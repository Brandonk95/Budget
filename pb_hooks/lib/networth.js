// Net worth: current assets/liabilities, daily snapshots, and history.
// Before the first snapshot, history is rebuilt from transactions (balance minus later activity).

const util = require(`${__hooks}/lib/util.js`);

const LIABILITY = { credit: true, loan: true };
const DAY = 86400000;
const pad = util.pad;
const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };

function accountsOf(app, userId) {
  return app.findRecordsByFilter("accounts", "user = {:u} && hidden = false", "name", 0, 0, { u: userId }).map((a) => ({
    id: a.id, name: a.getString("name"), institution: a.getString("institution"), type: a.getString("type") || "other",
    balance: a.getFloat("balance"), balance_date: a.getString("balance_date"), connection: a.getString("connection"),
  }));
}

// signed value: assets positive, debts negative regardless of how the bank reports them
const signed = (a) => (LIABILITY[a.type] ? -Math.abs(a.balance) : a.balance);

function current(app, userId) {
  const accs = accountsOf(app, userId);
  let assets = 0, liabilities = 0;
  const groups = {};
  for (const a of accs) {
    const v = signed(a);
    if (v >= 0) assets += v; else liabilities += -v;
    const g = (groups[a.type] = groups[a.type] || { type: a.type, total: 0, accounts: [] });
    g.total += v;
    g.accounts.push({ id: a.id, name: a.name, institution: a.institution, value: util.round2(v), synced: !!a.connection });
  }
  for (const k in groups) groups[k].total = util.round2(groups[k].total);
  return { assets: util.round2(assets), liabilities: util.round2(liabilities), net: util.round2(assets - liabilities), groups, accounts: accs };
}

function snapshot(app, userId) {
  const c = current(app, userId);
  if (!c.accounts.length) return null;
  const day = dayOf(Date.now());
  let r;
  try { r = app.findFirstRecordByFilter("balance_history", "user = {:u} && day = {:d}", { u: userId, d: day }); } catch (_) {
    r = new Record(app.findCollectionByNameOrId("balance_history"));
    r.set("user", userId);
    r.set("day", day);
  }
  r.set("assets", c.assets);
  r.set("liabilities", c.liabilities);
  r.set("net", c.net);
  app.save(r);
  try { require(`${__hooks}/lib/goals.js`).snapshotAccounts(app, userId); } catch (err) { app.logger().error("account snapshot", "error", String(err)); }
  return c;
}

function history(app, userId, days) {
  days = Math.max(7, Math.min(730, days || 90));
  const c = current(app, userId);
  const startMs = Date.now() - days * DAY;
  const start = dayOf(startMs);
  const snaps = {};
  for (const s of app.findRecordsByFilter("balance_history", "user = {:u} && day >= {:d}", "day", 0, 0, { u: userId, d: start })) {
    snaps[s.getString("day")] = s.getFloat("net");
  }
  // today is always live
  const today = dayOf(Date.now());
  snaps[today] = c.net;
  const firstSnap = Object.keys(snaps).sort()[0];

  // daily net change from transactions on visible accounts, for reconstruction
  const accIds = {};
  for (const a of c.accounts) accIds[a.id] = true;
  const delta = {};
  if (start < firstSnap) {
    const txs = app.findRecordsByFilter("transactions", "user = {:u} && date >= {:s}", "", 0, 0, { u: userId, s: start + " 00:00:00.000Z" });
    for (const t of txs) {
      if (!accIds[t.getString("account")]) continue;
      const d = t.getString("date").slice(0, 10);
      delta[d] = (delta[d] || 0) + t.getFloat("amount");
    }
  }

  const points = [];
  let anchor = snaps[firstSnap];
  // walk backward from the first snapshot
  const back = [];
  for (let ms = new Date(firstSnap + "T12:00:00").getTime() - DAY; dayOf(ms) >= start; ms -= DAY) {
    const next = dayOf(ms + DAY);
    anchor -= delta[next] || 0;
    back.push({ day: dayOf(ms), net: util.round2(anchor), estimated: true });
  }
  back.reverse();
  for (const p of back) points.push(p);
  let last = snaps[firstSnap];
  for (let ms = new Date(firstSnap + "T12:00:00").getTime(); dayOf(ms) <= today; ms += DAY) {
    const d = dayOf(ms);
    if (snaps[d] != null) last = snaps[d];
    points.push({ day: d, net: util.round2(last) });
  }
  const first = points.length ? points[0].net : c.net;
  return {
    assets: c.assets, liabilities: c.liabilities, net: c.net, groups: c.groups,
    change: util.round2(c.net - first), days, points,
  };
}

module.exports = { current, snapshot, history, LIABILITY };
