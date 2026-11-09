// Auto-categorization: user rules first, then built-in keyword guesses.

const BUILTIN = [
  [/payroll|direct dep|salary|paycheck/i, "Paycheck"],
  [/interest paid|dividend/i, "Other Income"],
  [/transfer|zelle to|xfer|online banking transfer/i, "Transfers"],
  [/payment.*(thank you|card)|autopay|credit card pmt|card payment/i, "Credit Card Payment"],
  [/rent|mortgage|landlord|apartment/i, "Rent / Mortgage"],
  [/electric|energy|water|utility|utilities|gas co|sewer|internet|comcast|xfinity|spectrum|verizon|at&t|t-mobile/i, "Utilities"],
  [/kroger|safeway|whole foods|trader joe|aldi|publix|heb|h-e-b|grocery|costco|wegmans|instacart/i, "Groceries"],
  [/shell|chevron|exxon|bp |mobil|fuel|uber|lyft|parking|toll|transit/i, "Transportation"],
  [/insurance|geico|state farm|progressive|allstate/i, "Insurance"],
  [/pharmacy|cvs|walgreens|doctor|medical|dental|clinic|hospital/i, "Health"],
  [/netflix|spotify|hulu|disney|youtube|apple\.com|prime video|hbo|max\.com|patreon|subscription/i, "Subscriptions"],
  [/restaurant|cafe|coffee|starbucks|doordash|grubhub|uber eats|mcdonald|chipotle|pizza|taco|grill|bar /i, "Dining Out"],
  [/amazon|target|walmart|best buy|etsy|ebay/i, "Shopping"],
];

function loadRules(app, userId) {
  return app.findRecordsByFilter("rules", "user = {:u}", "-created", 0, 0, { u: userId })
    .map((r) => ({ pattern: r.getString("pattern").toLowerCase(), category: r.getString("category") }))
    .filter((r) => r.pattern);
}

function loadCategoryIndex(app, userId) {
  const byName = {};
  for (const c of app.findRecordsByFilter("categories", "user = {:u}", "", 0, 0, { u: userId })) {
    byName[c.getString("name").toLowerCase()] = c.id;
  }
  return byName;
}

// Returns a category id or "" for a transaction-like {description, payee, amount}.
function categorize(ctx, tx) {
  const text = ((tx.description || "") + " " + (tx.payee || "")).toLowerCase();
  for (const r of ctx.rules) {
    if (text.indexOf(r.pattern) !== -1) return r.category;
  }
  // provider-supplied category hint beats keyword guesses
  if (tx.hint) {
    const id = ctx.byName[String(tx.hint).toLowerCase()];
    if (id && !(tx.hint === "Paycheck" && tx.amount <= 0)) return id;
  }
  for (const [re, name] of BUILTIN) {
    if (re.test(text)) {
      // income keywords only make sense for inflows and vice versa
      const id = ctx.byName[name.toLowerCase()];
      if (!id) continue;
      if ((name === "Paycheck" || name === "Other Income") && tx.amount <= 0) continue;
      return id;
    }
  }
  return "";
}

function context(app, userId) {
  return { rules: loadRules(app, userId), byName: loadCategoryIndex(app, userId) };
}

// Categorize every uncategorized transaction for a user. Returns the count changed.
function applyToUncategorized(app, userId) {
  const ctx = context(app, userId);
  const txs = app.findRecordsByFilter("transactions", "user = {:u} && category = ''", "", 0, 0, { u: userId });
  let n = 0;
  for (const t of txs) {
    const cat = categorize(ctx, {
      description: t.getString("description"), payee: t.getString("payee"), amount: t.getFloat("amount"),
    });
    if (cat) { t.set("category", cat); app.save(t); n++; }
  }
  return n;
}

const DEFAULT_CATEGORIES = [
  ["Paycheck", "income", 0, "💼"],
  ["Other Income", "income", 0, "💵"],
  ["Rent / Mortgage", "needs", 0, "🏠"],
  ["Utilities", "needs", 0, "💡"],
  ["Groceries", "needs", 0, "🛒"],
  ["Transportation", "needs", 0, "🚗"],
  ["Insurance", "needs", 0, "🛡️"],
  ["Health", "needs", 0, "🩺"],
  ["Dining Out", "wants", 0, "🍽️"],
  ["Shopping", "wants", 0, "🛍️"],
  ["Subscriptions", "wants", 0, "📺"],
  ["Entertainment", "wants", 0, "🎟️"],
  ["Personal Care", "wants", 0, "💇"],
  ["Gifts", "wants", 0, "🎁"],
  ["Emergency Fund", "savings", 0, "🧯"],
  ["Investing", "savings", 0, "📈"],
  ["Transfers", "transfer", 0, "🔁"],
  ["Credit Card Payment", "transfer", 0, "💳"],
];

function seedCategories(app, userId) {
  const col = app.findCollectionByNameOrId("categories");
  for (const [name, kind, budget, icon] of DEFAULT_CATEGORIES) {
    const r = new Record(col);
    r.set("user", userId);
    r.set("name", name);
    r.set("kind", kind);
    r.set("budget", budget);
    r.set("icon", icon);
    try { app.save(r); } catch (_) { /* already exists */ }
  }
}

module.exports = { context, categorize, applyToUncategorized, seedCategories };
