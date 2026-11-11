// Teaser screenshots of every page, desktop and phone, light and dark.
// Drives headless Chrome over the DevTools protocol (no npm packages needed).
//
//   node scripts/screenshots.mjs [baseUrl] [email] [password]
//
// Defaults to the local test container (http://localhost:8095). Writes PNGs to screenshots/,
// which git ignores. The verify-page shots need VERIFY_LINKS (see below).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const BASE = process.argv[2] || "http://localhost:8095";
const EMAIL = process.argv[3] || "me@example.test";
const PASSWORD = process.argv[4] || "testpass123";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "screenshots");
const PORT = 9300 + Math.floor(Math.random() * 600);
const CHROME = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("Chrome not found; set CHROME=/path/to/chrome");

const DEVICES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
};

// [file name, hash route, action run after the page settles]
const S = (name, hash, action = "") => ({ name, hash, action });
const openGoal = (n) => `[...document.querySelectorAll('.goal[data-id]')].find((g) => g.textContent.includes(${JSON.stringify(n)})).click(); await sleep(1500);`;
const SHOTS = {
  public: [
    S("01-home", "#/"),
    S("02-sign-in", "#/login"),
  ],
  app: [
    S("03-overview", "#/dashboard"),
    S("04-budget", "#/budget"),
    S("05-transactions", "#/transactions"),
    S("06-spending", "#/spending"),
    S("07-recurring", "#/recurring"),
    S("08-subscriptions", "#/recurring", `document.querySelector('[data-tab="subscriptions"]').click(); await sleep(1500);`),
    S("09-charge-history", "#/recurring", `document.querySelector('[data-tab="subscriptions"]').click(); await sleep(1500);
      [...document.querySelectorAll('.sub-row')].find((r) => /netflix/i.test(r.textContent)).click(); await sleep(1500);`),
    S("10-cash-flow", "#/cashflow"),
    S("11-net-worth", "#/networth"),
    S("12-accounts", "#/accounts"),
    S("13-goals", "#/goals"),
    S("14-goal-detail", "#/goals", openGoal("House down payment")),
    S("15-split", "#/transactions", `const s = document.querySelector('#tcat'); s.value = '__split'; s.onchange({ target: s }); await sleep(1200);
      document.querySelector('.tx-row').click(); await sleep(700); document.querySelector('#split-edit').click(); await sleep(800);`),
    S("16-settings", "#/settings"),
    S("18-reports", "#/reports", `document.querySelector('#mprev').click(); await sleep(1500);`),
    S("19-reports-year", "#/reports", `document.querySelector('[data-kind="year"]').click(); await sleep(1500);`),
  ],
};
const DARK = ["03-overview", "06-spending", "10-cash-flow", "14-goal-detail", "19-reports-year"];
const PHONE_SKIP = [];

// ---- tiny CDP client
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = join(tmpdir(), "keel-shots-profile");
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--hide-scrollbars", "--force-color-profile=srgb", "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });
process.on("exit", () => { try { chrome.kill(); } catch (_) { /* gone */ } });
process.on("uncaughtException", (err) => { console.error(err); process.exit(1); });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleepMs(200);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch (_) { /* starting */ }
}
if (!target) throw new Error("Chrome didn't start");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const listeners = new Set();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id); pending.delete(d.id);
    d.error ? p.rej(new Error(d.error.message)) : p.res(d.result);
  } else for (const f of listeners) f(d);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (code) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${code} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
};
const go = async (url) => {
  const loaded = new Promise((res) => { const f = (d) => { if (d.method === "Page.loadEventFired") { listeners.delete(f); res(); } }; listeners.add(f); });
  await send("Page.navigate", { url });
  await loaded;
};
await send("Page.enable");
await send("Runtime.enable");

async function setDevice(kind, theme) {
  await send("Emulation.setDeviceMetricsOverride", DEVICES[kind]);
  await send("Emulation.setTouchEmulationEnabled", kind === "phone" ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
}

async function shoot(kind, theme, shot) {
  await setDevice(kind, theme);
  await go("about:blank");
  await go(BASE + "/" + shot.hash);
  await sleepMs(2500); // data loads after the shell
  if (shot.action) await evalJs(shot.action);
  await evalJs(`document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); const t = document.querySelector('#viz-tip'); if (t) t.style.opacity = 0;`);
  await sleepMs(400);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const dir = join(OUT, kind + (theme === "dark" ? "-dark" : ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, shot.name + ".png"), Buffer.from(data, "base64"));
  console.log("saved", kind, theme, shot.name);
}

// ONLY=03-overview,06-spending re-shoots just those pages
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
async function run(kind, theme, list) {
  for (const shot of list.filter((s) => !ONLY.length || ONLY.includes(s.name))) {
    try { await shoot(kind, theme, shot); } catch (err) { console.log("FAILED", kind, theme, shot.name, err.message); }
  }
}

// signed out
await go(BASE + "/");
await evalJs(`localStorage.clear(); localStorage.setItem("keel_install_dismissed", "1");`);
for (const kind of ["desktop", "phone"]) await run(kind, "light", SHOTS.public);
// each verify link works once, so pass one per device: VERIFY_LINKS="#/verify/A,#/verify/B"
const links = (process.env.VERIFY_LINKS || "").split(",").filter(Boolean);
for (const [i, kind] of ["desktop", "phone"].entries()) {
  if (!links[i]) continue;
  await setDevice(kind, "light");
  await go("about:blank");
  await go(BASE + "/" + links[i]);
  await sleepMs(2500);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  mkdirSync(join(OUT, kind), { recursive: true });
  writeFileSync(join(OUT, kind, "17-verified.png"), Buffer.from(data, "base64"));
  console.log("saved", kind, "17-verified");
}

// signed in
await evalJs(`const r = await fetch("/api/collections/users/auth-with-password", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identity: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} }) }).then((r) => r.json());
  if (!r.token) throw new Error("sign-in failed");
  localStorage.setItem("pocketbase_auth", JSON.stringify({ token: r.token, record: r.record }));`);
await run("desktop", "light", SHOTS.app);
await run("desktop", "dark", SHOTS.app.filter((s) => DARK.includes(s.name)));
await run("phone", "light", SHOTS.app.filter((s) => !PHONE_SKIP.includes(s.name)));
await run("phone", "dark", SHOTS.app.filter((s) => DARK.includes(s.name)));

ws.close();
chrome.kill();
console.log("done ->", OUT);
