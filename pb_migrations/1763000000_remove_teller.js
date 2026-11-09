/// <reference path="../pb_data/types.d.ts" />

// Teller support was removed (SimpleFIN only). Drop any saved Teller connections;
// their accounts and transaction history stay as manual accounts.
migrate((app) => {
  const conns = app.findRecordsByFilter("bank_connections", "provider = 'teller'", "", 0, 0);
  for (const c of conns) app.delete(c);
}, (app) => {
  // nothing to restore
});
