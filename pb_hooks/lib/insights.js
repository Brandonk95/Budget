// Budget analysis: spending vs budget, pace projection, history-based suggestions,
// recurring bills (from recurring.js), a daily spend curve and plain-language tips.

const util = require(`${__hooks}/lib/util.js`);

const HISTORY_MONTHS = 6;

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
    icon: c.getString("icon"), archived: c.getBool("archived"), rollover: c.getBool("rollover"),
  }));
  const catById = {};
  for (const c of cats) catById[c.id] = c;

  const txs = app.findRecordsByFilter(
    "transactions",
    "user = {:u} && account.on_budget = true && exclude = false && date >= {:s} && date < {:e}",
    "date", 0, 0, { u: userId, s: histStart, e: r.end },
  ).map((t) => ({
    id: t.id, date: t.getString("date"), amount: t.getFloat("amount"), category: t.getString("category"),
    description: t.getString("description"), payee: t.getString("payee"),
  }));

  // per month, per category net amounts
  const byMonth = {}; // month -> { income, spend, cat: {id: net}, uncat }
  const blank = () => ({ income: 0, spend: 0, needs: 0, wants: 0, savings: 0, cat: {}, uncatSpend: 0, uncatCount: 0 });
  // daily spend for this month and last month (cumulative "spent so far" chart)
  const prevKey = util.shiftMonth(r.key, -1);
  const dayCur = {}, dayPrev = {};
  const addDay = (t, v) => {
    const m = t.date.slice(0, 7);
    const box = m === r.key ? dayCur : m === prevKey ? dayPrev : null;
    if (box) { const d = parseInt(t.date.slice(8, 10), 10); box[d] = (box[d] || 0) + v; }
  };
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    const b = (byMonth[m] = byMonth[m] || blank());
    const c = catById[t.category];
    if (c && c.kind === "transfer") continue;
    if (c && c.kind === "income") { b.income += t.amount; continue; }
    if (!c) {
      if (t.amount > 0) b.income += t.amount;
      else { b.uncatSpend += -t.amount; b.spend += -t.amount; addDay(t, -t.amount); }
      b.uncatCount++;
      continue;
    }
    b.cat[c.id] = (b.cat[c.id] || 0) + t.amount;
    addDay(t, -t.amount);
  }
  const cumulative = (box, n) => {
    const out = [];
    let run = 0;
    for (let d = 1; d <= n; d++) { run += box[d] || 0; out.push(util.round2(run)); }
    return out;
  };
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
  const prevMonth = byMonth[prevKey] || blank();
  const categories = cats.filter((c) => c.kind !== "transfer" && !c.archived).map((c) => {
    const spent = c.kind === "income" ? 0 : Math.max(0, -(cur.cat[c.id] || 0));
    // rollover: last month's leftover (or overspend) carries into this month
    const carry = c.rollover && c.budget > 0 && c.kind !== "income"
      ? util.round2(c.budget - Math.max(0, -(prevMonth.cat[c.id] || 0))) : 0;
    const available = Math.max(0, c.budget + carry);
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
      id: c.id, name: c.name, kind: c.kind, icon: c.icon, budget: c.budget, rollover: c.rollover,
      carry, available: util.round2(available),
      spent: util.round2(spent), remaining: util.round2(available - spent),
      pct: c.budget > 0 ? Math.round((spent / Math.max(available, 0.01)) * 100) : null,
      projected: util.round2(projected), avg3: util.round2(avg3), suggested,
    };
  });

  const spendCats = categories.filter((c) => c.kind !== "income");
  // Rocket Money-style: one overall budget; category budgets carve out pieces and
  // "Everything else" covers spending in categories without their own budget.
  const catBudget = spendCats.filter((c) => c.budget > 0).reduce((s, c) => s + c.available, 0);
  let incomeOverride = 0, budgetSetting = 0;
  try {
    const u = app.findRecordById("users", userId);
    incomeOverride = u.getFloat("income_override");
    budgetSetting = u.getFloat("budget_total");
  } catch (_) {}
  const totalBudget = Math.max(budgetSetting, catBudget);
  const elseSpent = spendCats.filter((c) => !(c.budget > 0)).reduce((s, c) => s + c.spent, 0) + cur.uncatSpend;
  const elseBudget = Math.max(0, totalBudget - catBudget);
  const everythingElse = {
    budget: util.round2(elseBudget), spent: util.round2(elseSpent), remaining: util.round2(elseBudget - elseSpent),
    pct: elseBudget > 0 ? Math.round((elseSpent / elseBudget) * 100) : null,
    avg3: util.round2(avg((b) => spendCats.filter((c) => !(c.budget > 0)).reduce((s, c) => s + Math.max(0, -(b.cat[c.id] || 0)), 0) + b.uncatSpend)),
  };
  const avgSpend = avg((b) => b.spend);
  const income = cur.income;
  const avgIncome = avg((b) => b.income);
  const expectedIncome = incomeOverride > 0 ? incomeOverride : Math.max(income, avgIncome);
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

  let bills = { expenses: 0, subscriptions: 0, bills: 0, income: 0, due_this_month: 0, paid_this_month: 0, remaining_this_month: 0 };
  let recurringCount = 0;
  let billList = [];
  try {
    const rec = require(`${__hooks}/lib/recurring.js`).list(app, userId, r.key);
    bills = rec.totals;
    recurringCount = rec.items.filter((x) => x.status === "active" && x.kind !== "income").length;
    billList = rec.calendar.filter((c) => c.kind !== "income");
  } catch (err) { app.logger().error("recurring list", "error", util.errMsg(err)); }
  const recurringTotal = bills.expenses;

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
    if (c.budget > 0 && c.spent > c.available) {
      tips.push({ level: "bad", text: `You've passed your ${c.icon} ${c.name} budget by ${money(c.spent - c.available)}. Moving money from another category keeps the month balanced.` });
    } else if (isCurrent && c.budget > 0 && c.projected > c.available * 1.05) {
      tips.push({ level: "warn", text: `${c.icon} ${c.name} is heading toward ${money(c.projected)} of ${money(c.available)}. Keeping it to ${money(Math.max(0, c.available - c.spent) / Math.max(1, remainingDays))}/day keeps you on course.` });
    }
    if (c.budget === 0 && c.spent > 0 && totalBudget === 0) {
      tips.push({ level: "info", text: `${c.icon} ${c.name}: ${money(c.spent)} spent with no budget yet. ${money(c.suggested || Math.ceil(c.spent / 5) * 5)} would be a good starting point.` });
    }
  }
  if (everythingElse.budget > 0 && everythingElse.spent > everythingElse.budget) {
    tips.push({ level: "bad", text: `You've passed your “Everything else” budget by ${money(everythingElse.spent - everythingElse.budget)}. Giving the biggest categories their own budget shows where it's going.` });
  }
  if (totalBudget === 0 && avgSpend > 0) {
    tips.push({ level: "info", text: `You usually spend about ${money(avgSpend)} a month. Set a budget on the Budget page to see what's left as you go.` });
  }
  if (cur.uncatCount > 0) {
    tips.push({ level: "info", text: `${cur.uncatCount} transaction(s) this month need a category. Sorting them (and saving a rule) keeps your budget accurate.` });
  }
  if (expectedIncome > 0) {
    const unassigned = expectedIncome - totalBudget;
    if (unassigned > 50) {
      tips.push({ level: "good", text: `${money(unassigned)} of your typical income isn't planned yet. Consider putting it toward a goal or savings.` });
    } else if (unassigned < -50) {
      tips.push({ level: "bad", text: `Your budget is ${money(-unassigned)} more than your typical income (${money(expectedIncome)}). Trimming a category or two brings it back in line.` });
    }
    const savingsRate = (expectedIncome - projectedSpend + cur.savings) / expectedIncome;
    if (savingsRate < 0.1 && !isFuture) {
      tips.push({ level: "warn", text: `You're on pace to save ${Math.round(savingsRate * 100)}% of income this month. Many people aim for 10–20%.` });
    }
    if (split.wants_pct > 30) {
      tips.push({ level: "info", text: `Wants are ${split.wants_pct}% of income. The 50/30/20 guideline suggests about 30%.` });
    }
  }
  if (recurringTotal > 0) {
    tips.push({ level: "info", text: `About ${money(recurringTotal)} a month goes to bills and subscriptions across ${recurringCount} merchant(s). The Recurring page is a good place to spot anything you no longer use.` });
  }
  if (txs.length && totalBudget > 0 && isCurrent && !tips.some((t) => t.level === "bad" || t.level === "warn")) {
    tips.unshift({ level: "good", text: "You're on track this month." });
  }
  if (!txs.length) {
    tips.push({ level: "info", text: "No transactions yet. Connect a bank on the Accounts page or import a CSV to get started." });
  }

  return {
    month: r.key, days: r.days, elapsed, remaining_days: remainingDays, is_current: isCurrent,
    income: util.round2(income), expected_income: util.round2(expectedIncome),
    spent: util.round2(spent), budgeted: util.round2(totalBudget),
    budget_left: util.round2(budgetLeft), projected_spend: util.round2(projectedSpend),
    safe_per_day: util.round2(safePerDay), uncategorized: { count: cur.uncatCount, amount: util.round2(cur.uncatSpend) },
    split, categories, bills, recurring_total: util.round2(recurringTotal), trend, tips,
    income_override: util.round2(incomeOverride),
    budget_setting: util.round2(budgetSetting), category_budgeted: util.round2(catBudget),
    everything_else: everythingElse, avg_spend: util.round2(avgSpend), bill_list: billList,
    goals_monthly: util.round2(goalsMonthly(app, userId)),
    daily: {
      current: cumulative(dayCur, r.days),
      previous: cumulative(dayPrev, util.monthRange(prevKey).days),
      today: elapsed,
    },
  };
}

// What to set aside each month to hit every dated goal on time.
function goalsMonthly(app, userId) {
  const now = new Date();
  let total = 0;
  for (const g of app.findRecordsByFilter("goals", "user = {:u}", "", 0, 0, { u: userId })) {
    const left = g.getFloat("target") - g.getFloat("saved");
    const td = g.getString("target_date");
    if (left <= 0 || !td) continue;
    const months = Math.max(1, (parseInt(td.slice(0, 4), 10) - now.getFullYear()) * 12 + (parseInt(td.slice(5, 7), 10) - 1 - now.getMonth()));
    total += left / months;
  }
  return total;
}

module.exports = { compute };
