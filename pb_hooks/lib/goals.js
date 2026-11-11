// Goals: "have $X saved by <date>", either tracked by hand or following an account's balance.
// For a linked account the balance history comes from daily account_history snapshots; days before
// the first snapshot are rebuilt from the account's transactions (balance minus later activity).

const util = require(`${__hooks}/lib/util.js`);

const DAY = 86400000;
const pad = util.pad;
const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const msOf = (day) => new Date(day + "T12:00:00").getTime();
const daysBetween = (a, b) => Math.round((msOf(b) - msOf(a)) / DAY);
// accounts a savings goal can follow (debts would need a "pay down" goal instead)
const GOAL_TYPES = { checking: true, savings: true, investment: true, cash: true, other: true };
const r2 = util.round2;

function accountOf(app, userId, id) {
  if (!id) return null;
  try {
    const a = app.findRecordById("accounts", id);
    if (a.getString("user") !== userId) return null;
    return { id: a.id, name: a.getString("name"), institution: a.getString("institution"), type: a.getString("type") || "other", balance: a.getFloat("balance"), hidden: a.getBool("hidden") };
  } catch (_) { return null; }
}

// One value per day from `start` through today.
function accountSeries(app, userId, acc, start) {
  const today = dayOf(Date.now());
  const snaps = {};
  for (const s of app.findRecordsByFilter("account_history", "account = {:a} && day >= {:d}", "day", 0, 0, { a: acc.id, d: start })) {
    snaps[s.getString("day")] = s.getFloat("balance");
  }
  snaps[today] = acc.balance; // today is always live
  const firstSnap = Object.keys(snaps).sort()[0];
  const delta = {};
  if (start < firstSnap) {
    for (const t of app.findRecordsByFilter("transactions", "user = {:u} && account = {:a} && date >= {:s}", "", 0, 0, { u: userId, a: acc.id, s: start + " 00:00:00.000Z" })) {
      const d = t.getString("date").slice(0, 10);
      delta[d] = (delta[d] || 0) + t.getFloat("amount");
    }
  }
  const back = [];
  let v = snaps[firstSnap];
  for (let ms = msOf(firstSnap) - DAY; dayOf(ms) >= start; ms -= DAY) {
    v -= delta[dayOf(ms + DAY)] || 0;
    back.push({ day: dayOf(ms), value: r2(v), estimated: true });
  }
  back.reverse();
  const points = back;
  let last = snaps[firstSnap];
  for (let ms = msOf(firstSnap); dayOf(ms) <= today; ms += DAY) {
    const d = dayOf(ms);
    if (snaps[d] != null) last = snaps[d];
    points.push({ day: d, value: r2(last) });
  }
  return points;
}

// Everything the UI shows about one goal. `detail` adds the full history and monthly deposits.
function compute(app, userId, g, detail) {
  const today = dayOf(Date.now());
  const target = g.getFloat("target");
  const created = g.getString("created").slice(0, 10) || today;
  const startDay = g.getString("start_day") || created;
  const acc = accountOf(app, userId, g.getString("account"));
  const linked = !!acc;
  const current = linked ? acc.balance : g.getFloat("saved");
  const left = Math.max(0, target - current);
  const td = g.getString("target_date").slice(0, 10);
  const daysLeft = td ? daysBetween(today, td) : null;

  // history: enough for the 90-day pace and six months of deposits, back to the goal's start
  let series = [];
  if (linked) {
    const span = detail ? Math.max(200, Math.min(730, daysBetween(startDay, today) + 14)) : 90;
    series = accountSeries(app, userId, acc, dayOf(Date.now() - span * DAY));
  }
  const at = (day) => { for (let i = series.length - 1; i >= 0; i--) if (series[i].day <= day) return series[i].value; return series.length ? series[0].value : current; };

  let startAmount = g.getString("start_day") ? g.getFloat("start_amount") : null;
  if (startAmount == null) startAmount = linked ? at(startDay) : 0;

  // pace = average change per day recently (90 days, or since the goal started if sooner, min 14)
  let pace = null, paceDays = 0;
  if (linked && series.length > 1) {
    paceDays = Math.min(90, series.length - 1);
    pace = (current - series[series.length - 1 - paceDays].value) / paceDays;
  } else if (!linked) {
    paceDays = daysBetween(startDay, today);
    if (paceDays >= 14) pace = (current - startAmount) / paceDays;
  }
  const pace30 = linked && series.length > 30 ? (current - series[series.length - 31].value) / 30 : null;

  const perDay = left > 0 && daysLeft > 0 ? left / daysLeft : null;
  let projected = null;
  if (left > 0 && pace > 0.005) {
    const n = Math.ceil(left / pace);
    if (n < 365 * 50) projected = dayOf(Date.now() + n * DAY);
  }
  let status;
  if (left <= 0) status = "done";
  else if (!td) status = "no_date";
  else if (daysLeft <= 0) status = "overdue";
  else if (projected && projected <= td) status = "on_track";
  // no pace yet (a goal tracked by hand needs two weeks): too soon to call it behind
  else if (pace == null) status = "started";
  else status = "behind";

  const out = {
    id: g.id, name: g.getString("name"), target: r2(target), target_date: td, linked,
    account: acc ? { id: acc.id, name: acc.name, institution: acc.institution, type: acc.type } : null,
    current: r2(current), left: r2(left), pct: target > 0 ? Math.min(1, Math.max(0, current / target)) : 0,
    start_day: startDay, start_amount: r2(startAmount), since_start: r2(current - startAmount),
    days_left: daysLeft,
    per_day: perDay == null ? null : r2(perDay),
    per_week: perDay == null ? null : r2(perDay * 7),
    per_month: perDay == null ? null : r2(perDay * 30.44),
    pace_per_day: pace == null ? null : r2(pace), pace_days: paceDays,
    pace_30: pace30 == null ? null : r2(pace30),
    projected_date: projected, status,
    saved: r2(g.getFloat("saved")),
  };
  // sparkline: weekly points over the last 90 days
  if (linked) out.spark = series.filter((p, i) => (series.length - 1 - i) % 7 === 0).map((p) => p.value);

  if (detail) {
    out.history = series;
    // net deposits per calendar month, last 6 months (this month so far included)
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.getFullYear() + "-" + pad(d.getMonth() + 1);
      const endPrev = dayOf(d.getTime() - DAY);
      const end = i === 0 ? today : dayOf(new Date(now.getFullYear(), now.getMonth() - i + 1, 0).getTime());
      months.push({ month: key, change: linked && series.length && endPrev >= series[0].day ? r2(at(end) - at(endPrev)) : null });
    }
    out.months = months;
  }
  return out;
}

function list(app, userId) {
  const goals = app.findRecordsByFilter("goals", "user = {:u}", "target_date", 0, 0, { u: userId }).map((g) => compute(app, userId, g, false));
  // undated goals after dated ones, finished goals last
  goals.sort((a, b) => (a.status === "done") - (b.status === "done") || (!a.target_date) - (!b.target_date) || (a.target_date || "").localeCompare(b.target_date || ""));
  let saved = 0, target = 0, monthly = 0;
  for (const g of goals) { saved += Math.min(g.current, g.target); target += g.target; if (g.per_month) monthly += g.per_month; }
  return { goals, totals: { saved: r2(saved), target: r2(target), per_month: r2(monthly) } };
}

function detail(app, userId, id) {
  let g;
  try { g = app.findRecordById("goals", id); } catch (_) { throw new NotFoundError("Goal not found."); }
  if (g.getString("user") !== userId) throw new NotFoundError("Goal not found.");
  return compute(app, userId, g, true);
}

// Daily: remember every account's balance so goal charts use real numbers going forward.
function snapshotAccounts(app, userId) {
  const day = dayOf(Date.now());
  const col = app.findCollectionByNameOrId("account_history");
  for (const a of app.findRecordsByFilter("accounts", "user = {:u}", "", 0, 0, { u: userId })) {
    let r;
    try { r = app.findFirstRecordByFilter("account_history", "account = {:a} && day = {:d}", { a: a.id, d: day }); } catch (_) {
      r = new Record(col);
      r.set("user", userId);
      r.set("account", a.id);
      r.set("day", day);
    }
    r.set("balance", a.getFloat("balance"));
    app.save(r);
  }
}

// Monthly amount still needed across dated goals (used by the budget insights).
function monthlyNeed(app, userId) {
  let total = 0;
  for (const g of list(app, userId).goals) if (g.per_month) total += g.per_month;
  return total;
}

module.exports = { list, detail, snapshotAccounts, monthlyNeed, GOAL_TYPES };
