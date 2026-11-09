/// <reference path="../pb_data/types.d.ts" />

// NOTE: every handler runs in its own isolated JS context, so shared code is
// loaded with require() inside each handler instead of at the top level.

// ---------------------------------------------------------------- bootstrap
onBootstrap((e) => {
  e.next();
  require(`${__hooks}/lib/setup.js`).applySettings(e.app);
});

// Make browsers revalidate the web app files so updates show up right after a redeploy.
routerUse((e) => {
  const p = e.request.url.path;
  if (p.indexOf("/api/") !== 0 && p.indexOf("/_/") !== 0) {
    e.response.header().set("Cache-Control", "no-cache");
  }
  return e.next();
});

// ---------------------------------------------------------------- users
onRecordCreate((e) => {
  if (!e.record.getInt("alert_threshold")) {
    e.record.set("alerts_enabled", true);
    e.record.set("alert_threshold", 90);
    e.record.set("large_txn_threshold", 500);
    e.record.set("weekly_digest", true);
    e.record.set("update_notes", true);
  }
  // new accounts start on the current release, so they don't get an update popup right away
  if (!e.record.getString("last_seen_version")) {
    e.record.set("last_seen_version", require(`${__hooks}/lib/release.js`).info().version);
  }
  e.next();
}, "users");

onRecordAfterCreateSuccess((e) => {
  require(`${__hooks}/lib/rules.js`).seedCategories(e.app, e.record.id);
  e.next();
}, "users");

// ---------------------------------------------------------------- ownership guards
// API rules force `user` to be the caller; these make sure related records are theirs too.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const uid = e.auth ? e.auth.id : "";
  const rec = e.record;
  const name = rec.collection().name;
  const owned = (col, id) => {
    if (!id) return;
    let r;
    try { r = e.app.findRecordById(col, id); } catch (_) { throw new BadRequestError("Invalid " + col + " reference."); }
    if (r.getString("user") !== uid) throw new ForbiddenError("That " + col.replace(/s$/, "") + " isn't yours.");
  };
  if (name === "transactions") { owned("accounts", rec.getString("account")); owned("categories", rec.getString("category")); }
  if (name === "rules") owned("categories", rec.getString("category"));
  if (name === "accounts") { rec.set("connection", ""); rec.set("external_id", ""); }
  e.next();
}, "transactions", "rules", "accounts");

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const uid = e.auth ? e.auth.id : "";
  const rec = e.record;
  const name = rec.collection().name;
  const owned = (col, id) => {
    if (!id) return;
    let r;
    try { r = e.app.findRecordById(col, id); } catch (_) { throw new BadRequestError("Invalid " + col + " reference."); }
    if (r.getString("user") !== uid) throw new ForbiddenError("That " + col.replace(/s$/, "") + " isn't yours.");
  };
  if (name === "transactions") { owned("accounts", rec.getString("account")); owned("categories", rec.getString("category")); }
  if (name === "rules") owned("categories", rec.getString("category"));
  if (name === "accounts") {
    const orig = rec.original();
    rec.set("connection", orig.getString("connection"));
    rec.set("external_id", orig.getString("external_id"));
  }
  e.next();
}, "transactions", "rules", "accounts");

// Auto-categorize manually created transactions.
onRecordCreateRequest((e) => {
  if (!e.record.getString("category")) {
    const rules = require(`${__hooks}/lib/rules.js`);
    const r = e.record;
    const ctx = rules.context(e.app, r.getString("user"));
    r.set("category", rules.categorize(ctx, {
      description: r.getString("description"), payee: r.getString("payee"), amount: r.getFloat("amount"),
    }));
  }
  e.next();
}, "transactions");

// ---------------------------------------------------------------- custom API
// Connect a bank via SimpleFIN setup token.
routerAdd("POST", "/api/budget/connect", (e) => {
  const util = require(`${__hooks}/lib/util.js`);
  const simplefin = require(`${__hooks}/lib/simplefin.js`);
  const jobs = require(`${__hooks}/lib/jobs.js`);
  const body = e.requestInfo().body || {};
  let accessUrl;
  try { accessUrl = simplefin.claim(body.setup_token); } catch (err) { throw new BadRequestError(util.errMsg(err)); }

  const conn = new Record(e.app.findCollectionByNameOrId("bank_connections"));
  conn.set("user", e.auth.id);
  conn.set("provider", "simplefin");
  conn.set("name", String(body.name || "SimpleFIN").slice(0, 80));
  conn.set("secret", accessUrl);
  conn.set("status", "ok");
  e.app.save(conn);
  return e.json(200, { connection: conn.id, sync: jobs.syncConnection(e.app, conn) });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/budget/sync", (e) => {
  const jobs = require(`${__hooks}/lib/jobs.js`);
  return e.json(200, jobs.syncUser(e.app, e.auth.id));
}, $apis.requireAuth("users"));

// Bulk CSV import (rows already parsed/mapped in the browser). De-duplicated on re-import.
routerAdd("POST", "/api/budget/import", (e) => {
  const util = require(`${__hooks}/lib/util.js`);
  const rules = require(`${__hooks}/lib/rules.js`);
  const jobs = require(`${__hooks}/lib/jobs.js`);
  const body = e.requestInfo().body || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new BadRequestError("No rows to import.");
  if (rows.length > 10000) throw new BadRequestError("Import at most 10,000 rows at a time.");

  let account;
  try { account = e.app.findRecordById("accounts", String(body.account || "")); } catch (_) { throw new BadRequestError("Pick an account."); }
  if (account.getString("user") !== e.auth.id) throw new ForbiddenError("That account isn't yours.");

  let inserted = 0, skipped = 0, invalid = 0;
  const created = [];
  e.app.runInTransaction((txApp) => {
    const col = txApp.findCollectionByNameOrId("transactions");
    const ctx = rules.context(txApp, e.auth.id);
    const occurrences = {};
    for (const row of rows) {
      const date = String(row.date || "");
      const amount = Number(row.amount);
      const desc = String(row.description || "").trim().slice(0, 500);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(amount)) { invalid++; continue; }
      const base = date + "|" + amount.toFixed(2) + "|" + desc.toLowerCase();
      occurrences[base] = (occurrences[base] || 0) + 1;
      const ext = "csv:" + $security.sha256(base).slice(0, 40) + ":" + occurrences[base];
      try {
        txApp.findFirstRecordByFilter("transactions", "account = {:a} && external_id = {:x}", { a: account.id, x: ext });
        skipped++;
        continue;
      } catch (_) {}
      const t = new Record(col);
      t.set("user", e.auth.id);
      t.set("account", account.id);
      t.set("external_id", ext);
      t.set("date", date + " 12:00:00.000Z");
      t.set("amount", util.round2(amount));
      t.set("description", desc);
      t.set("payee", String(row.payee || "").slice(0, 200));
      t.set("category", rules.categorize(ctx, { description: desc, payee: row.payee, amount }));
      txApp.save(t);
      created.push(t);
      inserted++;
    }
  });
  jobs.afterNewTransactions(e.app, e.app.findRecordById("users", e.auth.id), created);
  return e.json(200, { inserted, skipped, invalid });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/budget/apply-rules", (e) => {
  const rules = require(`${__hooks}/lib/rules.js`);
  return e.json(200, { updated: rules.applyToUncategorized(e.app, e.auth.id) });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/budget/insights", (e) => {
  const insights = require(`${__hooks}/lib/insights.js`);
  const month = e.request.url.query().get("month");
  return e.json(200, insights.compute(e.app, e.auth.id, month));
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/budget/digest", (e) => {
  const notify = require(`${__hooks}/lib/notify.js`);
  if (!notify.smtpReady(e.app)) throw new BadRequestError("SMTP isn't configured. Set SMTP_* in .env and restart.");
  const user = e.app.findRecordById("users", e.auth.id);
  try {
    notify.digest(e.app, user);
  } catch (err) {
    throw new BadRequestError("Sending failed: " + String(err.message || err));
  }
  return e.json(200, { sent: true, to: user.getString("email") });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/budget/status", (e) => {
  const rel = require(`${__hooks}/lib/release.js`).info();
  return e.json(200, {
    version: rel.version,
    released: rel.released,
    motd: rel.motd,
    smtp: e.app.settings().smtp.enabled,
    app_name: e.app.settings().meta.appName,
  });
});

// ---------------------------------------------------------------- schedules
cronAdd("budget_sync", $os.getenv("SYNC_CRON") || "0 */6 * * *", () => {
  require(`${__hooks}/lib/jobs.js`).syncAll($app);
});

cronAdd("budget_alerts", $os.getenv("ALERT_CRON") || "30 * * * *", () => {
  require(`${__hooks}/lib/jobs.js`).alertsAll($app);
});

cronAdd("budget_digest", $os.getenv("DIGEST_CRON") || "0 14 * * 1", () => {
  require(`${__hooks}/lib/jobs.js`).digestAll($app);
});
