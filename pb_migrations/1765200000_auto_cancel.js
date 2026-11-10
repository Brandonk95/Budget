/// <reference path="../pb_data/types.d.ts" />

// Subscriptions that stop charging are marked cancelled automatically. This flag tells those
// apart from ones the user cancelled, so an auto-cancelled one can come back if it charges again.
migrate((app) => {
  const rec = app.findCollectionByNameOrId("recurring");
  if (!rec.fields.getByName("auto_cancelled")) {
    rec.fields.add(new BoolField({ name: "auto_cancelled" }));
    app.save(rec);
  }
}, (app) => {
  const rec = app.findCollectionByNameOrId("recurring");
  rec.fields.removeByName("auto_cancelled");
  app.save(rec);
});
