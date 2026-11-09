// Email notifications over the SMTP settings configured from env (see setup.js).

const util = require(`${__hooks}/lib/util.js`);

function smtpReady(app) {
  return app.settings().smtp.enabled;
}

function layout(app, title, bodyHtml) {
  const url = app.settings().meta.appURL;
  const name = app.settings().meta.appName;
  return `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#172033;line-height:1.5">
<div style="max-width:560px;margin:0 auto;padding:24px">
${name === "Keel" && /^https?:\/\//.test(url) ? `<div style="text-align:center;margin:0 0 16px"><img src="${util.esc(url.replace(/\/$/, ""))}/brand/logo.png" alt="Keel" width="150" style="border-radius:12px;display:inline-block"></div>` : ""}
<div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #e5eaf1">
<h2 style="margin:0 0 16px;font-size:20px;font-weight:600;letter-spacing:-.01em">${util.esc(title)}</h2>${bodyHtml}
<p style="margin:24px 0 0"><a href="${util.esc(url)}" style="background:#155eef;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;display:inline-block;font-weight:600">Open ${util.esc(name)}</a></p>
</div><p style="color:#5f6b80;font-size:12px;text-align:center">You can change email preferences in Settings.</p></div></body></html>`;
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
    app.findFirstRecordByFilter("alerts_sent", "key = {:k}", { k: key });
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
    `<td style="padding:6px 4px;border-bottom:1px solid #e5eaf1;${i ? "text-align:right;" : ""}${bold ? "font-weight:600;" : ""}">${c}</td>`,
  ).join("") + "</tr>";
}
const table = (rows) => `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.join("")}</table>`;

function checkBudgets(app, user) {
  if (!user.getBool("alerts_enabled") || !user.getString("email")) return 0;
  const insights = require(`${__hooks}/lib/insights.js`);
  const threshold = user.getInt("alert_threshold") || 90;
  const data = insights.compute(app, user.id, util.currentMonth());
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
  const rows = [row(["Category", "Spent", "Budget"], true)].concat(hits.map(({ c, level }) =>
    row([`${util.esc(c.icon)} ${util.esc(c.name)} ${level === "over" ? "🔴" : "🟡"}`, util.money(c.spent), util.money(c.budget)])));
  const over = hits.filter((h) => h.level === "over").length;
  const subject = over ? `You've passed ${over} budget${over > 1 ? "s" : ""}` : `You're getting close to a budget`;
  send(app, user.getString("email"), subject, layout(app, subject,
    `<p>Here's where things stand for ${data.month}, with ${data.remaining_days} day(s) to go:</p>${table(rows)}
     <p>Safe to spend: <b>${util.money(data.safe_per_day)}/day</b> across all categories.</p>`));
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
  send(app, user.getString("email"), `Large transaction${big.length > 1 ? "s" : ""} detected`,
    layout(app, "Large transactions", `<p>These charges are at or above your ${util.money(limit)} alert:</p>${table(rows)}<p>Not you? Contact your bank right away.</p>`));
  return big.length;
}

function syncFailed(app, user, conn, message) {
  const key = `syncerr:${conn.id}:${util.today().slice(0, 10)}`;
  if (!claimKey(app, user.id, key)) return;
  send(app, user.getString("email"), "Bank sync failed",
    layout(app, "Bank sync failed", `<p>We couldn't refresh <b>${util.esc(conn.getString("name") || "your bank")}</b>:</p>
      <pre style="white-space:pre-wrap;background:#f5f7fa;padding:12px;border-radius:10px">${util.esc(message)}</pre>
      <p>Keel will try again on the next sync. If it keeps happening, reconnect the bank from the Accounts page.</p>`));
}

// Emails bills/subscriptions due in the next `days` days (each occurrence once).
function billReminders(app, user, days) {
  days = days || 3;
  if (!user.getBool("bill_reminders") || !user.getString("email")) return 0;
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const data = recurring.list(app, user.id, util.currentMonth());
  const due = data.upcoming.filter((u) => u.kind !== "income" && u.days_until >= 0 && u.days_until <= days)
    .filter((u) => claimKey(app, user.id, `bill:${u.id}:${u.date}`));
  if (!due.length) return 0;
  const total = due.reduce((s, u) => s + u.amount, 0);
  const when = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
  const rows = due.map((u) => row([util.esc(u.name), `${u.date.slice(5)} (${when(u.days_until)})`, util.money(u.amount)]));
  const subject = due.length === 1 ? `${due[0].name} is due ${when(due[0].days_until)}` : `${due.length} bills due soon (${util.money(total)})`;
  send(app, user.getString("email"), subject, layout(app, "Upcoming bills",
    `<p>Make sure there's enough in the account to cover these:</p>${table(rows)}<p>Total: <b>${util.money(total)}</b></p>`));
  return due.length;
}

function digest(app, user) {
  const insights = require(`${__hooks}/lib/insights.js`);
  const data = insights.compute(app, user.id, util.currentMonth());
  const weekAgo = util.dateFromJs(new Date(Date.now() - 7 * 86400000));
  const week = app.findRecordsByFilter("transactions", "user = {:u} && date >= {:d} && account.on_budget = true && exclude = false && amount < 0 &&(category = '' || category.kind != 'transfer')", "amount", 0, 0, { u: user.id, d: weekAgo });
  const weekSpend = week.reduce((s, t) => s - t.getFloat("amount"), 0);
  const top = week.slice(0, 5).map((t) => row([util.esc(t.getString("payee") || t.getString("description")), util.money(t.getFloat("amount"))]));

  const cats = data.categories.filter((c) => c.kind !== "income" && (c.budget > 0 || c.spent > 0))
    .sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, 8)
    .map((c) => row([`${util.esc(c.icon)} ${util.esc(c.name)}`, util.money(c.spent), c.budget ? util.money(c.budget) : "—", c.pct != null ? c.pct + "%" : ""]));

  let bills = [];
  try {
    bills = require(`${__hooks}/lib/recurring.js`).list(app, user.id, util.currentMonth()).upcoming
      .filter((u) => u.kind !== "income" && u.days_until >= 0 && u.days_until <= 7)
      .map((u) => row([util.esc(u.name), u.date.slice(5), util.money(u.amount)]));
  } catch (_) {}
  const tips = data.tips.slice(0, 5).map((t) => `<li style="margin-bottom:6px">${util.esc(t.text)}</li>`).join("");
  const html = layout(app, `Your weekly budget check-in`, `
    <p>Last 7 days you spent <b>${util.money(weekSpend)}</b>. Month to date: <b>${util.money(data.spent)}</b> of <b>${util.money(data.budgeted)}</b> budgeted, income <b>${util.money(data.income)}</b>.</p>
    <p>Safe to spend for the rest of ${data.month}: <b>${util.money(data.safe_per_day)}/day</b> (${data.remaining_days} days left).</p>
    ${cats.length ? `<h3 style="font-size:15px;margin:20px 0 6px">Categories</h3>${table([row(["", "Spent", "Budget", "Used"], true)].concat(cats))}` : ""}
    ${bills.length ? `<h3 style="font-size:15px;margin:20px 0 6px">Bills due in the next 7 days</h3>${table(bills)}` : ""}
    ${top.length ? `<h3 style="font-size:15px;margin:20px 0 6px">Biggest purchases this week</h3>${table(top)}` : ""}
    ${tips ? `<h3 style="font-size:15px;margin:20px 0 6px">Tips</h3><ul style="padding-left:18px;margin:0">${tips}</ul>` : ""}`);
  return send(app, user.getString("email"), `Weekly budget: ${util.money(weekSpend)} spent this week`, html);
}

module.exports = { send, layout, checkBudgets, largeTransactions, syncFailed, digest, billReminders, smtpReady };
