/// <reference path="../pb_data/types.d.ts" />

// Per-user "what's new" popup preference and the last release they've seen.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({ name: "update_notes" }));
  users.fields.add(new TextField({ name: "last_seen_version", max: 40 }));
  app.save(users);
  // existing users opt in by default
  app.db().newQuery("UPDATE users SET update_notes = TRUE").execute();
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("update_notes");
  users.fields.removeByName("last_seen_version");
  app.save(users);
});
