// Spending breakdown: by category and merchant for a month, plus a 6-month history.

const util = require(`${__hooks}/lib/util.js`);

function compute(app, userId, monthKey) {
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const r = util.monthRange(monthKey);
  const histStart = util.monthRange(util.shiftMonth(r.key, -5)).start;
  const cats = {};
  for (const c of app.findRecordsByFilter("categories", "user = {:u}", "", 0, 0, { u: userId })) {
    cats[c.id] = { id: c.id, name: c.getString("name"), kind: c.getString("kind"), icon: c.getString("icon") };
  }
  const txs = app.findRecordsByFilter(
    "transactions",
    "user = {:u} && account.on_budget = true && exclude = false && date >= {:s} && date < {:e}",
    "date", 0, 0, { u: userId, s: histStart, e: r.end },
  );

  const months = {};
  for (let i = 5; i >= 0; i--) months[util.shiftMonth(r.key, -i)] = { total: 0, cat: {}, toDate: 0 };
  // pace: compare the current month with earlier months up to the same day of the month
  const isCurrent = r.key === util.currentMonth();
  const dayOfMonth = isCurrent ? Number(util.today().slice(8, 10)) : 31;
  const byCat = {}, byMerchant = {};
  let total = 0, count = 0, income = 0;

  for (const t of txs) {
    const amt = t.getFloat("amount");
    const cid = t.getString("category");
    const c = cats[cid];
    if (c && c.kind === "transfer") continue;
    const m = t.getString("date").slice(0, 7);
    if ((c && c.kind === "income") || (!c && amt > 0)) {
      if (m === r.key) income += amt;
      continue;
    }
    const key = c ? c.id : "";
    const mo = months[m];
    if (mo) {
      mo.cat[key] = (mo.cat[key] || 0) - amt;
      if (Number(t.getString("date").slice(8, 10)) <= dayOfMonth) mo.toDate -= amt;
    }
    if (m !== r.key) continue;
    const b = (byCat[key] = byCat[key] || { id: key, total: 0, count: 0 });
    b.total -= amt;
    b.count++;
    if (amt < 0) {
      const name = t.getString("payee") || t.getString("description");
      const mk = recurring.normalizePayee(name) || name.toLowerCase();
      const x = (byMerchant[mk] = byMerchant[mk] || { name, total: 0, count: 0, category: key });
      x.total -= amt;
      x.count++;
      count++;
    }
  }

  const categories = Object.values(byCat).map((b) => {
    const c = cats[b.id] || { name: "Uncategorized", icon: "❔", kind: "" };
    return { id: b.id, name: c.name, icon: c.icon, kind: c.kind, total: util.round2(Math.max(0, b.total)), count: b.count };
  }).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  total = categories.reduce((s, c) => s + c.total, 0);
  for (const c of categories) c.pct = total ? Math.round((c.total / total) * 1000) / 10 : 0;

  const merchants = Object.values(byMerchant).map((x) => ({ name: x.name, total: util.round2(x.total), count: x.count, category: x.category }))
    .sort((a, b) => b.total - a.total).slice(0, 15);

  const trend = Object.keys(months).map((k) => {
    const mo = months[k];
    let t = 0;
    const per = {};
    for (const id in mo.cat) { const v = Math.max(0, mo.cat[id]); per[id] = util.round2(v); t += v; }
    return { month: k, total: util.round2(t), categories: per };
  });
  const prior = trend.slice(0, -1).filter((x) => x.total > 0);
  const avg = prior.length ? prior.reduce((s, x) => s + x.total, 0) / prior.length : 0;
  const priorKeys = prior.map((x) => x.month);
  const avgToDate = priorKeys.length ? priorKeys.reduce((s, k) => s + Math.max(0, months[k].toDate), 0) / priorKeys.length : 0;

  return {
    month: r.key, total: util.round2(total), income: util.round2(income), transactions: count,
    average: util.round2(avg), average_to_date: util.round2(avgToDate), is_current: isCurrent, day: dayOfMonth,
    months_compared: priorKeys.length, categories, merchants, trend,
  };
}

module.exports = { compute };
