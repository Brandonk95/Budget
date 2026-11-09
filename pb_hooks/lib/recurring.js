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
  const t = String(s || "").replace(/[#*]?\d{3,}.*$/, "").replace(/\s+/g, " ").trim();
  if (!t) return "Recurring";
  if (t === t.toUpperCase()) return t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return t;
}

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ---- detection ----
function analyze(group, today) {
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
  if (ok / intervals.length < 0.7) return null;

  const amounts = days.map((d) => Math.abs(byDay[d].reduce((s, t) => s + t.amount, 0)));
  const recent = amounts.slice(-4);
  const mx = Math.max.apply(null, recent), mn = Math.min.apply(null, recent);
  if (mn < 0.5 || mx > mn * 2) return null;
  const exact = recent.every((a) => Math.abs(a - recent[0]) < 0.01);
  if (days.length < fr.need && !(exact && days.length >= 2 && fr.f === "monthly")) return null;

  const lastDay = days[days.length - 1];
  const next = step(lastDay, fr.f, 1);
  // gone quiet: two missed cycles
  if (daysBetween(lastDay, today) > STEP_DAYS[fr.f] * 2 + 7) return null;

  const lastTx = byDay[lastDay][0];
  return {
    frequency: fr.f,
    amount: util.round2(recent.reduce((s, a) => s + a, 0) / recent.length),
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
    const a = analyze(groups[g], today);
    if (!a) continue;
    const [key, dir] = g.split("|");
    const cat = cats[a.tx.category];
    if (dir === "in" && cat && cat.kind !== "income") continue; // refunds etc.
    let r = existing[g];
    if (r) {
      if (r.getString("status") === "ignored") continue;
      if (a.last_date > r.getString("last_date").slice(0, 10)) {
        r.set("last_date", a.last_date + " 12:00:00.000Z");
        r.set("last_amount", a.last_amount);
        if (r.getString("status") === "active") r.set("next_date", a.next_date + " 12:00:00.000Z");
      }
      if (!r.getBool("edited") && r.getString("source") !== "manual") {
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
    r.set("kind", dir === "in" ? "income" : (SUBS.test(key) || (cat && /subscription/i.test(cat.name)) ? "subscription" : "bill"));
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
      calendar.push({ date: d, id: it.id, name: it.name, amount: it.amount, kind: it.kind, paid: !!paid, paid_amount: paid ? Math.abs(paid.amount) : 0 });
      if (it.kind !== "income") {
        dueThisMonth += it.amount;
        if (paid) paidThisMonth += Math.abs(paid.amount);
      }
    }
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
  const remaining = calendar.filter((c) => c.kind !== "income" && !c.paid && c.date >= today).reduce((s, c) => s + c.amount, 0);
  return {
    month: r.key, today, items, calendar, upcoming,
    totals: {
      subscriptions: util.round2(totals.subscription), bills: util.round2(totals.bill), income: util.round2(totals.income),
      expenses: util.round2(totals.subscription + totals.bill),
      due_this_month: util.round2(dueThisMonth), paid_this_month: util.round2(paidThisMonth), remaining_this_month: util.round2(remaining),
    },
  };
}

module.exports = { detect, list, normalizePayee, occurrences, PER_MONTH };
