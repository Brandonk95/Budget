/// <reference path="../pb_data/types.d.ts" />

// Shared household: a user can join another user's household, and then sees and edits that
// household's data (the owner's records) instead of their own. users.household points at the
// owner; it's empty for owners and people on their own. Only the server changes it.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("household")) {
    users.fields.add(new RelationField({ name: "household", collectionId: users.id, maxSelect: 1, cascadeDelete: false }));
    app.save(users);
  }

  const invites = new Collection({
    type: "base",
    name: "household_invites",
    // managed only through /api/budget/household/*
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "owner", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "email", name: "email", required: true },
      { type: "text", name: "token_hash", required: true, hidden: true, max: 100 },
      { type: "date", name: "expires", required: true },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_hh_inv_token ON household_invites (token_hash)"],
  });
  app.save(invites);

  // "already sent" is per person now, so each household member gets their own copy of an alert
  const sent = app.findCollectionByNameOrId("alerts_sent");
  sent.indexes = ["CREATE UNIQUE INDEX idx_alerts_user_key ON alerts_sent (user, key)"];
  app.save(sent);

  // "whose data": your own when you're not in a household, the owner's when you are
  const MINE = '((@request.auth.household = "" && user = @request.auth.id) || (@request.auth.household != "" && user = @request.auth.household))';
  const BODY_MINE = '((@request.auth.household = "" && @request.body.user = @request.auth.id) || (@request.auth.household != "" && @request.body.user = @request.auth.household))';
  const map = {
    "user = @request.auth.id": MINE,
    '@request.auth.id != "" && @request.body.user = @request.auth.id': '@request.auth.id != "" && ' + BODY_MINE,
    "user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)": MINE + " && (@request.body.user:isset = false || " + BODY_MINE + ")",
  };
  for (const name of ["categories", "bank_connections", "accounts", "transactions", "rules", "goals", "recurring", "balance_history", "account_history", "tx_splits"]) {
    const col = app.findCollectionByNameOrId(name);
    for (const r of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
      const v = col[r];
      if (v != null && map[v]) col[r] = map[v];
    }
    app.save(col);
  }
}, (app) => {
  const MINE = '((@request.auth.household = "" && user = @request.auth.id) || (@request.auth.household != "" && user = @request.auth.household))';
  const BODY_MINE = '((@request.auth.household = "" && @request.body.user = @request.auth.id) || (@request.auth.household != "" && @request.body.user = @request.auth.household))';
  const back = {};
  back[MINE] = "user = @request.auth.id";
  back['@request.auth.id != "" && ' + BODY_MINE] = '@request.auth.id != "" && @request.body.user = @request.auth.id';
  back[MINE + " && (@request.body.user:isset = false || " + BODY_MINE + ")"] = "user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)";
  for (const name of ["categories", "bank_connections", "accounts", "transactions", "rules", "goals", "recurring", "balance_history", "account_history", "tx_splits"]) {
    const col = app.findCollectionByNameOrId(name);
    for (const r of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
      const v = col[r];
      if (v != null && back[v]) col[r] = back[v];
    }
    app.save(col);
  }
  try { app.delete(app.findCollectionByNameOrId("household_invites")); } catch (_) {}
  const sent = app.findCollectionByNameOrId("alerts_sent");
  sent.indexes = ["CREATE UNIQUE INDEX idx_alerts_key ON alerts_sent (key)"];
  app.save(sent);
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("household");
  app.save(users);
});
