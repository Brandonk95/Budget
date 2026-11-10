// Split transactions. The transaction keeps its real amount (balances, syncing and recurring
// matching use it as is); budget and spending totals swap it for its parts via expand().

const util = require(`${__hooks}/lib/util.js`);

const r2 = util.round2;

// parts: [{ category, amount, note }] with positive amounts that add up to the transaction.
// An empty list removes the split.
function save(app, userId, txId, parts) {
  let tx;
  try { tx = app.findRecordById("transactions", txId); } catch (_) { throw new NotFoundError("Transaction not found."); }
  if (tx.getString("user") !== userId) throw new NotFoundError("Transaction not found.");
  parts = (parts || []).map((p) => ({ category: String(p.category || ""), amount: r2(Math.abs(Number(p.amount) || 0)), note: String(p.note || "").slice(0, 200) }))
    .filter((p) => p.amount > 0);
  const total = r2(Math.abs(tx.getFloat("amount")));
  const sign = tx.getFloat("amount") < 0 ? -1 : 1;

  if (parts.length) {
    if (parts.length < 2) throw new BadRequestError("A split needs at least two parts.");
    if (parts.length > 20) throw new BadRequestError("That's too many parts.");
    const sum = r2(parts.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(sum - total) > 0.009) throw new BadRequestError(`The parts add up to ${util.money(sum)}, not ${util.money(total)}.`);
    for (const p of parts) {
      if (!p.category) continue;
      let c;
      try { c = app.findRecordById("categories", p.category); } catch (_) { throw new BadRequestError("Unknown category."); }
      if (c.getString("user") !== userId) throw new ForbiddenError("That category isn't yours.");
    }
  }

  app.runInTransaction((txApp) => {
    for (const old of txApp.findRecordsByFilter("tx_splits", "transaction = {:t}", "", 0, 0, { t: tx.id })) txApp.delete(old);
    const t = txApp.findRecordById("transactions", tx.id);
    if (!parts.length) {
      t.set("split", false);
      txApp.save(t);
      return;
    }
    const col = txApp.findCollectionByNameOrId("tx_splits");
    parts.forEach((p, i) => {
      const r = new Record(col);
      r.set("user", userId);
      r.set("transaction", tx.id);
      r.set("category", p.category);
      r.set("amount", r2(sign * p.amount));
      r.set("note", p.note);
      r.set("position", i);
      txApp.save(r);
    });
    // the transaction shows under its biggest part
    const biggest = parts.slice().sort((a, b) => b.amount - a.amount)[0];
    t.set("split", true);
    t.set("category", biggest.category);
    t.set("cat_manual", true);
    txApp.save(t);
  });
  return { split: parts.length > 0, parts: list(app, userId, tx.id) };
}

function list(app, userId, txId) {
  return app.findRecordsByFilter("tx_splits", "user = {:u} && transaction = {:t}", "position", 0, 0, { u: userId, t: txId })
    .map((s) => ({ id: s.id, category: s.getString("category"), amount: s.getFloat("amount"), note: s.getString("note") }));
}

// txs: plain objects with id, amount, category and split. Split ones are replaced by one entry
// per part (same date, payee, etc.); `part` is the part's index. If the bank later changed the
// amount (a tip added when a pending charge posts), the difference goes on the biggest part.
function expand(app, userId, txs, start, end) {
  if (!txs.some((t) => t.split)) return txs;
  const byTx = {};
  for (const s of app.findRecordsByFilter("tx_splits", "user = {:u} && transaction.date >= {:s} && transaction.date < {:e}", "position", 0, 0, { u: userId, s: start, e: end })) {
    const k = s.getString("transaction");
    (byTx[k] = byTx[k] || []).push({ category: s.getString("category"), amount: s.getFloat("amount") });
  }
  const out = [];
  for (const t of txs) {
    const parts = t.split ? byTx[t.id] : null;
    if (!parts || !parts.length) { out.push(t); continue; }
    const diff = r2(t.amount - parts.reduce((s, p) => s + p.amount, 0));
    let big = 0;
    parts.forEach((p, i) => { if (Math.abs(p.amount) > Math.abs(parts[big].amount)) big = i; });
    parts.forEach((p, i) => out.push(Object.assign({}, t, { amount: r2(p.amount + (i === big ? diff : 0)), category: p.category, part: i })));
  }
  return out;
}

module.exports = { save, list, expand };
