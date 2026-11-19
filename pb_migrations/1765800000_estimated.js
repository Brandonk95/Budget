/// <reference path="../pb_data/types.d.ts" />

// Estimated pending charges: when a bank's balance moves before the transaction itself shows up,
// Keel keeps a stand-in "pending" transaction for the difference (transactions.estimated) and
// tracks the unexplained change on the account (est_gap_*), shrinking it as real ones arrive.
migrate((app) => {
  const tx = app.findCollectionByNameOrId("transactions");
  if (!tx.fields.getByName("estimated")) tx.fields.add(new BoolField({ name: "estimated" }));
  app.save(tx);
  const acc = app.findCollectionByNameOrId("accounts");
  // two running gaps: one assuming the bank's balance includes pending charges, one assuming it doesn't
  if (!acc.fields.getByName("est_gap_a")) acc.fields.add(new NumberField({ name: "est_gap_a" }));
  if (!acc.fields.getByName("est_gap_b")) acc.fields.add(new NumberField({ name: "est_gap_b" }));
  if (!acc.fields.getByName("est_shown")) acc.fields.add(new BoolField({ name: "est_shown" }));
  app.save(acc);
}, (app) => {
  app.db().newQuery("DELETE FROM transactions WHERE estimated = TRUE").execute();
  const tx = app.findCollectionByNameOrId("transactions");
  tx.fields.removeByName("estimated");
  app.save(tx);
  const acc = app.findCollectionByNameOrId("accounts");
  for (const f of ["est_gap_a", "est_gap_b", "est_shown"]) acc.fields.removeByName(f);
  app.save(acc);
});
