// Budget analysis: spending vs budget, pace projection, history-based suggestions,
// recurring-charge detection and plain-language tips.

const util = require(`${__hooks}/lib/util.js`);

const HISTORY_MONTHS = 6;

function normalizePayee(s) {
  return String(s || "").toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/\b(pos|debit|purchase|ach|card|checkcard|recurring|payment|www|com|inc|llc)\b/g, " ")
    .replace(/[^a-z& ]+/g, " ")
    .replace(/\s+/g, " ").trim()
    .split(" ").slice(0, 3).join(" ");
}

function detectRecurring(txs, catById) {
  const groups = {};
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const cat = catById[t.category];
    if (cat && (cat.kind === "transfer" || cat.kind === "income")) continue;
    const key = normalizePayee(t.payee || t.description);
    if (!key || key.length < 3) continue;
    (groups[key] = groups[key] || []).push(t);
  }
  const out = [];
  for (const key in groups) {
    const g = groups[key].sort((a, b) => (a.date < b.date ? -1 : 1));
    const months = {};
    for (const t of g) months[t.date.slice(0, 7)] = true;
    const monthCount = Object.keys(months).length;
    if (monthCount < 3 || g.length > monthCount * 2) continue; // need ~monthly cadence
    const amts = g.map((t) => -t.amount);
    const mean = amts.reduce((a, b) => a + b, 0) / amts.length;
    const sd = Math.sqrt(amts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / amts.length);
    if (mean < 1 || sd > mean * 0.15) continue;
    const last = g[g.length - 1];
    out.push({
      name: last.payee || last.description,
      amount: util.round2(mean),
      months: monthCount,
      last_date: last.date.slice(0, 10),
      category: last.category || "",
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

function compute(app, userId, monthKey) {
  const r = util.monthRange(monthKey);
  const histStart = util.monthRange(util.shiftMonth(r.key, -HISTORY_MONTHS)).start;
  const now = new Date();
  const isCurrent = r.key === util.currentMonth();
  const isFuture = r.start > util.today();
  const elapsed = isCurrent ? now.getDate() : (isFuture ? 0 : r.days);
  const remainingDays = isCurrent ? r.days - now.getDate() + 1 : 0;

  const cats = app.findRecordsByFilter("categories", "user = {:u}", "name", 0, 0, { u: userId }).map((c) => ({
    id: c.id, name: c.getString("name"), kind: c.getString("kind"), budget: c.getFloat("budget"),
    icon: c.getString("icon"), archived: c.getBool("archived"),
  }));
  const catById = {};
  for (const c of cats) catById[c.id] = c;

  const txs = app.findRecordsByFilter(
    "transactions",
    "user = {:u} && account.on_budget = true && date >= {:s} && date < {:e}",
    "date", 0, 0, { u: userId, s: histStart, e: r.end },
  ).map((t) => ({
    id: t.id, date: t.getString("date"), amount: t.getFloat("amount"), category: t.getString("category"),
    description: t.getString("description"), payee: t.getString("payee"),
  }));

  // per month, per category net amounts
  const byMonth = {}; // month -> { income, spend, cat: {id: net}, uncat }
  const blank = () => ({ income: 0, spend: 0, needs: 0, wants: 0, savings: 0, cat: {}, uncatSpend: 0, uncatCount: 0 });
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    const b = (byMonth[m] = byMonth[m] || blank());
    const c = catById[t.category];
    if (c && c.kind === "transfer") continue;
    if (c && c.kind === "income") { b.income += t.amount; continue; }
    if (!c) {
      if (t.amount > 0) b.income += t.amount;
      else { b.uncatSpend += -t.amount; b.spend += -t.amount; }
      b.uncatCount++;
      continue;
    }
    b.cat[c.id] = (b.cat[c.id] || 0) + t.amount;
  }
  for (const m in byMonth) {
    const b = byMonth[m];
    for (const id in b.cat) {
      const spent = Math.max(0, -b.cat[id]);
      b.spend += spent;
      b[catById[id].kind] += spent;
    }
  }

  const cur = byMonth[r.key] || blank();
  const pastKeys = [];
  for (let i = 1; i <= 3; i++) pastKeys.push(util.shiftMonth(r.key, -i));
  const pastWithData = pastKeys.filter((k) => byMonth[k]);
  const avg = (fn) => (pastWithData.length ? pastWithData.reduce((s, k) => s + fn(byMonth[k]), 0) / pastWithData.length : 0);

  const w = r.days ? elapsed / r.days : 1;
  const categories = cats.filter((c) => c.kind !== "transfer" && !c.archived).map((c) => {
    const spent = c.kind === "income" ? 0 : Math.max(0, -(cur.cat[c.id] || 0));
    const avg3 = avg((b) => Math.max(0, -(b.cat[c.id] || 0)));
    let projected = spent;
    if (isCurrent && c.kind !== "income") {
      if (c.kind === "wants") {
        const pace = elapsed ? (spent / elapsed) * r.days : 0;
        projected = Math.max(spent, pace * w + avg3 * (1 - w));
      } else {
        projected = Math.max(spent, avg3);
      }
    }
    const suggested = avg3 > 0 ? Math.ceil(avg3 / 5) * 5 : 0;
    return {
      id: c.id, name: c.name, kind: c.kind, icon: c.icon, budget: c.budget,
      spent: util.round2(spent), remaining: util.round2(c.budget - spent),
      pct: c.budget > 0 ? Math.round((spent / c.budget) * 100) : null,
      projected: util.round2(projected), avg3: util.round2(avg3), suggested,
    };
  });

  const spendCats = categories.filter((c) => c.kind !== "income");
  const totalBudget = spendCats.reduce((s, c) => s + c.budget, 0);
  const income = cur.income;
  const avgIncome = avg((b) => b.income);
  const expectedIncome = Math.max(income, avgIncome);
  const spent = cur.spend;
  const projectedSpend = spendCats.reduce((s, c) => s + c.projected, 0) + cur.uncatSpend;
  const budgetLeft = totalBudget - spent;
  const safePerDay = remainingDays > 0 ? Math.max(0, budgetLeft) / remainingDays : 0;

  // 50/30/20 split on this month's (or typical) income
  const base = expectedIncome || 1;
  const split = {
    needs: util.round2(cur.needs), wants: util.round2(cur.wants), savings: util.round2(cur.savings),
    needs_pct: Math.round((cur.needs / base) * 100),
    wants_pct: Math.round((cur.wants / base) * 100),
    savings_pct: Math.round(((expectedIncome - cur.needs - cur.wants) / base) * 100),
  };

  const recurring = detectRecurring(txs, catById);
  const recurringTotal = recurring.reduce((s, x) => s + x.amount, 0);

  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const k = util.shiftMonth(r.key, -i);
    const b = byMonth[k] || blank();
    trend.push({ month: k, income: util.round2(b.income), spend: util.round2(b.spend) });
  }

  // ---- tips ----
  const tips = [];
  const money = util.money;
  for (const c of spendCats) {
    if (c.budget > 0 && c.spent > c.budget) {
      tips.push({ level: "bad", text: `${c.icon} ${c.name} is over budget by ${money(c.spent - c.budget)}.` });
    } else if (isCurrent && c.budget > 0 && c.projected > c.budget * 1.05) {
      tips.push({ level: "warn", text: `${c.icon} ${c.name} is on pace for ${money(c.projected)} vs a ${money(c.budget)} budget — ${money(Math.max(0, c.budget - c.spent) / Math.max(1, remainingDays))}/day keeps you on track.` });
    }
    if (c.budget === 0 && c.spent > 0) {
      tips.push({ level: "info", text: `${c.icon} ${c.name} has ${money(c.spent)} spent but no budget. Suggested: ${money(c.suggested || Math.ceil(c.spent / 5) * 5)}.` });
    }
  }
  if (cur.uncatCount > 0) {
    tips.push({ level: "info", text: `${cur.uncatCount} transaction(s) this month are uncategorized. Categorize them (and create rules) so your budget is accurate.` });
  }
  if (expectedIncome > 0) {
    const unassigned = expectedIncome - totalBudget;
    if (unassigned > 50) {
      tips.push({ level: "good", text: `${money(unassigned)} of your typical income isn't assigned to a category. Give every dollar a job — put it toward a goal or savings.` });
    } else if (unassigned < -50) {
      tips.push({ level: "bad", text: `You've budgeted ${money(-unassigned)} more than your typical income (${money(expectedIncome)}).` });
    }
    const savingsRate = (expectedIncome - projectedSpend + cur.savings) / expectedIncome;
    if (savingsRate < 0.1 && !isFuture) {
      tips.push({ level: "warn", text: `Projected savings rate is ${Math.round(savingsRate * 100)}%. Aim for at least 10–20% of income.` });
    }
    if (split.wants_pct > 30) {
      tips.push({ level: "info", text: `Wants are ${split.wants_pct}% of income (50/30/20 guideline: 30%).` });
    }
  }
  if (recurringTotal > 0) {
    tips.push({ level: "info", text: `You have ~${money(recurringTotal)}/month in recurring charges across ${recurring.length} merchants. Review them for anything you no longer use.` });
  }
  if (!txs.length) {
    tips.push({ level: "info", text: "No transactions yet. Connect a bank on the Accounts page or import a CSV." });
  }

  return {
    month: r.key, days: r.days, elapsed, remaining_days: remainingDays, is_current: isCurrent,
    income: util.round2(income), expected_income: util.round2(expectedIncome),
    spent: util.round2(spent), budgeted: util.round2(totalBudget),
    budget_left: util.round2(budgetLeft), projected_spend: util.round2(projectedSpend),
    safe_per_day: util.round2(safePerDay), uncategorized: { count: cur.uncatCount, amount: util.round2(cur.uncatSpend) },
    split, categories, recurring, recurring_total: util.round2(recurringTotal), trend, tips,
  };
}

module.exports = { compute };
