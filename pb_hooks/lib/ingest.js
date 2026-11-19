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
// a.prev, if given, gets { balance } of the account before this update (null for a new account).
function upsertAccount(app, conn, a) {
  let acc;
  try {
    acc = app.findFirstRecordByFilter("accounts", "connection = {:c} && external_id = {:e}", { c: conn.id, e: a.externalId });
  } catch (_) { acc = null; }
  if (!acc && a.externalId) {
    // an account restored from a backup comes back unlinked; reconnecting the bank picks it up
    // again (with its history) instead of making a duplicate
    try {
      acc = app.findFirstRecordByFilter("accounts", "user = {:u} && connection = '' && external_id = {:e}", { u: conn.getString("user"), e: a.externalId });
      acc.set("connection", conn.id);
    } catch (_) { acc = null; }
  }
  if (a.prev) a.prev.balance = acc && !acc.isNew() ? acc.getFloat("balance") : null;
  if (!acc) {
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
// track, if given, gets how much the account's transactions moved: .all (every row) and
// .posted (pending rows count as 0), for the estimated pending charge below.
function upsertTransactions(app, acc, txs, windowStart, ctx, track) {
  track = track || {};
  track.all = 0; track.posted = 0;
  const counts = (amt, pending) => { track.all += amt; if (!pending) track.posted += amt; };
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
      counts(-tx.getFloat("amount"), tx.getBool("pending"));
      counts(amount, !!t.pending);
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
    counts(amount, !!t.pending);
  }

  // Pending items often get a new id once they post; drop stale pending rows in the window.
  const stale = app.findRecordsByFilter(
    "transactions", "account = {:a} && pending = true && date >= {:s}", "", 0, 0, { a: acc.id, s: windowStart },
  );
  for (const s of stale) {
    if (s.getBool("estimated") || seen[s.getString("external_id")]) continue;
    counts(-s.getFloat("amount"), true);
    app.delete(s);
  }
  return created;
}

// ---- estimated pending charge
// Banks often move the balance a day or two before the transaction itself comes through. Each
// sync, the part of the balance change that the transactions don't account for is added to a
// running gap; the gap shows as one "pending" transaction on the account. As the real
// transactions arrive they account for the balance change instead, so the gap shrinks by their
// amounts (a $40 estimate becomes $20 when the first of two $20 charges shows up, and goes away
// with the second). Some banks count pending charges in the balance and some don't, so two gaps
// are kept, one for each, and the smaller one is shown.
const EST_ID = "keel:estimate";
const EST_MAX_DAYS = 7; // a gap nothing has explained in a week is dropped

// A gap only starts (or flips sign) from a real move in the balance, and only by as much as the
// balance moved: transactions turning up with no balance change just mean the balance already had
// them (an old charge, or one an estimate was dismissed for), so they don't make a new estimate.
function settle(prev, next, dBal) {
  if (Math.abs(next) < 0.01) return 0;
  if (Math.abs(prev) >= 0.01 && Math.sign(next) === Math.sign(prev)) return next;
  if (Math.sign(next) === Math.sign(dBal)) return util.round2(Math.sign(next) * Math.min(Math.abs(next), Math.abs(dBal)));
  return 0;
}

function updateEstimate(app, acc, prevBalance, track, fresh) {
  // "Invert amounts" banks don't say which way their balance moves, so they don't get estimates
  const flip = 1;
  const off = acc.getBool("flip_amounts");
  let ph = null;
  try { ph = app.findFirstRecordByFilter("transactions", "account = {:a} && external_id = {:e}", { a: acc.id, e: EST_ID }); } catch (_) {}
  let gA = acc.getFloat("est_gap_a"), gB = acc.getFloat("est_gap_b");
  // the stand-in was deleted by hand, or it's too old, or there's nothing to compare with: start over
  const dismissed = acc.getBool("est_shown") && !ph;
  const stale = ph && Date.now() - new Date(ph.getString("created").replace(" ", "T")).getTime() > EST_MAX_DAYS * 86400000;
  if (off || fresh || prevBalance == null || dismissed || stale) { gA = 0; gB = 0; }
  else {
    const dBal = util.round2(acc.getFloat("balance") - prevBalance);
    gA = settle(gA, util.round2(gA + dBal - flip * (track.all || 0)), dBal);
    gB = settle(gB, util.round2(gB + dBal - flip * (track.posted || 0)), dBal);
  }
  const g = Math.abs(gA) <= Math.abs(gB) ? gA : gB;
  const show = Math.abs(g) >= 0.01;
  // one way of counting says everything is accounted for: trust it and clear the other's leftovers
  if (!show) { gA = 0; gB = 0; }
  acc.set("est_gap_a", gA);
  acc.set("est_gap_b", gB);
  acc.set("est_shown", show);
  app.save(acc);
  if (!show) { if (ph) app.delete(ph); return null; }
  if (!ph) {
    ph = new Record(app.findCollectionByNameOrId("transactions"));
    ph.set("user", acc.getString("user"));
    ph.set("account", acc.id);
    ph.set("external_id", EST_ID);
    ph.set("date", util.today());
    ph.set("category", "");
  }
  const amount = util.round2(g * flip);
  ph.set("amount", amount);
  ph.set("pending", true);
  ph.set("estimated", true);
  ph.set("payee", amount < 0 ? "Pending charge" : "Pending deposit");
  ph.set("description", "Your balance changed, but the bank hasn't listed the transaction yet. Keel swaps this for the real one when it shows up.");
  app.save(ph);
  return ph;
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

module.exports = { upsertAccount, upsertTransactions, updateEstimate, markSynced, windowStartSec, guessType, EST_ID };
