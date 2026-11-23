// keel-push sends Web Push notifications for Keel's server hooks, which can't do the
// cryptography themselves (VAPID signing, RFC 8292, and aes128gcm payload encryption, RFC 8291).
// Standard library only.
//
//	keel-push keys          prints {"public":"...","private":"..."} (a new VAPID key pair, base64url)
//	keel-push send <json>   sends one payload to many subscriptions and prints one result each:
//	                        [{"endpoint":"...","status":201,"error":""}]
//
// The send job: {"public","private","subject","payload","ttl","urgency","topic",
// "subs":[{"endpoint","p256dh","auth"}]}
package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type sub struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

type job struct {
	Public  string `json:"public"`
	Private string `json:"private"`
	Subject string `json:"subject"`
	Payload string `json:"payload"`
	TTL     int    `json:"ttl"`
	Urgency string `json:"urgency"`
	Topic   string `json:"topic"`
	Subs    []sub  `json:"subs"`
}

type result struct {
	Endpoint string `json:"endpoint"`
	Status   int    `json:"status"`
	Error    string `json:"error"`
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func unb64(s string) ([]byte, error) {
	s = strings.TrimRight(strings.NewReplacer("+", "-", "/", "_").Replace(strings.TrimSpace(s)), "=")
	return base64.RawURLEncoding.DecodeString(s)
}

func hkdfExtract(salt, ikm []byte) []byte {
	m := hmac.New(sha256.New, salt)
	m.Write(ikm)
	return m.Sum(nil)
}

// one block is enough: every output here is 32 bytes or less
func hkdfExpand(prk, info []byte, n int) []byte {
	m := hmac.New(sha256.New, prk)
	m.Write(info)
	m.Write([]byte{1})
	return m.Sum(nil)[:n]
}

func keys() error {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]string{"public": b64(k.PublicKey().Bytes()), "private": b64(k.Bytes())})
}

// The VAPID JWT for one push service (aud is its origin), signed ES256.
func vapidJWT(priv *ecdsa.PrivateKey, endpoint, subject string) (string, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	head := b64([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, _ := json.Marshal(map[string]any{"aud": u.Scheme + "://" + u.Host, "exp": time.Now().Add(12 * time.Hour).Unix(), "sub": subject})
	signing := head + "." + b64(claims)
	h := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, priv, h[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return signing + "." + b64(sig), nil
}

// RFC 8291: encrypt the payload for one subscription (a single aes128gcm record).
func encrypt(s sub, payload []byte) ([]byte, error) {
	uaPub, err := unb64(s.P256dh)
	if err != nil {
		return nil, fmt.Errorf("p256dh: %w", err)
	}
	secret, err := unb64(s.Auth)
	if err != nil {
		return nil, fmt.Errorf("auth: %w", err)
	}
	uaKey, err := ecdh.P256().NewPublicKey(uaPub)
	if err != nil {
		return nil, fmt.Errorf("p256dh: %w", err)
	}
	as, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	shared, err := as.ECDH(uaKey)
	if err != nil {
		return nil, err
	}
	asPub := as.PublicKey().Bytes()
	info := append(append([]byte("WebPush: info\x00"), uaPub...), asPub...)
	ikm := hkdfExpand(hkdfExtract(secret, shared), info, 32)
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	prk := hkdfExtract(salt, ikm)
	cek := hkdfExpand(prk, []byte("Content-Encoding: aes128gcm\x00"), 16)
	nonce := hkdfExpand(prk, []byte("Content-Encoding: nonce\x00"), 12)
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sealed := gcm.Seal(nil, nonce, append(append([]byte{}, payload...), 2), nil) // 0x02: the last (only) record
	var body bytes.Buffer
	body.Write(salt)
	binary.Write(&body, binary.BigEndian, uint32(4096))
	body.WriteByte(byte(len(asPub)))
	body.Write(asPub)
	body.Write(sealed)
	return body.Bytes(), nil
}

func send(arg string) error {
	var j job
	if err := json.Unmarshal([]byte(arg), &j); err != nil {
		return fmt.Errorf("bad job: %w", err)
	}
	d, err := unb64(j.Private)
	if err != nil || len(d) != 32 {
		return errors.New("bad private key")
	}
	curve := elliptic.P256()
	priv := &ecdsa.PrivateKey{D: new(big.Int).SetBytes(d)}
	priv.PublicKey.Curve = curve
	priv.PublicKey.X, priv.PublicKey.Y = curve.ScalarBaseMult(d)
	if j.TTL <= 0 {
		j.TTL = 24 * 3600
	}
	if j.Urgency == "" {
		j.Urgency = "normal"
	}
	if j.Subject == "" {
		j.Subject = "mailto:keel@localhost"
	}
	client := &http.Client{Timeout: 15 * time.Second}
	out := make([]result, len(j.Subs))
	var wg sync.WaitGroup
	for i, s := range j.Subs {
		wg.Add(1)
		go func(i int, s sub) {
			defer wg.Done()
			out[i] = result{Endpoint: s.Endpoint}
			body, err := encrypt(s, []byte(j.Payload))
			if err != nil {
				out[i].Error = err.Error()
				return
			}
			jwt, err := vapidJWT(priv, s.Endpoint, j.Subject)
			if err != nil {
				out[i].Error = err.Error()
				return
			}
			req, err := http.NewRequest("POST", s.Endpoint, bytes.NewReader(body))
			if err != nil {
				out[i].Error = err.Error()
				return
			}
			req.Header.Set("Content-Encoding", "aes128gcm")
			req.Header.Set("Content-Type", "application/octet-stream")
			req.Header.Set("TTL", strconv.Itoa(j.TTL))
			req.Header.Set("Urgency", j.Urgency)
			if j.Topic != "" {
				req.Header.Set("Topic", j.Topic)
			}
			req.Header.Set("Authorization", "vapid t="+jwt+", k="+j.Public)
			res, err := client.Do(req)
			if err != nil {
				out[i].Error = err.Error()
				return
			}
			msg, _ := io.ReadAll(io.LimitReader(res.Body, 500))
			res.Body.Close()
			out[i].Status = res.StatusCode
			if res.StatusCode >= 300 {
				out[i].Error = strings.TrimSpace(string(msg))
			}
		}(i, s)
	}
	wg.Wait()
	return json.NewEncoder(os.Stdout).Encode(out)
}

func main() {
	var err error
	switch {
	case len(os.Args) == 2 && os.Args[1] == "keys":
		err = keys()
	case len(os.Args) == 3 && os.Args[1] == "send":
		err = send(os.Args[2])
	default:
		err = errors.New("usage: keel-push keys | keel-push send <json>")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
