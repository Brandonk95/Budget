// Recurring bills, subscriptions and income: detection from transaction history,
// occurrence math for the calendar, and monthly totals.

const util = require(`${__hooks}/lib/util.js`);

const DAY = 86400000;
const FREQS = [
  { f: "weekly", min: 5, max: 9, need: 4 },
  { f: "biweekly", min: 12, max: 17, need: 3 },
  { f: "monthly", min: 26, max: 35, need: 3 },
  { f: "quarterly", min: 80, max: 100, need: 2 },
  { f: "yearly", min: 350, max: 380, need: 2 },
];
const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
// days a charge may run late before it counts as missed
const GRACE = { weekly: 3, biweekly: 4, monthly: 7, quarterly: 14, yearly: 21 };
const STEP_DAYS = { weekly: 7, biweekly: 14, monthly: 30.4, quarterly: 91, yearly: 365 };
const SUBS = /netflix|spotify|hulu|disney|youtube|apple|prime|hbo|max\b|patreon|adobe|microsoft|xbox|playstation|nintendo|google|dropbox|icloud|audible|peacock|paramount|sirius|crunchyroll|chatgpt|openai|anthropic|claude|github|new york times|nytimes|wsj|gym|fitness|planet fit|peloton|duolingo|headspace|calm|onlyfans|twitch|discord|nord|vpn|1password|lastpass/;

// ---- date helpers (day strings "YYYY-MM-DD", math in UTC) ----
function dayMs(day) {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function msDay(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + "-" + util.pad(d.getUTCMonth() + 1) + "-" + util.pad(d.getUTCDate());
}
function todayDay() { return util.today().slice(0, 10); }
function addMonths(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return msDay(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}
function step(day, freq, n) {
  if (freq === "weekly") return msDay(dayMs(day) + 7 * n * DAY);
  if (freq === "biweekly") return msDay(dayMs(day) + 14 * n * DAY);
  if (freq === "quarterly") return addMonths(day, 3 * n);
  if (freq === "yearly") return addMonths(day, 12 * n);
  return addMonths(day, n);
}
const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / DAY);

function normalizePayee(s) {
  return String(s || "").toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/\b(pos|debit|purchase|ach|card|checkcard|recurring|payment|pmt|www|com|inc|llc|co|corp|online|autopay|bill|ppd|web|id)\b/g, " ")
    .replace(/[^a-z& ]+/g, " ")
    .replace(/\s+/g, " ").trim()
    .split(" ").slice(0, 3).join(" ");
}

function prettyName(s) {
  let t = String(s || "").replace(/[#*]?\d{3,}.*$/, "").replace(/\s+/g, " ").trim();
  // "AMAZON PRIME*MEMBERSHIP" -> "AMAZON PRIME"
  const star = t.indexOf("*");
  if (star >= 3) t = t.slice(0, star).trim();
  if (!t) return "Recurring";
  if (t === t.toUpperCase()) return t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return t;
}

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// A charge is a subscription when it's a known service, filed under Subscriptions,
// or the categorizer's merchant directory says so (Fishbrain, Playit, ...).
function isSubscription(key, cat, tx) {
  if (SUBS.test(key)) return true;
  if (cat && /subscription/i.test(cat.name)) return true;
  try {
    const m = require(`${__hooks}/lib/rules.js`).directoryMatch(tx.payee || tx.description, tx.amount);
    return !!(m && m.name === "Subscriptions");
  } catch (_) { return false; }
}

// ---- detection ----
function analyze(group, today, isIncome) {
  // collapse same-day charges
  const byDay = {};
  for (const t of group) {
    const d = t.date.slice(0, 10);
    (byDay[d] = byDay[d] || []).push(t);
  }
  const days = Object.keys(byDay).sort();
  if (days.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < days.length; i++) intervals.push(daysBetween(days[i - 1], days[i]));
  const med = median(intervals);
  const fr = FREQS.find((x) => med >= x.min && med <= x.max);
  if (!fr) return null;
  const ok = intervals.filter((iv) => iv >= fr.min && iv <= fr.max).length;
  // paychecks drift (holidays, hours worked), so income gets a looser rhythm and amount check
  if (ok / intervals.length < (isIncome ? 0.6 : 0.7)) return null;

  const amounts = days.map((d) => Math.abs(byDay[d].reduce((s, t) => s + t.amount, 0)));
  const recent = amounts.slice(-4);
  const mx = Math.max.apply(null, recent), mn = Math.min.apply(null, recent);
  if (mn < 0.5 || mx > mn * (isIncome ? 3 : 2)) return null;
  const exact = recent.every((a) => Math.abs(a - recent[0]) < 0.01);
  if (days.length < fr.need && !(exact && days.length >= 2 && fr.f === "monthly")) return null;

  const lastDay = days[days.length - 1];
  const next = step(lastDay, fr.f, 1);
  // gone quiet: two missed cycles
  if (daysBetween(lastDay, today) > STEP_DAYS[fr.f] * 2 + 7) return null;

  const lastTx = byDay[lastDay][0];
  // when the last two charges match, that's the current price (subscriptions after a price change);
  // otherwise average them (variable bills like electric)
  const n = amounts.length;
  const current = Math.abs(amounts[n - 1] - amounts[n - 2]) < 0.01 ? amounts[n - 1] : recent.reduce((s, a) => s + a, 0) / recent.length;
  return {
    frequency: fr.f,
    amount: util.round2(current),
    last_amount: util.round2(amounts[amounts.length - 1]),
    last_date: lastDay,
    next_date: next,
    tx: lastTx,
    count: days.length,
  };
}

function loadTx(app, userId, sinceDay) {
  return app.findRecordsByFilter(
    "transactions",
    "user = {:u} && date >= {:s} && exclude = false && (category = '' || category.kind != 'transfer')",
    "date", 0, 0, { u: userId, s: sinceDay + " 00:00:00.000Z" },
  ).map((t) => ({
    id: t.id, date: t.getString("date"), amount: t.getFloat("amount"), category: t.getString("category"),
    description: t.getString("description"), payee: t.getString("payee"), account: t.getString("account"),
  }));
}

function detect(app, userId) {
  const today = todayDay();
  const since = msDay(dayMs(today) - 400 * DAY);
  const txs = loadTx(app, userId, since);
  const cats = {};
  for (const c of app.findRecordsByFilter("categories", "user = {:u}", "", 0, 0, { u: userId })) {
    cats[c.id] = { name: c.getString("name"), kind: c.getString("kind") };
  }

  const groups = {};
  for (const t of txs) {
    if (!t.amount) continue;
    const key = normalizePayee(t.payee || t.description);
    if (!key || key.length < 3) continue;
    const g = key + "|" + (t.amount > 0 ? "in" : "out");
    (groups[g] = groups[g] || []).push(t);
  }

  const existing = {};
  for (const r of app.findRecordsByFilter("recurring", "user = {:u}", "", 0, 0, { u: userId })) {
    existing[r.getString("merchant_key") + "|" + (r.getString("kind") === "income" ? "in" : "out")] = r;
  }

  const col = app.findCollectionByNameOrId("recurring");
  let found = 0, updated = 0;
  for (const g in groups) {
    const [key, dir] = g.split("|");
    const a = analyze(groups[g], today, dir === "in");
    if (!a) continue;
    const cat = cats[a.tx.category];
    if (dir === "in" && cat && cat.kind !== "income") continue; // refunds etc.
    let r = existing[g];
    if (r) {
      if (r.getString("status") === "ignored") continue;
      if (a.last_date > r.getString("last_date").slice(0, 10) && r.getString("status") === "cancelled" && r.getBool("auto_cancelled")) {
        r.set("status", "active");
        r.set("auto_cancelled", false);
      }
      if (a.last_date > r.getString("last_date").slice(0, 10)) {
        r.set("last_date", a.last_date + " 12:00:00.000Z");
        r.set("last_amount", a.last_amount);
        if (r.getString("status") === "active") r.set("next_date", a.next_date + " 12:00:00.000Z");
      }
      if (!r.getBool("edited") && r.getString("source") !== "manual") {
        if (dir === "out" && r.getString("kind") === "bill" && isSubscription(key, cat, a.tx)) r.set("kind", "subscription");
        r.set("amount", a.amount);
        r.set("frequency", a.frequency);
        if (a.tx.category) r.set("category", a.tx.category);
        r.set("account", a.tx.account);
        r.set("next_date", a.next_date + " 12:00:00.000Z");
      }
      app.save(r);
      updated++;
      continue;
    }
    r = new Record(col);
    r.set("user", userId);
    r.set("name", prettyName(a.tx.payee || a.tx.description).slice(0, 120));
    r.set("merchant_key", key);
    r.set("amount", a.amount);
    r.set("last_amount", a.last_amount);
    r.set("kind", dir === "in" ? "income" : isSubscription(key, cat, a.tx) ? "subscription" : "bill");
    r.set("frequency", a.frequency);
    r.set("last_date", a.last_date + " 12:00:00.000Z");
    r.set("next_date", a.next_date + " 12:00:00.000Z");
    r.set("category", a.tx.category || "");
    r.set("account", a.tx.account);
    r.set("status", "active");
    r.set("source", "auto");
    app.save(r);
    existing[g] = r;
    found++;
  }
  return { found, updated };
}

// ---- occurrences / listing ----
function anchorOf(r) {
  const next = r.next_date ? r.next_date.slice(0, 10) : "";
  if (next) return next;
  if (r.last_date) return step(r.last_date.slice(0, 10), r.frequency, 1);
  return "";
}

// All expected dates for r between [from, to] (inclusive day strings).
function occurrences(r, from, to) {
  const anchor = anchorOf(r);
  if (!anchor) return [];
  const out = [];
  let i = 0, d = anchor;
  // walk back to before `from`
  while (d > from && i > -800) { i--; d = step(anchor, r.frequency, i); }
  for (let n = 0; n < 800; n++, i++) {
    d = step(anchor, r.frequency, i);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

function toPlain(r) {
  return {
    id: r.id, name: r.getString("name"), merchant_key: r.getString("merchant_key"), amount: r.getFloat("amount"),
    last_amount: r.getFloat("last_amount"), kind: r.getString("kind"), frequency: r.getString("frequency"),
    next_date: r.getString("next_date"), last_date: r.getString("last_date"), category: r.getString("category"),
    account: r.getString("account"), status: r.getString("status"), source: r.getString("source"), edited: r.getBool("edited"),
    auto_cancelled: r.getBool("auto_cancelled"),
  };
}

// Payment matching: a transaction from the same merchant within ±6 days of the expected date.
function matchPaid(occDay, item, txIndex) {
  const list = txIndex[item.merchant_key + "|" + (item.kind === "income" ? "in" : "out")] || [];
  for (const t of list) {
    if (Math.abs(daysBetween(occDay, t.date.slice(0, 10))) <= 6) return t;
  }
  return null;
}

// Subscriptions that stop charging: one missed cycle -> "possibly cancelled" (shown, still counted);
// a second missed cycle -> cancelled automatically. If a charge shows up again, it's active again.
// The clock starts from the later of the last charge seen and the next due date the user set,
// so "Track again" with a new due date isn't re-cancelled straight away.
function reviewSubscriptions(app, recs, items, txIndex, today) {
  const byId = {};
  for (const r of recs) byId[r.id] = r;
  for (const it of items) {
    if (it.kind !== "subscription" || !it.merchant_key) continue;
    const seen = (txIndex[it.merchant_key + "|out"] || []).map((t) => t.date.slice(0, 10)).sort();
    let last = it.last_date ? it.last_date.slice(0, 10) : "";
    if (seen.length && seen[seen.length - 1] > last) last = seen[seen.length - 1];
    const r = byId[it.id];
    if (it.status === "cancelled" && it.auto_cancelled) {
      // it charged again after we gave up on it
      if (it.last_date && last > it.last_date.slice(0, 10)) {
        r.set("status", "active"); r.set("auto_cancelled", false);
        r.set("last_date", last + " 12:00:00.000Z"); r.set("next_date", step(last, it.frequency, 1) + " 12:00:00.000Z");
        try { app.save(r); it.status = "active"; it.auto_cancelled = false; it.last_date = r.getString("last_date"); it.next_date = r.getString("next_date"); } catch (_) { /* keep as is */ }
      }
      continue;
    }
    if (it.status !== "active" || !last) continue;
    let due1 = step(last, it.frequency, 1);
    const userNext = it.next_date ? it.next_date.slice(0, 10) : "";
    if (userNext > due1) due1 = userNext;
    const due2 = step(due1, it.frequency, 1);
    const grace = GRACE[it.frequency] || 7;
    if (daysBetween(due2, today) > grace) {
      r.set("status", "cancelled");
      r.set("auto_cancelled", true);
      try { app.save(r); it.status = "cancelled"; it.auto_cancelled = true; } catch (_) { /* keep as is */ }
    } else if (daysBetween(due1, today) > grace) {
      it.possibly_cancelled = true;
      it.missed_date = due1;
    }
  }
}

function list(app, userId, monthKey) {
  const r = util.monthRange(monthKey);
  const today = todayDay();
  let recs = app.findRecordsByFilter("recurring", "user = {:u}", "name", 0, 0, { u: userId });
  if (!recs.length) {
    try { detect(app, userId); } catch (err) { app.logger().error("recurring detect", "error", util.errMsg(err)); }
    recs = app.findRecordsByFilter("recurring", "user = {:u}", "name", 0, 0, { u: userId });
  }
  const items = recs.map(toPlain);

  const monthStart = r.start.slice(0, 10);
  const monthEnd = msDay(dayMs(r.end.slice(0, 10)) - DAY);
  const horizon = msDay(dayMs(today) + 30 * DAY);
  const from = monthStart < today ? monthStart : today;
  const txs = loadTx(app, userId, msDay(dayMs(from) - 10 * DAY));
  const txIndex = {};
  for (const t of txs) {
    const k = normalizePayee(t.payee || t.description) + "|" + (t.amount > 0 ? "in" : "out");
    (txIndex[k] = txIndex[k] || []).push(t);
  }

  reviewSubscriptions(app, recs, items, txIndex, today);

  const calendar = [];
  const upcoming = [];
  const totals = { subscription: 0, bill: 0, income: 0 };
  let dueThisMonth = 0, paidThisMonth = 0;
  for (const it of items) {
    it.monthly = util.round2(it.amount * PER_MONTH[it.frequency]);
    if (it.status !== "active") continue;
    totals[it.kind] += it.monthly;
    for (const d of occurrences(it, monthStart, monthEnd)) {
      const paid = it.merchant_key ? matchPaid(d, it, txIndex) : null;
      const lapsed = !!it.possibly_cancelled && !paid;
      calendar.push({ date: d, id: it.id, name: it.name, amount: it.amount, kind: it.kind, paid: !!paid, paid_amount: paid ? Math.abs(paid.amount) : 0, lapsed });
      if (it.kind !== "income" && !lapsed) {
        dueThisMonth += it.amount;
        if (paid) paidThisMonth += Math.abs(paid.amount);
      }
    }
    if (it.possibly_cancelled) continue;
    // next unpaid occurrence from today (allow a few days late)
    const soon = occurrences(it, msDay(dayMs(today) - 5 * DAY), horizon)
      .filter((d) => !(it.merchant_key && matchPaid(d, it, txIndex)));
    if (soon.length) {
      it.next_due = soon[0];
      it.days_until = daysBetween(today, soon[0]);
      upcoming.push({ date: soon[0], days_until: it.days_until, id: it.id, name: it.name, amount: it.amount, kind: it.kind });
    }
  }
  upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  calendar.sort((a, b) => (a.date < b.date ? -1 : 1));
  // No recurring income found: estimate from deposits filed as income over the last 3 full months,
  // so the page can say "about $X/mo" instead of a confident $0.
  let incomeEstimate = 0;
  if (!totals.income) {
    const cats = {};
    for (const c of app.findRecordsByFilter("categories", "user = {:u}", "", 0, 0, { u: userId })) cats[c.id] = c.getString("kind");
    const s3 = util.monthRange(util.shiftMonth(util.currentMonth(), -3)).start;
    const e3 = util.monthRange(util.currentMonth()).start;
    let sum = 0;
    for (const t of app.findRecordsByFilter("transactions", "user = {:u} && exclude = false && amount > 0 && date >= {:s} && date < {:e}", "", 0, 0, { u: userId, s: s3, e: e3 })) {
      if (cats[t.getString("category")] === "income") sum += t.getFloat("amount");
    }
    incomeEstimate = util.round2(sum / 3);
  }
  const remaining = calendar.filter((c) => c.kind !== "income" && !c.paid && !c.lapsed && c.date >= today).reduce((s, c) => s + c.amount, 0);
  return {
    month: r.key, today, items, calendar, upcoming, possibly_cancelled: items.filter((x) => x.possibly_cancelled).length,
    totals: {
      subscriptions: util.round2(totals.subscription), bills: util.round2(totals.bill), income: util.round2(totals.income),
      income_estimate: incomeEstimate,
      expenses: util.round2(totals.subscription + totals.bill),
      due_this_month: util.round2(dueThisMonth), paid_this_month: util.round2(paidThisMonth), remaining_this_month: util.round2(remaining),
    },
  };
}

// Subscription tracker: every subscription with its billing cycle, next renewal,
// monthly/yearly cost and price changes, plus likely subscriptions not tracked yet.
function subscriptions(app, userId) {
  const today = todayDay();
  const base = list(app, userId, util.currentMonth());
  const txs = loadTx(app, userId, msDay(dayMs(today) - 400 * DAY));
  const byKey = {};
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const k = normalizePayee(t.payee || t.description);
    if (!k || k.length < 3) continue;
    (byKey[k] = byKey[k] || []).push(t);
  }

  const subs = base.items.filter((x) => x.kind === "subscription").map((it) => {
    it.yearly = util.round2(it.amount * PER_MONTH[it.frequency] * 12);
    if (it.status === "active") {
      const next = occurrences(it, msDay(dayMs(today) - 5 * DAY), msDay(dayMs(today) + 400 * DAY))
        .filter((d) => !(it.merchant_key && matchPaid(d, it, { [it.merchant_key + "|out"]: byKey[it.merchant_key] || [] })));
      if (next.length) { it.next_renewal = next[0]; it.days_until = daysBetween(today, next[0]); }
    }
    // price change: the latest price vs the last different price, if it changed in the past ~6 months
    const charges = (byKey[it.merchant_key] || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    it.charges = charges.length;
    if (charges.length >= 2) {
      const last = Math.abs(charges[charges.length - 1].amount);
      let j = charges.length - 2;
      while (j >= 0 && Math.abs(Math.abs(charges[j].amount) - last) < 0.01) j--;
      if (j >= 0) {
        const prev = Math.abs(charges[j].amount);
        const since = charges[j + 1].date.slice(0, 10);
        const rel = Math.abs(last - prev) / prev;
        if (Math.abs(last - prev) >= 0.5 && rel >= 0.02 && rel <= 1 && daysBetween(since, today) <= 190) {
          it.price_change = { from: util.round2(prev), to: util.round2(last), date: since };
        }
      }
    }
    return it;
  });

  // likely subscriptions: known subscription merchants with no recurring entry at all
  const known = {};
  for (const it of base.items) known[it.merchant_key] = true;
  const suggestions = [];
  for (const k in byKey) {
    if (known[k] || !SUBS.test(k)) continue;
    const g = byKey[k].slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = g[g.length - 1];
    const days = {};
    for (const t of g) days[t.date.slice(0, 10)] = true;
    const ds = Object.keys(days).sort();
    let frequency = "monthly";
    if (ds.length >= 2) {
      const ivs = [];
      for (let i = 1; i < ds.length; i++) ivs.push(daysBetween(ds[i - 1], ds[i]));
      const med = median(ivs);
      const fr = FREQS.find((x) => med >= x.min && med <= x.max);
      if (fr) frequency = fr.f; else if (med > 200) frequency = "yearly";
    } else if (daysBetween(last.date.slice(0, 10), today) > 40) {
      frequency = "yearly";
    }
    // a lone monthly-looking charge from long ago is probably gone
    if (frequency !== "yearly" && daysBetween(last.date.slice(0, 10), today) > STEP_DAYS[frequency] * 2 + 7) continue;
    suggestions.push({
      merchant_key: k, name: prettyName(last.payee || last.description), amount: util.round2(Math.abs(last.amount)),
      last_date: last.date.slice(0, 10), next_date: step(last.date.slice(0, 10), frequency, 1), frequency,
      charges: ds.length, category: last.category || "", account: last.account,
    });
  }
  suggestions.sort((a, b) => b.amount * PER_MONTH[b.frequency] - a.amount * PER_MONTH[a.frequency]);

  const active = subs.filter((s) => s.status === "active");
  const cancelled = subs.filter((s) => s.status === "cancelled");
  const monthly = active.reduce((s, x) => s + x.monthly, 0);
  return {
    today, subscriptions: subs, suggestions,
    totals: {
      count: active.length, monthly: util.round2(monthly), yearly: util.round2(monthly * 12),
      renewing_30d: util.round2(active.filter((s) => s.days_until != null && s.days_until <= 30).reduce((s, x) => s + x.amount, 0)),
      cancelled_savings_yearly: util.round2(cancelled.reduce((s, x) => s + x.yearly, 0)),
    },
  };
}

// Every charge (or deposit) from one recurring item's merchant, with what it has cost over time.
function history(app, userId, id) {
  const r = app.findRecordById("recurring", id);
  if (r.getString("user") !== userId) throw new NotFoundError();
  const key = r.getString("merchant_key");
  const income = r.getString("kind") === "income";
  const out = { id, name: r.getString("name"), kind: r.getString("kind"), charges: [], months: [],
    totals: { all_time: 0, this_year: 0, last_12m: 0, count: 0, average: 0, first_date: "", last_date: "" } };
  if (!key) return out;
  // narrow in the database by the merchant's first word, then match exactly like detection does
  const word = key.split(" ").find((w) => w.length >= 3) || key;
  const rows = app.findRecordsByFilter("transactions",
    `user = {:u} && exclude = false && amount ${income ? ">" : "<"} 0 && (payee ~ {:w} || description ~ {:w})`,
    "-date", 0, 0, { u: userId, w: word });
  const today = todayDay();
  const year = today.slice(0, 4);
  const since12 = addMonths(today.slice(0, 7) + "-01", -11);
  const byMonth = {};
  for (const t of rows) {
    if (normalizePayee(t.getString("payee") || t.getString("description")) !== key) continue;
    const day = t.getString("date").slice(0, 10);
    const amt = Math.abs(t.getFloat("amount"));
    out.charges.push({ id: t.id, date: day, amount: util.round2(amt), description: t.getString("payee") || t.getString("description"), account: t.getString("account") });
    out.totals.all_time += amt;
    if (day.slice(0, 4) === year) out.totals.this_year += amt;
    if (day >= since12) out.totals.last_12m += amt;
    byMonth[day.slice(0, 7)] = (byMonth[day.slice(0, 7)] || 0) + amt;
  }
  const n = out.charges.length;
  out.totals.count = n;
  if (n) {
    out.totals.first_date = out.charges[n - 1].date;
    out.totals.last_date = out.charges[0].date;
    out.totals.average = util.round2(out.totals.all_time / n);
  }
  for (const k of ["all_time", "this_year", "last_12m"]) out.totals[k] = util.round2(out.totals[k]);
  for (let i = 11; i >= 0; i--) {
    const m = addMonths(today.slice(0, 7) + "-01", -i).slice(0, 7);
    out.months.push({ month: m, total: util.round2(byMonth[m] || 0) });
  }
  return out;
}

// Active bills, subscriptions and paychecks still expected between [from, to]: occurrences
// already matched to a transaction are left out, and lapsed subscriptions aren't counted.
function expected(app, userId, from, to) {
  const today = todayDay();
  const recs = app.findRecordsByFilter("recurring", "user = {:u} && status = 'active'", "name", 0, 0, { u: userId });
  const items = recs.map(toPlain);
  const txIndex = {};
  for (const t of loadTx(app, userId, msDay(dayMs(from) - 60 * DAY))) {
    const k = normalizePayee(t.payee || t.description) + "|" + (t.amount > 0 ? "in" : "out");
    (txIndex[k] = txIndex[k] || []).push(t);
  }
  reviewSubscriptions(app, recs, items, txIndex, today);
  const out = [];
  for (const it of items) {
    if (it.status !== "active" || it.possibly_cancelled) continue;
    for (const d of occurrences(it, from, to)) {
      if (it.merchant_key && matchPaid(d, it, txIndex)) continue;
      out.push({ date: d, id: it.id, name: it.name, amount: it.amount, kind: it.kind, account: it.account, frequency: it.frequency });
    }
  }
  return { events: out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)), items, txIndex };
}

module.exports = { detect, list, subscriptions, history, expected, normalizePayee, occurrences, PER_MONTH };
