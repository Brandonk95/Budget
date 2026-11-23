// Phone and browser notifications (Web Push). Each device that turns them on in Settings is a
// push_subs row. The server's VAPID keys are made on first use and kept in app_kv. The sending
// itself (encryption, signing, the HTTP call) is done by the keel-push helper in the image.
//
// Every alert email also goes out as a notification to that person's devices (see notify.send),
// so the same Settings switches control both. Digest-style emails opt out.

const util = require(`${__hooks}/lib/util.js`);
const BIN = "/usr/local/bin/keel-push";

function available() {
  try { $os.stat(BIN); return true; } catch (_) { return false; }
}

function kvGet(app, key) {
  try { return app.findFirstRecordByFilter("app_kv", "key = {:k}", { k: key }).getString("value"); } catch (_) { return ""; }
}
function kvSet(app, key, value) {
  let r;
  try { r = app.findFirstRecordByFilter("app_kv", "key = {:k}", { k: key }); } catch (_) { r = new Record(app.findCollectionByNameOrId("app_kv")); r.set("key", key); }
  r.set("value", value);
  app.save(r);
}

function run(args) {
  const raw = $os.cmd(BIN, ...args).output();
  return JSON.parse(toString(raw));
}

function keys(app) {
  const saved = kvGet(app, "vapid");
  if (saved) return JSON.parse(saved);
  const k = run(["keys"]);
  kvSet(app, "vapid", JSON.stringify(k));
  return k;
}

function publicKey(app) {
  if (!available()) return null;
  try { return keys(app).public; } catch (err) { app.logger().error("push keys", "error", util.errMsg(err)); return null; }
}

function subscribe(app, userId, body) {
  const ep = String(body.endpoint || "");
  const k = body.keys || {};
  if (!/^https:\/\//.test(ep) || !k.p256dh || !k.auth) throw new Error("That isn't a valid push subscription.");
  let r;
  try { r = app.findFirstRecordByFilter("push_subs", "endpoint = {:e}", { e: ep }); } catch (_) { r = new Record(app.findCollectionByNameOrId("push_subs")); r.set("endpoint", ep); }
  r.set("user", userId);
  r.set("p256dh", String(k.p256dh));
  r.set("auth", String(k.auth));
  r.set("label", String(body.label || "").slice(0, 120));
  app.save(r);
  return { ok: true };
}

function unsubscribe(app, userId, endpoint) {
  try {
    const r = app.findFirstRecordByFilter("push_subs", "endpoint = {:e} && user = {:u}", { e: String(endpoint || ""), u: userId });
    app.delete(r);
  } catch (_) {}
  return { ok: true };
}

// Send { title, body, url, tag } to every device of these users. Returns how many got it.
function sendTo(app, userIds, msg) {
  if (!userIds.length || !available()) return 0;
  const subs = [];
  for (const id of userIds) for (const s of app.findRecordsByFilter("push_subs", "user = {:u}", "", 0, 0, { u: id })) subs.push(s);
  if (!subs.length) return 0;
  const k = keys(app);
  const meta = app.settings().meta;
  const base = (meta.appURL || "").replace(/\/$/, "");
  const job = {
    public: k.public, private: k.private,
    subject: meta.senderAddress ? "mailto:" + meta.senderAddress : (/^https:/.test(base) ? base : "mailto:keel@localhost"),
    payload: JSON.stringify({ title: msg.title || meta.appName || "Keel", body: msg.body || "", url: msg.url || "/", tag: msg.tag || "" }),
    ttl: msg.ttl || 24 * 3600, urgency: msg.urgency || "normal",
    subs: subs.map((s) => ({ endpoint: s.getString("endpoint"), p256dh: s.getString("p256dh"), auth: s.getString("auth") })),
  };
  let results = [];
  try { results = run(["send", JSON.stringify(job)]); } catch (err) { app.logger().error("push send", "error", util.errMsg(err)); return 0; }
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status >= 200 && r.status < 300) ok++;
    // the browser unsubscribed or the subscription expired: forget it
    else if (r.status === 404 || r.status === 410) { try { app.delete(subs[i]); } catch (_) {} }
    else app.logger().warn("push failed", "status", r.status, "error", r.error);
  });
  return ok;
}

// An alert email's twin: find the person by email, push the subject, link to where the email's button goes.
function fromEmail(app, to, subject, html) {
  if (!available()) return 0;
  let user;
  try { user = app.findAuthRecordByEmail("users", to); } catch (_) { return 0; }
  const meta = app.settings().meta;
  const base = (meta.appURL || "").replace(/\/$/, "");
  let url = "/";
  const m = /href="([^"]+#\/[^"]*)"/.exec(html || "");
  if (m && m[1].indexOf(base) === 0) url = m[1].slice(base.length) || "/";
  return sendTo(app, [user.id], { title: meta.appName || "Keel", body: subject, url, tag: subject.slice(0, 40) });
}

module.exports = { available, publicKey, subscribe, unsubscribe, sendTo, fromEmail };
