// Applies app + SMTP settings from environment variables on every boot,
// so docker-compose .env is the single source of truth.

const util = require(`${__hooks}/lib/util.js`);

function applySettings(app) {
  const s = app.settings();
  s.meta.appName = util.env("APP_NAME", "Budget");
  s.meta.appURL = util.env("APP_URL", "http://localhost:8090");

  const host = util.env("SMTP_HOST", "");
  if (host && host !== "smtp.example.com") {
    s.smtp.enabled = true;
    s.smtp.host = host;
    s.smtp.port = parseInt(util.env("SMTP_PORT", "587"), 10);
    s.smtp.username = util.env("SMTP_USERNAME", "");
    s.smtp.password = util.env("SMTP_PASSWORD", "");
    s.smtp.tls = util.env("SMTP_TLS", "false") === "true";
    s.smtp.authMethod = util.env("SMTP_AUTH_METHOD", "PLAIN");
    s.meta.senderAddress = util.env("SMTP_SENDER_ADDRESS", util.env("SMTP_USERNAME", "budget@localhost"));
    s.meta.senderName = util.env("SMTP_SENDER_NAME", s.meta.appName);
  } else {
    s.smtp.enabled = false;
    app.logger().warn("SMTP_HOST not set — email alerts, digests and password reset emails are disabled");
  }
  app.save(s);

  const users = app.findCollectionByNameOrId("users");
  const allow = util.env("ALLOW_SIGNUPS", "true") === "true";
  users.createRule = allow ? "" : null;
  app.save(users);
}

module.exports = { applySettings };
