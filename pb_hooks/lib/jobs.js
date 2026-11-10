// Higher-level jobs shared by routes and cron.

const util = require(`${__hooks}/lib/util.js`);

function syncUser(app, userId) {
  const simplefin = require(`${__hooks}/lib/simplefin.js`);
  const notify = require(`${__hooks}/lib/notify.js`);
  const user = app.findRecordById("users", userId);
  const conns = app.findRecordsByFilter("bank_connections", "user = {:u}", "", 0, 0, { u: userId });
  const summary = { connections: conns.length, accounts: 0, new_transactions: 0, errors: [] };
  let created = [];
  for (const conn of conns) {
    try {
      const res = simplefin.syncConnection(app, conn);
      summary.accounts += res.accounts;
      created = created.concat(res.newTransactions);
      if (res.errors.length) summary.errors.push(conn.getString("name") + ": " + res.errors.join("; "));
    } catch (err) {
      const msg = util.errMsg(err);
      summary.errors.push((conn.getString("name") || "bank") + ": " + msg);
      conn.set("status", "error");
      conn.set("last_error", msg);
      try { app.save(conn); } catch (_) {}
      try { notify.syncFailed(app, user, conn, msg); } catch (e2) { app.logger().error("sync failure email", "error", util.errMsg(e2)); }
    }
  }
  summary.new_transactions = created.length;
  afterNewTransactions(app, user, created);
  return summary;
}

// Sync a single connection right after it's added (doesn't spend other connections' quota).
function syncConnection(app, conn) {
  const provider = require(`${__hooks}/lib/simplefin.js`);
  const user = app.findRecordById("users", conn.getString("user"));
  try {
    const res = provider.syncConnection(app, conn);
    afterNewTransactions(app, user, res.newTransactions);
    return { connections: 1, accounts: res.accounts, new_transactions: res.newTransactions.length, errors: res.errors };
  } catch (err) {
    return { connections: 1, accounts: 0, new_transactions: 0, errors: [util.errMsg(err)] };
  }
}

function afterNewTransactions(app, user, created) {
  const notify = require(`${__hooks}/lib/notify.js`);
  try { require(`${__hooks}/lib/networth.js`).snapshot(app, user.id); } catch (err) { app.logger().error("net worth snapshot", "error", util.errMsg(err)); }
  if (created.length) {
    try { require(`${__hooks}/lib/recurring.js`).detect(app, user.id); } catch (err) { app.logger().error("recurring detect", "error", util.errMsg(err)); }
  }
  try { notify.largeTransactions(app, user, created); } catch (err) { app.logger().error("large txn email", "error", util.errMsg(err)); }
  try { notify.checkBudgets(app, user); } catch (err) { app.logger().error("budget alert email", "error", util.errMsg(err)); }
}

function eachUser(app, fn) {
  for (const u of app.findAllRecords("users")) {
    try { fn(u); } catch (err) { app.logger().error("job failed", "user", u.id, "error", util.errMsg(err)); }
  }
}

function syncAll(app) {
  const ids = {};
  for (const c of app.findAllRecords("bank_connections")) ids[c.getString("user")] = true;
  for (const id in ids) {
    try {
      const s = syncUser(app, id);
      app.logger().info("bank sync", "user", id, "new", s.new_transactions, "errors", s.errors.length);
    } catch (err) {
      app.logger().error("bank sync failed", "user", id, "error", util.errMsg(err));
    }
  }
}

function alertsAll(app) {
  const notify = require(`${__hooks}/lib/notify.js`);
  eachUser(app, (u) => notify.checkBudgets(app, u));
}

function digestAll(app) {
  const notify = require(`${__hooks}/lib/notify.js`);
  eachUser(app, (u) => { if (u.getBool("weekly_digest") && u.getString("email")) notify.digest(app, u); });
}

// Daily: net worth snapshot and "bill due soon" emails.
function dailyAll(app) {
  const notify = require(`${__hooks}/lib/notify.js`);
  const networth = require(`${__hooks}/lib/networth.js`);
  eachUser(app, (u) => {
    networth.snapshot(app, u.id);
    notify.billReminders(app, u);
    try { require(`${__hooks}/lib/forecast.js`).lowBalanceAlert(app, u); } catch (err) { app.logger().error("cash forecast alert", "error", util.errMsg(err)); }
  });
}

module.exports = { syncConnection, syncUser, syncAll, alertsAll, digestAll, dailyAll, afterNewTransactions };
