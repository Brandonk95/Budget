# Budget

A self-hosted budgeting app built on [PocketBase](https://pocketbase.io). It runs as one Docker container and needs no build step.

- **Bank sync** through [Teller](https://teller.io), which is free for personal use, or [SimpleFIN Bridge](https://beta-bridge.simplefin.org) (about $15/year). Balances and transactions sync every 6 hours. You can also import CSV files from any bank.
- **Budgets** per category, grouped as needs, wants and savings. The app suggests amounts from your 3-month average and tracks how much income is left to assign.
- **Insights**: a projection of month-end spending, a safe-to-spend amount per day, a 50/30/20 check, recurring and subscription detection, and a 6-month trend.
- **Auto-categorization**: your own rules ("contains *kroger* → Groceries") plus built-in guesses for common merchants. When you change a transaction's category, the app offers to turn it into a rule.
- **Goals** with the monthly amount needed to hit each target date.
- **Email over SMTP**: alerts when a budget passes your warning threshold or goes over it, alerts for large transactions, a failed-sync notice, a weekly summary, plus password reset and verification emails.

## Quick start

```bash
cp .env.example .env
# edit .env: APP_URL, PB_ADMIN_*, SMTP_*, TZ
docker compose up -d --build
```

Open `http://localhost:8090` (or your `APP_URL`) and create your account. After that, set `ALLOW_SIGNUPS=false` in `.env` and run `docker compose up -d` so nobody else can register.

The PocketBase admin dashboard is at `/_/`. It uses the `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` superuser, which is created or updated on every start.

## Configuration (`.env`)

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public URL. Email links use it. |
| `PORT` | Host port (default 8090). |
| `TZ` | Timezone for transaction dates and month boundaries. |
| `ALLOW_SIGNUPS` | `true` or `false`. |
| `PB_ENCRYPTION_KEY` | Optional 32-character key that encrypts stored settings, such as the SMTP password. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Mail server. Leave `SMTP_HOST` empty to turn email off. |
| `SMTP_TLS` | `true` for implicit TLS (port 465). `false` for STARTTLS (port 587) or plain SMTP. |
| `SMTP_AUTH_METHOD` | `PLAIN` (default) or `LOGIN`. |
| `SMTP_SENDER_ADDRESS`, `SMTP_SENDER_NAME` | The "From" address and name. |
| `TELLER_APP_ID` | Your Teller application ID. Leave it empty to hide the Teller option. |
| `TELLER_ENV` | `sandbox` (fake data, no certificate), `development` (real banks, free, up to 100 bank logins) or `production`. |
| `COMPOSE_PROFILES` | Set to `teller` to start the certificate proxy. It is needed for `development` and `production`. |
| `TELLER_API_URL` | Optional. Overrides the Teller API address. |
| `SYNC_CRON`, `ALERT_CRON`, `DIGEST_CRON` | Schedules in UTC. Keep the sync schedule at 6 runs a day or fewer, because SimpleFIN allows about 24 requests a day. |

SMTP settings are applied from `.env` each time the app boots, so `.env` is the only place you need to edit them. A Gmail example: `smtp.gmail.com`, port `587`, `SMTP_TLS=false`, with an [app password](https://support.google.com/accounts/answer/185833).

To test email, open **Settings → Send me a summary now**.

## Connecting your bank

### Teller (free, recommended)

Teller's **development** environment connects to real banks at no cost, for up to 100 bank logins. That is plenty for a household.

1. Sign up at [teller.io](https://teller.io) and copy your **Application ID** into `TELLER_APP_ID`.
2. In the Teller dashboard, download your client certificate. Put `certificate.pem` and `private_key.pem` in `./teller/`.
3. Keep `TELLER_ENV=development` and `COMPOSE_PROFILES=teller` in `.env`, then run `docker compose up -d`.
4. In Budget, go to **Accounts → Connect bank → Connect with Teller** and log in to your bank in Teller's window.

**Why the extra container?** For real bank data, Teller requires mutual TLS: every request has to present your client certificate. PocketBase's HTTP client can't do that. The `teller-proxy` service is a small nginx container on the internal Docker network. It adds the certificate and forwards requests to `api.teller.io`. It isn't published on any host port.

To try the flow with fake data first, set `TELLER_ENV=sandbox` and remove `COMPOSE_PROFILES`. Then log in with username `username` and password `password`.

The Teller access token stays on your server and is never sent to the browser. The first sync pulls about 6 months of history and uses Teller's merchant categories to pre-fill yours. Sometimes a bank asks you to log in again, for example after you change your password or when it needs MFA. When that happens, the connection shows **Reconnect needed** and you get an email. Click **Reconnect** to fix it. Clicking **Disconnect** revokes Teller's access and keeps your history as manual accounts.

If a bank reports card purchases as positive amounts, tick **Flip ±** on that account. The fix applies from the next sync.

### SimpleFIN Bridge (fallback)

Use this when Teller doesn't support your bank.

1. Sign up at [SimpleFIN Bridge](https://beta-bridge.simplefin.org) (about $1.50 a month) and link your banks there.
2. Create a new app connection and copy the **setup token**.
3. In Budget, go to **Accounts → Connect bank** and paste the token.

The token can only be used once. It is exchanged for an access URL that stays on your server. The first sync pulls up to 90 days of history.

New synced accounts start like this: checking and credit accounts count toward your budget, and savings and investment accounts don't. You can change the "In budget" setting for each account. Mark card payments and moves between your own accounts as **Transfers** or **Credit Card Payment** so they aren't counted as spending.

### CSV import

Go to **Accounts → Import CSV**, pick the account, then map the date, description and amount columns. The amount can be a single column or separate debit and credit columns. Re-importing the same file skips rows that are already there.

## Backups and updates

All data lives in `./pb_data`, which is a SQLite database. Back up that folder, or use **Settings → Backups** in the PocketBase dashboard at `/_/`.

To update PocketBase, change `PB_VERSION` in the `Dockerfile` and run `docker compose up -d --build`. Migrations run automatically.

## Exposing it to the internet

Put the app behind a reverse proxy that provides HTTPS, such as Caddy, Traefik or nginx, and set `APP_URL` to the HTTPS address. A Caddy example:

```
budget.example.com {
  reverse_proxy localhost:8090
}
```

If the proxy runs in front of the app, set the trusted proxy headers (e.g. `X-Forwarded-For`) in the dashboard under **Settings → Application**. This makes rate limits and logs show real client IPs.

## Project layout

```
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
teller-proxy/    nginx config that adds the Teller client certificate (mTLS)
teller/          put certificate.pem + private_key.pem here (git-ignored)
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
