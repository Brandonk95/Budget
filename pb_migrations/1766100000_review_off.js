/// <reference path="../pb_data/types.d.ts" />

// The review inbox is optional, per person: users.review_off turns it off.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("review_off")) users.fields.add(new BoolField({ name: "review_off" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("review_off");
  app.save(users);
});
