// Account emails (confirm email, password reset, email change, sign-in code, new sign-in alert)
// in the same layout as Keel's other emails. PocketBase fills in {APP_URL}, {TOKEN}, {OTP} and
// {ALERT_INFO} when it sends them. The links open pages in the app itself, not the admin UI.

function apply(app, users) {
  const notify = require(`${__hooks}/lib/notify.js`);
  const name = app.settings().meta.appName || "Keel";
  const footer = `You're getting this because of your ${name} account.`;
  const note = (t) => `<p style="color:#5f6b80;font-size:13px;margin:16px 0 0">${t}</p>`;
  const mail = (title, body, button) => notify.layout(app, title, body, { button, footer });

  users.verificationTemplate.subject = `Confirm your email for ${name}`;
  users.verificationTemplate.body = mail("Confirm your email",
    `<p style="margin:0">Welcome to ${name}. Confirm this is your email address so ${name} can send you budget alerts, bill reminders and your weekly summary.</p>`
      + note(`If you didn't create a ${name} account, you can ignore this email.`),
    { label: "Confirm email", href: "{APP_URL}/#/verify/{TOKEN}" });

  users.resetPasswordTemplate.subject = `Reset your ${name} password`;
  users.resetPasswordTemplate.body = mail("Reset your password",
    `<p style="margin:0">Someone asked to reset the password for your ${name} account. Choose a new one with the button below.</p>`
      + note("If that wasn't you, ignore this email. Your password stays the same."),
    { label: "Choose a new password", href: "{APP_URL}/#/reset/{TOKEN}" });

  users.confirmEmailChangeTemplate.subject = `Confirm your new email for ${name}`;
  users.confirmEmailChangeTemplate.body = mail("Confirm your new email",
    `<p style="margin:0">Confirm this address to make it the email for your ${name} account.</p>`
      + note("If you didn't ask for this, ignore this email and nothing changes."),
    { label: "Confirm new email", href: "{APP_URL}/#/email-change/{TOKEN}" });

  users.otp.emailTemplate.subject = `Your ${name} sign-in code`;
  users.otp.emailTemplate.body = mail("Your sign-in code",
    `<p style="margin:0">Enter this code to sign in:</p>
     <p style="margin:16px 0;font-size:30px;font-weight:700;letter-spacing:.18em;font-family:ui-monospace,Menlo,Consolas,monospace">{OTP}</p>`
      + note("If you didn't try to sign in, you can ignore this email."), null);

  users.authAlert.emailTemplate.subject = `New sign-in to your ${name} account`;
  users.authAlert.emailTemplate.body = mail("New sign-in",
    `<p style="margin:0">Your ${name} account was just signed in to from a new location:</p>
     <p style="margin:12px 0;padding:12px;background:#f5f7fa;border-radius:10px;font-size:14px">{ALERT_INFO}</p>`
      + note("If this was you, there's nothing to do. If not, change your password right away."), null);
}

module.exports = { apply };
