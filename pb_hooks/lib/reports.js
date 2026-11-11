// Month and year in review: income against spending, savings rate, top merchants,
// the categories that changed most, and what subscriptions cost.
// Counts money the same way as the Spending page: on-budget accounts, excluded and transfer
// transactions left out, split purchases counted as their parts, refunds netted against spending.

const util = require(`${__hooks}/lib/util.js`);

const r2 = util.round2;
const pad = (n) => (n < 10 ? "0" : "") + n;

function loadCats(app, userId) {
  const cats = {};
  for (const c of app.findRecordsByFilter("categories", "user = {:u}", "", 0, 0, { u: userId })) {
    cats[c.id] = { id: c.id, name: c.getString("name"), kind: c.getString("kind"), icon: c.getString("icon") };
  }
  return cats;
}

function subscriptionKeys(app, userId) {
  const keys = {};
  for (const r of app.findRecordsByFilter("recurring", "user = {:u} && kind = 'subscription'", "", 0, 0, { u: userId })) {
    if (r.getString("merchant_key")) keys[r.getString("merchant_key")] = { id: r.id, name: r.getString("name"), status: r.getString("status") };
  }
  return keys;
}

// Totals for [start, end). dayLimit (1-31) keeps only days of the month up to that day,
// so a month in progress can be compared with earlier months at the same point.
function period(app, userId, start, end, ctx, dayLimit) {
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const raw = app.findRecordsByFilter("transactions",
    "user = {:u} && account.on_budget = true && exclude = false && date >= {:s} && date < {:e}",
    "date", 0, 0, { u: userId, s: start, e: end })
    .filter((t) => !dayLimit || Number(t.getString("date").slice(8, 10)) <= dayLimit)
    .map((t) => ({
      id: t.id, date: t.getString("date"), amount: t.getFloat("amount"), category: t.getString("category"),
      payee: t.getString("payee"), description: t.getString("description"), split: t.getBool("split"),
    }));
  const txs = require(`${__hooks}/lib/splits.js`).expand(app, userId, raw, start, end);
  const out = { income: 0, spent: 0, purchases: 0, byCat: {}, byMerchant: {}, byMonth: {}, subs: {}, largest: [] };
  for (const t of txs) {
    const c = ctx.cats[t.category];
    if (c && c.kind === "transfer") continue;
    const m = t.date.slice(0, 7);
    const mo = (out.byMonth[m] = out.byMonth[m] || { income: 0, spent: 0 });
    if ((c && c.kind === "income") || (!c && t.amount > 0)) {
      out.income += t.amount; mo.income += t.amount;
      continue;
    }
    out.spent -= t.amount; mo.spent -= t.amount;
    const key = c ? c.id : "";
    out.byCat[key] = (out.byCat[key] || 0) - t.amount;
    if (t.amount >= 0) continue;
    const name = t.payee || t.description || "Unknown";
    const mk = recurring.normalizePayee(name) || name.toLowerCase();
    const x = (out.byMerchant[mk] = out.byMerchant[mk] || { name, total: 0, count: 0 });
    x.total -= t.amount;
    if (!t.part) { x.count++; out.purchases++; }
    const sub = ctx.subs[mk];
    if (sub) {
      const s = (out.subs[sub.id] = out.subs[sub.id] || { id: sub.id, name: sub.name, status: sub.status, total: 0, count: 0 });
      s.total -= t.amount; if (!t.part) s.count++;
    }
    if (!t.part) out.largest.push({ id: t.id, name, date: t.date.slice(0, 10), amount: r2(-t.amount), category: key });
  }
  out.largest.sort((a, b) => b.amount - a.amount);
  out.largest = out.largest.slice(0, 5);
  out.net = out.income - out.spent;
  return out;
}

const rate = (p) => (p.income > 0 ? Math.round((p.net / p.income) * 1000) / 10 : null);
const summary = (p) => ({ income: r2(p.income), spent: r2(Math.max(0, p.spent)), net: r2(p.net), savings_rate: rate(p), purchases: p.purchases });

function merchants(p, n) {
  return Object.values(p.byMerchant).map((x) => ({ name: x.name, total: r2(x.total), count: x.count }))
    .filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, n);
}

function subscriptions(p) {
  const items = Object.values(p.subs).map((s) => ({ id: s.id, name: s.name, status: s.status, total: r2(s.total), count: s.count }))
    .filter((s) => s.total > 0).sort((a, b) => b.total - a.total);
  return { total: r2(items.reduce((s, x) => s + x.total, 0)), items };
}

// Every category with this period's total next to the comparison, and the biggest moves both ways.
function categories(ctx, cur, base) {
  const ids = {};
  for (const k in cur.byCat) ids[k] = true;
  for (const k in base) ids[k] = true;
  const list = Object.keys(ids).map((id) => {
    const c = ctx.cats[id] || { name: "Uncategorized", icon: "", kind: "" };
    const total = r2(Math.max(0, cur.byCat[id] || 0)), before = r2(Math.max(0, base[id] || 0));
    return { id, name: c.name, icon: c.icon, kind: c.kind, total, before, change: r2(total - before) };
  }).filter((c) => c.total > 0 || c.before > 0);
  list.sort((a, b) => b.total - a.total);
  // ignore pocket change so a $3 → $9 category doesn't top the list
  const moved = list.filter((c) => Math.abs(c.change) >= 10);
  return {
    list,
    up: moved.filter((c) => c.change > 0).sort((a, b) => b.change - a.change).slice(0, 3),
    down: moved.filter((c) => c.change < 0).sort((a, b) => a.change - b.change).slice(0, 3),
  };
}

function month(app, userId, key) {
  const ctx = { cats: loadCats(app, userId), subs: subscriptionKeys(app, userId) };
  const r = util.monthRange(key);
  const isCurrent = r.key === util.currentMonth();
  const limit = isCurrent ? Number(util.today().slice(8, 10)) : 0;
  const cur = period(app, userId, r.start, r.end, ctx);
  const prevKey = util.shiftMonth(r.key, -1);
  const pr = util.monthRange(prevKey);
  const prev = period(app, userId, pr.start, pr.end, ctx, limit);
  // categories compare against the average of the three months before, at the same point in the month
  const base = {};
  let baseMonths = 0;
  for (let i = 1; i <= 3; i++) {
    const m = util.monthRange(util.shiftMonth(r.key, -i));
    const p = i === 1 ? prev : period(app, userId, m.start, m.end, ctx, limit);
    if (!(p.spent > 0 || p.income > 0)) continue;
    baseMonths++;
    for (const k in p.byCat) base[k] = (base[k] || 0) + p.byCat[k];
  }
  for (const k in base) base[k] /= baseMonths || 1;
  const cats = categories(ctx, cur, base);
  if (!baseMonths) cats.up = cats.down = []; // nothing earlier to compare with
  return Object.assign({
    kind: "month", key: r.key, is_current: isCurrent, day: limit || r.days, days: r.days,
  }, summary(cur), {
    prev: Object.assign({ key: prevKey }, summary(prev), { partial: !!limit, has_data: prev.spent > 0 || prev.income > 0 }),
    compare_months: baseMonths,
    categories: cats.list, up: cats.up, down: cats.down,
    merchants: merchants(cur, 8), largest: cur.largest, subscriptions: subscriptions(cur),
  });
}

function year(app, userId, y) {
  y = Number(y) || new Date().getFullYear();
  const ctx = { cats: loadCats(app, userId), subs: subscriptionKeys(app, userId) };
  const start = `${y}-01-01 00:00:00.000Z`, end = `${y + 1}-01-01 00:00:00.000Z`;
  const cur = period(app, userId, start, end, ctx);
  const nowKey = util.currentMonth();
  const isCurrent = Number(nowKey.slice(0, 4)) === y;
  // last year up to the same point, so a year in progress isn't compared with a whole one
  const prevEnd = isCurrent ? util.monthRange(util.shiftMonth(nowKey.replace(/^\d{4}/, String(y - 1)), 1)).start : start;
  const prev = period(app, userId, `${y - 1}-01-01 00:00:00.000Z`, prevEnd, ctx);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const k = `${y}-${pad(m)}`;
    const v = cur.byMonth[k];
    months.push({ month: k, future: k > nowKey, income: r2(v ? v.income : 0), spent: r2(v ? Math.max(0, v.spent) : 0) });
  }
  const active = months.filter((m) => !m.future && (m.spent > 0 || m.income > 0));
  // best and worst only among finished months; the one in progress isn't over yet
  const byNet = active.filter((m) => m.month !== nowKey).sort((a, b) => (b.income - b.spent) - (a.income - a.spent));
  const cats = categories(ctx, cur, prev.byCat);
  if (!(prev.spent > 0 || prev.income > 0)) cats.up = cats.down = [];
  return Object.assign({
    kind: "year", year: y, is_current: isCurrent, months_with_data: active.length,
  }, summary(cur), {
    prev: Object.assign({ year: y - 1 }, summary(prev), { partial: isCurrent, has_data: prev.spent > 0 || prev.income > 0 }),
    months,
    best_month: byNet.length > 1 ? byNet[0] : null,
    worst_month: byNet.length > 1 ? byNet[byNet.length - 1] : null,
    avg_spent: active.length ? r2(active.reduce((s, m) => s + m.spent, 0) / active.length) : 0,
    categories: cats.list, up: cats.up, down: cats.down,
    merchants: merchants(cur, 10), largest: cur.largest, subscriptions: subscriptions(cur),
  });
}

// The 1st of each month: last month in review, by email.
// `force` skips the date check (for testing).
function monthlyEmail(app, user, force) {
  if (!user.getBool("monthly_report") || !user.getString("email")) return false;
  if (!force && new Date().getDate() !== 1) return false;
  const notify = require(`${__hooks}/lib/notify.js`);
  const key = util.shiftMonth(util.currentMonth(), -1);
  const rep = month(app, user.id, key);
  if (!(rep.spent > 0 || rep.income > 0)) return false;
  if (!notify.claimKey(app, user.id, "report:" + key)) return false;
  const [yy, mm] = key.split("-").map(Number);
  const label = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][mm - 1] + " " + yy;
  const diff = rep.prev.has_data ? rep.spent - rep.prev.spent : null;
  const sign = (n) => (n >= 0 ? "+" : "−") + util.money(Math.abs(n));
  const movers = rep.up.concat(rep.down).map((c) => notify.row([util.esc(c.name), util.money(c.total), `<span style="color:${c.change > 0 ? "#c93d48" : "#0f7a52"}">${sign(c.change)}</span>`]));
  const merch = rep.merchants.slice(0, 5).map((m) => notify.row([util.esc(m.name), `${m.count}×`, util.money(m.total)]));
  const url = app.settings().meta.appURL;
  const html = notify.layout(app, `${label} in review`, `
    <p>You brought in <b>${util.money(rep.income)}</b> and spent <b>${util.money(rep.spent)}</b>${rep.income > 0 ? `, so you ${rep.net >= 0 ? "kept" : "were short"} <b>${util.money(Math.abs(rep.net))}</b>${rep.savings_rate != null && rep.net > 0 ? ` (${rep.savings_rate}% of income)` : ""}` : ""}.</p>
    ${diff != null ? `<p>That's ${util.money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} spending than the month before.</p>` : ""}
    ${movers.length ? `<h3 style="font-size:15px;margin:20px 0 6px">Biggest changes</h3><p style="margin:0 0 6px;color:#5f6b80;font-size:13px">Compared with your ${rep.compare_months}-month average</p>${notify.table(movers)}` : ""}
    ${merch.length ? `<h3 style="font-size:15px;margin:20px 0 6px">Where it went</h3>${notify.table(merch)}` : ""}
    ${rep.subscriptions.total ? `<p>Subscriptions cost <b>${util.money(rep.subscriptions.total)}</b> this month.</p>` : ""}`,
    { button: { label: "See the full report", href: `${url}/#/reports` } });
  return notify.send(app, user.getString("email"), `${label}: ${util.money(rep.spent)} spent${rep.savings_rate != null && rep.net > 0 ? `, ${rep.savings_rate}% saved` : ""}`, html);
}

module.exports = { month, year, monthlyEmail };
