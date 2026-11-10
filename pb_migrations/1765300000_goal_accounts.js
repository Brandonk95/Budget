/// <reference path="../pb_data/types.d.ts" />

// Goals can follow an account's balance ("have $5,000 in Savings"), and every account's balance
// is recorded daily so goal charts use real numbers instead of estimates going forward.
migrate((app) => {
  const accounts = app.findCollectionByNameOrId("accounts");
  const goals = app.findCollectionByNameOrId("goals");
  if (!goals.fields.getByName("account")) {
    goals.fields.add(new RelationField({ name: "account", collectionId: accounts.id, maxSelect: 1, cascadeDelete: false }));
  }
  // where the goal started, for "saved since you set this goal"
  if (!goals.fields.getByName("start_amount")) goals.fields.add(new NumberField({ name: "start_amount" }));
  if (!goals.fields.getByName("start_day")) goals.fields.add(new TextField({ name: "start_day", max: 10 }));
  app.save(goals);

  try { app.findCollectionByNameOrId("account_history"); return; } catch (_) { /* create it */ }
  const users = app.findCollectionByNameOrId("users");
  const OWNER = "user = @request.auth.id";
  const hist = new Collection({
    type: "base",
    name: "account_history",
    listRule: OWNER, viewRule: OWNER, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "account", collectionId: accounts.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "text", name: "day", required: true, max: 10 }, // YYYY-MM-DD
      { type: "number", name: "balance" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_accthist_acct_day ON account_history (account, day)"],
  });
  app.save(hist);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("account_history")); } catch (_) {}
  const goals = app.findCollectionByNameOrId("goals");
  for (const f of ["account", "start_amount", "start_day"]) goals.fields.removeByName(f);
  app.save(goals);
});
