/// <reference path="../pb_data/types.d.ts" />

// More email alerts (duplicate charges, price increases, yearly renewals, paychecks) and the
// monthly report email. All on by default, including for existing users.
const FIELDS = ["alert_duplicates", "alert_price", "alert_renewals", "alert_paycheck", "monthly_report"];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const f of FIELDS) if (!users.fields.getByName(f)) users.fields.add(new BoolField({ name: f }));
  app.save(users);
  app.db().newQuery(`UPDATE users SET ${FIELDS.map((f) => `${f} = TRUE`).join(", ")}`).execute();
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const f of FIELDS) users.fields.removeByName(f);
  app.save(users);
});
