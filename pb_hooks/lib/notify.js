// Email notifications over the SMTP settings configured from env (see setup.js).

const util = require(`${__hooks}/lib/util.js`);

function smtpReady(app) {
  return app.settings().smtp.enabled;
}

// Email clients fetch images through their own proxies (Gmail does), which can't reach a home or LAN
// server, so the logo comes from the public repo instead of APP_URL.
const LOGO_URL = "https://raw.githubusercontent.com/Brandonk95/Budget/main/pb_public/brand/logo.png";

function monthName(key) {
  const [y, m] = String(key).split("-").map(Number);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return names[m - 1] ? `${names[m - 1]} ${y}` : key;
}
const days = (n) => `${n} day${n === 1 ? "" : "s"}`;

// Each email has a tone: a colored header with an emoji badge, and a matching button.
const TONES = {
  blue: ["#2f74ff", "#0d47c9", "#eaf1ff", "#155eef"],
  green: ["#14a874", "#0b6e4c", "#e3f6ee", "#0f7a52"],
  amber: ["#f08c1a", "#b4530a", "#fff3e0", "#9a5208"],
  red: ["#e04b5a", "#a3202f", "#fdecee", "#c93d48"],
  purple: ["#6a5cf0", "#3b2fb8", "#efedff", "#5143d1"],
};
const tone = (t) => TONES[t] || TONES.blue;

// opts.button: { label, href } replaces the "Open Keel" button (null hides it); opts.footer replaces the footer line.
// opts.tone (blue|green|amber|red|purple), opts.icon (an emoji), opts.kicker (small label over the title),
// opts.stat + opts.statLabel (a big number in the header).
function layout(app, title, bodyHtml, opts) {
  opts = opts || {};
  const url = app.settings().meta.appURL;
  const name = app.settings().meta.appName;
  const [a, b, , ink] = tone(opts.tone);
  const btn = opts.button === undefined ? { label: `Open ${name}`, href: url } : opts.button;
  const footer = opts.footer ? util.esc(opts.footer)
    : `You can change which emails you get in <a href="${util.esc(url)}/#/settings" style="color:#5f6b80;text-decoration:underline">Settings</a>.`;
  const head = `<div style="background-color:${a};background-image:linear-gradient(135deg,${a} 0%,${b} 100%);padding:24px 24px ${opts.stat ? 22 : 24}px;color:#ffffff">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
${opts.icon ? `<td style="width:48px;height:48px;border-radius:14px;background-color:rgba(255,255,255,.2);text-align:center;vertical-align:middle;font-size:24px;line-height:48px">${opts.icon}</td>` : ""}
<td style="${opts.icon ? "padding-left:14px;" : ""}vertical-align:middle">
${opts.kicker ? `<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.82)">${util.esc(opts.kicker)}</div>` : ""}
<div style="font-size:21px;font-weight:700;letter-spacing:-.01em;line-height:1.25;color:#ffffff">${util.esc(title)}</div></td></tr></table>
${opts.stat ? `<div style="margin-top:18px;font-size:36px;font-weight:800;letter-spacing:-.02em;line-height:1.1;color:#ffffff">${opts.stat}</div>${opts.statLabel ? `<div style="font-size:14px;color:rgba(255,255,255,.85);margin-top:4px">${opts.statLabel}</div>` : ""}` : ""}
</div>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#eef2f8;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#172033;line-height:1.5">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
${name === "Keel" ? `<div style="text-align:center;margin:0 0 16px"><img src="${LOGO_URL}" alt="Keel" width="120" height="68" style="border-radius:12px;display:inline-block;border:0"></div>` : ""}
<div style="background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e3e8f0;box-shadow:0 10px 30px rgba(23,32,51,.07)">
${head}
<div style="padding:22px 24px 26px;font-size:15px">${bodyHtml}
${btn ? `<p style="margin:24px 0 0"><a href="${util.esc(btn.href)}" style="background-color:${ink};color:#ffffff;padding:12px 20px;border-radius:12px;text-decoration:none;display:inline-block;font-weight:700">${util.esc(btn.label)} &rarr;</a></p>` : ""}
</div></div>
<p style="color:#5f6b80;font-size:12px;text-align:center;margin:18px 0 0">${footer}</p></div></body></html>`;
}

// ---- building blocks for email bodies (inline styles only; email clients ignore stylesheets)
const MUTED = "#5f6b80";
// a row of small tiles: [{ label, value, color }]
function stats(items) {
  items = items.filter(Boolean);
  if (!items.length) return "";
  const w = Math.floor(100 / items.length);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0;margin:4px 0 8px"><tr>${items.map((it, i) =>
    `<td style="width:${w}%;vertical-align:top;${i ? "padding-left:8px;" : ""}"><div style="background:#f5f7fa;border-radius:12px;padding:12px 14px">
      <div style="font-size:12px;color:${MUTED}">${it.label}</div><div style="font-size:18px;font-weight:700;color:${it.color || "#172033"};white-space:nowrap">${it.value}</div>${it.sub ? `<div style="font-size:12px;color:${MUTED};white-space:nowrap">${it.sub}</div>` : ""}</div></td>`).join("")}</tr></table>`;
}
// a progress bar
function bar(pct, color) {
  const w = Math.max(2, Math.min(100, Math.round(pct || 0)));
  return `<div style="height:8px;background:#e9edf3;border-radius:99px;overflow:hidden"><div style="width:${w}%;height:8px;background:${color};border-radius:99px"></div></div>`;
}
const barColor = (pct, warnAt) => (pct >= 100 ? TONES.red[3] : pct >= (warnAt || 90) ? TONES.amber[0] : TONES.blue[3]);
// a labelled bar: name on the left, value on the right, the bar underneath
function meter(label, right, pct, color) {
  return `<div style="padding:9px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:6px"><tr>
    <td style="font-size:14px;font-weight:600">${label}</td><td style="font-size:14px;text-align:right;color:${MUTED};white-space:nowrap">${right}</td></tr></table>${bar(pct, color)}</div>`;
}
function pill(text, t) {
  const [, , soft, ink] = tone(t);
  return `<span style="display:inline-block;font-size:12px;font-weight:700;padding:1px 9px;border-radius:99px;background:${soft};color:${ink};vertical-align:1px">${text}</span>`;
}
const section = (emoji, title) => `<h3 style="font-size:15px;margin:24px 0 6px;font-weight:700">${emoji ? `<span style="margin-right:6px">${emoji}</span>` : ""}${title}</h3>`;
function callout(html, t, emoji) {
  const [a, , soft] = tone(t);
  return `<div style="background:${soft};border-left:4px solid ${a};border-radius:10px;padding:12px 14px;margin:16px 0 0;font-size:14px">${emoji ? `<span style="margin-right:6px">${emoji}</span>` : ""}${html}</div>`;
}

function send(app, to, subject, html) {
  if (!smtpReady(app)) {
    app.logger().warn("SMTP not configured; skipped email", "subject", subject, "to", to);
    return false;
  }
  const meta = app.settings().meta;
  const msg = new MailerMessage({
    from: { address: meta.senderAddress, name: meta.senderName },
    to: [{ address: to }],
    subject,
    html,
  });
  app.newMailClient().send(msg);
  return true;
}

// Returns true if `key` had not been sent before (and records it).
function claimKey(app, userId, key) {
  try {
    app.findFirstRecordByFilter("alerts_sent", "user = {:u} && key = {:k}", { u: userId, k: key });
    return false;
  } catch (_) {
    const r = new Record(app.findCollectionByNameOrId("alerts_sent"));
    r.set("user", userId);
    r.set("key", key);
    app.save(r);
    return true;
  }
}

function row(cells, bold) {
  return "<tr>" + cells.map((c, i) =>
    `<td style="padding:10px 4px;border-bottom:1px solid #eef1f5;${i ? "text-align:right;white-space:nowrap;" : "font-weight:600;"}${bold ? `font-weight:700;font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;` : ""}">${c}</td>`,
  ).join("") + "</tr>";
}
const table = (rows) => `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:4px 0">${rows.join("")}</table>`;

function checkBudgets(app, user) {
  if (!user.getBool("alerts_enabled") || !user.getString("email")) return 0;
  const insights = require(`${__hooks}/lib/insights.js`);
  const threshold = user.getInt("alert_threshold") || 90;
  const data = insights.compute(app, require(`${__hooks}/lib/household.js`).ownerId(user), util.currentMonth());
  const hits = [];
  for (const c of data.categories) {
    if (c.kind === "income" || !(c.budget > 0) || c.pct == null) continue;
    let level = "";
    if (c.pct >= 100) level = "over";
    else if (c.pct >= threshold) level = "warn";
    if (!level) continue;
    if (claimKey(app, user.id, `budget:${c.id}:${data.month}:${level}`)) hits.push({ c, level });
  }
  if (!hits.length) return 0;
  const meters = hits.map(({ c, level }) => meter(`${util.esc(c.name)} ${level === "over" ? pill("over", "red") : pill(`${c.pct}%`, "amber")}`,
    `${util.money(c.spent)} of ${util.money(c.budget)}`, c.pct, level === "over" ? TONES.red[3] : TONES.amber[0])).join("");
  const over = hits.filter((h) => h.level === "over").length;
  const subject = over ? `You've passed ${over} budget${over > 1 ? "s" : ""}` : `You're getting close to a budget`;
  send(app, user.getString("email"), subject, layout(app, subject,
    `<p style="margin:0 0 6px">Here's where things stand for ${monthName(data.month)}, with ${days(data.remaining_days)} to go:</p>${meters}
     ${callout(`Across everything, you can still spend about <b>${util.money(data.safe_per_day)} a day</b> and stay on budget.`, "blue", "💡")}`,
    { tone: over ? "red" : "amber", icon: over ? "🚨" : "⚠️", kicker: "Budget alert", button: { label: "Open your budget", href: `${app.settings().meta.appURL}/#/budget` } }));
  return hits.length;
}

function largeTransactions(app, user, txs) {
  const limit = user.getFloat("large_txn_threshold");
  if (!user.getBool("alerts_enabled") || !(limit > 0) || !txs.length) return 0;
  const cutoff = util.dateFromJs(new Date(Date.now() - 4 * 86400000));
  const big = txs.filter((t) => -t.getFloat("amount") >= limit && t.getString("date") >= cutoff)
    .filter((t) => claimKey(app, user.id, "large:" + t.id));
  if (!big.length) return 0;
  const rows = big.map((t) => row([util.esc(t.getString("payee") || t.getString("description")), t.getString("date").slice(0, 10), util.money(t.getFloat("amount"))]));
  const sum = big.reduce((s2, t) => s2 - t.getFloat("amount"), 0);
  send(app, user.getString("email"), `Large transaction${big.length > 1 ? "s" : ""} detected`,
    layout(app, big.length > 1 ? `${big.length} big charges` : "A big charge", `<p style="margin:0 0 4px">${big.length > 1 ? "These charges are" : "This charge is"} at or above your ${util.money(limit)} alert:</p>${table(rows)}
      ${callout("Not you? Contact your bank right away.", "red", "🔒")}`,
    { tone: "purple", icon: "💳", kicker: "Large transaction", stat: util.money(sum), statLabel: big.length > 1 ? `across ${big.length} charges` : util.esc(big[0].getString("payee") || big[0].getString("description")) }));
  return big.length;
}

function syncFailed(app, user, conn, message) {
  const key = `syncerr:${conn.id}:${util.today().slice(0, 10)}`;
  if (!claimKey(app, user.id, key)) return;
  send(app, user.getString("email"), "Bank sync failed",
    layout(app, "Bank sync failed", `<p style="margin:0">We couldn't refresh <b>${util.esc(conn.getString("name") || "your bank")}</b>:</p>
      <pre style="white-space:pre-wrap;background:#f5f7fa;padding:12px;border-radius:10px;font-size:13px">${util.esc(message)}</pre>
      ${callout("Keel will try again on the next sync. If it keeps happening, reconnect the bank from the Accounts page.", "blue", "🔁")}`,
    { tone: "red", icon: "🔌", kicker: "Bank connection", button: { label: "Open Accounts", href: `${app.settings().meta.appURL}/#/accounts` } }));
}

// Emails bills/subscriptions due in the next `days` days (each occurrence once).
function billReminders(app, user, days) {
  days = days || 3;
  if (!user.getBool("bill_reminders") || !user.getString("email")) return 0;
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const data = recurring.list(app, require(`${__hooks}/lib/household.js`).ownerId(user), util.currentMonth());
  const due = data.upcoming.filter((u) => u.kind !== "income" && u.days_until >= 0 && u.days_until <= days)
    .filter((u) => claimKey(app, user.id, `bill:${u.id}:${u.date}`));
  if (!due.length) return 0;
  const total = due.reduce((s, u) => s + u.amount, 0);
  const when = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
  const short = (d) => { const [, m, dd] = String(d).slice(0, 10).split("-").map(Number); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${dd}`; };
  const rows = due.map((u) => row([util.esc(u.name), `${short(u.date)}<div style="font-size:12px;color:${u.days_until <= 1 ? TONES.red[3] : MUTED}">${when(u.days_until)}</div>`, util.money(u.amount)]));
  const subject = due.length === 1 ? `${due[0].name} is due ${when(due[0].days_until)}` : `${due.length} bills due soon (${util.money(total)})`;
  send(app, user.getString("email"), subject, layout(app, due.length === 1 ? "A bill is due soon" : "Bills due soon",
    `<p style="margin:0 0 4px">Make sure there's enough in the account to cover ${due.length === 1 ? "it" : "these"}:</p>${table(rows)}`,
    { tone: "amber", icon: "🗓️", kicker: "Bill reminder", stat: util.money(total), statLabel: `due in the next ${days} days`, button: { label: "See what's coming up", href: `${app.settings().meta.appURL}/#/recurring` } }));
  return due.length;
}

function digest(app, user) {
  const insights = require(`${__hooks}/lib/insights.js`);
  const data = insights.compute(app, require(`${__hooks}/lib/household.js`).ownerId(user), util.currentMonth());
  const weekAgo = util.dateFromJs(new Date(Date.now() - 7 * 86400000));
  const week = app.findRecordsByFilter("transactions", "user = {:u} && date >= {:d} && account.on_budget = true && exclude = false && amount < 0 &&(category = '' || category.kind != 'transfer')", "amount", 0, 0, { u: require(`${__hooks}/lib/household.js`).ownerId(user), d: weekAgo });
  const weekSpend = week.reduce((s, t) => s - t.getFloat("amount"), 0);
  const top = week.slice(0, 5).map((t) => row([util.esc(t.getString("payee") || t.getString("description")), util.money(t.getFloat("amount"))]));

  const warnAt = user.getInt("alert_threshold") || 90;
  const cats = data.categories.filter((c) => c.kind !== "income" && c.budget > 0)
    .sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, 6)
    .map((c) => meter(util.esc(c.name), `${util.money(c.spent)} of ${util.money(c.budget)}`, c.pct, barColor(c.pct, warnAt)));

  let bills = [];
  try {
    bills = require(`${__hooks}/lib/recurring.js`).list(app, require(`${__hooks}/lib/household.js`).ownerId(user), util.currentMonth()).upcoming
      .filter((u) => u.kind !== "income" && u.days_until >= 0 && u.days_until <= 7)
      .map((u) => row([util.esc(u.name), u.date.slice(5), util.money(u.amount)]));
  } catch (_) {}
  const tips = data.tips.slice(0, 3).map((t) => callout(util.esc(t.text), "blue", "💡")).join("");
  const first = (user.getString("name") || "").trim().split(/\s+/)[0];
  const usedPct = data.budgeted > 0 ? Math.round((data.spent / data.budgeted) * 100) : null;
  const html = layout(app, first ? `Hi ${first}, here's your week` : "Here's your week", `
    ${stats([
      { label: "Month so far", value: util.money(data.spent), sub: data.budgeted > 0 ? `of ${util.money(data.budgeted)}` : "" },
      { label: "Safe per day", value: util.money(data.safe_per_day), sub: `${days(data.remaining_days)} left`, color: TONES.blue[3] },
      { label: "Income", value: util.money(data.income), sub: monthName(data.month).split(" ")[0], color: TONES.green[3] },
    ])}
    ${usedPct != null ? `<div style="margin:12px 0 0">${meter("Budget used", `${usedPct}%`, usedPct, barColor(usedPct, warnAt))}</div>` : ""}
    ${cats.length ? `${section("📊", "Categories to watch")}${cats.join("")}` : ""}
    ${bills.length ? `${section("🗓️", "Bills due in the next 7 days")}${table(bills)}` : ""}
    ${top.length ? `${section("🛍️", "Biggest purchases this week")}${table(top)}` : ""}
    ${tips ? `${section("", "Ideas for the rest of the month")}${tips}` : ""}`,
    { tone: "blue", icon: "👋", kicker: "Weekly check-in", stat: util.money(weekSpend), statLabel: "spent in the last 7 days" });
  return send(app, user.getString("email"), `Weekly budget: ${util.money(weekSpend)} spent this week`, html);
}

module.exports = { send, layout, claimKey, row, table, stats, bar, meter, pill, section, callout, TONES, checkBudgets, largeTransactions, syncFailed, digest, billReminders, smtpReady };
