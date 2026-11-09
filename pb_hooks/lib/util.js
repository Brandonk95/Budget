// Shared helpers. Loaded with require(`${__hooks}/lib/util.js`) inside handlers
// (PocketBase JSVM handlers can't see top-level variables of the hooks file).

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function b64encode(str) {
  const b = utf8Bytes(str);
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < b.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < b.length ? B64[n & 63] : "=";
  }
  return out;
}

function b64decode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = [];
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) |
      ((i + 2 < s.length ? B64.indexOf(s[i + 2]) : 0) << 6) | (i + 3 < s.length ? B64.indexOf(s[i + 3]) : 0);
    bytes.push((n >> 16) & 255);
    if (i + 2 < s.length) bytes.push((n >> 8) & 255);
    if (i + 3 < s.length) bytes.push(n & 255);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 31) << 6) | (bytes[++i] & 63));
    else if (c < 0xf0) out += String.fromCharCode(((c & 15) << 12) | ((bytes[++i] & 63) << 6) | (bytes[++i] & 63));
    else {
      const cp = ((c & 7) << 18) | ((bytes[++i] & 63) << 12) | ((bytes[++i] & 63) << 6) | (bytes[++i] & 63);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

const pad = (n) => (n < 10 ? "0" + n : "" + n);

// Local (container TZ) calendar date -> stored value at noon UTC so it never shifts a day.
function dateFromJs(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " 12:00:00.000Z";
}
function dateFromUnix(sec) { return dateFromJs(new Date(sec * 1000)); }
function today() { return dateFromJs(new Date()); }

function currentMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}

// "2026-11" -> { start, end, days, year, month }
function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || "") ? month : currentMonth();
  const year = parseInt(m.slice(0, 4), 10);
  const mon = parseInt(m.slice(5, 7), 10);
  const ny = mon === 12 ? year + 1 : year;
  const nm = mon === 12 ? 1 : mon + 1;
  const days = new Date(year, mon, 0).getDate();
  return {
    key: m, year, month: mon, days,
    start: year + "-" + pad(mon) + "-01 00:00:00.000Z",
    end: ny + "-" + pad(nm) + "-01 00:00:00.000Z",
  };
}

function shiftMonth(month, delta) {
  const r = monthRange(month);
  const d = new Date(r.year, r.month - 1 + delta, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

function money(n) {
  const v = round2(n);
  const s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (v < 0 ? "-$" : "$") + s;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function env(name, fallback) {
  const v = $os.getenv(name);
  return v === "" || v == null ? fallback : v;
}

function errMsg(err) {
  if (!err) return "unknown error";
  return String(err.message || err).slice(0, 1500);
}

module.exports = {
  b64encode, b64decode, dateFromJs, dateFromUnix, today, currentMonth, monthRange, shiftMonth,
  round2, money, esc, env, errMsg, pad,
};
