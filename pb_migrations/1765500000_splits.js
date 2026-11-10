/// <reference path="../pb_data/types.d.ts" />

// Split transactions: one purchase divided across categories. The transaction itself stays whole
// (balances and syncing never see the split); budget and spending totals use its parts instead.
migrate((app) => {
  const tx = app.findCollectionByNameOrId("transactions");
  if (!tx.fields.getByName("split")) tx.fields.add(new BoolField({ name: "split" }));
  app.save(tx);

  try { app.findCollectionByNameOrId("tx_splits"); return; } catch (_) { /* create it */ }
  const users = app.findCollectionByNameOrId("users");
  const categories = app.findCollectionByNameOrId("categories");
  const OWNER = "user = @request.auth.id";
  const splits = new Collection({
    type: "base",
    name: "tx_splits",
    // written only through POST /api/budget/transactions/{id}/split, which checks the parts add up
    listRule: OWNER, viewRule: OWNER, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "transaction", collectionId: tx.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "category", collectionId: categories.id, maxSelect: 1, cascadeDelete: false },
      { type: "number", name: "amount" }, // same sign as the transaction
      { type: "text", name: "note", max: 200 },
      { type: "number", name: "position", onlyInt: true },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_tx_splits_tx ON tx_splits (`transaction`)"],
  });
  app.save(splits);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("tx_splits")); } catch (_) {}
  const tx = app.findCollectionByNameOrId("transactions");
  tx.fields.removeByName("split");
  app.save(tx);
});
