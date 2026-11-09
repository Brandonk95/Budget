// Teller API client (https://teller.io/docs/api).
//
// Real-bank environments (development/production) require mTLS with the client
// certificate Teller issues you. PocketBase's $http can't present a client cert,
// so requests go through the `teller-proxy` nginx sidecar, which holds the
// certificate and forwards to https://api.teller.io. The sandbox needs no cert.

const util = require(`${__hooks}/lib/util.js`);

function config() {
  const env = util.env("TELLER_ENV", "sandbox");
  return {
    appId: util.env("TELLER_APP_ID", ""),
    env,
    base: util.env("TELLER_API_URL", env === "sandbox" ? "https://api.teller.io" : "http://teller-proxy:8080").replace(/\/+$/, ""),
  };
}

class TellerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code || "";
  }
}

function request(token, method, path) {
  const cfg = config();
  let res;
  try {
    res = $http.send({
      url: cfg.base + path,
      method,
      headers: { Authorization: "Basic " + util.b64encode(token + ":"), Accept: "application/json" },
      timeout: 90,
    });
  } catch (err) {
    throw new TellerError(0, "network", "Couldn't reach Teller at " + cfg.base + " (" + util.errMsg(err) + ")." +
      (cfg.base.indexOf("teller-proxy") !== -1 ? " Is the teller-proxy container running? Check the keel-teller-proxy container logs." : ""));
  }
  if (res.statusCode >= 200 && res.statusCode < 300) return res.json;

  const err = (res.json && res.json.error) || {};
  let msg = err.message || toString(res.body).slice(0, 300) || "HTTP " + res.statusCode;
  if (res.statusCode === 400 && /certificate/i.test(msg)) {
    msg = "Teller needs your client certificate: put certificate.pem and private_key.pem in the teller folder (/DATA/AppData/keel/teller on CasaOS); the proxy picks them up within a minute. " + msg;
  }
  throw new TellerError(res.statusCode, err.code, msg);
}

const needsReconnect = (e) => /^enrollment\.disconnected/.test(e.code || "") || e.status === 403;

// Teller's enrichment categories -> default category names (see rules.js).
const CATEGORY_HINTS = {
  groceries: "Groceries", dining: "Dining Out", bar: "Dining Out",
  fuel: "Transportation", transport: "Transportation", transportation: "Transportation",
  utilities: "Utilities", phone: "Utilities", insurance: "Insurance", health: "Health",
  home: "Rent / Mortgage", shopping: "Shopping", clothing: "Shopping", electronics: "Shopping",
  entertainment: "Entertainment", sport: "Entertainment", software: "Subscriptions",
  income: "Paycheck", investment: "Investing", charity: "Gifts",
};

function mapType(a) {
  if (a.type === "credit") return "credit";
  if (a.subtype === "savings" || a.subtype === "money_market" || a.subtype === "certificate_of_deposit") return "savings";
  return "checking";
}

function syncConnection(app, conn) {
  const ingest = require(`${__hooks}/lib/ingest.js`);
  const rules = require(`${__hooks}/lib/rules.js`);
  const token = conn.getString("secret");
  const ctx = rules.context(app, conn.getString("user"));
  // Teller returns full history, so pull a longer first window for trends/recurring detection.
  const start = ingest.windowStartSec(conn, 180);
  const startDay = util.dateFromUnix(start).slice(0, 10);

  let accounts;
  try {
    accounts = request(token, "GET", "/accounts") || [];
  } catch (e) {
    ingest.markSynced(app, conn, needsReconnect(e) ? "reconnect" : "error", e.message);
    throw e;
  }

  let created = [];
  const errors = [];
  for (const a of accounts) {
    if (a.status && a.status !== "open") continue;
    try {
      const type = mapType(a);
      let bal = {};
      try { bal = request(token, "GET", "/accounts/" + a.id + "/balances") || {}; } catch (e) {
        if (needsReconnect(e)) throw e;
        errors.push(a.name + " balance: " + e.message);
      }
      // Teller reports credit balances as the amount owed; store debt as negative for net worth.
      const sign = type === "credit" ? -1 : 1;
      const ledger = bal.ledger != null ? parseFloat(bal.ledger) * sign : null;
      const avail = bal.available != null ? parseFloat(bal.available) : ledger;

      const acc = ingest.upsertAccount(app, conn, {
        externalId: String(a.id),
        name: a.name + (a.last_four ? " ••" + a.last_four : ""),
        institution: (a.institution && a.institution.name) || conn.getString("institution"),
        type,
        currency: a.currency,
        balance: ledger,
        available: avail,
      });

      const list = request(token, "GET", "/accounts/" + a.id + "/transactions?start_date=" + startDay) || [];
      const txs = list.map((t) => {
        const d = t.details || {};
        const hint = d.category ? CATEGORY_HINTS[d.category] : "";
        return {
          externalId: String(t.id),
          date: String(t.date).slice(0, 10) + " 12:00:00.000Z",
          amount: parseFloat(t.amount),
          description: t.description || "",
          payee: (d.counterparty && d.counterparty.name) || "",
          pending: t.status === "pending",
          hint,
        };
      });
      created = created.concat(ingest.upsertTransactions(app, acc, txs, util.dateFromUnix(start), ctx));
    } catch (e) {
      if (needsReconnect(e)) {
        ingest.markSynced(app, conn, "reconnect", e.message);
        throw e;
      }
      if (e.status === 410) continue; // account closed
      errors.push(a.name + ": " + e.message);
    }
  }

  ingest.markSynced(app, conn, errors.length ? "error" : "ok", errors.join("; "));
  return { newTransactions: created, accounts: accounts.length, errors };
}

// Revoke Teller's access when the user disconnects (best effort).
function revoke(token) {
  try { request(token, "DELETE", "/accounts"); } catch (_) {}
}

module.exports = { config, syncConnection, revoke, request };
