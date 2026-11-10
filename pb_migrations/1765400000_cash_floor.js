/// <reference path="../pb_data/types.d.ts" />

// Cash-flow forecast: the balance a user doesn't want checking to drop below, and whether to email about it.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("cash_floor")) users.fields.add(new NumberField({ name: "cash_floor", min: 0 }));
  if (!users.fields.getByName("cash_alerts")) users.fields.add(new BoolField({ name: "cash_alerts" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["cash_floor", "cash_alerts"]) users.fields.removeByName(f);
  app.save(users);
});
