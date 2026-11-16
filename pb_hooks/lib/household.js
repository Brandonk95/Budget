// Shared household. One person owns the data; others join by an emailed invite and then see
// and edit the owner's data (users.household = owner id). Each person keeps their own login,
// email alerts and theme. The budget total, expected income and low-balance warning level are
// shared and live on the owner's record.

const util = require(`${__hooks}/lib/util.js`);

const INVITE_DAYS = 7;
// shared money settings, stored on the owner
const SHARED = ["budget_total", "income_override", "cash_floor"];

const ownerId = (user) => user.getString("household") || user.id;
const person = (u) => ({ id: u.id, name: u.getString("name"), email: u.getString("email") });

function membersOf(app, ownerIdValue) {
  return app.findRecordsByFilter("users", "household = {:o}", "created", 0, 0, { o: ownerIdValue });
}

// Everyone who gets this household's emails: the owner, then the members.
function recipients(app, owner) {
  return [owner].concat(membersOf(app, owner.id));
}

function info(app, user) {
  const oid = ownerId(user);
  const owner = app.findRecordById("users", oid);
  const members = membersOf(app, oid);
  const out = {
    role: user.getString("household") ? "member" : members.length ? "owner" : "solo",
    owner: person(owner),
    members: members.map(person),
    invites: [],
    settings: {},
  };
  for (const k of SHARED) out.settings[k] = owner.getFloat(k);
  if (out.role !== "member") {
    const now = new Date().toISOString().replace("T", " ");
    out.invites = app.findRecordsByFilter("household_invites", "owner = {:o} && expires > {:n}", "-created", 0, 0, { o: oid, n: now })
      .map((i) => ({ id: i.id, email: i.getString("email"), expires: i.getString("expires") }));
  }
  return out;
}

function invite(app, user, email) {
  const notify = require(`${__hooks}/lib/notify.js`);
  if (user.getString("household")) throw new Error("Only the person who owns the household can invite people.");
  email = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter an email address.");
  if (email === user.getString("email").toLowerCase()) throw new Error("That's your own email.");
  if (!notify.smtpReady(app)) throw new Error("Email isn't set up on this server, so Keel can't send the invite. Set SMTP_* in .env and restart.");
  for (const m of membersOf(app, user.id)) if (m.getString("email").toLowerCase() === email) throw new Error("They're already in your household.");

  // one live invite per address: a new one replaces the old
  for (const old of app.findRecordsByFilter("household_invites", "owner = {:o} && email = {:e}", "", 0, 0, { o: user.id, e: email })) app.delete(old);
  const token = $security.randomString(40);
  const rec = new Record(app.findCollectionByNameOrId("household_invites"));
  rec.set("owner", user.id);
  rec.set("email", email);
  rec.set("token_hash", $security.sha256(token));
  rec.set("expires", new Date(Date.now() + INVITE_DAYS * 86400000).toISOString().replace("T", " "));
  app.save(rec);

  const meta = app.settings().meta;
  const who = user.getString("name") || user.getString("email");
  const link = `${meta.appURL}/#/join/${token}`;
  const sent = notify.send(app, email, `${who} invited you to share a budget on ${meta.appName}`, notify.layout(app, "You're invited",
    `<p style="margin:0 0 12px">${util.esc(who)} (${util.esc(user.getString("email"))}) wants to share their ${util.esc(meta.appName)} budget with you: the same accounts, transactions, budget, goals and bills, with your own login.</p>
     <p style="margin:0;color:#5f6b80;font-size:14px">The link works once and expires in ${INVITE_DAYS} days. Sign up or sign in with this email address (${util.esc(email)}) to accept.</p>`,
    { button: { label: "Join the household", href: link }, footer: "If you weren't expecting this, you can ignore it." }));
  if (!sent) { app.delete(rec); throw new Error("The invite email couldn't be sent. Check the server's SMTP settings."); }
  return { id: rec.id, email, expires: rec.getString("expires") };
}

function cancelInvite(app, user, id) {
  let rec;
  try { rec = app.findRecordById("household_invites", id); } catch (_) { return; }
  if (rec.getString("owner") !== user.id) throw new Error("That invite isn't yours.");
  app.delete(rec);
}

function findInvite(app, token) {
  if (!token || String(token).length < 20) throw new Error("That invite link isn't valid.");
  let rec;
  try { rec = app.findFirstRecordByFilter("household_invites", "token_hash = {:h}", { h: $security.sha256(String(token)) }); } catch (_) {
    throw new Error("That invite link isn't valid, or it was already used.");
  }
  if (new Date(rec.getString("expires").replace(" ", "T")) < new Date()) throw new Error("That invite has expired. Ask for a new one.");
  return rec;
}

// What the join page shows before you sign in.
function preview(app, token) {
  const rec = findInvite(app, token);
  const owner = app.findRecordById("users", rec.getString("owner"));
  return { from: owner.getString("name") || owner.getString("email"), email: rec.getString("email") };
}

function join(app, user, token) {
  const rec = findInvite(app, token);
  if (rec.getString("email").toLowerCase() !== user.getString("email").toLowerCase()) {
    throw new Error(`This invite is for ${rec.getString("email")}. Sign in with that email to accept it.`);
  }
  const oid = rec.getString("owner");
  if (oid === user.id) throw new Error("That's your own household.");
  if (user.getString("household")) throw new Error("You're already in a household. Leave it first under Settings.");
  if (membersOf(app, user.id).length) throw new Error("Other people share your budget. Remove them under Settings before joining someone else's.");
  const owner = app.findRecordById("users", oid);
  if (owner.getString("household")) throw new Error("That invite is no longer valid.");

  user.set("household", oid);
  app.save(user);
  app.delete(rec);
  // other invites to this address from anyone are moot now
  for (const o of app.findRecordsByFilter("household_invites", "email = {:e}", "", 0, 0, { e: rec.getString("email") })) app.delete(o);

  try {
    const notify = require(`${__hooks}/lib/notify.js`);
    const who = user.getString("name") || user.getString("email");
    notify.send(app, owner.getString("email"), `${who} joined your household`, notify.layout(app, "Your budget is shared",
      `<p style="margin:0">${util.esc(who)} accepted your invite and now shares your budget. You can remove them any time under Settings.</p>`));
  } catch (_) {}
  return info(app, user);
}

function leave(app, user) {
  if (!user.getString("household")) throw new Error("You're not in someone else's household.");
  user.set("household", "");
  app.save(user);
  return info(app, user);
}

function remove(app, owner, memberId) {
  let m;
  try { m = app.findRecordById("users", memberId); } catch (_) { throw new Error("They aren't in your household."); }
  if (m.getString("household") !== owner.id) throw new Error("They aren't in your household.");
  m.set("household", "");
  app.save(m);
  return info(app, owner);
}

// Budget total, expected income and warning level apply to the whole household.
function saveShared(app, user, data) {
  const owner = app.findRecordById("users", ownerId(user));
  for (const k of SHARED) {
    if (data[k] == null) continue;
    const v = Number(data[k]);
    if (!isFinite(v) || v < 0) throw new Error("Enter an amount of 0 or more.");
    owner.set(k, util.round2(v));
  }
  app.save(owner);
  return info(app, user).settings;
}

module.exports = { ownerId, recipients, membersOf, info, invite, cancelInvite, preview, join, leave, remove, saveShared, SHARED };
