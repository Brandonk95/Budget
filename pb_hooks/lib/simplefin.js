// SimpleFIN Bridge client (https://www.simplefin.org/protocol.html).
// Users create a setup token at https://bridge.simplefin.org, paste it in the app,
// and we exchange it once for a long-lived access URL that is stored hidden.

const util = require(`${__hooks}/lib/util.js`);

function claim(setupToken) {
  const claimUrl = util.b64decode(String(setupToken || "").trim()).trim();
  if (!/^https:\/\/[^\s]+$/.test(claimUrl)) {
    throw new Error("That doesn't look like a SimpleFIN setup token.");
  }
  const res = $http.send({ url: claimUrl, method: "POST", headers: { "Content-Length": "0" }, timeout: 30 });
  const body = toString(res.body).trim();
  if (res.statusCode !== 200) {
    throw new Error("SimpleFIN claim failed (" + res.statusCode + "). Setup tokens can only be used once — create a new one. " + body.slice(0, 200));
  }
  if (!/^https:\/\/[^:\s]+:[^@\s]+@[^\s]+$/.test(body)) {
    throw new Error("SimpleFIN returned an unexpected access URL.");
  }
  return body;
}

function parseAccessUrl(accessUrl) {
  const m = /^(https):\/\/([^:]+):([^@]+)@(.+?)\/?$/.exec(accessUrl);
  if (!m) throw new Error("Invalid stored access URL");
  return {
    base: m[1] + "://" + m[4],
    auth: "Basic " + util.b64encode(decodeURIComponent(m[2]) + ":" + decodeURIComponent(m[3])),
  };
}

function fetchAccounts(accessUrl, startUnix) {
  const a = parseAccessUrl(accessUrl);
  const url = a.base + "/accounts?pending=1&start-date=" + Math.floor(startUnix);
  const res = $http.send({ url, method: "GET", headers: { Authorization: a.auth }, timeout: 90 });
  if (res.statusCode === 403) throw new Error("SimpleFIN denied access (403). Reconnect this bank with a new setup token.");
  if (res.statusCode === 402) throw new Error("SimpleFIN subscription payment required (402).");
  if (res.statusCode !== 200) throw new Error("SimpleFIN error " + res.statusCode + ": " + toString(res.body).slice(0, 300));
  const data = res.json || {};
  const errors = (data.errors || []).concat((data.errlist || []).map((e) => e.msg || e.message || JSON.stringify(e)));
  return { accounts: data.accounts || [], errors };
}

// Sync one bank_connections record. Returns { newTransactions: [Record], accounts: n, errors: [] }.
function syncConnection(app, conn) {
  const ingest = require(`${__hooks}/lib/ingest.js`);
  const rules = require(`${__hooks}/lib/rules.js`);
  const nowSec = Date.now() / 1000;
  const start = ingest.windowStartSec(conn, 89); // SimpleFIN caps requests at 90 days
  const result = fetchAccounts(conn.getString("secret"), start);
  const ctx = rules.context(app, conn.getString("user"));
  let created = [];

  for (const a of result.accounts) {
    const acc = ingest.upsertAccount(app, conn, {
      externalId: String(a.id),
      name: a.name,
      institution: (a.org && (a.org.name || a.org.domain)) || "",
      currency: a.currency,
      balance: parseFloat(a.balance),
      available: parseFloat(a["available-balance"] || a.balance),
      balanceDate: a["balance-date"] ? util.dateFromUnix(a["balance-date"]) : null,
    });
    const txs = (a.transactions || []).map((t) => ({
      externalId: String(t.id),
      date: util.dateFromUnix(t.transacted_at || t.posted || nowSec),
      amount: parseFloat(t.amount),
      description: t.description || t.memo || "",
      payee: t.payee || "",
      pending: !!t.pending,
    }));
    created = created.concat(ingest.upsertTransactions(app, acc, txs, util.dateFromUnix(start), ctx));
  }

  // SimpleFIN "errors" are often informational (e.g. a range was capped); keep the
  // connection healthy unless nothing came back.
  const hardFail = result.errors.length && !result.accounts.length;
  ingest.markSynced(app, conn, hardFail ? "error" : "ok", result.errors.join("; "));
  return { newTransactions: created, accounts: result.accounts.length, errors: hardFail ? result.errors : [] };
}

module.exports = { claim, syncConnection };
