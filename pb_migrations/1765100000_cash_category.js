/// <reference path="../pb_data/types.d.ts" />

// Adds a "Cash & ATM" category (ATM and teller withdrawals) to existing accounts.
migrate((app) => {
  const cats = app.findCollectionByNameOrId("categories");
  for (const u of app.findAllRecords("users")) {
    try {
      app.findFirstRecordByFilter("categories", "user = {:u} && name = {:n}", { u: u.id, n: "Cash & ATM" });
      continue;
    } catch (_) { /* not there yet */ }
    const r = new Record(cats);
    r.set("user", u.id);
    r.set("name", "Cash & ATM");
    r.set("kind", "wants");
    r.set("budget", 0);
    r.set("icon", "🏧");
    try { app.save(r); } catch (_) { /* name taken */ }
  }
}, () => {});
