/// <reference path="../pb_data/types.d.ts" />

// - users.cf_skip_months: months the cash-flow forecast leaves out of its spending rate ("2026-09,2026-10")
// - users.cal_token: the secret in a person's bill-calendar feed URL (hidden from the API)
// - push_subs: each browser or phone that turned on notifications (managed through /api/budget/push/*)
// - app_kv: small server-side values, like the Web Push (VAPID) keys
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("cf_skip_months")) users.fields.add(new TextField({ name: "cf_skip_months", max: 400 }));
  if (!users.fields.getByName("cal_token")) users.fields.add(new TextField({ name: "cal_token", max: 64, hidden: true }));
  app.save(users);

  app.save(new Collection({
    type: "base",
    name: "push_subs",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "text", name: "endpoint", required: true, max: 1000 },
      { type: "text", name: "p256dh", required: true, max: 200 },
      { type: "text", name: "auth", required: true, max: 100 },
      { type: "text", name: "label", max: 120 },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_push_endpoint ON push_subs (endpoint)"],
  }));

  app.save(new Collection({
    type: "base",
    name: "app_kv",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "key", required: true, max: 100 },
      { type: "text", name: "value", max: 5000 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_app_kv_key ON app_kv (key)"],
  }));
}, (app) => {
  for (const n of ["push_subs", "app_kv"]) { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} }
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("cf_skip_months");
  users.fields.removeByName("cal_token");
  app.save(users);
});
