// Export (transactions as CSV), full backup (JSON) and restore from a backup.
//
// A backup holds everything that's yours: settings, categories, accounts, transactions and
// their splits, rules, goals, bills and subscriptions, and balance history. It leaves out
// bank-connection secrets: a backup file shouldn't be a key to your bank data. On restore,
// accounts that belonged to a bank connection you still have stay linked; otherwise they come
// back unlinked and are picked up again (no duplicates) when you reconnect that bank.

const FORMAT = 1;

// restore order: each collection only points at ones above it
const COLLECTIONS = ["categories", "accounts", "transactions", "tx_splits", "rules", "goals", "recurring", "balance_history", "account_history"];
// relation fields that point at other backed-up records
const RELS = {
  accounts: { connection: "bank_connections" },
  transactions: { account: "accounts", category: "categories" },
  tx_splits: { transaction: "transactions", category: "categories" },
  rules: { category: "categories" },
  goals: { account: "accounts" },
  recurring: { category: "categories", account: "accounts" },
  account_history: { account: "accounts" },
};
const SKIP = { id: 1, user: 1, created: 1, updated: 1 };
// user fields a backup never touches
const USER_SKIP = { id: 1, email: 1, emailVisibility: 1, verified: 1, password: 1, tokenKey: 1, created: 1, updated: 1, avatar: 1, last_seen_version: 1 };

function fieldsOf(col) {
  const out = [];
  const list = col.fields;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    out.push({ name: f.getName(), type: f.type(), hidden: !!f.getHidden() });
  }
  return out;
}

function plain(rec, fields, skip) {
  const o = { id: rec.id };
  for (const f of fields) {
    if (skip[f.name] || f.hidden || f.type === "password" || f.type === "file") continue;
    if (f.type === "number") o[f.name] = rec.getFloat(f.name);
    else if (f.type === "bool") o[f.name] = rec.getBool(f.name);
    else if (f.type === "json") o[f.name] = rec.get(f.name) == null ? null : JSON.parse(rec.getString(f.name) || "null");
    else o[f.name] = rec.getString(f.name);
  }
  return o;
}

function backup(app, userId) {
  const user = app.findRecordById("users", userId);
  const out = {
    app: "keel", format: FORMAT, exported: new Date().toISOString(),
    settings: plain(user, fieldsOf(user.collection()), USER_SKIP),
    // names only, for reference: the secrets that make them work aren't included
    bank_connections: app.findRecordsByFilter("bank_connections", "user = {:u}", "", 0, 0, { u: userId })
      .map((c) => ({ id: c.id, name: c.getString("name"), provider: c.getString("provider"), institution: c.getString("institution") })),
  };
  delete out.settings.id;
  for (const name of COLLECTIONS) {
    const col = app.findCollectionByNameOrId(name);
    const fields = fieldsOf(col);
    out[name] = app.findRecordsByFilter(name, name === "transactions" ? "user = {:u} && estimated = false" : "user = {:u}", "", 0, 0, { u: userId }).map((r) => plain(r, fields, SKIP));
  }
  return out;
}

function counts(b) {
  const c = {};
  for (const name of COLLECTIONS) c[name] = Array.isArray(b[name]) ? b[name].length : 0;
  return c;
}

// Replaces all of this user's data with the backup's. Runs in one database transaction,
// so a bad file changes nothing.
function restore(app, userId, b) {
  if (!b || b.app !== "keel" || typeof b.format !== "number") throw new Error("That file isn't a Keel backup.");
  if (b.format > FORMAT) throw new Error("That backup is from a newer version of Keel. Update this server first.");
  for (const name of COLLECTIONS) if (b[name] != null && !Array.isArray(b[name])) throw new Error("The backup file is damaged (" + name + ").");

  const result = counts(b);
  app.runInTransaction((tx) => {
    // the bank connections you have now stay; a backed-up account keeps its link only if it's one of them
    const myConns = {};
    for (const c of tx.findRecordsByFilter("bank_connections", "user = {:u}", "", 0, 0, { u: userId })) myConns[c.id] = c.id;

    // clear what's there, children first
    for (const name of COLLECTIONS.slice().reverse()) {
      for (const r of tx.findRecordsByFilter(name, "user = {:u}", "", 0, 0, { u: userId })) tx.delete(r);
    }

    const ids = { bank_connections: myConns };
    for (const name of COLLECTIONS) {
      const col = tx.findCollectionByNameOrId(name);
      const fields = {};
      for (const f of fieldsOf(col)) fields[f.name] = f;
      const rels = RELS[name] || {};
      ids[name] = {};
      for (const src of b[name] || []) {
        const r = new Record(col);
        r.set("user", userId);
        for (const k in src) {
          const f = fields[k];
          if (!f || SKIP[k] || f.type === "autodate" || f.type === "file" || f.type === "password") continue;
          let v = src[k];
          if (rels[k]) v = v ? (ids[rels[k]][v] || "") : "";
          if (f.type === "json") v = v == null ? null : v;
          r.set(k, v);
        }
        // a required link that didn't survive (e.g. a split whose transaction is missing) drops the row
        if ((name === "transactions" && !r.getString("account")) || (name === "tx_splits" && !r.getString("transaction"))
          || (name === "rules" && !r.getString("category")) || (name === "account_history" && !r.getString("account"))) { result[name]--; continue; }
        tx.save(r);
        ids[name][src.id] = r.id;
      }
    }

    if (b.settings && typeof b.settings === "object") {
      const user = tx.findRecordById("users", userId);
      const uf = {};
      for (const f of fieldsOf(user.collection())) uf[f.name] = f;
      for (const k in b.settings) {
        const f = uf[k];
        if (!f || USER_SKIP[k] || f.hidden || f.type === "autodate" || f.type === "file" || f.type === "password" || f.type === "relation") continue;
        user.set(k, b.settings[k]);
      }
      tx.save(user);
    }
  });
  return result;
}

// ---------------------------------------------------------------- CSV
function csvCell(v) {
  let s = v == null ? "" : String(v);
  // a cell starting with = + - @ is a formula to a spreadsheet; keep text as text
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// One row per transaction; a split transaction becomes one row per part, so a pivot table by
// category adds up. from/to are YYYY-MM-DD (inclusive) or empty.
function transactionsCsv(app, userId, from, to) {
  let filter = "user = {:u} && estimated = false";
  const p = { u: userId };
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || "")) { filter += " && date >= {:f}"; p.f = from + " 00:00:00.000Z"; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || "")) { filter += " && date <= {:t}"; p.t = to + " 23:59:59.999Z"; }
  const cats = {}, accts = {};
  for (const c of app.findRecordsByFilter("categories", "user = {:u}", "", 0, 0, { u: userId })) cats[c.id] = c;
  for (const a of app.findRecordsByFilter("accounts", "user = {:u}", "", 0, 0, { u: userId })) accts[a.id] = a.getString("name");
  const parts = {};
  for (const s of app.findRecordsByFilter("tx_splits", "user = {:u}", "position", 0, 0, { u: userId })) {
    (parts[s.getString("transaction")] = parts[s.getString("transaction")] || []).push(s);
  }
  const catName = (id) => (cats[id] ? cats[id].getString("name") : "");
  const group = (id) => (cats[id] ? cats[id].getString("kind") : "");
  const lines = [["Date", "Payee", "Description", "Amount", "Category", "Group", "Account", "Notes", "Pending", "Excluded", "Split"].join(",")];
  let rows = 0;
  for (const t of app.findRecordsByFilter("transactions", filter, "-date", 0, 0, p)) {
    const date = t.getString("date").slice(0, 10);
    const base = [date, t.getString("payee"), t.getString("description")];
    const tail = [accts[t.getString("account")] || ""];
    const flags = [t.getBool("pending") ? "yes" : "", t.getBool("exclude") ? "yes" : ""];
    const ps = t.getBool("split") ? parts[t.id] || [] : [];
    const sign = t.getFloat("amount") < 0 ? -1 : 1;
    if (ps.length) {
      ps.forEach((s, i) => {
        const amt = sign * Math.abs(s.getFloat("amount"));
        lines.push(base.concat([amt.toFixed(2), catName(s.getString("category")), group(s.getString("category"))], tail,
          [s.getString("note") || t.getString("notes")], flags, [`${i + 1} of ${ps.length} (total ${Math.abs(t.getFloat("amount")).toFixed(2)})`]).map(csvCell).join(","));
        rows++;
      });
    } else {
      lines.push(base.concat([t.getFloat("amount").toFixed(2), catName(t.getString("category")), group(t.getString("category"))], tail,
        [t.getString("notes")], flags, [""]).map(csvCell).join(","));
      rows++;
    }
  }
  return { csv: "﻿" + lines.join("\r\n") + "\r\n", rows };
}

module.exports = { backup, restore, counts, transactionsCsv, FORMAT };
