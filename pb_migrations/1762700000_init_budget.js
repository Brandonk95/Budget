/// <reference path="../pb_data/types.d.ts" />

// Initial schema for the budgeting app.
migrate((app) => {
  const OWNER = "user = @request.auth.id";
  const CREATE_OWNED = '@request.auth.id != "" && @request.body.user = @request.auth.id';
  const UPDATE_OWNED = OWNER + " && (@request.body.user:isset = false || @request.body.user = @request.auth.id)";

  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({ name: "alerts_enabled" }));
  users.fields.add(new NumberField({ name: "alert_threshold", min: 1, max: 200, onlyInt: true }));
  users.fields.add(new NumberField({ name: "large_txn_threshold", min: 0 }));
  users.fields.add(new BoolField({ name: "weekly_digest" }));
  app.save(users);

  const userField = () => ({
    type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true,
  });
  const stamps = () => [
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];

  // ---- categories ----
  const categories = new Collection({
    type: "base",
    name: "categories",
    listRule: OWNER, viewRule: OWNER, createRule: CREATE_OWNED, updateRule: UPDATE_OWNED, deleteRule: OWNER,
    fields: [
      userField(),
      { type: "text", name: "name", required: true, max: 60 },
      { type: "select", name: "kind", required: true, maxSelect: 1, values: ["income", "needs", "wants", "savings", "transfer"] },
      { type: "number", name: "budget", min: 0 },
      { type: "text", name: "icon", max: 8 },
      { type: "bool", name: "archived" },
      ...stamps(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_categories_user_name ON categories (user, name)"],
  });
  app.save(categories);

  // ---- bank_connections (SimpleFIN) ----
  const connections = new Collection({
    type: "base",
    name: "bank_connections",
    // created/updated only through the custom /api/budget/* routes
    listRule: OWNER, viewRule: OWNER, createRule: null, updateRule: null, deleteRule: OWNER,
    fields: [
      userField(),
      { type: "text", name: "name", max: 80 },
      { type: "text", name: "access_url", required: true, hidden: true, max: 2000 },
      { type: "date", name: "last_sync" },
      { type: "select", name: "status", maxSelect: 1, values: ["ok", "error"] },
      { type: "text", name: "last_error", max: 2000 },
      ...stamps(),
    ],
  });
  app.save(connections);

  // ---- accounts ----
  const accounts = new Collection({
    type: "base",
    name: "accounts",
    listRule: OWNER, viewRule: OWNER, createRule: CREATE_OWNED, updateRule: UPDATE_OWNED, deleteRule: OWNER,
    fields: [
      userField(),
      { type: "relation", name: "connection", collectionId: connections.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "external_id", max: 200 },
      { type: "text", name: "name", required: true, max: 120 },
      { type: "text", name: "institution", max: 120 },
      { type: "select", name: "type", maxSelect: 1, values: ["checking", "savings", "credit", "investment", "loan", "cash", "other"] },
      { type: "text", name: "currency", max: 10 },
      { type: "number", name: "balance" },
      { type: "number", name: "available" },
      { type: "date", name: "balance_date" },
      { type: "bool", name: "on_budget" },
      { type: "bool", name: "hidden" },
      ...stamps(),
    ],
    indexes: ["CREATE INDEX idx_accounts_user ON accounts (user)"],
  });
  app.save(accounts);

  // ---- transactions ----
  const transactions = new Collection({
    type: "base",
    name: "transactions",
    listRule: OWNER, viewRule: OWNER, createRule: CREATE_OWNED, updateRule: UPDATE_OWNED, deleteRule: OWNER,
    fields: [
      userField(),
      { type: "relation", name: "account", required: true, collectionId: accounts.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "external_id", max: 300 },
      { type: "date", name: "date", required: true },
      // negative = money out, positive = money in
      { type: "number", name: "amount" },
      { type: "text", name: "description", max: 500 },
      { type: "text", name: "payee", max: 200 },
      { type: "relation", name: "category", collectionId: categories.id, maxSelect: 1, cascadeDelete: false },
      { type: "text", name: "notes", max: 1000 },
      { type: "bool", name: "pending" },
      ...stamps(),
    ],
    indexes: [
      "CREATE INDEX idx_tx_user_date ON transactions (user, date)",
      "CREATE UNIQUE INDEX idx_tx_account_ext ON transactions (account, external_id) WHERE external_id != ''",
    ],
  });
  app.save(transactions);

  // ---- rules (auto-categorization) ----
  const rules = new Collection({
    type: "base",
    name: "rules",
    listRule: OWNER, viewRule: OWNER, createRule: CREATE_OWNED, updateRule: UPDATE_OWNED, deleteRule: OWNER,
    fields: [
      userField(),
      // case-insensitive "contains" match against description + payee
      { type: "text", name: "pattern", required: true, max: 120 },
      { type: "relation", name: "category", required: true, collectionId: categories.id, maxSelect: 1, cascadeDelete: true },
      ...stamps(),
    ],
  });
  app.save(rules);

  // ---- goals ----
  const goals = new Collection({
    type: "base",
    name: "goals",
    listRule: OWNER, viewRule: OWNER, createRule: CREATE_OWNED, updateRule: UPDATE_OWNED, deleteRule: OWNER,
    fields: [
      userField(),
      { type: "text", name: "name", required: true, max: 100 },
      { type: "number", name: "target", min: 0 },
      { type: "number", name: "saved", min: 0 },
      { type: "date", name: "target_date" },
      { type: "text", name: "icon", max: 8 },
      ...stamps(),
    ],
  });
  app.save(goals);

  // ---- alerts_sent (dedupes notification emails; server only) ----
  const alerts = new Collection({
    type: "base",
    name: "alerts_sent",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      userField(),
      { type: "text", name: "key", required: true, max: 300 },
      ...stamps(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_alerts_key ON alerts_sent (key)"],
  });
  app.save(alerts);
}, (app) => {
  for (const name of ["alerts_sent", "goals", "rules", "transactions", "accounts", "bank_connections", "categories"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["alerts_enabled", "alert_threshold", "large_txn_threshold", "weekly_digest"]) {
    users.fields.removeByName(f);
  }
  app.save(users);
});
