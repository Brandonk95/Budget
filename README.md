# Keel

**Keep your money on an even keel.** Keel is a self-hosted budgeting app built on [PocketBase](https://pocketbase.io). It runs as one Docker container and updates itself automatically.

- **Bank sync** through [Teller](https://teller.io), which is free for personal use, or [SimpleFIN Bridge](https://beta-bridge.simplefin.org) (about $15/year). Balances and transactions sync every 6 hours. You can also import CSV files from any bank.
- **Budgets** per category, grouped as needs, wants and savings. The app suggests amounts from your 3-month average and tracks how much income is left to assign.
- **Insights**: a projection of month-end spending, a safe-to-spend amount per day, a 50/30/20 check, recurring and subscription detection, and a 6-month trend.
- **Auto-categorization**: your own rules ("contains *kroger* → Groceries") plus built-in guesses for common merchants. When you change a transaction's category, the app offers to turn it into a rule.
- **Goals** with the monthly amount needed to hit each target date.
- **Automatic updates**: Watchtower checks for a new image every 5 minutes. Signed-in users see a "what's new" popup in the top-right corner, which they can turn off in Settings.
- **Email over SMTP**: alerts when a budget passes your warning threshold or goes over it, alerts for large transactions, a failed-sync notice, a weekly summary, plus password reset and verification emails.

## Install

`docker-compose.yml` is self-contained. It needs no `.env` file and no repo checkout. All data goes in `/DATA/AppData/keel`.

**Before the first install:** push this repo to `main` once so GitHub Actions publishes the images. Then set both packages, `keel` and `keel-teller-proxy`, to **Public** under **GitHub → your profile → Packages → Package settings**.

### CasaOS / ZimaOS

1. Open **App Store → Custom Install** (the **+** in the top-right corner) and choose **Import**.
2. Paste the contents of `docker-compose.yml`.
3. In the install dialog, edit the settings:
   - `APP_URL`: the address you'll open Keel at, e.g. `http://192.168.1.10:8095`.
   - `PB_ADMIN_PASSWORD`: change it.
   - `SMTP_*`: fill these in if you want email.
   - `TELLER_APP_ID`: fill it in if you want Teller bank sync.
4. Install, then open Keel from the dashboard and create your account.
5. Afterwards, set `ALLOW_SIGNUPS` to `false` in the app's settings so nobody else can register.

CasaOS fills in your timezone (`$TZ`) automatically.

### Plain Docker

Edit the values in `docker-compose.yml`, then run:

```bash
TZ=America/Chicago docker compose up -d
```

To build from source instead of pulling, use the command below. It also turns off auto-updates.

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Keel runs on port **8095**. The PocketBase admin dashboard is at `/_/` and uses the `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` superuser, which is created or updated on every start.

## Configuration

All settings are environment variables on the `keel` service, which you can edit in CasaOS under the app's **Settings**. If a value contains a `$`, write it as `$$`.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | The address you use to open Keel. Email links use it. |
| `TZ` | Timezone for transaction dates and month boundaries. CasaOS sets it for you. |
| `ALLOW_SIGNUPS` | `true` or `false`. |
| `PB_ENCRYPTION_KEY` | Optional 32-character key that encrypts stored settings, such as the SMTP password. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Mail server. Leave `SMTP_HOST` empty to turn email off. |
| `SMTP_TLS` | `true` for implicit TLS (port 465). `false` for STARTTLS (port 587) or plain SMTP. |
| `SMTP_AUTH_METHOD` | `PLAIN` (default) or `LOGIN`. |
| `SMTP_SENDER_ADDRESS`, `SMTP_SENDER_NAME` | The "From" address and name. |
| `TELLER_APP_ID` | Your Teller application ID. Leave it empty to hide the Teller option. |
| `TELLER_ENV` | `sandbox` (fake data, no certificate), `development` (real banks, free, up to 100 bank logins) or `production`. |
| `TELLER_API_URL` | Optional. Overrides the Teller API address. |
| `SYNC_CRON`, `ALERT_CRON`, `DIGEST_CRON` | Schedules in UTC. Keep the sync schedule at 6 runs a day or fewer, because SimpleFIN allows about 24 requests a day. |

SMTP settings are applied each time the app starts. A Gmail example: `smtp.gmail.com`, port `587`, `SMTP_TLS=false`, with an [app password](https://support.google.com/accounts/answer/185833).

To test email, open **Settings → Send me a summary now**.

## Connecting your bank

### Teller (free, recommended)

Teller's **development** environment connects to real banks at no cost, for up to 100 bank logins. That is plenty for a household.

1. Sign up at [teller.io](https://teller.io) and copy your **Application ID** into `TELLER_APP_ID`.
2. In the Teller dashboard, download your client certificate. Upload `certificate.pem` and `private_key.pem` to `/DATA/AppData/keel/teller`. On CasaOS, use the **Files** app. The proxy picks them up within a minute, with no restart needed.
3. Keep `TELLER_ENV=development`.
4. In Keel, go to **Accounts → Connect bank → Connect with Teller** and log in to your bank in Teller's window.

**Why the extra container?** For real bank data, Teller requires mutual TLS: every request has to present your client certificate. PocketBase's HTTP client can't do that. The `teller-proxy` service is a small nginx container on the internal Docker network. It adds the certificate and forwards requests to `api.teller.io`. It isn't published on any host port. It sits idle until the certificate files exist, so it's harmless if you never use Teller.

To try the flow with fake data first, set `TELLER_ENV=sandbox`. No certificate is needed for that. Then log in with username `username` and password `password`.

The Teller access token stays on your server and is never sent to the browser. The first sync pulls about 6 months of history and uses Teller's merchant categories to pre-fill yours. Sometimes a bank asks you to log in again, for example after you change your password or when it needs MFA. When that happens, the connection shows **Reconnect needed** and you get an email. Click **Reconnect** to fix it. Clicking **Disconnect** revokes Teller's access and keeps your history as manual accounts.

If a bank reports card purchases as positive amounts, tick **Flip ±** on that account. The fix applies from the next sync.

### SimpleFIN Bridge (fallback)

Use this when Teller doesn't support your bank.

1. Sign up at [SimpleFIN Bridge](https://beta-bridge.simplefin.org) (about $1.50 a month) and link your banks there.
2. Create a new app connection and copy the **setup token**.
3. In Keel, go to **Accounts → Connect bank** and paste the token.

The token can only be used once. It is exchanged for an access URL that stays on your server. The first sync pulls up to 90 days of history.

New synced accounts start like this: checking and credit accounts count toward your budget, and savings and investment accounts don't. You can change the "In budget" setting for each account. Mark card payments and moves between your own accounts as **Transfers** or **Credit Card Payment** so they aren't counted as spending.

### CSV import

Go to **Accounts → Import CSV**, pick the account, then map the date, description and amount columns. The amount can be a single column or separate debit and credit columns. Re-importing the same file skips rows that are already there.

## Automatic updates and releases

```
push to main ─▶ GitHub Actions builds the image (amd64 + arm64)
             ─▶ ghcr.io/brandonk95/keel:latest, :<version>, :sha-<commit>
             ─▶ Watchtower on your server sees it within 5 minutes
             ─▶ pulls it and restarts Keel (a few seconds of downtime; your data is kept, migrations run on boot)
             ─▶ open browser tabs notice the new version within a minute and show the update popup
```

**To ship a release**, edit `release.json` and push to `main`:

```json
{
  "version": "1.1.0",
  "released": "2026-12-01",
  "motd": "One or two sentences about what's new. This text is shown in the update popup."
}
```

The popup shows once per version for each user, and only if that user has **Settings → Show what's new when Keel updates** turned on. Pushes that don't change the version still deploy, but no popup appears. New accounts start on the current version, so they don't see a popup on their first login.

- **Change the check interval** with `WATCHTOWER_POLL_INTERVAL` (in seconds) on the `watchtower` service.
- **Pause auto-updates** with `docker compose stop watchtower`.
- **Pin a version** by changing the `keel` image to `ghcr.io/brandonk95/keel:1.0.0`.

Watchtower only manages containers in this stack. It is scoped with `WATCHTOWER_SCOPE=keel`, so other apps on the host aren't touched. It needs the Docker socket to restart containers, which gives it full control of Docker on that host. That's normal for Watchtower, but worth knowing.

## Backups

All data lives in `/DATA/AppData/keel/pb_data`, which is a SQLite database. Back up that folder, or use **Settings → Backups** in the PocketBase dashboard at `/_/`. If you want to be able to roll back a release, take a backup before you push it.

To upgrade PocketBase itself, change `PB_VERSION` in the `Dockerfile` and release as usual.

## Exposing it to the internet

Put the app behind a reverse proxy that provides HTTPS, such as Caddy, Traefik or nginx, and set `APP_URL` to the HTTPS address. A Caddy example:

```
budget.example.com {
  reverse_proxy localhost:8095
}
```

If the proxy runs in front of the app, set the trusted proxy headers (e.g. `X-Forwarded-For`) in the dashboard under **Settings → Application**. This makes rate limits and logs show real client IPs.

## Project layout

```
release.json     version + "message of the day" shown after updates
.github/workflows/release.yml   builds and publishes the image to GHCR
pb_migrations/   schema (collections, API rules, indexes)
pb_hooks/        server logic (JS, runs inside PocketBase)
  main.pb.js     routes, record hooks, cron jobs
  lib/teller.js     Teller bank sync
  lib/simplefin.js  SimpleFIN bank sync
  lib/ingest.js     shared account/transaction upserts
  lib/insights.js   budget analysis and tips
  lib/notify.js     SMTP emails
  lib/rules.js      auto-categorization and default categories
pb_public/       web app (vanilla JS + PocketBase SDK)
teller-proxy/    image for the Teller mTLS proxy (nginx; waits for the certificate)
assets/          app icon (used by CasaOS)
```

### Custom API (all require a signed-in user)

| Route | |
| --- | --- |
| `POST /api/budget/teller/enroll` | `{access_token, enrollment_id, institution, connection?}`: saves a Teller Connect enrollment and syncs it |
| `POST /api/budget/connect` | `{setup_token, name}`: claims the SimpleFIN token and runs the first sync |
| `POST /api/budget/sync` | Syncs all of your connections now |
| `POST /api/budget/import` | `{account, rows:[{date:"YYYY-MM-DD", amount, description}]}` |
| `POST /api/budget/apply-rules` | Categorizes uncategorized transactions |
| `GET /api/budget/insights?month=YYYY-MM` | Budget analysis for one month |
| `POST /api/budget/digest` | Emails you the weekly summary now |
