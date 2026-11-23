// Bill calendar feed: an .ics URL you subscribe to in Google, Apple or Outlook calendar.
// Bills, subscriptions and paydays from a month back to six months ahead, as all-day events.
// The URL carries a secret token (users.cal_token), so anyone with the link can see the schedule;
// resetting the link makes a new token and the old one stops working.

const util = require(`${__hooks}/lib/util.js`);

const DAY = 86400000;
const msOf = (day) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const dayOf = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + "-" + util.pad(d.getUTCMonth() + 1) + "-" + util.pad(d.getUTCDate()); };
const compact = (day) => day.replace(/-/g, "");
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// lines longer than 75 octets are folded (continuation lines start with a space)
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = unescape(encodeURIComponent(ch)).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function urlFor(app, token) {
  return token ? `${app.settings().meta.appURL.replace(/\/$/, "")}/api/budget/feed/${token}.ics` : null;
}

function ensureToken(app, user, reset) {
  if (reset || !user.getString("cal_token")) {
    user.set("cal_token", $security.randomString(40));
    app.save(user);
  }
  return urlFor(app, user.getString("cal_token"));
}

function feed(app, user) {
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const ownerId = user.getString("household") || user.id;
  const today = util.today().slice(0, 10);
  const from = dayOf(msOf(today) - 31 * DAY), to = dayOf(msOf(today) + 183 * DAY);
  const exp = recurring.expected(app, ownerId, from, to);
  const base = app.settings().meta.appURL.replace(/\/$/, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Keel//Bills//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(app.settings().meta.appName || "Keel")} bills`, "X-WR-CALDESC:Bills\\, subscriptions and paydays from Keel",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  let n = 0;
  for (const it of exp.items) {
    if (it.status !== "active" || it.possibly_cancelled) continue;
    const pay = it.kind === "income";
    for (const d of recurring.occurrences(it, from, to)) {
      const amount = util.money(it.amount);
      lines.push("BEGIN:VEVENT",
        `UID:${it.id}-${compact(d)}@keel`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compact(d)}`,
        `DTEND;VALUE=DATE:${compact(dayOf(msOf(d) + DAY))}`,
        `SUMMARY:${esc(`${pay ? "💰" : it.kind === "subscription" ? "🔁" : "🧾"} ${it.name} ${pay ? "+" : ""}${amount}`)}`,
        `DESCRIPTION:${esc(`${pay ? "Expected paycheck" : it.kind === "subscription" ? "Subscription renews" : "Bill due"}: ${amount} (${it.frequency}).\nOpen Keel: ${base}/#/recurring`)}`,
        `CATEGORIES:${pay ? "Income" : it.kind === "subscription" ? "Subscription" : "Bill"}`,
        "TRANSP:TRANSPARENT",
        "END:VEVENT");
      n++;
    }
  }
  lines.push("END:VCALENDAR");
  return { ics: lines.map(fold).join("\r\n") + "\r\n", events: n };
}

module.exports = { feed, ensureToken, urlFor };
