// Provider-neutral storage of synced accounts and transactions.
// The bank provider (simplefin.js) normalizes their data and hand it here.

const util = require(`${__hooks}/lib/util.js`);

function guessType(name) {
  const n = (name || "").toLowerCase();
  if (/credit|card|visa|mastercard|amex|discover/.test(n)) return "credit";
  if (/saving|money market|mmkt/.test(n)) return "savings";
  if (/brokerage|ira|401k|invest|roth|hsa/.test(n)) return "investment";
  if (/loan|mortgage|auto/.test(n)) return "loan";
  return "checking";
}

// a: { externalId, name, institution, type, currency, balance, available, balanceDate }
function upsertAccount(app, conn, a) {
  let acc;
  try {
    acc = app.findFirstRecordByFilter("accounts", "connection = {:c} && external_id = {:e}", { c: conn.id, e: a.externalId });
  } catch (_) {
    acc = new Record(app.findCollectionByNameOrId("accounts"));
    acc.set("user", conn.getString("user"));
    acc.set("connection", conn.id);
    acc.set("external_id", a.externalId);
    acc.set("name", a.name || "Account");
    const t = a.type || guessType(a.name);
    acc.set("type", t);
    acc.set("on_budget", t === "checking" || t === "credit");
  }
  acc.set("institution", a.institution || "");
  acc.set("currency", /^[A-Z]{3}$/.test(a.currency || "") ? a.currency : "USD");
  if (a.balance != null && isFinite(a.balance)) acc.set("balance", util.round2(a.balance));
  if (a.available != null && isFinite(a.available)) acc.set("available", util.round2(a.available));
  acc.set("balance_date", a.balanceDate || util.today());
  app.save(acc);
  return acc;
}

// txs: [{ externalId, date: "YYYY-MM-DD 12:00:00.000Z", amount, description, payee, pending, hint }]
// windowStart: stored-date string; pending rows in the window that vanished get removed.
function upsertTransactions(app, acc, txs, windowStart, ctx) {
  const rules = require(`${__hooks}/lib/rules.js`);
  const col = app.findCollectionByNameOrId("transactions");
  const flip = acc.getBool("flip_amounts") ? -1 : 1;
  const seen = {};
  const created = [];

  for (const t of txs) {
    seen[t.externalId] = true;
    const amount = util.round2((Number(t.amount) || 0) * flip);
    const desc = String(t.description || "").slice(0, 500);
    const payee = String(t.payee || "").slice(0, 200);

    let tx = null;
    try {
      tx = app.findFirstRecordByFilter("transactions", "account = {:a} && external_id = {:e}", { a: acc.id, e: t.externalId });
    } catch (_) {}

    if (tx) {
      // keep the user's category/notes/payee edits; refresh bank-owned fields
      tx.set("amount", amount);
      tx.set("pending", !!t.pending);
      tx.set("date", t.date);
      if (desc) tx.set("description", desc);
      app.save(tx);
      continue;
    }
    tx = new Record(col);
    tx.set("user", acc.getString("user"));
    tx.set("account", acc.id);
    tx.set("external_id", t.externalId);
    tx.set("date", t.date);
    tx.set("amount", amount);
    tx.set("description", desc);
    tx.set("payee", payee);
    tx.set("pending", !!t.pending);
    tx.set("category", rules.categorize(ctx, { description: desc, payee, amount, hint: t.hint }));
    app.save(tx);
    created.push(tx);
  }

  // Pending items often get a new id once they post; drop stale pending rows in the window.
  const stale = app.findRecordsByFilter(
    "transactions", "account = {:a} && pending = true && date >= {:s}", "", 0, 0, { a: acc.id, s: windowStart },
  );
  for (const s of stale) {
    if (!seen[s.getString("external_id")]) app.delete(s);
  }
  return created;
}

function markSynced(app, conn, status, message) {
  conn.set("last_sync", new Date().toISOString().replace("T", " "));
  conn.set("status", status);
  conn.set("last_error", String(message || "").slice(0, 2000));
  app.save(conn);
}

// First sync looks back `firstDays`; later syncs overlap 10 days to catch late postings.
function windowStartSec(conn, firstDays) {
  const nowSec = Date.now() / 1000;
  let start = nowSec - firstDays * 86400;
  const last = conn.getDateTime("last_sync");
  if (!last.isZero()) start = Math.max(start, last.unix() - 10 * 86400);
  return start;
}

module.exports = { upsertAccount, upsertTransactions, markSynced, windowStartSec, guessType };
