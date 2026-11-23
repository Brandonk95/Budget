/// <reference path="../pb_data/types.d.ts" />

// Review inbox: transactions.reviewed. New bank transactions arrive unreviewed; anything you add,
// edit or check off is reviewed. Existing history starts reviewed, except the last week's.
migrate((app) => {
  const tx = app.findCollectionByNameOrId("transactions");
  if (!tx.fields.getByName("reviewed")) tx.fields.add(new BoolField({ name: "reviewed" }));
  app.save(tx);
  const d = new Date(Date.now() - 7 * 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  const cutoff = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 00:00:00.000Z`;
  app.db().newQuery("UPDATE transactions SET reviewed = TRUE WHERE date < {:c} OR estimated = TRUE OR cat_manual = TRUE").bind({ c: cutoff }).execute();
}, (app) => {
  const tx = app.findCollectionByNameOrId("transactions");
  tx.fields.removeByName("reviewed");
  app.save(tx);
});
