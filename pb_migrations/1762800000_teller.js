/// <reference path="../pb_data/types.d.ts" />

// Adds multi-provider bank connections (SimpleFIN + Teller).
migrate((app) => {
  const conns = app.findCollectionByNameOrId("bank_connections");
  // the hidden credential now holds a SimpleFIN access URL or a Teller access token
  conns.fields.getByName("access_url").name = "secret";
  conns.fields.add(new SelectField({ name: "provider", maxSelect: 1, values: ["simplefin", "teller"] }));
  conns.fields.add(new TextField({ name: "enrollment_id", max: 200 }));
  conns.fields.add(new TextField({ name: "institution", max: 200 }));
  const status = conns.fields.getByName("status");
  status.values = ["ok", "error", "reconnect"];
  app.save(conns);
  app.db().newQuery("UPDATE bank_connections SET provider = 'simplefin' WHERE provider = ''").execute();

  const accounts = app.findCollectionByNameOrId("accounts");
  // some institutions report purchases as positive; this flips them on sync
  accounts.fields.add(new BoolField({ name: "flip_amounts" }));
  app.save(accounts);
}, (app) => {
  const conns = app.findCollectionByNameOrId("bank_connections");
  conns.fields.getByName("secret").name = "access_url";
  conns.fields.removeByName("provider");
  conns.fields.removeByName("enrollment_id");
  conns.fields.removeByName("institution");
  conns.fields.getByName("status").values = ["ok", "error"];
  app.save(conns);
  const accounts = app.findCollectionByNameOrId("accounts");
  accounts.fields.removeByName("flip_amounts");
  app.save(accounts);
});
