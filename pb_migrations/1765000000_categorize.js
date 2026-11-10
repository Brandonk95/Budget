/// <reference path="../pb_data/types.d.ts" />

// Smarter categorization: remember categories the user picks by hand (cat_manual), and add
// the newer default categories (Travel, Home, Pets, Fees & Charges, Education, Charity)
// to existing accounts.
migrate((app) => {
  const tx = app.findCollectionByNameOrId("transactions");
  tx.fields.add(new BoolField({ name: "cat_manual" }));
  app.save(tx);

  const NEW = [
    ["Education", "needs", "🎓"],
    ["Fees & Charges", "needs", "🧾"],
    ["Travel", "wants", "✈️"],
    ["Home", "wants", "🔨"],
    ["Pets", "wants", "🐾"],
    ["Charity", "wants", "💝"],
  ];
  const cats = app.findCollectionByNameOrId("categories");
  for (const u of app.findAllRecords("users")) {
    const have = {};
    for (const c of app.findRecordsByFilter("categories", "user = {:u}", "", 0, 0, { u: u.id })) have[c.getString("name").toLowerCase()] = 1;
    for (const [name, kind, icon] of NEW) {
      if (have[name.toLowerCase()]) continue;
      const r = new Record(cats);
      r.set("user", u.id);
      r.set("name", name);
      r.set("kind", kind);
      r.set("budget", 0);
      r.set("icon", icon);
      try { app.save(r); } catch (_) { /* name taken */ }
    }
  }
}, (app) => {
  const tx = app.findCollectionByNameOrId("transactions");
  tx.fields.removeByName("cat_manual");
  app.save(tx);
});
