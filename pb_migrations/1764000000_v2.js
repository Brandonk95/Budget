/// <reference path="../pb_data/types.d.ts" />

// Keel 2.0: recurring bills/subscriptions/income, net worth history,
// per-transaction "exclude from budget", and an income override for the budget.
migrate((app) => {
  const OWNER = "user = @request.auth.id";
  const CREATE_OWNED = '@request.auth.id != "" && @request.body.user = @request.auth.id';
  const UPDATE_OWNED = OWNER + " && (@request.body.user:isset = false || @request.body.user = @request.auth.id)";

  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new NumberField({ name: "income_override", min: 0 }));
  users.fields.add(new BoolField({ name: "bill_reminders" }));
  // one overall monthly spending budget; category budgets carve pieces out of it
  users.fields.add(new NumberField({ name: "budget_total", min: 0 }));
  app.save(users);

  const catCol = app.findCollectionByNameOrId("categories");
  catCol.fields.add(new BoolField({ name: "rollover" }));
  app.save(catCol);
  app.db().newQuery("UPDATE users SET bill_reminders = TRUE").execute();

  const tx = app.findCollectionByNameOrId("transactions");
  tx.fields.add(new BoolField({ name: "exclude" }));
  app.save(tx);

  const categories = app.findCollectionByNameOrId("categories");
  const accounts = app.findCollectionByNameOrId("accounts");
  const userField = () => ({
    type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true,
  });
  const stamps = () => [
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];

  const recurring = new Collection({
    type: "base",
    name: "recurring",
    listRule: OWNER, viewRule: OWNER, createRule: CREATE_OWNED, updateRule: UPDATE_OWNED, deleteRule: OWNER,
    fields: [
      userField(),
      { type: "text", name: "name", required: true, max: 120 },
      // normalized merchant text used to match transactions ("" = manual, no matching)
      { type: "text", name: "merchant_key", max: 120 },
      { type: "number", name: "amount", min: 0 },
      { type: "select", name: "kind", required: true, maxSelect: 1, values: ["subscription", "bill", "income"] },
      { type: "select", name: "frequency", required: true, maxSelect: 1, values: ["weekly", "biweekly", "monthly", "quarterly", "yearly"] },
      { type: "date", name: "next_date" },
      { type: "date", name: "last_date" },
      { type: "number", name: "last_amount" },
      { type: "relation", name: "category", collectionId: categories.id, maxSelect: 1, cascadeDelete: false },
      { type: "relation", name: "account", collectionId: accounts.id, maxSelect: 1, cascadeDelete: false },
      // active = tracked; cancelled = you stopped it; ignored = not actually recurring
      { type: "select", name: "status", required: true, maxSelect: 1, values: ["active", "cancelled", "ignored"] },
      { type: "select", name: "source", maxSelect: 1, values: ["auto", "manual"] },
      // set once the user edits it, so detection stops overwriting their changes
      { type: "bool", name: "edited" },
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_recurring_user ON recurring (user)"],
  });
  app.save(recurring);

  const history = new Collection({
    type: "base",
    name: "balance_history",
    listRule: OWNER, viewRule: OWNER, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      userField(),
      { type: "text", name: "day", required: true, max: 10 }, // YYYY-MM-DD
      { type: "number", name: "assets" },
      { type: "number", name: "liabilities" },
      { type: "number", name: "net" },
      ...stamps(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_balhist_user_day ON balance_history (user, day)"],
  });
  app.save(history);
}, (app) => {
  for (const name of ["balance_history", "recurring"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const tx = app.findCollectionByNameOrId("transactions");
  tx.fields.removeByName("exclude");
  app.save(tx);
  const cats = app.findCollectionByNameOrId("categories");
  cats.fields.removeByName("rollover");
  app.save(cats);
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("budget_total");
  users.fields.removeByName("income_override");
  users.fields.removeByName("bill_reminders");
  app.save(users);
});
