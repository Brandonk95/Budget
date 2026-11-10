// Cash-flow forecast: where your spending accounts (checking and cash) are headed day by day.
//   balance today
//   + paychecks and other recurring income on their expected dates
//   - bills and subscriptions on their due dates (unless they're charged to a card)
//   - everyday spending at your usual daily rate (the last 90 days of non-recurring outflows,
//     card payments and transfers out included, since those leave checking too)

const util = require(`${__hooks}/lib/util.js`);

const DAY = 86400000;
const LOOKBACK = 90;
const CASH_TYPES = { checking: true, cash: true };
const r2 = util.round2;
const dayOf = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + "-" + util.pad(d.getUTCMonth() + 1) + "-" + util.pad(d.getUTCDate()); };
const msOf = (day) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d); };

function forecast(app, userId, opts) {
  opts = opts || {};
  const days = Math.max(14, Math.min(120, opts.days || 45));
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const user = app.findRecordById("users", userId);
  const floor = user.getFloat("cash_floor");

  const all = app.findRecordsByFilter("accounts", "user = {:u} && hidden = false", "name", 0, 0, { u: userId }).map((a) => ({
    id: a.id, name: a.getString("name"), institution: a.getString("institution"), type: a.getString("type") || "other", balance: a.getFloat("balance"),
  }));
  const chosen = opts.accounts && opts.accounts.length ? opts.accounts : all.filter((a) => CASH_TYPES[a.type]).map((a) => a.id);
  const inSet = {};
  for (const id of chosen) inSet[id] = true;
  const accounts = all.filter((a) => inSet[a.id]);
  const choices = all.filter((a) => a.type !== "credit" && a.type !== "loan").map((a) => ({ id: a.id, name: a.name, institution: a.institution, type: a.type, balance: r2(a.balance), selected: !!inSet[a.id] }));
  if (!accounts.length) return { days, accounts: [], choices, floor, points: [], empty: true };

  const today = util.today().slice(0, 10);
  const end = dayOf(msOf(today) + days * DAY);
  const start = accounts.reduce((s, a) => s + a.balance, 0);

  // recurring events; a few days overdue still counts (it just hasn't posted yet), placed on today
  const exp = recurring.expected(app, userId, dayOf(msOf(today) - 5 * DAY), end);
  const recKeys = {};
  for (const it of exp.items) if (it.status === "active" && it.merchant_key) recKeys[it.merchant_key + "|" + (it.kind === "income" ? "in" : "out")] = true;
  const events = [];
  for (const e of exp.events) {
    // charged to an account outside this forecast (a credit card, say): it hits that account, not this one
    if (e.account && !inSet[e.account]) continue;
    const day = e.date < today ? today : e.date;
    events.push({ day, id: e.id, name: e.name, kind: e.kind, amount: r2(e.kind === "income" ? e.amount : -e.amount), late: e.date < today });
  }
  const hasIncome = exp.items.some((it) => it.status === "active" && it.kind === "income");

  // everyday rate from the forecast accounts' own history
  const since = dayOf(msOf(today) - LOOKBACK * DAY);
  const txs = app.findRecordsByFilter("transactions", "user = {:u} && date >= {:s} && date < {:e}", "", 0, 0,
    { u: userId, s: since + " 00:00:00.000Z", e: today + " 00:00:00.000Z" }).filter((t) => inSet[t.getString("account")]);
  // moves between two forecast accounts cancel out: skip matched pairs (same amount, within 3 days)
  const skip = {};
  const ins = txs.filter((t) => t.getFloat("amount") > 0);
  for (const t of txs) {
    const amt = t.getFloat("amount");
    if (amt >= 0) continue;
    const d = msOf(t.getString("date").slice(0, 10));
    const m = ins.find((x) => !skip[x.id] && x.getString("account") !== t.getString("account") && Math.abs(x.getFloat("amount") + amt) < 0.01 && Math.abs(msOf(x.getString("date").slice(0, 10)) - d) <= 3 * DAY);
    if (m) { skip[m.id] = true; skip[t.id] = true; }
  }
  // how much history there is (a new account shouldn't be divided by 90 days)
  let first = today;
  for (const t of txs) { const d = t.getString("date").slice(0, 10); if (d < first) first = d; }
  const span = Math.max(14, Math.min(LOOKBACK, Math.round((msOf(today) - msOf(first)) / DAY)));
  let out = 0, inn = 0;
  for (const t of txs) {
    if (skip[t.id]) continue;
    const amt = t.getFloat("amount");
    const key = recurring.normalizePayee(t.getString("payee") || t.getString("description")) + "|" + (amt > 0 ? "in" : "out");
    if (recKeys[key]) continue; // already on the calendar
    if (amt < 0) out += -amt; else inn += amt;
  }
  const spendPerDay = txs.length ? out / span : 0;
  // irregular deposits only count when no paycheck was detected (otherwise stay conservative)
  const otherInPerDay = !hasIncome && txs.length ? inn / span : 0;

  const byDay = {};
  for (const e of events) (byDay[e.day] = byDay[e.day] || []).push(e);
  const points = [];
  let bal = start, low = { day: today, balance: start };
  let belowDay = null;
  for (let i = 0; i <= days; i++) {
    const day = dayOf(msOf(today) + i * DAY);
    if (i > 0) bal += otherInPerDay - spendPerDay;
    const ev = byDay[day] || [];
    for (const e of ev) bal += e.amount;
    points.push({ day, balance: r2(bal), events: ev });
    if (bal < low.balance) low = { day, balance: r2(bal) };
    if (belowDay == null && bal < floor) belowDay = day;
  }
  const nextIncome = events.find((e) => e.kind === "income" && e.day > today) || null;
  // lowest point before the next paycheck lands
  let beforePay = null;
  if (nextIncome) {
    for (const p of points) {
      if (p.day >= nextIncome.day) break;
      if (!beforePay || p.balance < beforePay.balance) beforePay = { day: p.day, balance: p.balance };
    }
  }
  const sum = (k) => r2(events.filter((e) => (k === "income" ? e.kind === "income" : e.kind !== "income")).reduce((s, e) => s + Math.abs(e.amount), 0));
  return {
    today, days, floor, start: r2(start), end_balance: points[points.length - 1].balance,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, institution: a.institution, type: a.type, balance: r2(a.balance) })),
    choices, has_income: hasIncome,
    spend_per_day: r2(spendPerDay), other_in_per_day: r2(otherInPerDay), lookback_days: span,
    income_total: sum("income"), bills_total: sum("bills"), spend_total: r2(spendPerDay * days),
    low, before_payday: beforePay, next_income: nextIncome, below_floor_day: belowDay,
    points,
  };
}

// Daily: email once a week at most when checking is headed below the user's floor in the next 14 days.
function lowBalanceAlert(app, user) {
  if (!user.getBool("cash_alerts") || !user.getString("email")) return false;
  const f = forecast(app, user.id, { days: 14 });
  if (f.empty || !f.below_floor_day) return false;
  const notify = require(`${__hooks}/lib/notify.js`);
  const monday = new Date(); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  if (!notify.claimKey(app, user.id, `cashlow:${dayOf(monday.getTime())}`)) return false;
  const pt = f.points.find((p) => p.day === f.below_floor_day);
  const pretty = (d) => { const x = new Date(msOf(d)); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x.getUTCDay()] + ", " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][x.getUTCMonth()] + " " + x.getUTCDate(); };
  const upcoming = f.points.filter((p) => p.day <= f.below_floor_day).flatMap((p) => p.events.map((e) => Object.assign({}, e, { day: p.day }))).filter((e) => e.kind !== "income").slice(0, 8);
  const rows = upcoming.map((e) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eef1f5">${util.esc(e.name)}</td><td style="padding:6px 0;border-bottom:1px solid #eef1f5;color:#5f6b80">${pretty(e.day)}</td><td style="padding:6px 0;border-bottom:1px solid #eef1f5;text-align:right">${util.money(Math.abs(e.amount))}</td></tr>`).join("");
  notify.send(app, user.getString("email"), "Checking may run low",
    notify.layout(app, "Checking may run low", `<p>Your checking balance is projected to drop to <b>${util.money(pt.balance)}</b> around <b>${pretty(f.below_floor_day)}</b>, below your ${util.money(f.floor)} warning level.</p>
      ${f.next_income ? `<p>Your next expected deposit is ${util.esc(f.next_income.name)} (${util.money(f.next_income.amount)}) on ${pretty(f.next_income.day)}.</p>` : ""}
      ${rows ? `<p style="margin-bottom:4px">Coming out before then:</p><table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` : ""}
      <p style="color:#5f6b80;font-size:13px">This assumes about ${util.money(f.spend_per_day)} a day of everyday spending, your usual rate.</p>`));
  return true;
}

module.exports = { forecast, lowBalanceAlert };
