// The smaller "heads up" emails: possible duplicate charges, a subscription price going up,
// a yearly renewal coming in a week, and a paycheck landing. Each one is sent once (claimKey).

const util = require(`${__hooks}/lib/util.js`);

const DAY = 86400000;
const dayOf = (s) => String(s).slice(0, 10);
const dayMs = (d) => Date.parse(dayOf(d) + "T00:00:00Z");
const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / DAY);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pretty = (d) => { const x = new Date(dayMs(d)); return `${MON[x.getUTCMonth()]} ${x.getUTCDate()}`; };
const nameOf = (t) => t.getString("payee") || t.getString("description") || "a merchant";
const enabled = (user, field) => user.getBool(field) && !!user.getString("email");
// new transactions from the first sync of a bank can go back months; only fresh ones are news
const recent = (t, days) => daysBetween(t.getString("date"), util.today()) <= days;

// Two charges at the same merchant for the same amount within two days of each other.
function duplicates(app, user, created) {
  if (!enabled(user, "alert_duplicates") || !created.length) return 0;
  const notify = require(`${__hooks}/lib/notify.js`);
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const found = [];
  for (const t of created) {
    const amt = t.getFloat("amount");
    // pending charges get a new id when they post, so they'd look like their own duplicate
    if (amt > -5 || t.getBool("pending") || !recent(t, 4)) continue;
    const key = recurring.normalizePayee(nameOf(t));
    if (!key) continue;
    const from = util.dateFromJs(new Date(dayMs(t.getString("date")) - 2 * DAY));
    const to = util.dateFromJs(new Date(dayMs(t.getString("date")) + 2 * DAY));
    const twins = app.findRecordsByFilter("transactions",
      "user = {:u} && account = {:a} && id != {:id} && pending = false && amount = {:amt} && date >= {:f} && date <= {:t}",
      "date", 0, 0, { u: user.id, a: t.getString("account"), id: t.id, amt, f: from, t: to })
      .filter((o) => recurring.normalizePayee(nameOf(o)) === key);
    if (!twins.length) continue;
    const pair = [t.id, twins[0].id].sort().join(":");
    if (notify.claimKey(app, user.id, "dup:" + pair)) found.push({ t, twin: twins[0] });
  }
  if (!found.length) return 0;
  const rows = found.map(({ t, twin }) => notify.row([
    util.esc(nameOf(t)), `${pretty(twin.getString("date"))} and ${pretty(t.getString("date"))}`, util.money(Math.abs(t.getFloat("amount"))),
  ]));
  const subject = found.length === 1 ? `Possible double charge at ${nameOf(found[0].t)}` : `${found.length} possible double charges`;
  notify.send(app, user.getString("email"), subject, notify.layout(app, "Possible double charge",
    `<p>${found.length === 1 ? "This merchant charged" : "These merchants charged"} the same amount twice within two days:</p>${notify.table(rows)}
     <p>That can be completely normal, like two trips to the same store. If you only bought once, check with the merchant or your bank.</p>`));
  return found.length;
}

// A subscription charged more than last time (only changes in the last two weeks are news).
function priceIncreases(app, user) {
  if (!enabled(user, "alert_price")) return 0;
  const notify = require(`${__hooks}/lib/notify.js`);
  const subs = require(`${__hooks}/lib/recurring.js`).subscriptions(app, user.id).subscriptions;
  const ups = subs.filter((s) => s.status === "active" && s.price_change && s.price_change.to > s.price_change.from
    && daysBetween(s.price_change.date, util.today()) <= 14)
    .filter((s) => notify.claimKey(app, user.id, `price:${s.id}:${s.price_change.date}`));
  if (!ups.length) return 0;
  const PER_YEAR = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };
  const rows = ups.map((s) => notify.row([util.esc(s.name), `${util.money(s.price_change.from)} → <b>${util.money(s.price_change.to)}</b>`,
    `+${util.money((s.price_change.to - s.price_change.from) * (PER_YEAR[s.frequency] || 12))}/yr`]));
  const subject = ups.length === 1 ? `${ups[0].name} went up to ${util.money(ups[0].price_change.to)}` : `${ups.length} subscriptions went up`;
  notify.send(app, user.getString("email"), subject, notify.layout(app, "A subscription price went up",
    `<p>${ups.length === 1 ? "This subscription charged" : "These subscriptions charged"} more than last time:</p>${notify.table(rows)}
     <p>If it's not worth the new price, now's a good time to cancel or switch plans.</p>`));
  return ups.length;
}

// A week's notice before a yearly (or quarterly) charge, since those are easy to forget.
function renewals(app, user) {
  if (!enabled(user, "alert_renewals")) return 0;
  const notify = require(`${__hooks}/lib/notify.js`);
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const today = dayOf(util.today());
  const items = recurring.list(app, user.id, util.currentMonth()).items
    .filter((it) => it.status === "active" && it.kind !== "income" && (it.frequency === "yearly" || it.frequency === "quarterly"));
  const due = [];
  for (const it of items) {
    const next = recurring.occurrences(it, today, util.dateFromJs(new Date(dayMs(today) + 8 * DAY)).slice(0, 10))[0];
    if (!next) continue;
    const n = daysBetween(today, next);
    if (n < 4 || n > 7) continue; // the 3-day bill reminder covers the last few days
    if (notify.claimKey(app, user.id, `renew:${it.id}:${next}`)) due.push({ it, next, n });
  }
  if (!due.length) return 0;
  const rows = due.map(({ it, next, n }) => notify.row([util.esc(it.name), `${pretty(next)} (in ${n} days)`, util.money(it.amount)]));
  const subject = due.length === 1 ? `${due[0].it.name} renews in ${due[0].n} days (${util.money(due[0].it.amount)})` : `${due.length} renewals next week`;
  notify.send(app, user.getString("email"), subject, notify.layout(app, "Renewing next week",
    `<p>${due.length === 1 ? `This ${due[0].it.frequency} charge is` : "These charges are"} coming up:</p>${notify.table(rows)}
     <p>Still using it? If not, cancel before it renews.</p>`));
  return due.length;
}

// A deposit from a recurring income source (a paycheck) just landed.
function paychecks(app, user, created) {
  if (!enabled(user, "alert_paycheck") || !created.length) return 0;
  const notify = require(`${__hooks}/lib/notify.js`);
  const recurring = require(`${__hooks}/lib/recurring.js`);
  const sources = {};
  for (const r of app.findRecordsByFilter("recurring", "user = {:u} && kind = 'income' && status = 'active'", "", 0, 0, { u: user.id })) {
    if (r.getString("merchant_key")) sources[r.getString("merchant_key")] = r.getString("name");
  }
  const landed = created.filter((t) => t.getFloat("amount") > 0 && !t.getBool("pending") && recent(t, 3)
    && sources[recurring.normalizePayee(nameOf(t))]).filter((t) => notify.claimKey(app, user.id, "pay:" + t.id));
  if (!landed.length) return 0;
  const total = landed.reduce((s, t) => s + t.getFloat("amount"), 0);
  let left = "";
  try {
    const d = require(`${__hooks}/lib/insights.js`).compute(app, user.id, util.currentMonth());
    if (d.budgeted > 0) left = `<p>You have <b>${util.money(Math.max(0, d.budgeted - d.spent))}</b> left to spend this month, about <b>${util.money(d.safe_per_day)} a day</b> for the next ${d.remaining_days} days.</p>`;
  } catch (_) {}
  const rows = landed.map((t) => notify.row([util.esc(sources[recurring.normalizePayee(nameOf(t))]), pretty(t.getString("date")), `<span style="color:#0f7a52">+${util.money(t.getFloat("amount"))}</span>`]));
  const subject = `Your paycheck arrived: +${util.money(total)}`;
  notify.send(app, user.getString("email"), subject, notify.layout(app, "Your paycheck arrived", `${notify.table(rows)}${left}`));
  return landed.length;
}

module.exports = { duplicates, priceIncreases, renewals, paychecks };
