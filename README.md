# Keel

**Money, on course.** Keel is a self-hosted budgeting app built on [PocketBase](https://pocketbase.io). It runs as one Docker container and updates itself automatically.

- **Bank sync** through [SimpleFIN Bridge](https://beta-bridge.simplefin.org) (about $15/year). Balances and transactions sync every 6 hours. You can also import CSV files from any bank.
- **One monthly budget, Rocket Money style.** Set a single spending number, give the categories you care about their own slice, and everything else shares the rest. A guided "Create budget" setup suggests amounts from your recent spending. Categories can roll unspent money (or overspending) into next month. The budget page shows what's left to spend, a safe amount per day, and this month's bills marked paid or due.
- **Recurring bills, subscriptions and income** are found automatically from your history (weekly to yearly). A calendar shows what's due, and payments are matched as they post. Mark anything cancelled or "not recurring", or add your own. Optional email reminders go out 3 days before a bill is due.
- **Subscription tracker** (a tab on the Recurring page): all your monthly and yearly subscriptions with their cost per month or per year, next renewal dates, price-increase flags and how much you save by cancelling. A subscription that skips a charge is flagged as possibly cancelled, and after a second missed charge it's marked cancelled automatically (it switches back on if it charges again). Subscriptions it spots in your transactions (including yearly ones charged only once) are suggested so you can track them in one click.
- **Spending** breakdown by category and merchant, with a 6-month trend.
- **Net worth** over time: assets minus credit cards and loans, recorded daily (earlier history is estimated from transactions).
- **Overview**: spending so far this month against last month, left to spend, upcoming bills, accounts and recent transactions.
- **Insights**: month-end projections, a 50/30/20 check and plain-language tips.
- **Auto-categorization** that learns: your own rules ("contains *kroger* → Groceries") come first, then the categories you have picked by hand for each merchant, then a built-in directory of hundreds of merchants (groceries, gas, streaming, airlines, utilities, pet stores and more). It reads messy bank text like "PURCHASE AUTHORIZED ON 11/02 SQ *BLUE BOTTLE #123". Change one transaction's category and Keel files that merchant's other uncategorized and future transactions the same way.
- **Goals** with the monthly amount needed to hit each target date.
- **Automatic updates**: Watchtower checks for a new image every 5 minutes. Signed-in users see a "what's new" popup in the top-right corner, which they can turn off in Settings.
- **Installable app** for phones and desktops: home-screen icon, full-screen window, opens offline.
- **Calm, accessible design**: Keel Blue on cool neutrals, the Inter typeface, Lucide icons, a dark mode of its own, a phone layout with a bottom bar, and reduced-motion support.
- **Email over SMTP**: alerts when a budget passes your warning threshold or goes over it, alerts for large transactions, a failed-sync notice, a weekly summary, plus password reset and verification emails.

## Install

`docker-compose.yml` is self-contained. It needs no `.env` file and no repo checkout. All data goes in `/DATA/AppData/keel`.

**Before the first install:** push this repo to `main` once so GitHub Actions publishes the images. Then set the `keel` package to **Public** under **GitHub → your profile → Packages → Package settings**.

### CasaOS / ZimaOS

1. Open **App Store → Custom Install** (the **+** in the top-right corner) and choose **Import**.
2. Paste the contents of `docker-compose.yml`.
3. In the install dialog, edit the settings:
   - `APP_URL`: the address you'll open Keel at, e.g. `http://192.168.1.10:8095`.
   - `PB_ADMIN_PASSWORD`: change it.
   - `SMTP_*`: fill these in if you want email.
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
| `SYNC_CRON`, `ALERT_CRON`, `DIGEST_CRON`, `DAILY_CRON` | Schedules in UTC. Keep the sync schedule at 6 runs a day or fewer, because SimpleFIN allows about 24 requests a day. `DAILY_CRON` (default 13:00) records net worth and sends bill reminders. |

SMTP settings are applied each time the app starts. A Gmail example: `smtp.gmail.com`, port `587`, `SMTP_TLS=false`, with an [app password](https://support.google.com/accounts/answer/185833).

To test email, open **Settings → Send me a summary now**.

## Connecting your bank

1. Sign up at [SimpleFIN Bridge](https://beta-bridge.simplefin.org) (about $1.50 a month) and link your banks there.
2. Create a new app connection and copy the **setup token**.
3. In Keel, go to **Accounts → Connect bank** and paste the token.

The token can only be used once. It is exchanged for an access URL that stays on your server. The first sync pulls up to 90 days of history. If a bank reports card purchases as positive amounts, tick **Flip ±** on that account. The fix applies from the next sync.

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

## Installing the app on your phone

Keel is an installable web app (PWA). Once installed it has its own home-screen icon, opens full screen without the browser bar, and still opens when you're offline (it shows your data again as soon as you reconnect).

- **Android (Chrome, Edge, Samsung Internet):** open Keel and tap **Install** on the Overview banner or under **Settings → Install the app**. You can also use the browser menu → **Install app**.
- **iPhone / iPad (Safari):** tap **Share**, then **Add to Home Screen**.
- **Desktop (Chrome, Edge):** click the install icon in the address bar, or use **Settings → Install the app**.

Phones only allow a full install from an **https://** address (see [Exposing it to the internet](#exposing-it-to-the-internet); a Tailscale or Cloudflare Tunnel address also works). On a plain `http://` LAN address, iPhones can still add it to the home screen, but Android only creates a browser shortcut.

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
  lib/simplefin.js  SimpleFIN bank sync
  lib/ingest.js     shared account/transaction upserts
  lib/insights.js   budget analysis and tips
  lib/recurring.js  recurring bill/subscription/income detection and calendar
  lib/spending.js   category and merchant breakdowns
  lib/networth.js   net worth snapshots and history
  lib/notify.js     SMTP emails
  lib/rules.js      auto-categorization and default categories
pb_public/       web app (vanilla JS + PocketBase SDK)
assets/          icon.png (CasaOS) and brand/ originals (favicon, logo, transparent logo)
pb_public/brand/ web-sized favicon, logo and wordmark
```

### Custom API (all require a signed-in user)

| Route | |
| --- | --- |
| `POST /api/budget/connect` | `{setup_token, name}`: claims the SimpleFIN token and runs the first sync |
| `POST /api/budget/sync` | Syncs all of your connections now |
| `POST /api/budget/import` | `{account, rows:[{date:"YYYY-MM-DD", amount, description}]}` |
| `POST /api/budget/apply-rules` | Categorizes uncategorized transactions |
| `GET /api/budget/insights?month=YYYY-MM` | Budget analysis for one month |
| `GET /api/budget/spending?month=YYYY-MM` | Spending by category and merchant, plus a 6-month trend |
| `GET /api/budget/recurring?month=YYYY-MM` | Recurring items, the month's calendar, upcoming bills and totals |
| `GET /api/budget/subscriptions` | Subscriptions with renewals and price changes, plus untracked suggestions |
| `POST /api/budget/recurring/detect` | Rescans transactions for recurring charges |
| `GET /api/budget/networth?days=90` | Net worth now and over time |
| `POST /api/budget/digest` | Emails you the weekly summary now |
