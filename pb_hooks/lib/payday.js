// Paycheck to paycheck: what's safe to spend until the next paycheck lands, and a plan for the
// last one (bills due before the next payday, a share for goals, the rest to spend).
//   until payday = checking and cash today
//                  - bills due from those accounts before payday
//                  - the cash-flow warning level, kept as a cushion
//   paycheck plan = the latest paycheck
//                  - every bill due between it and the next one (card bills too: the card gets paid from it)
//                  - this pay period's share of what your goals need per month
//                  = spending money for the pay period

const util = require(`${__hooks}/lib/util.js`);

const DAY = 86400000;
const CASH_TYPES = { checking: true, cash: true };
// how far back the latest paycheck may be, per frequency, and still count as "this pay period"
const PERIOD_DAYS = { weekly: 7, biweekly: 14, monthly: 31, quarterly: 92, yearly: 366 };
const r2 = util.round2;
const msOf = (day) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const dayOf = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + "-" + util.pad(d.getUTCMonth() + 1) + "-" + util.pad(d.getUTCDate()); };
const daysBetween = (a, b) => Math.round((msOf(b) - msOf(a)) / DAY);
const sum = (list) => r2(list.reduce((s, x) => s + x.amount, 0));

function compute(app, userId) {
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const today = util.today().slice(0, 10);
  const user = app.findRecordById("users", userId);
  const accounts = app.findRecordsByFilter("accounts", "user = {:u} && hidden = false", "", 0, 0, { u: userId })
    .filter((a) => CASH_TYPES[a.getString("type")]);
  const inSet = {};
  for (const a of accounts) inSet[a.id] = true;
  const balance = r2(accounts.reduce((s, a) => s + a.getFloat("balance"), 0));

  // a paycheck or bill a few days late still counts: it just hasn't posted yet
  const exp = recurring.expected(app, userId, dayOf(msOf(today) - 5 * DAY), dayOf(msOf(today) + 400 * DAY));
  const sources = exp.items.filter((it) => it.status === "active" && it.kind === "income");
  if (!sources.length) return { today, has_income: false };
  const next = exp.events.find((e) => e.kind === "income");
  if (!next) return { today, has_income: true, next: null };
  const payday = next.date < today ? today : next.date;
  const daysLeft = daysBetween(today, payday);

  // ---- until payday
  const bills = exp.events
    .filter((e) => e.kind !== "income" && e.date < payday && (!e.account || inSet[e.account]))
    .map((e) => ({ id: e.id, name: e.name, date: e.date < today ? today : e.date, late: e.date < today, amount: r2(e.amount) }));
  const cushion = Math.max(0, r2(user.getFloat("cash_floor")));
  const safe = r2(balance - sum(bills) - cushion);
  const until = {
    balance, accounts: accounts.length, bills, bills_total: sum(bills), cushion, safe,
    per_day: daysLeft > 0 ? r2(Math.max(0, safe) / daysLeft) : null,
  };

  // ---- plan for the latest paycheck from a source Keel knows
  let last = null;
  for (const it of sources) {
    if (!it.merchant_key) continue;
    const oldest = dayOf(msOf(today) - ((PERIOD_DAYS[it.frequency] || 31) + 7) * DAY);
    for (const t of exp.txIndex[it.merchant_key + "|in"] || []) {
      const d = t.date.slice(0, 10);
      if (d < oldest || d > today) continue;
      if (!last || d > last.date) last = { date: d, amount: r2(t.amount), name: it.name, frequency: it.frequency, it };
    }
  }
  let plan = null;
  if (last) {
    // the pay period runs to the next paycheck still to come: this job's next one, or another
    // source's if it lands sooner (one that's already overdue doesn't cut the period short)
    const after = dayOf(msOf(last.date) + DAY);
    let end = recurring.occurrences(last.it, after, dayOf(msOf(last.date) + 400 * DAY))[0]
      || dayOf(msOf(last.date) + (PERIOD_DAYS[last.frequency] || 14) * DAY);
    for (const e of exp.events) if (e.kind === "income" && e.date >= today && e.date > last.date && e.date < end) end = e.date;
    const days = Math.max(1, daysBetween(last.date, end));
    const lastDay = dayOf(msOf(end) - DAY);
    const unpaid = {};
    for (const e of exp.events) unpaid[e.id + "|" + e.date] = true;
    const due = [];
    for (const it of exp.items) {
      if (it.kind === "income" || it.status !== "active" || it.possibly_cancelled) continue;
      for (const d of recurring.occurrences(it, last.date, lastDay)) {
        due.push({ id: it.id, name: it.name, date: d, amount: r2(it.amount), paid: d < dayOf(msOf(today) - 5 * DAY) || !unpaid[it.id + "|" + d] });
      }
    }
    due.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const goals = [];
    try {
      for (const g of require(`${__hooks}/lib/goals.js`).list(app, userId).goals) {
        if (g.status === "done" || !(g.per_month > 0)) continue;
        goals.push({ id: g.id, name: g.name, amount: r2((g.per_month * days) / 30.44) });
      }
    } catch (_) {}
    const spending = r2(last.amount - sum(due) - sum(goals));
    plan = {
      name: last.name, date: last.date, amount: last.amount, next_date: end, days,
      bills: due, bills_total: sum(due), goals, goals_total: sum(goals),
      spending, per_day: r2(Math.max(0, spending) / days),
    };
  }

  return {
    today, has_income: true,
    next: { name: next.name, date: payday, amount: r2(next.amount), late: next.date < today, days: daysLeft },
    until, plan,
  };
}

module.exports = { compute };
