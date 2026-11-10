/* Keel: single-page budgeting app on top of PocketBase. No build step. */
(() => {
  "use strict";

  const pb = new PocketBase(location.origin);
  pb.autoCancellation(false);

  // ------------------------------------------------------------------ helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
  const money = (n) => fmt.format(Number(n) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const thisMonth = () => ymd(new Date()).slice(0, 7);
  const shiftMonth = (m, delta) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthLabel = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }); };
  const shortMonth = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: "short" }); };
  const monthBounds = (m) => ({ start: `${m}-01 00:00:00.000Z`, end: `${shiftMonth(m, 1)}-01 00:00:00.000Z` });
  const dateOnly = (s) => (s || "").slice(0, 10);
  const prettyDate = (s) => { if (!s) return ""; const [y, m, d] = dateOnly(s).split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
  const KINDS = { income: "Income", needs: "Needs", wants: "Wants", savings: "Savings", transfer: "Transfers (not budgeted)" };
  const ACCOUNT_TYPES = ["checking", "savings", "credit", "investment", "loan", "cash", "other"];

  function toast(msg, isErr) {
    const el = document.createElement("div");
    el.className = "toast" + (isErr ? " err" : "");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), isErr ? 6000 : 3000);
  }
  function errText(err) {
    const d = err && err.response && err.response.data;
    if (d && typeof d === "object") {
      const first = Object.keys(d).map((k) => `${k}: ${d[k].message || d[k]}`)[0];
      if (first) return first;
    }
    return (err && err.response && err.response.message) || (err && err.message) || String(err);
  }
  const fail = (err) => { console.error(err); toast(errText(err), true); };

  async function api(path, opts = {}) {
    return pb.send(path, { method: opts.method || "GET", body: opts.body, query: opts.query });
  }

  function modal(title, bodyHtml, { wide = false, onMount } = {}) {
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-bg"><div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${bodyHtml}</div></div>`;
    const bg = $(".modal-bg", root);
    const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    $$("[data-close]", root).forEach((b) => b.addEventListener("click", close));
    const first = $("input, select, textarea", root);
    if (first) first.focus();
    if (onMount) onMount($(".modal", root), close);
    return close;
  }

  function confirmBox(text, okLabel = "Delete") {
    return new Promise((resolve) => {
      modal("Are you sure?", `<p>${esc(text)}</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">${esc(okLabel)}</button></div>`, {
        onMount: (m, close) => { $("#ok", m).onclick = () => { close(); resolve(true); }; },
      });
    });
  }

  // Lucide icons (lucide.dev, ISC license), inlined so there's no extra download.
  const ICONS = {
    dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    budget: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    spending: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    recurring: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    subscriptions: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
    transactions: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    networth: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    accounts: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    goals: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

  // a simple keel/hull mark
  const LOGO = '<img src="brand/favicon-32.png" alt="" width="28" height="28">';
  // The wordmark is the transparent logo used as a CSS mask, so it takes the theme's ink color.
  // If APP_NAME was changed, fall back to the icon plus the configured name.
  const isKeel = () => (state.status.app_name || "Keel") === "Keel";
  const brandMark = () => isKeel()
    ? `<div class="brand"><span class="wordmark" role="img" aria-label="Keel"></span></div>`
    : `<div class="brand"><div class="logo">${LOGO}</div>${esc(state.status.app_name)}</div>`;

  // ------------------------------------------------------------------ state
  const state = {
    month: thisMonth(),
    categories: [],
    accounts: [],
    status: { smtp: false, app_name: "Keel" },
  };
  const catById = (id) => state.categories.find((c) => c.id === id);
  const accById = (id) => state.accounts.find((a) => a.id === id);

  async function loadCategories() {
    state.categories = await pb.collection("categories").getFullList({ sort: "name" });
  }
  async function loadAccounts() {
    state.accounts = await pb.collection("accounts").getFullList({ sort: "name" });
  }
  function categoryOptions(selected, { includeNone = true, noneLabel = "Uncategorized" } = {}) {
    let html = includeNone ? `<option value="">${esc(noneLabel)}</option>` : "";
    for (const kind of Object.keys(KINDS)) {
      const cats = state.categories.filter((c) => c.kind === kind && (!c.archived || c.id === selected));
      if (!cats.length) continue;
      html += `<optgroup label="${esc(KINDS[kind])}">` + cats.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("") + "</optgroup>";
    }
    return html;
  }
  const accountOptions = (selected, all) =>
    (all ? `<option value="">All accounts</option>` : "") +
    state.accounts.map((a) => `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${esc(a.name)}${a.institution ? " · " + esc(a.institution) : ""}</option>`).join("");

  // ------------------------------------------------------------------ auth
  function renderAuth(mode = "login") {
    document.title = state.status.app_name;
    $("#app").innerHTML = `
      <div class="auth"><div class="card">
        ${isKeel() ? `<img class="auth-logo" src="brand/logo.png" alt="Keel" width="760" height="431">` : `<div class="brand" style="padding:0 0 6px"><div class="logo">${LOGO}</div>${esc(state.status.app_name)}</div>`}
        <p class="tagline">Money, on course.</p>
        ${isKeel() ? `<a class="auth-home small" href="#/">← Back to home</a>` : ""}
        <div class="tabs">
          <button data-m="login" class="${mode === "login" ? "on" : ""}">Sign in</button>
          <button data-m="register" class="${mode === "register" ? "on" : ""}">Create account</button>
        </div>
        <form id="auth-form" class="stack">
          ${mode === "register" ? `<label class="field"><span>Name</span><input name="name" autocomplete="name"></label>` : ""}
          <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
          ${mode !== "forgot" ? `<label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="${mode === "register" ? "new-password" : "current-password"}"></label>` : ""}
          <button class="btn primary" style="width:100%;justify-content:center">${mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send reset link"}</button>
          ${mode === "login" && state.status.smtp ? `<p class="small" style="text-align:center"><a href="#" id="forgot">Forgot password?</a></p>` : ""}
          ${mode === "forgot" ? `<p class="small" style="text-align:center"><a href="#" id="back">Back to sign in</a></p>` : ""}
        </form>
      </div></div>`;
    $$(".tabs button").forEach((b) => (b.onclick = () => { history.replaceState(null, "", b.dataset.m === "register" ? "#/register" : "#/login"); renderAuth(b.dataset.m); }));
    const f = $("#forgot"); if (f) f.onclick = (e) => { e.preventDefault(); renderAuth("forgot"); };
    const bk = $("#back"); if (bk) bk.onclick = (e) => { e.preventDefault(); renderAuth("login"); };
    $("#auth-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const btn = $("button.primary", e.target); btn.disabled = true; btn.classList.add("loading");
      try {
        if (mode === "forgot") {
          await pb.collection("users").requestPasswordReset(fd.email);
          toast("If that email exists, a reset link is on its way.");
          renderAuth("login");
          return;
        }
        if (mode === "register") {
          await pb.collection("users").create({ name: fd.name, email: fd.email, password: fd.password, passwordConfirm: fd.password });
          if (state.status.smtp) pb.collection("users").requestVerification(fd.email).catch(() => {});
        }
        await pb.collection("users").authWithPassword(fd.email, fd.password);
        await start();
      } catch (err) { fail(err); btn.disabled = false; btn.classList.remove("loading"); }
    };
  }

  // ------------------------------------------------------------------ public homepage
  function renderPublic() {
    const h = location.hash.replace(/^#\/?/, "");
    if (h === "login" || h === "register") return renderAuth(h);
    if (h.startsWith("reset") || h.startsWith("verify")) return renderAuth("login");
    return renderLanding();
  }

  function renderLanding() {
    const name = state.status.app_name || "Keel";
    document.title = `${name} · Money, on course.`;
    const F = (ic, title, text) => `<div class="lp-f"><span class="cm" style="--c:var(--s1)" aria-hidden="true">${catSvg(ic)}</span><h3>${title}</h3><p>${text}</p></div>`;
    // a small, static preview of the Overview so visitors see what they get
    const pts = [0, 18, 26, 61, 70, 92, 118, 126, 160, 171, 198, 214];
    const prev = [0, 30, 52, 70, 101, 128, 140, 171, 202, 220, 251, 280, 300, 322];
    const px = (i, n) => 8 + (i / (n - 1)) * 284, py = (v) => 112 - (v / 340) * 100;
    const line = (a, n) => a.map((v, i) => (i ? "L" : "M") + px(i, n).toFixed(1) + " " + py(v).toFixed(1)).join("");
    const curD = line(pts, 14);
    const preview = `<div class="lp-shot" aria-hidden="true">
      <div class="lp-shot-h"><div><div class="label">Spent this month</div><div class="lp-big num">$1,214.60</div><div class="small muted"><b class="pos">$182.40 less</b> than last month at this point</div></div></div>
      <svg viewBox="0 0 300 120" class="lp-chart"><line x1="8" x2="292" y1="${py(300)}" y2="${py(300)}" class="ref"/>
        <path d="${line(prev, 14)}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 5"/>
        <path d="${curD}L${px(11, 14)} 112L8 112Z" fill="var(--s1)" opacity=".12"/>
        <path d="${curD}" fill="none" stroke="var(--s1)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${px(11, 14)}" cy="${py(214)}" r="5" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/></svg>
      <div class="lp-rows">
        ${[["Groceries", 412.18, 500], ["Dining Out", 168.4, 200], ["Transportation", 96.25, 180]].map(([n, v, b]) => `<div class="cat-row"><div>${catLabel({ name: n })}</div><div class="num">${money(v)} <span class="muted">/ ${money(b)}</span></div><div class="bar"><i style="width:${(v / b) * 100}%;background:${catColor({ name: n })}"></i></div></div>`).join("")}
      </div></div>`;
    $("#app").innerHTML = `
      <div class="lp">
        <header class="lp-nav">
          ${isKeel() ? `<span class="wordmark" role="img" aria-label="Keel"></span>` : `<div class="brand" style="padding:0"><div class="logo">${LOGO}</div>${esc(name)}</div>`}
          <div class="spacer"></div>
          <a class="btn" href="#/login">Sign in</a>
          <a class="btn primary hide-xs" href="#/register">Create account</a>
        </header>
        <section class="lp-hero">
          <div class="lp-copy">
            <p class="lp-eyebrow">Personal budgeting, self-hosted</p>
            <h1>Money, on course.</h1>
            <p class="lp-lede">${esc(name)} pulls in your bank transactions, files them for you, and shows what's left to spend this month, so you always know where you stand.</p>
            <div class="row lp-cta"><a class="btn primary lg" href="#/register">Create your account</a><a class="btn lg" href="#/login">Sign in</a></div>
            <p class="small muted">Free and private. Your data stays on this server.</p>
          </div>
          ${preview}
        </section>
        <section class="lp-grid">
          ${F("swap", "Your banks, synced", "Connect through SimpleFIN to pull balances and transactions every day, or import a CSV.")}
          ${F("tag", "Categories that learn", "Common merchants are filed automatically. Fix one and Keel remembers it next time.")}
          ${F("target", "One budget number", "Pick a monthly total and watch the categories you care about. Everything else shares the rest.")}
          ${F("repeat", "Bills & subscriptions", "Recurring charges and paychecks are found for you, with what's still due this month.")}
          ${F("trend", "Net worth over time", "Assets and debts in one place, recorded daily so you can see the trend.")}
          ${F("shield", "Private by design", "Self-hosted on your own server. No ads, no selling your data, no third-party trackers.")}
        </section>
        <section class="lp-band">
          <h2>Know what's left before you spend it.</h2>
          <a class="btn primary lg" href="#/register">Get started</a>
        </section>
        <footer class="lp-foot small muted">${esc(name)} v${esc(state.status.version || "")} · <a href="#/login">Sign in</a></footer>
      </div>`;
  }

  // ------------------------------------------------------------------ shell / router
  // `main` routes sit in the mobile bottom bar; the rest live under "More".
  const ROUTES = {
    dashboard: { title: "Overview", render: renderDashboard, month: true, main: true },
    budget: { title: "Budget", render: renderBudget, month: true, main: true },
    transactions: { title: "Transactions", render: renderTransactions, month: true, main: true },
    spending: { title: "Spending", render: renderSpending, month: true, main: true },
    recurring: { title: "Recurring", render: renderRecurring, month: true },
    subscriptions: { title: "Recurring", hidden: true, render: () => { recState.tab = "subscriptions"; history.replaceState(null, "", "#/recurring"); return route(); } },
    networth: { title: "Net worth", render: renderNetWorth },
    accounts: { title: "Accounts", render: renderAccounts },
    goals: { title: "Goals", render: renderGoals },
    settings: { title: "Settings", render: renderSettings },
  };

  function currentRoute() {
    const r = (location.hash.replace(/^#\/?/, "").split("?")[0]) || "dashboard";
    return ROUTES[r] ? r : "dashboard";
  }

  function renderShell() {
    const me = pb.authStore.record;
    $("#app").innerHTML = `
      <div class="shell">
        <aside class="side">
          ${brandMark()}
          <nav class="nav" aria-label="Main">${Object.keys(ROUTES).filter((k) => !ROUTES[k].hidden).map((k) => `<a href="#/${k}" data-r="${k}" class="${ROUTES[k].main ? "" : "sec"}">${icon(k)}<span>${ROUTES[k].title}</span></a>`).join("")}
            <button type="button" class="more" id="nav-more" aria-haspopup="dialog">${icon("more")}<span>More</span></button></nav>
          <div class="foot"><div class="who" title="${esc(me.email)}">${esc(me.name || me.email)}</div><div class="ver">Keel v${esc(state.status.version || "")}</div></div>
        </aside>
        <main>
          <div class="topbar">
            <h1 id="page-title"></h1>
            <div class="spacer"></div>
            <div class="month-picker" id="month-picker">
              <button id="mprev" aria-label="Previous month">${icon("left")}</button><span id="mlabel" aria-live="polite"></span><button id="mnext" aria-label="Next month">${icon("right")}</button>
            </div>
          </div>
          <div id="view"></div>
        </main>
      </div>`;
    $("#mprev").onclick = () => { state.month = shiftMonth(state.month, -1); route(); };
    $("#mnext").onclick = () => { state.month = shiftMonth(state.month, 1); route(); };
    $("#nav-more").onclick = openMoreSheet;
  }

  // Mobile: the pages that don't fit in the bottom bar.
  function openMoreSheet() {
    const r = currentRoute();
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-bg sheet-bg"><div class="modal sheet" role="dialog" aria-modal="true" aria-label="More pages">
      <nav class="sheet-nav">${Object.keys(ROUTES).filter((k) => !ROUTES[k].main && !ROUTES[k].hidden).map((k) => `<a href="#/${k}" class="${k === r ? "active" : ""}">${icon(k)}${ROUTES[k].title}</a>`).join("")}</nav>
      <div class="foot">${esc(pb.authStore.record.email)} · Keel v${esc(state.status.version || "")}</div></div></div>`;
    const bg = $(".modal-bg", root);
    const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    $$("a", root).forEach((a) => a.addEventListener("click", close));
    const first = $("a", root); if (first) first.focus();
  }

  async function route() {
    // a re-render removes whatever was hovered, so drop any open tooltip with it
    const tip = $("#viz-tip"); if (tip) tip.style.opacity = 0;
    if (reloadIfPending()) return; // a newer version is waiting: load it instead of rendering old code
    if (!pb.authStore.isValid) return renderPublic();
    if (!$(".shell")) renderShell();
    const r = currentRoute();
    const def = ROUTES[r];
    document.title = `${def.title} · ${state.status.app_name}`;
    $("#page-title").textContent = def.title;
    $$(".nav a").forEach((a) => { const on = a.dataset.r === r; a.classList.toggle("active", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $("#nav-more").classList.toggle("active", !def.main);
    $("#month-picker").classList.toggle("hidden", !def.month);
    $("#mlabel").textContent = monthLabel(state.month);
    const view = $("#view");
    view.innerHTML = `<div class="empty"><span class="loading-dots">Loading</span></div>`;
    try { await def.render(view); } catch (err) { fail(err); view.innerHTML = `<div class="empty">Couldn't load this page: ${esc(errText(err))}</div>`; }
  }

  // ------------------------------------------------------------------ charts
  // Hand-rolled SVG. Colors come from CSS tokens (--s1..--s8 categorical, --muted, --border),
  // so light/dark both work. Every chart has a hover tooltip via [data-tip].
  const SERIES = (i) => `var(--s${(i % 8) + 1})`;
  const fmt0 = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money0 = (n) => fmt0.format(Number(n) || 0);
  const compact = (v) => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "k" : a >= 1e3 ? (a / 1e3).toFixed(1) + "k" : String(Math.round(a)); return (v < 0 ? "-$" : "$") + s; };
  const tipAttr = (html) => `data-tip="${esc(html)}"`;
  function niceStep(range, ticks) {
    const raw = range / ticks; const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function scale(lo, hi, ticks = 4) {
    if (hi === lo) { hi = lo + 1; }
    const st = niceStep(hi - lo, ticks);
    const min = Math.floor(lo / st) * st, max = Math.ceil(hi / st) * st;
    const out = []; for (let v = min; v <= max + st / 2; v += st) out.push(v);
    return { min, max, ticks: out };
  }
  const dayLabel = (m, d) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

  // Tooltip + crosshair, bound once for the whole app.
  function bindTooltips() {
    const tip = document.createElement("div");
    tip.id = "viz-tip"; tip.className = "viz-tip"; tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
    let lastSvg = null;
    const hide = () => { tip.style.opacity = 0; if (lastSvg) lastSvg.classList.remove("hovering"); lastSvg = null; };
    document.addEventListener("pointermove", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t) return hide();
      tip.innerHTML = t.getAttribute("data-tip");
      tip.style.opacity = 1;
      const r = tip.getBoundingClientRect();
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
      tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
      const svg = t.ownerSVGElement;
      if (lastSvg && lastSvg !== svg) lastSvg.classList.remove("hovering");
      lastSvg = svg;
      if (svg && t.dataset.x) {
        svg.classList.add("hovering");
        const xh = svg.querySelector(".xh"); if (xh) { xh.setAttribute("x1", t.dataset.x); xh.setAttribute("x2", t.dataset.x); }
        svg.querySelectorAll(".xh-dot").forEach((dot) => {
          const yv = t.dataset["y" + dot.dataset.s];
          if (yv == null || yv === "") dot.style.display = "none";
          else { dot.style.display = ""; dot.setAttribute("cx", t.dataset.x); dot.setAttribute("cy", yv); }
        });
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (!(e.target.closest && e.target.closest("[data-tip]"))) hide();
      const inMenu = e.target.closest && e.target.closest("details.menu");
      document.querySelectorAll("details.menu[open]").forEach((d) => { if (d !== inMenu) d.removeAttribute("open"); });
    });
    window.addEventListener("scroll", hide, { passive: true });
  }

  // Generic line chart: series = [{ values:[...], color, dashed, area, label }], x labels by index.
  let chartSeq = 0;
  // yMax caps the scale (lines above it are clipped; tooltips still show real values).
  // refs = [{ v, label }] draws dashed reference lines, e.g. the budget.
  function lineChart({ series, n, xLabel, tipFor, height = 220, yMinZero = true, ariaLabel, yMax = null, refs = [] }) {
    const W = 640, H = height, L = 52, R = 14, T = 12, B = 26;
    const all = series.flatMap((s) => s.values.filter((v) => v != null)).concat(refs.map((r) => r.v));
    const lo = yMinZero ? Math.min(0, ...all) : Math.min(...all), hi = yMax != null ? Math.max(1, yMax) : Math.max(1, ...all);
    const cid = "clip" + (++chartSeq);
    const sc = scale(lo, hi);
    const x = (i) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - (v - sc.min) / (sc.max - sc.min)) * (H - T - B);
    let g = "";
    for (const t of sc.ticks) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
    const xt = n <= 1 ? [0] : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1];
    for (const i of [...new Set(xt)]) g += `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(xLabel(i))}</text>`;
    for (const r of refs) g += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(r.v)}" y2="${y(r.v)}"/><text class="ax ref-l" x="${W - R}" y="${y(r.v) - 5}" text-anchor="end">${esc(r.label)}</text>`;
    let paths = "";
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (!pts.length) return;
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
      if (s.area) paths += `<path d="${d}L${pts[pts.length - 1][0].toFixed(1)} ${y(Math.max(sc.min, 0))}L${pts[0][0].toFixed(1)} ${y(Math.max(sc.min, 0))}Z" fill="${s.color}" opacity=".12"/>`;
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="5 5"' : ""}/>`;
      if (s.endDot) { const p = pts[pts.length - 1]; paths += `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`; }
      paths += `<circle class="xh-dot" data-s="${si}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2" cx="-10" cy="-10"/>`;
    });
    const cw = n <= 1 ? W - L - R : (W - L - R) / (n - 1);
    let hits = "";
    for (let i = 0; i < n; i++) {
      const ys = series.map((s, si) => `data-y${si}="${s.values[i] == null || y(s.values[i]) < T ? "" : y(s.values[i]).toFixed(1)}"`).join(" ");
      hits += `<rect class="hit" x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${H - T - B}" data-x="${x(i).toFixed(1)}" ${ys} ${tipAttr(tipFor(i))}/>`;
    }
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel || "")}"><defs><clipPath id="${cid}"><rect x="0" y="${T - 6}" width="${W}" height="${H - T - B + 6}"/></clipPath></defs>${g}<g clip-path="url(#${cid})">${paths}</g><line class="xh" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/>${hits}</svg></div>`;
  }

  function donut(items, total, centerLabel) {
    const R = 72, SW = 22, C = 2 * Math.PI * R, GAP = items.length > 1 ? 2 : 0;
    let off = 0, segs = "";
    items.forEach((it) => {
      const len = total ? (it.value / total) * C : 0;
      const dash = Math.max(0.5, len - GAP);
      segs += `<circle r="${R}" cx="100" cy="100" fill="none" stroke="${it.color}" stroke-width="${SW}" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)" ${tipAttr(`<b>${esc(it.label)}</b><br>${money(it.value)} · ${total ? Math.round((it.value / total) * 100) : 0}%`)}/>`;
      off += len;
    });
    if (!items.length) segs = `<circle r="${R}" cx="100" cy="100" fill="none" stroke="var(--track)" stroke-width="${SW}"/>`;
    return `<svg class="donut" viewBox="0 0 200 200" role="img" aria-label="Spending by category">${segs}
      <text x="100" y="98" text-anchor="middle" class="d-big">${esc(money(total))}</text>
      <text x="100" y="118" text-anchor="middle" class="d-sub">${esc(centerLabel)}</text></svg>`;
  }

  function monthBars(trend, avg, currentKey) {
    const W = 640, H = 200, L = 52, R = 14, T = 18, B = 26;
    const sc = scale(0, Math.max(1, avg, ...trend.map((t) => t.total)));
    const y = (v) => T + (1 - v / sc.max) * (H - T - B);
    const gw = (W - L - R) / trend.length, bw = Math.min(56, gw * 0.55);
    let g = "";
    for (const t of sc.ticks) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
    let bars = "";
    trend.forEach((t, i) => {
      const x0 = L + i * gw + (gw - bw) / 2, top = y(t.total), base = y(0), r = Math.min(4, (base - top) / 2);
      if (t.total > 0) bars += `<path d="M${x0} ${base}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x0 + bw - r}Q${x0 + bw} ${top} ${x0 + bw} ${top + r}V${base}Z" fill="var(--s1)" opacity="${t.month === currentKey ? 1 : 0.55}"/>`;
      bars += `<rect class="hit" x="${L + i * gw}" y="${T}" width="${gw}" height="${H - T - B}" ${tipAttr(`<b>${esc(monthLabel(t.month))}</b><br>Spent ${money(t.total)}`)}/>`;
      if (t.month === currentKey && t.total > 0) bars += `<text class="lbl" x="${x0 + bw / 2}" y="${top - 6}" text-anchor="middle">${esc(compact(t.total))}</text>`;
      bars += `<text class="ax" x="${x0 + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(shortMonth(t.month))}</text>`;
    });
    const avgLine = avg > 0 ? `<line x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--muted)" stroke-dasharray="4 4"/><text class="ax" x="${W - R}" y="${y(avg) - 5}" text-anchor="end">avg ${esc(compact(avg))}</text>` : "";
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending by month">${g}${bars}${avgLine}</svg></div>`;
  }

  // ------------------------------------------------------------------ shared bits
  // ---- category identity: one Lucide icon and one locked color per category, used everywhere
  const CAT_ICONS = {
    briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    pulse: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    cap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    hammer: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
    paw: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    buoy: '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
    trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
    baby: '<path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    dumbbell: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
  };
  // default categories: [icon, color slot]. Slots spread the big spenders across the 8 validated hues.
  const CAT_DEFAULTS = {
    "paycheck": ["briefcase", 3], "other income": ["coins", 6], "rent / mortgage": ["home", 1], "utilities": ["zap", 4],
    "groceries": ["cart", 3], "transportation": ["car", 7], "insurance": ["shield", 6], "health": ["pulse", 8],
    "education": ["cap", 7], "fees & charges": ["receipt", 8], "dining out": ["utensils", 2], "shopping": ["bag", 5],
    "subscriptions": ["repeat", 1], "entertainment": ["ticket", 4], "personal care": ["scissors", 5], "travel": ["plane", 6],
    "home": ["hammer", 2], "pets": ["paw", 4], "gifts": ["gift", 5], "charity": ["heart", 8], "cash & atm": ["banknote", 3],
    "emergency fund": ["buoy", 7], "investing": ["trend", 6], "transfers": ["swap", 0], "credit card payment": ["card", 0],
    "everything else": ["box", 0],
  };
  const CAT_ICON_KEYS = Object.keys(CAT_ICONS).filter((k) => k !== "help");
  const hashStr = (str) => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  const catDef = (c) => CAT_DEFAULTS[String((c && c.name) || "").trim().toLowerCase()];
  function catIconKey(c) {
    if (!c) return "help";
    if (CAT_ICONS[c.icon]) return c.icon;
    const d = catDef(c);
    return d ? d[0] : "tag";
  }
  function catColor(c) {
    if (!c || !c.name) return "var(--subtle)";
    const d = catDef(c);
    if (d) return d[1] ? `var(--s${d[1]})` : "var(--subtle)";
    return `var(--s${(hashStr(c.name.toLowerCase()) % 8) + 1})`;
  }
  const catSvg = (key) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CAT_ICONS[key] || CAT_ICONS.tag}</svg>`;
  // tinted circle with the category's icon in its color (the one category mark in the app)
  const catMark = (c, sm) => `<span class="cm${sm ? " sm" : ""}" style="--c:${catColor(c)}" aria-hidden="true">${catSvg(catIconKey(c))}</span>`;
  const catLabel = (c) => `<span class="cl">${catMark(c, true)}<span>${esc(c ? c.name : "Uncategorized")}</span></span>`;
  const avatar = (name, cat) => (cat && typeof cat === "object") ? catMark(cat)
    : `<span class="av" aria-hidden="true">${esc((String(name || "?").trim().charAt(0) || "?").toUpperCase())}</span>`;

  // ---- wording
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + "s")}`;
  // signed change, colored in both directions (green good, red bad)
  const signed = (n, goodWhenUp = true) => {
    if (Math.abs(n) < 0.005) return `<b>${money(0)}</b>`;
    const good = goodWhenUp ? n > 0 : n < 0;
    return `<b class="${good ? "pos" : "negc"}">${n > 0 ? "+" : "−"}${money(Math.abs(n))}</b>`;
  };
  const cap = (t) => String(t || "").charAt(0).toUpperCase() + String(t || "").slice(1);
  // "USAA CLASSIC CHECKING (9166)" -> "USAA Classic Checking ··9166"
  function acctLabel(a) {
    if (!a) return "";
    let n = String(a.name || "").trim();
    let tail = "";
    const m = /\s*[(\[]?(?:x|\*|#|\.\.\.?)?(\d{4})[)\]]?\s*$/i.exec(n);
    if (m && n.length > m[0].length) { tail = " ··" + m[1]; n = n.slice(0, m.index).trim(); }
    if (n && n === n.toUpperCase()) n = n.toLowerCase().split(/\s+/).map((w, i) => (w.length <= 3 || (i === 0 && w.length <= 4)) ? w.toUpperCase() : cap(w)).join(" ");
    return n + tail;
  }
  function ago(s) {
    if (!s) return "";
    const t = new Date(String(s).replace(" ", "T")).getTime();
    const sec = Math.max(0, (Date.now() - t) / 1000);
    if (sec < 60) return "just now";
    if (sec < 3600) return plural(Math.floor(sec / 60), "minute") + " ago";
    if (sec < 86400) return plural(Math.floor(sec / 3600), "hour") + " ago";
    if (sec < 86400 * 30) return plural(Math.floor(sec / 86400), "day") + " ago";
    return new Date(t).toLocaleDateString();
  }
  const FREQ = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };
  const RKIND = { subscription: "Subscriptions", bill: "Bills & utilities", income: "Income" };
  const GROUPS = [["checking", "Checking"], ["credit", "Credit cards"], ["savings", "Savings"], ["investment", "Investments"], ["loan", "Loans"], ["cash", "Cash"], ["other", "Other"]];
  const dueText = (n) => (n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);
  function barClass(pct) { return pct == null ? "" : pct > 100 ? "bad" : pct >= 85 ? "warn" : ""; }

  function txLine(t) {
    const c = catById(t.category);
    const acc = accById(t.account);
    return `<div class="tx-line click" data-id="${t.id}">
      ${avatar(t.payee || t.description, c)}
      <div class="grow"><div class="t-name">${esc(t.payee || t.description || "Transaction")}${t.pending ? ' <span class="pill">pending</span>' : ""}${t.exclude ? ' <span class="pill">excluded</span>' : ""}</div>
        <div class="small muted">${esc(c ? c.name : "Uncategorized")}${acc && state.accounts.length > 1 ? " · " + esc(acctLabel(acc)) : ""}</div></div>
      <div class="right"><div class="num ${t.amount > 0 ? "pos" : ""}">${t.amount > 0 ? "+" : ""}${money(t.amount)}</div><div class="small muted">${prettyDate(t.date)}</div></div>
    </div>`;
  }

  // ------------------------------------------------------------------ dashboard
  async function renderDashboard(view) {
    const b = monthBounds(state.month);
    const [d, rec, nw, recent, goals] = await Promise.all([
      api("/api/budget/insights", { query: { month: state.month } }),
      api("/api/budget/recurring", { query: { month: state.month } }),
      api("/api/budget/networth", { query: { days: 30 } }),
      pb.collection("transactions").getList(1, 7, { sort: "-date,-created", filter: pb.filter("date < {:e}", { e: b.end }) }),
      api("/api/budget/goals").then((x) => x.goals.filter((g) => g.status !== "done").slice(0, 4)),
      loadCategories(), loadAccounts(),
    ]);
    const today = d.daily.today;
    const cur = d.daily.current, prev = d.daily.previous;
    const curNow = today ? cur[today - 1] : 0;
    const prevSame = today ? prev[Math.min(today, prev.length) - 1] || 0 : 0;
    const diff = curNow - prevSame;
    const prevTotal = prev[prev.length - 1] || 0;
    const compare = !prevTotal && !curNow ? "No spending yet."
      : d.is_current ? (Math.abs(diff) < 1 ? "About the same as last month at this point" : diff < 0 ? `<b class="pos">${money(-diff)} less</b> than last month at this point` : `<b class="negc">${money(diff)} more</b> than last month at this point`)
        : `Last month: ${money(prevTotal)}`;
    const n = Math.max(cur.length, prev.length);
    const prevKey = shiftMonth(state.month, -1);
    // scale to this month and the budget, not to last month's spike
    const curMax = Math.max(0, ...cur.slice(0, today || cur.length));
    const prevMax = Math.max(0, ...prev);
    const target = d.budgeted > 0 ? d.budgeted : 0;
    const capAt = Math.max(curMax * 1.25, target * 1.1, prevSame * 1.25, 1);
    const yMax = prevMax > capAt ? capAt : null;
    const chart = lineChart({
      n, ariaLabel: "Cumulative spending this month vs last month", yMax,
      refs: target ? [{ v: target, label: `Budget ${compact(target)}` }] : [],
      series: [
        { values: prev.concat(Array(n - prev.length).fill(null)), color: "var(--muted)", dashed: true },
        { values: cur.map((v, i) => (i < today ? v : null)), color: "var(--s1)", area: true, endDot: true },
      ],
      xLabel: (i) => dayLabel(state.month, i + 1),
      tipFor: (i) => `<b>${esc(dayLabel(state.month, i + 1))}</b><br>This month: ${i < today ? money(cur[i]) : "—"}<br><span class="muted">${esc(dayLabel(prevKey, Math.min(i + 1, prev.length)))}: ${prev[i] != null ? money(prev[i]) : "—"}</span>`,
    });

    const left = d.budget_left;
    const usedPct = d.budgeted > 0 ? Math.min(100, (d.spent / d.budgeted) * 100) : 0;
    const bills = rec.upcoming.filter((u) => u.kind !== "income" && u.days_until <= 14);
    const billsTotal = bills.reduce((s, u) => s + u.amount, 0);
    const spendCats = d.categories.filter((c) => c.kind !== "income" && c.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 5);
    const topMax = Math.max(1, ...spendCats.map((c) => Math.max(c.spent, c.budget)));

    const groups = GROUPS.filter(([k]) => nw.groups[k]).map(([k, label]) => {
      const g = nw.groups[k];
      return `<details class="acct-g"><summary><span>${label}</span><span class="num ${g.total < 0 ? "" : ""}">${money(g.total)}</span></summary>
        ${g.accounts.map((a) => `<div class="acct-row"><span>${esc(a.name)}${a.institution ? ` <span class="muted small">${esc(a.institution)}</span>` : ""}</span><span class="num">${money(a.value)}</span></div>`).join("")}</details>`;
    }).join("");

    view.innerHTML = `
      <div class="stack">${installBanner()}
        <div class="grid dash-top">
          <div class="card hero">
            <div class="card-h"><div><div class="label">Spent ${d.is_current ? "this month" : "in " + esc(monthLabel(state.month))}</div>
              <div class="big num">${money(d.spent)}</div><div class="small muted">${compare}</div></div>
              <div class="spacer"></div>
              <div class="legend"><span style="--c:var(--s1)">This month</span><span class="dash" style="--c:var(--muted)">Last month${yMax != null ? ` (${esc(compact(prevTotal))} total)` : ""}</span></div></div>
            ${chart}
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-h"><h2>Left to spend</h2><div class="spacer"></div><a href="#/budget" class="small">Budget →</a></div>
              ${d.budgeted > 0 ? `
                <div class="big num" style="color:${left < 0 ? "var(--bad-text)" : "var(--text)"}">${money(left)}</div>
                <div class="bar ${barClass(Math.round((d.spent / d.budgeted) * 100))}" style="margin:10px 0 6px"><i style="width:${usedPct}%"></i></div>
                <div class="row small muted"><span>${money(d.spent)} of ${money(d.budgeted)}</span><div class="spacer"></div>${d.is_current && d.remaining_days ? `<span>${money(d.safe_per_day)}/day · ${d.remaining_days} days left</span>` : ""}</div>`
              : `<p class="muted" style="margin:0 0 10px">Set a monthly budget to see what's left to spend.</p><a class="btn primary sm" href="#/budget">Create a budget</a>`}
            </div>
            <div class="card">
              <div class="card-h"><h2>Upcoming</h2><div class="spacer"></div><span class="small muted">next 14 days · ${money(billsTotal)}</span></div>
              ${bills.length ? bills.slice(0, 5).map((u) => `<a class="bill-line" href="#/recurring">${avatar(u.name)}<div class="grow"><div class="t-name">${esc(u.name)}</div><div class="small muted">${dueText(u.days_until)} · ${prettyDate(u.date)}</div></div><div class="num">${money(u.amount)}</div></a>`).join("")
                : `<div class="muted small">No bills due in the next two weeks.${rec.items.length ? "" : ` Recurring charges are detected from your history; <a href="#/recurring">add one</a>.`}</div>`}
            </div>
          </div>
        </div>

        <div class="grid two">
          <div class="card">
            <div class="card-h"><h2>Recent transactions</h2><div class="spacer"></div><a href="#/transactions" class="small">See all →</a></div>
            ${recent.items.length ? recent.items.map(txLine).join("") : `<div class="empty">No transactions yet. <a href="#/accounts">Connect a bank</a> or import a CSV.</div>`}
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-h"><h2>Net worth</h2><div class="spacer"></div><a href="#/networth" class="small">Details →</a></div>
              <div class="big num">${money(nw.net)}</div>
              <div class="small muted">${nw.change === 0 ? "No change" : signed(nw.change)} over the last 30 days</div>
              <div class="accts">${groups || `<div class="muted small" style="margin-top:10px">No accounts yet.</div>`}</div>
            </div>
            <div class="card">
              <div class="card-h"><h2>Top categories</h2><div class="spacer"></div><a href="#/spending" class="small">Spending →</a></div>
              ${spendCats.length ? spendCats.map((c) => `<div class="cat-row"><div>${catLabel(c)}</div><div class="num">${money(c.spent)}${c.budget ? ` <span class="muted">/ ${money(c.budget)}</span>` : ""}</div>
                <div class="bar ${c.budget ? barClass(c.pct) : ""}"><i style="width:${(c.spent / topMax) * 100}%"></i></div></div>`).join("") : `<div class="muted small">No spending yet this month.</div>`}
              ${d.uncategorized.count ? `<div class="row small" style="margin-top:12px"><span class="muted">${plural(d.uncategorized.count, "transaction")} (${money(d.uncategorized.amount)}) need a category</span><div class="spacer"></div><a class="btn sm" href="#/transactions?uncat=1">Categorize</a></div>` : ""}
            </div>
          </div>
        </div>

        ${d.tips.length ? `<div class="card"><div class="card-h"><h2>Insights</h2></div><ul class="tips">${d.tips.map((t) => `<li class="${t.level}">${esc(t.text)}</li>`).join("")}</ul></div>` : ""}
        ${goals.length ? `<div class="card"><div class="card-h"><h2>Goals</h2><div class="spacer"></div><a href="#/goals" class="small">All goals →</a></div>
          <div class="grid goals-grid">${goals.map(goalCard).join("")}</div></div>` : ""}
      </div>`;
    const byId = Object.fromEntries(recent.items.map((t) => [t.id, t]));
    $$(".tx-line", view).forEach((el) => (el.onclick = () => editTx(byId[el.dataset.id])));
    bindGoalCards(view);
    bindInstallBanner(view);
  }

  // ------------------------------------------------------------------ spending
  async function renderSpending(view) {
    const [s] = await Promise.all([api("/api/budget/spending", { query: { month: state.month } }), loadCategories()]);
    const top = s.categories.slice(0, 7);
    const rest = s.categories.slice(7);
    // colors follow the category, never its rank, so they match the Budget page
    const items = top.map((c) => ({ label: c.name, value: c.total, color: catColor(c.id ? c : null), cat: c.id ? c : null, id: c.id }));
    if (rest.length) items.push({ label: `Other (${rest.length})`, value: rest.reduce((a, c) => a + c.total, 0), color: "var(--subtle)", cat: { name: "Everything else" }, id: null });
    // pace: this month so far vs earlier months up to the same day, not vs whole months
    const paced = s.is_current && s.average_to_date > 0;
    const base = paced ? s.average_to_date : s.average;
    const vsAvg = base ? s.total - base : 0;
    const uncat = s.categories.find((c) => !c.id);
    const merchMax = Math.max(1, ...s.merchants.map((m) => m.total));

    view.innerHTML = `
      <div class="stack">
        <div class="grid kpis">
          <div class="card kpi"><div class="label">Spent</div><div class="value num">${money(s.total)}</div><div class="sub">${plural(s.transactions, "purchase")}</div></div>
          <div class="card kpi"><div class="label">${paced ? "vs usual at this point" : `vs ${s.months_compared || 5}-month average`}</div><div class="value num">${base ? money(Math.abs(vsAvg)) + `<span class="${vsAvg > 0 ? "negc" : "pos"}" style="font-size:14px;font-weight:600"> ${vsAvg > 0 ? "more" : "less"}</span>` : "—"}</div><div class="sub">${paced ? `Usually ${money(base)} by day ${s.day} · ${money(s.average)} a full month` : `Average ${money(s.average)} a month`}</div></div>
          <div class="card kpi"><div class="label">Income</div><div class="value num pos">${money(s.income)}</div><div class="sub">${s.income ? `Spent ${Math.round((s.total / s.income) * 100)}% of income` : "No income this month"}</div></div>
        </div>
        <div class="grid two">
          <div class="card">
            <div class="card-h"><h2>By category</h2>${uncat ? `<div class="spacer"></div><span class="small muted">${money(uncat.total)} uncategorized</span><a class="btn sm" href="#/transactions?uncat=1">Categorize</a>` : ""}</div>
            ${s.categories.length ? `<div class="donut-wrap">${donut(items, s.total, "spent")}
              <div class="d-legend">${items.map((it) => `<button class="d-item" ${it.id != null ? `data-cat="${it.id}"` : "disabled"}>${catMark(it.cat, true)}<span class="grow">${esc(it.label)}</span><span class="num">${money(it.value)}</span><span class="num muted small">${s.total ? Math.round((it.value / s.total) * 100) : 0}%</span></button>`).join("")}</div></div>`
              : `<div class="empty">No spending in ${esc(monthLabel(state.month))}.</div>`}
          </div>
          <div class="card">
            <div class="card-h"><h2>Top merchants</h2></div>
            ${s.merchants.length ? s.merchants.slice(0, 10).map((m) => `<div class="cat-row"><div class="desc">${esc(m.name)} <span class="muted small">×${m.count}</span></div><div class="num">${money(m.total)}</div><div class="bar"><i style="width:${(m.total / merchMax) * 100}%"></i></div></div>`).join("") : `<div class="muted small">Nothing yet.</div>`}
          </div>
        </div>
        <div class="card"><div class="card-h"><h2>Last 6 months</h2></div>${monthBars(s.trend, s.average, state.month)}</div>
      </div>`;
    $$(".d-item[data-cat]", view).forEach((b) => (b.onclick = () => { txState.category = b.dataset.cat || "__none"; txState.page = 1; location.hash = "#/transactions"; }));
  }

  // ------------------------------------------------------------------ recurring
  const recState = { tab: "upcoming" };

  // Compact month view: a dot per bill or paycheck, details on hover. The list beside it does the real work.
  function billCalendar(month, calendar, today) {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    const byDay = {};
    for (const c of calendar) (byDay[+c.date.slice(8, 10)] = byDay[+c.date.slice(8, 10)] || []).push(c);
    let cells = "";
    for (let i = 0; i < first; i++) cells += `<div class="cal-c empty-c"></div>`;
    for (let d = 1; d <= days; d++) {
      const list = byDay[d] || [];
      const key = `${month}-${pad(d)}`;
      const tip = list.length ? `<b>${esc(dayLabel(month, d))}</b>` + list.map((c) => `<br>${c.paid ? "✓ " : ""}${esc(c.name)}: ${c.kind === "income" ? "+" : ""}${money(c.amount)}`).join("") : "";
      cells += `<div class="cal-c ${key === today ? "today" : ""} ${list.length ? "has" : ""}" ${tip ? tipAttr(tip) : ""}>
        <span class="cal-d">${d}</span>
        ${list.length ? `<span class="cal-dots">${list.slice(0, 3).map((c) => `<i class="${c.kind === "income" ? "inc" : ""} ${c.paid || c.lapsed ? "paid" : ""}"></i>`).join("")}</span>` : ""}
      </div>`;
    }
    const wd = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
    return `<div class="cal">${wd.map((w) => `<div class="cal-h">${esc(w)}</div>`).join("")}${cells}</div>`;
  }

  // a subscription that skipped a charge, or was cancelled automatically after skipping two
  const lapsePill = (it) => it.possibly_cancelled
    ? `<span class="pill warn-p" ${tipAttr(`No charge since it was due ${esc(prettyDate(it.missed_date))}. If the next one doesn't come either, Keel marks it cancelled.`)}>possibly cancelled</span>`
    : it.status === "cancelled" && it.auto_cancelled ? `<span class="pill" ${tipAttr("Missed two charges in a row, so Keel marked it cancelled. It comes back on its own if it charges again.")}>auto-cancelled</span>` : "";

  function recRow(it) {
    const c = catById(it.category);
    const sub = it.possibly_cancelled
      ? `${FREQ[it.frequency]} · expected ${prettyDate(it.missed_date)}, no charge yet`
      : it.status === "active"
        ? `${FREQ[it.frequency]}${it.next_due ? ` · next ${prettyDate(it.next_due)} (${dueText(it.days_until).toLowerCase()})` : ""}`
        : `${it.status === "cancelled" ? (it.auto_cancelled ? "Cancelled automatically" : "Cancelled") : "Not recurring"}${it.last_date ? ` · last ${prettyDate(it.last_date)}` : ""}`;
    return `<div class="tx-line click rec" data-id="${it.id}">${avatar(it.name, c)}
      <div class="grow"><div class="t-name">${esc(it.name)}${it.source === "auto" && !it.edited && it.status === "active" && !it.possibly_cancelled ? ' <span class="pill">detected</span>' : ""} ${lapsePill(it)}</div><div class="small muted">${sub}</div></div>
      <div class="right"><div class="num ${it.kind === "income" ? "pos" : ""}">${it.kind === "income" ? "+" : ""}${money(it.amount)}</div>${it.frequency !== "monthly" ? `<div class="small muted">${money(it.monthly)}/mo</div>` : ""}</div></div>`;
  }

  async function renderRecurring(view) {
    const tab = recState.tab;
    const [r, subs] = await Promise.all([
      api("/api/budget/recurring", { query: { month: state.month } }),
      tab === "subscriptions" ? api("/api/budget/subscriptions") : null,
      loadCategories(), loadAccounts(),
    ]);
    const active = r.items.filter((x) => x.status === "active");
    const inactive = r.items.filter((x) => x.status !== "active");
    const t = r.totals;
    const count = (k) => active.filter((x) => x.kind === k).length;
    const section = (kind) => {
      const list = active.filter((x) => x.kind === kind).sort((a, b) => b.monthly - a.monthly);
      if (!list.length) return "";
      const sum = list.reduce((acc, x) => acc + x.monthly, 0);
      return `<div class="kind-h row"><span>${RKIND[kind]}</span><div class="spacer"></div><span class="num">${money(sum)}/mo</span></div>${list.map(recRow).join("")}`;
    };
    const per = `<span class="muted" style="font-size:14px">/mo</span>`;
    const incomeValue = t.income ? `<span class="pos">${money(t.income)}</span>${per}` : t.income_estimate ? `≈ ${money(t.income_estimate)}${per}` : `<span class="muted">None found</span>`;
    const incomeSub = t.income ? plural(count("income"), "paycheck or deposit", "paychecks & deposits")
      : t.income_estimate ? "Estimated from recent deposits; no regular paycheck detected yet"
        : `Add your paycheck so Keel can plan around it`;
    const upcoming = r.upcoming.slice(0, 12);
    const isNow = state.month === thisMonth();
    const tabs = [["upcoming", "Upcoming"], ["bill", `Bills · ${count("bill")}`], ["subscriptions", `Subscriptions · ${count("subscription")}`], ["income", "Income"],
      ["inactive", `Cancelled &amp; ignored${inactive.length ? ` · ${inactive.length}` : ""}`]];
    const emptyKind = { bill: "No bills found yet. Keel finds them after about three months of history, or add your own.", income: t.income_estimate ? `No regular paycheck detected yet. Your deposits average about ${money(t.income_estimate)} a month; add your paycheck to track it here.` : "No recurring income yet. Add your paycheck to track it." };
    view.innerHTML = `
      <div class="stack">
        <div class="grid kpis">
          <div class="card kpi"><div class="label">Recurring costs</div><div class="value num">${money(t.expenses)}${per}</div><div class="sub">${money(t.bills)} bills + ${money(t.subscriptions)} subscriptions</div></div>
          <div class="card kpi"><div class="label">Still due ${isNow ? "this month" : "in " + esc(monthLabel(state.month))}</div><div class="value num">${money(t.remaining_this_month)}</div><div class="sub">${money(t.paid_this_month)} paid so far</div></div>
          <div class="card kpi"><div class="label">Recurring income</div><div class="value num">${incomeValue}</div><div class="sub">${incomeSub}</div></div>
        </div>
        ${r.possibly_cancelled ? `<div class="callout small warn-c">${plural(r.possibly_cancelled, "subscription")} didn't charge when expected: ${r.items.filter((x) => x.possibly_cancelled).map((x) => `<b>${esc(x.name)}</b>`).join(", ")}. If you cancelled ${r.possibly_cancelled === 1 ? "it" : "them"}, Keel will mark ${r.possibly_cancelled === 1 ? "it" : "them"} cancelled after one more missed charge, or you can do it now.</div>` : ""}
        <div class="card">
          <div class="row" style="margin-bottom:14px">
            <div class="seg" role="tablist">
              ${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}
            </div>
            <div class="spacer"></div>
            <button class="btn" id="rec-scan" title="Look through your transactions for repeating charges">↻ Rescan</button>
            <button class="btn primary" id="rec-add">+ Add</button>
          </div>
          ${tab === "upcoming" ? `<div class="grid rec-up">
              <div><div class="kind-h">Next 30 days</div>${upcoming.length ? upcoming.map((u) => { const it = r.items.find((x) => x.id === u.id); return `<div class="tx-line click rec" data-id="${u.id}">${avatar(u.name, it && catById(it.category))}<div class="grow"><div class="t-name">${esc(u.name)}</div><div class="small muted">${dueText(u.days_until)} · ${prettyDate(u.date)} · ${u.kind === "income" ? "Income" : u.kind === "subscription" ? "Subscription" : "Bill"}</div></div><div class="num ${u.kind === "income" ? "pos" : ""}">${u.kind === "income" ? "+" : ""}${money(u.amount)}</div></div>`; }).join("") : `<div class="muted small">Nothing due in the next 30 days.</div>`}</div>
              <div class="cal-box"><div class="kind-h">${esc(monthLabel(state.month))}</div>${billCalendar(state.month, r.calendar, r.today)}<div class="legend"><span style="--c:var(--s1)">Bill or subscription</span><span style="--c:var(--good)">Income</span><span class="faded" style="--c:var(--subtle)">Paid</span></div></div>
            </div>`
            : tab === "bill" || tab === "income" ? (section(tab) || `<div class="empty">${emptyKind[tab]}</div>`)
            : tab === "subscriptions" ? `<div id="subs-box"></div>`
            : (inactive.length ? inactive.map(recRow).join("") : `<div class="empty">Nothing here. Items you cancel or mark as not recurring show up here.</div>`)}
        </div>
        <p class="small muted">Bills and subscriptions are both recurring charges and both count toward your spending budget. Subscriptions are services you can cancel; bills are everything else that repeats, like rent, utilities and insurance.</p>
      </div>`;
    $$("[data-tab]", view).forEach((b) => (b.onclick = () => { recState.tab = b.dataset.tab; route(); }));
    const byId = Object.fromEntries(r.items.map((x) => [x.id, x]));
    $$(".rec", view).forEach((el) => (el.onclick = () => editRecurring(byId[el.dataset.id])));
    $("#rec-add").onclick = () => editRecurring(null, tab === "subscriptions" ? { kind: "subscription" } : tab === "income" ? { kind: "income" } : undefined);
    $("#rec-scan").onclick = async (e) => {
      e.target.disabled = true;
      try { const x = await api("/api/budget/recurring/detect", { method: "POST" }); toast(x.found ? `Found ${plural(x.found, "new recurring item")}` : "No new recurring items found"); route(); } catch (err) { fail(err); e.target.disabled = false; }
    };
    if (subs) renderSubscriptions($("#subs-box", view), subs);
  }

  // What a recurring item has cost: totals, the last 12 months as bars, and every charge.
  function historyHtml(h, it) {
    const inc = it.kind === "income";
    const noun = inc ? "deposit" : "charge";
    if (!h.charges.length) {
      return `<div class="muted small">${it.merchant_key ? `No matching ${noun}s found in your transactions yet.` : `Added by hand, so there are no ${noun}s to match it with.`}</div>`;
    }
    const t = h.totals;
    const yr = new Date().getFullYear();
    const max = Math.max(1, ...h.months.map((x) => x.total));
    const stat = (label, v, sub) => `<div class="h-stat"><div class="label">${label}</div><div class="h-v num">${money(v)}</div>${sub ? `<div class="small muted">${sub}</div>` : ""}</div>`;
    const rows = h.charges.map((c, i) => {
      const older = h.charges[i + 1];
      const diff = older ? c.amount - older.amount : 0;
      const change = Math.abs(diff) >= 0.01 ? `<span class="small ${diff > 0 === !inc ? "negc" : "pos"}" ${tipAttr(`${diff > 0 ? "Up" : "Down"} from ${esc(money(older.amount))}`)}>${diff > 0 ? "▲" : "▼"} ${money(Math.abs(diff))}</span>` : "";
      return `<div class="h-row${i >= 12 ? " extra" : ""}"><span>${esc(prettyDate(c.date))} ${c.date.slice(0, 4)}</span><span class="spacer"></span>${change}<span class="num">${inc ? "+" : ""}${money(c.amount)}</span></div>`;
    }).join("");
    return `
      <div class="h-stats">
        ${stat(`This year (${yr})`, t.this_year)}
        ${stat("Last 12 months", t.last_12m)}
        ${stat("All time", t.all_time, `${plural(t.count, noun)} since ${esc(prettyDate(t.first_date))} ${t.first_date.slice(0, 4)}`)}
      </div>
      <div class="h-bars" role="img" aria-label="${inc ? "Received" : "Paid"} per month, last 12 months">${h.months.map((x) => `<div class="h-bar" ${tipAttr(`<b>${esc(monthLabel(x.month))}</b><br>${x.total ? money(x.total) : `No ${noun}`}`)}><i style="height:${Math.max(x.total ? 4 : 0, (x.total / max) * 100)}%"></i><span>${esc(shortMonth(x.month).charAt(0))}</span></div>`).join("")}</div>
      <div class="kind-h row"><span>${inc ? "Deposits" : "Charges"}</span><div class="spacer"></div><span class="small muted">Average ${money(t.average)}</span></div>
      <div class="h-list">${rows}</div>
      ${h.charges.length > 12 ? `<button type="button" class="btn sm" id="h-more" style="margin-top:8px">Show all ${h.charges.length}</button>` : ""}`;
  }

  const COMMON_SUBS = ["Netflix", "Spotify", "Hulu", "Disney+", "Max", "YouTube Premium", "Apple One", "iCloud+", "Amazon Prime", "Paramount+", "Peacock", "Audible", "Xbox Game Pass", "PlayStation Plus", "Nintendo Switch Online", "Adobe Creative Cloud", "Microsoft 365", "Google One", "Dropbox", "ChatGPT Plus", "Claude Pro", "GitHub", "1Password", "Duolingo", "Headspace", "Gym membership", "New York Times", "SiriusXM"];

  function editRecurring(it, defaults) {
    const isNew = !it;
    it = it || { name: "", amount: "", kind: "bill", frequency: "monthly", next_date: ymd(new Date()), category: "", status: "active", source: "manual", ...defaults };
    const sel = (name, map, v) => `<select name="${name}">${Object.keys(map).map((k) => `<option value="${k}" ${k === v ? "selected" : ""}>${map[k]}</option>`).join("")}</select>`;
    modal(isNew ? (it.kind === "subscription" ? "Add subscription" : "Add recurring") : it.name, `
      <form id="rec-form" class="stack">
        <div class="${isNew ? "" : "rec-cols"}">
        <div class="rec-fields stack">
        <label class="field"><span>Name</span><input name="name" required value="${esc(it.name)}" list="common-subs" placeholder="e.g. Netflix, Rent, Electric"></label>
        <datalist id="common-subs">${COMMON_SUBS.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <div class="form-grid">
          <label class="field"><span>Amount</span><input name="amount" type="number" min="0" step="0.01" required value="${it.amount}"></label>
          <label class="field"><span>Type</span>${sel("kind", { subscription: "Subscription", bill: "Bill", income: "Income" }, it.kind)}</label>
        </div>
        <div class="form-grid">
          <label class="field"><span>How often</span>${sel("frequency", FREQ, it.frequency)}</label>
          <label class="field"><span>Next due</span><input name="next_date" type="date" value="${dateOnly(it.next_due || it.next_date)}"></label>
        </div>
        <label class="field"><span>Category</span><select name="category">${categoryOptions(it.category, { noneLabel: "None" })}</select></label>
        </div>
        ${!isNew ? `<section id="rec-hist" class="rec-hist" aria-live="polite"><div class="muted small"><span class="loading-dots">Loading history</span></div></section>` : ""}
        </div>
        <div class="actions">
          ${!isNew ? (it.status === "active"
            ? `<button type="button" class="btn" id="r-cancel" title="You stopped this; keep it for reference">Mark cancelled</button><button type="button" class="btn" id="r-ignore" title="This isn't actually recurring">Not recurring</button>`
            : `<button type="button" class="btn" id="r-active">Track again</button>`) + (it.source === "manual" ? `<button type="button" class="btn danger" id="r-del">Delete</button>` : "") + `<div class="spacer"></div>` : ""}
          <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>
        </div>
      </form>`, {
      onMount: (m, close) => {
        const form = $("#rec-form", m);
        if (!isNew) {
          m.classList.add("wide");
          api(`/api/budget/recurring/${it.id}/history`).then((h) => {
            const box = $("#rec-hist", m); if (!box) return;
            box.innerHTML = historyHtml(h, it);
            const more = $("#h-more", box);
            if (more) more.onclick = () => { $$(".h-row.extra", box).forEach((x) => x.classList.remove("extra")); more.hidden = true; };
          }).catch(() => { const box = $("#rec-hist", m); if (box) box.innerHTML = `<div class="muted small">Couldn't load the charge history.</div>`; });
        }
        const save = async (extra) => {
          const fd = Object.fromEntries(new FormData(form));
          const data = { name: fd.name.trim(), amount: Math.abs(Number(fd.amount) || 0), kind: fd.kind, frequency: fd.frequency, category: fd.category, next_date: fd.next_date ? fd.next_date + " 12:00:00.000Z" : "", ...extra };
          try {
            if (isNew) await pb.collection("recurring").create({ ...data, user: pb.authStore.record.id, status: "active", merchant_key: it.merchant_key || "", account: it.account || "", last_date: it.last_date ? it.last_date + " 12:00:00.000Z" : "", last_amount: it.last_date ? it.amount : 0 });
            else await pb.collection("recurring").update(it.id, data);
            close(); route();
          } catch (err) { fail(err); }
        };
        form.onsubmit = (e) => { e.preventDefault(); save({}); };
        const on = (id, fn) => { const b = $(id, m); if (b) b.onclick = fn; };
        on("#r-cancel", () => save({ status: "cancelled", auto_cancelled: false }));
        on("#r-ignore", () => save({ status: "ignored" }));
        on("#r-active", () => {
          const nd = $("[name=next_date]", form).value;
          const today = ymd(new Date());
          save({ status: "active", auto_cancelled: false, next_date: (nd && nd > today ? nd : today) + " 12:00:00.000Z" });
        });
        on("#r-del", async () => { close(); if (await confirmBox(`Delete “${it.name}”?`)) { try { await pb.collection("recurring").delete(it.id); route(); } catch (err) { fail(err); } } });
      },
    });
  }

  // ------------------------------------------------------------------ subscriptions
  const subState = { view: "monthly" };
  const CYCLE = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
  const PER = { weekly: "wk", biweekly: "2 wks", monthly: "mo", quarterly: "qtr", yearly: "yr" };

  function renderSubscriptions(view, s) {
    const yr = subState.view === "yearly";
    const unit = yr ? "yr" : "mo";
    const cost = (x) => (yr ? x.yearly : x.monthly);
    const active = s.subscriptions.filter((x) => x.status === "active").sort((a, b) => b.monthly - a.monthly);
    const cancelled = s.subscriptions.filter((x) => x.status === "cancelled");
    const t = s.totals;
    const renewCell = (x) => {
      if (!x.next_renewal) return `<span class="muted small">—</span>`;
      const soon = x.days_until <= 7 || (x.frequency === "yearly" && x.days_until <= 30);
      return `<div>${prettyDate(x.next_renewal)}${x.frequency === "yearly" ? " " + x.next_renewal.slice(0, 4) : ""}</div><div class="small ${soon ? "" : "muted"}">${soon ? `<span class="pill warn-p">${esc(dueText(x.days_until))}</span>` : esc(dueText(x.days_until))}</div>`;
    };
    const row = (x) => {
      const c = catById(x.category);
      const pc = x.price_change;
      return `<tr class="click sub-row" data-id="${x.id}">
        <td><div class="row" style="flex-wrap:nowrap">${avatar(x.name, c)}<div class="grow"><div class="t-name">${esc(x.name)} ${lapsePill(x)}</div>
          ${pc ? `<span class="pill ${pc.to > pc.from ? "err" : "ok"}" title="Changed on ${esc(prettyDate(pc.date))}">${pc.to > pc.from ? "▲" : "▼"}<span class="hide-sm"> price ${pc.to > pc.from ? "up" : "down"}</span> ${money(pc.from)} → ${money(pc.to)}</span>` : `<span class="small muted">${x.charges ? `${x.charges} charge${x.charges === 1 ? "" : "s"} found` : "added manually"}</span>`}</div></div></td>
        <td class="hide-sm"><span class="pill">${CYCLE[x.frequency]}</span></td>
        <td class="hide-sm">${renewCell(x)}</td>
        <td class="right num">${money(x.amount)}<span class="muted small">/${PER[x.frequency]}</span></td>
        <td class="right num"><b>${money(cost(x))}</b><span class="muted small">/${unit}</span></td>
      </tr>`;
    };

    view.innerHTML = `
      <div class="stack">
        <div class="row sub-sum">
          <div><div class="label">Subscriptions cost</div><div class="big num">${money(yr ? t.yearly : t.monthly)}<span class="muted" style="font-size:15px">/${unit}</span></div>
            <div class="small muted">${plural(t.count, "active subscription")} · ${yr ? money(t.monthly) + " a month" : money(t.yearly) + " a year"}${t.renewing_30d ? ` · ${money(t.renewing_30d)} renewing in the next 30 days` : ""}${t.cancelled_savings_yearly ? ` · <span class="pos">saving ${money(t.cancelled_savings_yearly)}/yr</span> by cancelling` : ""}</div></div>
          <div class="spacer"></div>
          <div class="seg">${[["monthly", "Monthly"], ["yearly", "Yearly"]].map(([k, l]) => `<button data-v="${k}" class="${subState.view === k ? "on" : ""}">${l}</button>`).join("")}</div>
        </div>

        ${s.suggestions.length ? `<div class="sugg">
          <div class="card-h"><h3>Possible subscriptions found</h3><span class="pill">${s.suggestions.length}</span><div class="spacer"></div><span class="small muted">From your transactions, not tracked yet</span></div>
          ${s.suggestions.map((g, i) => `<div class="tx-line">${avatar(g.name)}<div class="grow"><div class="t-name">${esc(g.name)}</div>
              <div class="small muted">${money(g.amount)} · last charged ${prettyDate(g.last_date)} ${g.last_date.slice(0, 4)} · looks ${CYCLE[g.frequency].toLowerCase()}${g.charges > 1 ? ` · ${g.charges} charges` : ""}</div></div>
              <button class="btn sm" data-ignore="${i}">Not a subscription</button><button class="btn sm primary" data-track="${i}">Track</button></div>`).join("")}
        </div>` : ""}

        <div>
          ${active.length ? `<div class="table-wrap"><table>
              <thead><tr><th>Service</th><th class="hide-sm">Billing</th><th class="hide-sm">Next renewal</th><th class="right">Price</th><th class="right">Per ${yr ? "year" : "month"}</th></tr></thead>
              <tbody>${active.map(row).join("")}</tbody>
              <tfoot><tr><td colspan="3" class="hide-sm"><b>Total</b></td><td class="show-sm"><b>Total</b></td><td class="right num" colspan="2"><b>${money(yr ? t.yearly : t.monthly)}</b><span class="muted small">/${unit}</span></td></tr></tfoot>
            </table></div>`
            : `<div class="empty">No subscriptions tracked yet. ${s.suggestions.length ? "Track the ones found above, or add" : "Add"} your streaming, software and membership plans so you can see what they cost each month and year.</div>`}
        </div>

        ${cancelled.length ? `<div><div class="card-h"><h3>Cancelled</h3><div class="spacer"></div><span class="small muted">Saving ${money(t.cancelled_savings_yearly)} a year</span></div>
          <div class="table-wrap"><table><tbody>${cancelled.map((x) => `<tr class="click sub-row" data-id="${x.id}"><td><div class="row" style="flex-wrap:nowrap">${avatar(x.name)}<div class="grow"><div class="t-name">${esc(x.name)} ${lapsePill(x)}</div><div class="small muted">${CYCLE[x.frequency]} · ${money(x.amount)}${x.last_date ? ` · last charged ${prettyDate(x.last_date)}` : ""}</div></div></div></td><td class="right num pos">+${money(x.yearly)}<span class="muted small">/yr</span></td></tr>`).join("")}</tbody></table></div></div>` : ""}
        <p class="small muted">Keel can't cancel services for you. Cancel with the provider, then mark it cancelled here.</p>
      </div>`;

    $$("[data-v]", view).forEach((b) => (b.onclick = () => { subState.view = b.dataset.v; route(); }));
    const byId = Object.fromEntries(s.subscriptions.map((x) => [x.id, x]));
    $$(".sub-row", view).forEach((el) => (el.onclick = () => editRecurring(byId[el.dataset.id])));
    $$("[data-track]", view).forEach((b) => (b.onclick = () => {
      const g = s.suggestions[+b.dataset.track];
      editRecurring(null, { kind: "subscription", name: g.name, amount: g.amount, frequency: g.frequency, next_date: g.next_date, category: g.category, merchant_key: g.merchant_key, account: g.account, last_date: g.last_date });
    }));
    $$("[data-ignore]", view).forEach((b) => (b.onclick = async () => {
      const g = s.suggestions[+b.dataset.ignore];
      try {
        await pb.collection("recurring").create({ user: pb.authStore.record.id, name: g.name, merchant_key: g.merchant_key, amount: g.amount, kind: "subscription", frequency: g.frequency, status: "ignored" });
        toast(`Won't suggest ${g.name} again`); route();
      } catch (err) { fail(err); }
    }));
  }

  // ------------------------------------------------------------------ net worth
  const nwState = { days: 90 };
  async function renderNetWorth(view) {
    const nw = await api("/api/budget/networth", { query: { days: nwState.days } });
    const pts = nw.points;
    const est = pts.some((p) => p.estimated);
    // estimated history dashed, recorded balances solid (joined at the first recorded day)
    const firstReal = pts.findIndex((p) => !p.estimated);
    const nwSeries = est ? [
      { values: pts.map((p, i) => (p.estimated || i === firstReal ? p.net : null)), color: "var(--s1)", dashed: true, endDot: firstReal < 0 },
      { values: pts.map((p) => (p.estimated ? null : p.net)), color: "var(--s1)", endDot: true },
    ] : [{ values: pts.map((p) => p.net), color: "var(--s1)", area: false, endDot: true }];
    const chart = pts.length > 1 ? lineChart({
      n: pts.length, yMinZero: false, height: 240, ariaLabel: "Net worth over time",
      series: nwSeries,
      xLabel: (i) => prettyDate(pts[i].day),
      tipFor: (i) => `<b>${esc(prettyDate(pts[i].day))}</b><br>${money(pts[i].net)}${pts[i].estimated ? '<br><span class="muted">estimated</span>' : ""}`,
    }) : `<div class="empty">Not enough history yet.</div>`;
    const assetG = [], liabG = [];
    for (const [k, label] of GROUPS) {
      const g = nw.groups[k]; if (!g) continue;
      (k === "credit" || k === "loan" ? liabG : assetG).push({ label, g });
    }
    const list = (arr) => arr.length ? arr.map(({ label, g }) => `<div class="kind-h row"><span>${label}</span><div class="spacer"></div><span class="num">${money(Math.abs(g.total))}</span></div>
      ${g.accounts.map((a) => `<div class="acct-row"><span>${esc(acctLabel(a))}${a.institution ? ` <span class="muted small">${esc(a.institution)}</span>` : ""}</span><span class="num">${money(Math.abs(a.value))}</span></div>`).join("")}`).join("") : "";
    view.innerHTML = `
      <div class="stack">
        <div class="card hero">
          <div class="card-h"><div><div class="label">Net worth</div><div class="big num">${money(nw.net)}</div>
            <div class="small muted">${nw.change === 0 ? "No change" : signed(nw.change)} over the last ${nwState.days} days</div></div>
            <div class="spacer"></div>
            <div class="seg">${[[30, "1M"], [90, "3M"], [180, "6M"], [365, "1Y"]].map(([dd, l]) => `<button data-days="${dd}" class="${nwState.days === dd ? "on" : ""}">${l}</button>`).join("")}</div></div>
          ${chart}
          ${est ? `<div class="row" style="margin-top:8px"><div class="legend" style="margin:0"><span style="--c:var(--s1)">Recorded</span><span class="dash" style="--c:var(--s1)">Estimated</span></div><span class="small muted">Earlier points are estimated from your transactions. Keel records your balances daily from now on.</span></div>` : ""}
        </div>
        <div class="grid halves top">
          <div class="card"><div class="card-h"><h2>Assets</h2><div class="spacer"></div><span class="num">${money(nw.assets)}</span></div>${list(assetG) || `<div class="muted small">No accounts yet.</div>`}</div>
          ${liabG.length ? `<div class="card"><div class="card-h"><h2>Liabilities</h2><div class="spacer"></div><span class="num">${money(nw.liabilities)}</span></div>${list(liabG)}</div>`
            : `<div class="card slim"><div class="row"><h2>Liabilities</h2><div class="spacer"></div><span class="num">${money(0)}</span></div><div class="small muted">No credit cards or loans connected.</div></div>`}
        </div>
        <p class="small muted">Hide an account from net worth on the <a href="#/accounts">Accounts</a> page. Credit cards and loans count as debts.</p>
      </div>`;
    $$(".seg button", view).forEach((b) => (b.onclick = () => { nwState.days = +b.dataset.days; route(); }));
  }

  // ------------------------------------------------------------------ transactions
  const txState = { page: 1, q: "", account: "", category: "" };

  async function renderTransactions(view) {
    await Promise.all([loadCategories(), loadAccounts()]);
    if (/uncat=1/.test(location.hash)) { txState.category = "__none"; history.replaceState(null, "", "#/transactions"); }
    view.innerHTML = `
      <div class="card">
        <div class="row" style="margin-bottom:14px">
          <input id="tq" placeholder="Search description or payee…" value="${esc(txState.q)}" style="max-width:260px">
          <select id="tacc" class="inline">${accountOptions(txState.account, true)}</select>
          <select id="tcat" class="inline"><option value="">All categories</option><option value="__none" ${txState.category === "__none" ? "selected" : ""}>Uncategorized</option>${categoryOptions(txState.category, { includeNone: false })}</select>
          <div class="spacer"></div>
          <button class="btn" id="apply-rules" title="Run your rules on uncategorized transactions">Apply rules</button>
          <button class="btn primary" id="add-tx">+ Add</button>
        </div>
        <div id="tx-list"><div class="empty">Loading…</div></div>
      </div>`;
    let t;
    $("#tq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { txState.q = e.target.value; txState.page = 1; loadTx(); }, 250); };
    $("#tacc").onchange = (e) => { txState.account = e.target.value; txState.page = 1; loadTx(); };
    $("#tcat").onchange = (e) => { txState.category = e.target.value; txState.page = 1; loadTx(); };
    $("#add-tx").onclick = () => editTx(null);
    $("#apply-rules").onclick = async () => {
      try { const r = await api("/api/budget/apply-rules", { method: "POST" }); toast(`Categorized ${plural(r.updated, "transaction")}`); loadTx(); } catch (err) { fail(err); }
    };
    await loadTx();
  }

  async function loadTx() {
    const box = $("#tx-list"); if (!box) return;
    const b = monthBounds(state.month);
    const parts = ["date >= {:s} && date < {:e}"];
    const params = { s: b.start, e: b.end };
    if (txState.q) { parts.push("(description ~ {:q} || payee ~ {:q} || notes ~ {:q})"); params.q = txState.q; }
    if (txState.account) { parts.push("account = {:a}"); params.a = txState.account; }
    if (txState.category === "__none") parts.push("category = ''");
    else if (txState.category) { parts.push("category = {:c}"); params.c = txState.category; }
    const res = await pb.collection("transactions").getList(txState.page, 100, { filter: pb.filter(parts.join(" && "), params), sort: "-date,-created" });
    if (!res.items.length) {
      box.innerHTML = `<div class="empty">No transactions for ${esc(monthLabel(state.month))}${state.accounts.length ? "" : ` — <a href="#/accounts">connect a bank or import a CSV</a>`}.</div>`;
      return;
    }
    const total = res.items.reduce((s, t) => s + t.amount, 0);
    const days = [];
    for (const t of res.items) {
      const d = dateOnly(t.date);
      if (!days.length || days[days.length - 1].d !== d) days.push({ d, items: [] });
      days[days.length - 1].items.push(t);
    }
    const dayHead = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); };
    box.innerHTML = `
      ${days.map((g) => `<div class="day-h row"><span>${esc(dayHead(g.d))}</span><div class="spacer"></div><span class="num small">${money(g.items.reduce((s, t) => s + t.amount, 0))}</span></div>
        ${g.items.map(txLine).join("")}`).join("")}
      <div class="row" style="margin-top:12px">
        <span class="muted small">${plural(res.totalItems, "transaction")} · net ${money(total)} on this page</span>
        <div class="spacer"></div>
        ${res.page > 1 ? `<button class="btn sm" id="pprev">‹ Prev</button>` : ""}
        ${res.page < res.totalPages ? `<button class="btn sm" id="pnext">Next ›</button>` : ""}
      </div>`;
    const items = Object.fromEntries(res.items.map((t) => [t.id, t]));
    $$(".tx-line", box).forEach((el) => (el.onclick = () => editTx(items[el.dataset.id])));
    const pp = $("#pprev"); if (pp) pp.onclick = () => { txState.page--; loadTx(); };
    const pn = $("#pnext"); if (pn) pn.onclick = () => { txState.page++; loadTx(); };
  }

  function suggestPattern(tx) {
    return (tx.payee || tx.description || "").replace(/[#*]?\d{3,}.*$/, "").replace(/\s+/g, " ").trim().slice(0, 40).toLowerCase();
  }

  function offerRule(tx, categoryId) {
    const cat = catById(categoryId);
    const pattern = suggestPattern(tx);
    if (!pattern || !cat) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span>Got it. Keel will file “${esc(pattern)}” under ${esc(cat.name)} from now on.</span> <button class="btn sm" style="margin-left:8px">Make a rule</button>`;
    $("#toasts").appendChild(el);
    const timer = setTimeout(() => el.remove(), 7000);
    $("button", el).onclick = () => { clearTimeout(timer); el.remove(); createRuleDialog(pattern, categoryId); };
  }

  function createRuleDialog(pattern, categoryId) {
    modal("New categorization rule", `
      <form id="rule-form" class="stack">
        <label class="field"><span>When description or payee contains</span><input name="pattern" required value="${esc(pattern)}"></label>
        <label class="field"><span>Set category to</span><select name="category" required>${categoryOptions(categoryId, { includeNone: false })}</select></label>
        <label class="check"><input type="checkbox" name="apply" checked> Also apply to existing uncategorized transactions</label>
        <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save rule</button></div>
      </form>`, {
      onMount: (m, close) => {
        $("#rule-form", m).onsubmit = async (e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(e.target));
          try {
            await pb.collection("rules").create({ user: pb.authStore.record.id, pattern: fd.pattern.trim().toLowerCase(), category: fd.category });
            if (fd.apply) { const r = await api("/api/budget/apply-rules", { method: "POST" }); toast(`Rule saved · ${plural(r.updated, "transaction")} categorized`); }
            else toast("Rule saved");
            close();
            if (currentRoute() === "transactions") loadTx(); else route();
          } catch (err) { fail(err); }
        };
      },
    });
  }

  function editTx(tx) {
    const isNew = !tx;
    const manual = isNew || (tx.external_id || "").startsWith("csv:") || !tx.external_id;
    tx = tx || { date: ymd(new Date()), amount: "", account: state.accounts[0] && state.accounts[0].id, category: "" };
    if (isNew && !state.accounts.length) { toast("Add an account first (Accounts page).", true); return; }
    modal(isNew ? "Add transaction" : "Transaction", `
      <form id="tx-form" class="stack">
        <div class="form-grid">
          <label class="field"><span>Date</span><input type="date" name="date" value="${dateOnly(tx.date)}" ${manual ? "" : "disabled"} required></label>
          <label class="field"><span>Amount (negative = spending)</span><input type="number" step="0.01" name="amount" value="${tx.amount}" ${manual ? "" : "disabled"} required></label>
        </div>
        <label class="field"><span>Account</span><select name="account" ${isNew ? "" : "disabled"}>${accountOptions(tx.account)}</select></label>
        <label class="field"><span>Description</span><input name="description" value="${esc(tx.description)}" ${manual ? "" : "disabled"}></label>
        <label class="field"><span>Payee</span><input name="payee" value="${esc(tx.payee)}"></label>
        <label class="field"><span>Category</span><select name="category">${categoryOptions(tx.category)}</select></label>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(tx.notes)}</textarea></label>
        <label class="check"><input type="checkbox" name="exclude" ${tx.exclude ? "checked" : ""}> Exclude from budget and spending (reimbursements, one-off moves)</label>
        <div class="actions">
          ${!isNew ? `<button type="button" class="btn danger" id="del">Delete</button><button type="button" class="btn" id="mkrule">Make rule</button><div class="spacer"></div>` : ""}
          <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>
        </div>
      </form>`, {
      onMount: (m, close) => {
        const form = $("#tx-form", m);
        form.onsubmit = async (e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(form));
          const data = { payee: fd.payee, category: fd.category, notes: fd.notes, exclude: !!fd.exclude };
          if (manual) Object.assign(data, { date: fd.date + " 12:00:00.000Z", amount: Number(fd.amount), description: fd.description });
          try {
            if (isNew) await pb.collection("transactions").create({ ...data, user: pb.authStore.record.id, account: fd.account });
            else await pb.collection("transactions").update(tx.id, data);
            close(); toast("Changes saved");
            if (!isNew && fd.category && fd.category !== tx.category) offerRule(tx, fd.category);
            if (currentRoute() === "transactions") loadTx(); else route();
          } catch (err) { fail(err); }
        };
        const del = $("#del", m);
        if (del) del.onclick = async () => {
          close();
          if (!(await confirmBox("Delete this transaction? Bank-synced transactions may come back on the next sync."))) return;
          try { await pb.collection("transactions").delete(tx.id); toast("Deleted"); loadTx(); } catch (err) { fail(err); }
        };
        const mk = $("#mkrule", m);
        if (mk) mk.onclick = () => { const cat = $("[name=category]", form).value; close(); createRuleDialog(suggestPattern(tx), cat); };
      },
    });
  }

  // ------------------------------------------------------------------ budget
  // Rocket Money-style: one monthly spending budget. Categories you care about get their
  // own slice; everything without a slice shares "Everything else".
  function ring(pct, cls, big, sub) {
    const R = 64, C = 2 * Math.PI * R, p = Math.max(0, Math.min(100, pct));
    return `<svg class="ring ${cls}" viewBox="0 0 160 160" role="img" aria-label="${esc(sub)}">
      <circle r="${R}" cx="80" cy="80" fill="none" stroke="var(--track)" stroke-width="14"/>
      <circle r="${R}" cx="80" cy="80" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${(p / 100) * C} ${C}" transform="rotate(-90 80 80)"/>
      <text x="80" y="78" text-anchor="middle" class="d-big">${esc(big)}</text>
      <text x="80" y="98" text-anchor="middle" class="d-sub">${esc(sub)}</text></svg>`;
  }

  function budgetRow(c, d) {
    const over = c.remaining < 0;
    // a slice far below what you usually spend is a budget problem, not good news
    const tooLow = c.avg3 > 0 && c.available >= 0 && c.avg3 > Math.max(c.available * 1.5, c.available + 25);
    const pct = c.available > 0 ? Math.min(100, (c.spent / c.available) * 100) : (c.spent > 0 ? 100 : 0);
    const proj = d.is_current && c.available > 0 && c.projected > c.spent ? Math.min(100, (c.projected / c.available) * 100) : null;
    return `<div class="b-row click" data-id="${c.id || ""}">
      <div class="row"><span class="b-name">${catLabel(c)}</span>${c.rollover ? `<span class="pill" title="Unspent money carries over to next month">rollover</span>` : ""}
        <div class="spacer"></div><span class="num ${over ? "over" : ""}">${over ? money(-c.remaining) + " over" : money(c.remaining) + " left"}</span></div>
      <div class="bar ${barClass(c.available > 0 ? Math.round((c.spent / c.available) * 100) : null)}"><i style="width:${pct}%"></i>${proj != null && proj > pct ? `<b style="left:${proj}%" ${tipAttr(`On pace for <b>${esc(money(c.projected))}</b> by the end of the month`)}></b>` : ""}</div>
      <div class="small muted">${money(c.spent)} of ${money(c.available)}${c.carry ? ` · ${c.carry > 0 ? "+" : ""}${money(c.carry)} rolled over` : ""}${c.avg3 && !tooLow ? ` · usually ${money(c.avg3)}` : ""}</div>
      ${tooLow ? `<div class="small warn-t">You usually spend ${money(c.avg3)} here, so this budget may be too low.</div>` : ""}
    </div>`;
  }

  async function renderBudget(view) {
    const [d] = await Promise.all([api("/api/budget/insights", { query: { month: state.month } }), loadCategories()]);
    const spendCats = d.categories.filter((c) => c.kind !== "income");
    const budgeted = spendCats.filter((c) => c.budget > 0).sort((a, b) => b.available - a.available);
    const unbudgeted = spendCats.filter((c) => !(c.budget > 0));
    const ee = d.everything_else;
    const hasBudget = d.budgeted > 0;
    // bills are paid out of the spending budget, so only goals come off the top
    const available = d.expected_income - d.goals_monthly;
    const usedPct = hasBudget ? (d.spent / d.budgeted) * 100 : 0;
    const ringCls = usedPct > 100 ? "bad" : usedPct >= 85 ? "warn" : "good";
    const billsSorted = d.bill_list.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const today = ymd(new Date());
    const incomePct = d.expected_income > 0 ? Math.min(100, (d.income / d.expected_income) * 100) : 0;

    view.innerHTML = `
      <div class="stack">
        ${hasBudget ? `
        <div class="card b-hero">
          <div class="b-ring">${ring(d.budget_left < 0 ? 100 : 100 - usedPct, ringCls, money(Math.abs(d.budget_left)), d.budget_left < 0 ? "over budget" : "left to spend")}
            <div class="small muted center">${money(d.spent)} spent of ${money(d.budgeted)}</div>
            ${d.is_current && d.remaining_days && d.budget_left > 0 ? `<div class="small center"><b class="num">${money(d.safe_per_day)}</b>/day for ${d.remaining_days} more days</div>` : ""}
          </div>
          <div class="b-math">
            <div class="m-row"><span>Expected income <button class="btn link sm" id="edit-income">${d.income_override ? "edit" : "auto · edit"}</button></span><span class="num">${money(d.expected_income)}</span></div>
            ${d.goals_monthly ? `<div class="m-row"><span>Savings goals <a class="small" href="#/goals">view</a></span><span class="num">−${money(d.goals_monthly)}</span></div>` : ""}
            <div class="m-row total"><span>Available to budget</span><span class="num">${money(available)}</span></div>
            <div class="m-row"><span>Your spending budget <button class="btn link sm" id="edit-total">edit</button></span><span class="num">${money(d.budgeted)}</span></div>
            <div class="m-row small muted"><span>includes bills &amp; subscriptions <a href="#/recurring">view</a></span><span class="num">${money(d.bills.expenses)}</span></div>
            ${d.budgeted > available + 1 && d.expected_income > 0 ? `<div class="callout small warn-c">Your budget is ${money(d.budgeted - available)} more than your income${d.goals_monthly ? " after goals" : ""}.</div>`
              : d.expected_income > 0 && available - d.budgeted > 50 ? `<div class="callout small">${money(available - d.budgeted)} a month is left over after your budget. Put it toward savings or a goal.</div>` : ""}
          </div>
        </div>` : `
        <div class="card b-empty">
          <h2>Build your budget</h2>
          <p class="muted">Pick one monthly spending number, then give the categories you care about their own slice. Everything else shares what's left.
            ${d.avg_spend ? `You've spent about <b>${money(d.avg_spend)}</b> a month recently.` : ""}</p>
          <button class="btn primary" id="wizard">Create budget</button>
        </div>`}

        <div class="grid two">
          <div class="card">
            <div class="card-h"><h2>Spending</h2><div class="spacer"></div>
              ${hasBudget ? `<button class="btn sm" id="wizard">Re-plan</button>` : ""}<button class="btn sm primary" id="add-budget">+ Category budget</button></div>
            ${budgeted.length ? budgeted.map((c) => budgetRow(c, d)).join("") : `<div class="muted small" style="margin-bottom:12px">No category budgets yet. Add one for anything you want to watch closely, like Dining Out or Groceries.</div>`}
            ${hasBudget ? budgetRow({ id: "", name: "Everything else", available: ee.budget, spent: ee.spent, remaining: ee.remaining, carry: 0, avg3: ee.avg3, projected: 0 }, d) : ""}
            ${d.is_current && budgeted.some((c) => c.available > 0 && c.projected > c.spent) ? `<p class="small muted tick-note"><span class="tick-key" aria-hidden="true"></span>The tick on a bar marks where you're on pace to finish the month.</p>` : ""}
            ${unbudgeted.filter((c) => c.spent > 0).length ? `<details class="else-list"><summary class="small muted">What's in “Everything else”</summary>
              ${unbudgeted.filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent).map((c) => `<div class="acct-row"><span>${catLabel(c)}</span><span class="num">${money(c.spent)}</span></div>`).join("")}
              ${d.uncategorized.amount ? `<div class="acct-row"><span>${catLabel(null)} <a class="btn sm" href="#/transactions?uncat=1">Categorize</a></span><span class="num">${money(d.uncategorized.amount)}</span></div>` : ""}</details>` : ""}
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-h"><h2>Bills this month</h2><div class="spacer"></div><span class="small muted">${money(d.bills.paid_this_month)} paid · ${money(d.bills.remaining_this_month)} to go</span></div>
              ${billsSorted.length ? billsSorted.map((b) => {
                const status = b.paid ? `<span class="pill ok">✓ paid</span>` : b.date < today ? `<span class="pill err">not seen</span>` : `<span class="small muted">${dueText(Math.round((new Date(b.date) - new Date(today)) / 86400000))}</span>`;
                return `<div class="bill-line">${avatar(b.name)}<div class="grow"><div class="t-name">${esc(b.name)}</div><div class="small muted">${prettyDate(b.date)}</div></div><div class="right"><div class="num">${money(b.paid ? b.paid_amount : b.amount)}</div>${status}</div></div>`;
              }).join("") : `<div class="muted small">No bills tracked. <a href="#/recurring">Review recurring charges</a>.</div>`}
            </div>
            <div class="card">
              <div class="card-h"><h2>Income</h2><div class="spacer"></div><span class="num pos">${money(d.income)}</span></div>
              <div class="bar good"><i style="width:${incomePct}%"></i></div>
              <div class="small muted" style="margin-top:6px">${money(d.income)} of ${money(d.expected_income)} expected${d.income_override ? "" : " (based on recent months)"}</div>
            </div>
            <div class="card">
              <div class="card-h"><h2>50 / 30 / 20 check</h2></div>
              <div class="split">
                <i style="width:${Math.min(100, (d.split.needs / (d.expected_income || 1)) * 100)}%;background:var(--s1)"></i>
                <i style="width:${Math.min(100, (d.split.wants / (d.expected_income || 1)) * 100)}%;background:var(--s2)"></i>
                <i style="width:${Math.max(0, Math.min(100, (d.split.savings / (d.expected_income || 1)) * 100))}%;background:var(--s3)"></i>
              </div>
              <div class="legend">
                <span style="--c:var(--s1)">Needs ${d.split.needs_pct}% <em class="muted">(≤50%)</em></span>
                <span style="--c:var(--s2)">Wants ${d.split.wants_pct}% <em class="muted">(≤30%)</em></span>
                <span style="--c:var(--s3)">Left / saved ${d.split.savings_pct}% <em class="muted">(≥20%)</em></span>
              </div>
            </div>
          </div>
        </div>

        <details class="card manage"><summary><h2 style="display:inline">Manage categories</h2></summary>
          <div class="row" style="margin:12px 0"><p class="muted small" style="margin:0">Category type drives the 50/30/20 check. Transfers never count as spending.</p><div class="spacer"></div><button class="btn sm primary" id="add-cat">+ Category</button></div>
          <div class="table-wrap"><table><tbody>
            ${Object.keys(KINDS).map((k) => { const list = state.categories.filter((c) => c.kind === k && !c.archived); return list.length ? `<tr><td colspan="3" class="kind-h">${KINDS[k]}</td></tr>` + list.map((c) => `<tr><td>${catLabel(c)}</td><td class="right num muted">${c.budget ? money(c.budget) + "/mo" : ""}</td><td class="right"><button class="btn sm edit-cat" data-id="${c.id}">Edit</button></td></tr>`).join("") : ""; }).join("")}
          </tbody></table></div>
        </details>
      </div>`;

    const statsById = Object.fromEntries(d.categories.map((c) => [c.id, c]));
    $$(".b-row", view).forEach((el) => (el.onclick = () => (el.dataset.id ? editCategoryBudget(statsById[el.dataset.id]) : editTotal(d))));
    $$("#wizard", view).forEach((b) => (b.onclick = () => budgetWizard(d)));
    $("#add-budget").onclick = () => addCategoryBudget(d);
    const ei = $("#edit-income", view); if (ei) ei.onclick = () => editIncome(d);
    const et = $("#edit-total", view); if (et) et.onclick = () => editTotal(d);
    $$(".edit-cat", view).forEach((b) => (b.onclick = () => editCategory(catById(b.dataset.id))));
    $("#add-cat").onclick = () => editCategory(null);
  }

  async function saveMe(data) {
    const saved = await pb.collection("users").update(pb.authStore.record.id, data);
    pb.authStore.save(pb.authStore.token, saved);
  }

  function editIncome(d) {
    modal("Monthly income", `
      <form id="inc-form" class="stack">
        <p class="muted small" style="margin:0">Keel estimates income from recent deposits (${money(Math.max(d.income, 0))} so far this month). Set it yourself if your pay is irregular.</p>
        <label class="field"><span>Expected monthly income (0 = automatic)</span><input name="v" type="number" min="0" step="1" value="${d.income_override || 0}"></label>
        <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
      </form>`, {
      onMount: (m, close) => { $("#inc-form", m).onsubmit = async (e) => { e.preventDefault(); try { await saveMe({ income_override: Math.max(0, Number(new FormData(e.target).get("v")) || 0) }); close(); route(); } catch (err) { fail(err); } }; },
    });
  }

  function editTotal(d) {
    modal("Monthly spending budget", `
      <form id="tot-form" class="stack">
        <p class="muted small" style="margin:0">One number for everything you spend in a month, bills included. Category budgets (${money(d.category_budgeted)} now) come out of it; the rest is “Everything else”.</p>
        <label class="field"><span>Total per month</span><input name="v" type="number" min="0" step="any" value="${Math.round(d.budget_setting || d.budgeted)}"></label>
        ${d.avg_spend ? `<p class="small muted" style="margin:0">Recent average: ${money(d.avg_spend)}/month.</p>` : ""}
        <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
      </form>`, {
      onMount: (m, close) => { $("#tot-form", m).onsubmit = async (e) => { e.preventDefault(); try { await saveMe({ budget_total: Math.max(0, Number(new FormData(e.target).get("v")) || 0) }); close(); route(); } catch (err) { fail(err); } }; },
    });
  }

  function editCategoryBudget(c) {
    modal(c.name, `
      <form id="cb-form" class="stack">
        <label class="field"><span>Monthly budget</span><input name="budget" type="number" min="0" step="any" value="${c.budget || 0}"></label>
        ${c.suggested ? `<p class="small muted" style="margin:0">You've averaged ${money(c.avg3)}/month here. <button type="button" class="btn link sm" id="use-sugg">Use ${money(c.suggested)}</button></p>` : ""}
        <label class="check"><input type="checkbox" name="rollover" ${c.rollover ? "checked" : ""}> Roll over: unspent money (or overspending) carries into next month</label>
        <div class="actions">
          ${c.budget ? `<button type="button" class="btn danger" id="cb-remove">Remove budget</button><div class="spacer"></div>` : ""}
          <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>
        </div>
      </form>`, {
      onMount: (m, close) => {
        const form = $("#cb-form", m);
        const save = async (budget, rollover) => { try { await pb.collection("categories").update(c.id, { budget, rollover }); close(); route(); } catch (err) { fail(err); } };
        form.onsubmit = (e) => { e.preventDefault(); const fd = new FormData(form); save(Math.max(0, Number(fd.get("budget")) || 0), fd.has("rollover")); };
        const us = $("#use-sugg", m); if (us) us.onclick = () => { $("[name=budget]", form).value = c.suggested; };
        const rm = $("#cb-remove", m); if (rm) rm.onclick = () => save(0, false);
      },
    });
  }

  function addCategoryBudget(d) {
    const options = d.categories.filter((c) => c.kind !== "income" && !(c.budget > 0)).sort((a, b) => b.avg3 - a.avg3);
    if (!options.length) return toast("Every category already has a budget.");
    modal("Add a category budget", `<div class="pick">${options.map((c) => `<button class="pick-i" data-id="${c.id}">${catLabel(c)}<span class="spacer"></span><span class="small muted">${c.avg3 ? "avg " + money(c.avg3) : ""}</span></button>`).join("")}</div>
      <div class="actions"><button class="btn" data-close>Cancel</button></div>`, {
      onMount: (m, close) => { $$(".pick-i", m).forEach((b) => (b.onclick = () => { close(); const c = options.find((x) => x.id === b.dataset.id); editCategoryBudget({ ...c, budget: c.suggested || 0 }); })); },
    });
  }

  function budgetWizard(d) {
    const cats = d.categories.filter((c) => c.kind !== "income").sort((a, b) => (b.budget || b.avg3) - (a.budget || a.avg3));
    const autoInc = d.income_override ? d.income_override : d.expected_income;
    const suggestedTotal = Math.round((d.budget_setting || d.budgeted || d.avg_spend || Math.max(0, d.expected_income - d.goals_monthly)) / 10) * 10;
    modal("Create your budget", `
      <form id="wz" class="stack">
        <div class="wz-step"><div class="wz-n">1</div><div class="grow">
          <b>Monthly income</b>
          <p class="small muted">Based on your recent deposits. Change it if that's not right.</p>
          <input name="income" type="number" min="0" step="any" value="${Math.round(autoInc)}" style="max-width:180px">
        </div></div>
        <div class="wz-step"><div class="wz-n">2</div><div class="grow">
          <b>Bills &amp; subscriptions: ${money(d.bills.expenses)}/month</b>
          <p class="small muted">Found from your recurring charges and counted inside your spending budget. <a href="#/recurring" data-close>Review them</a> any time.</p>
        </div></div>
        <div class="wz-step"><div class="wz-n">3</div><div class="grow">
          <b>Total monthly spending budget</b>
          <p class="small muted">${d.avg_spend ? `You've spent about ${money(d.avg_spend)} a month lately. ` : ""}<span id="wz-left"></span></p>
          <input name="total" type="number" min="0" step="any" value="${suggestedTotal}" style="max-width:180px">
        </div></div>
        <div class="wz-step"><div class="wz-n">4</div><div class="grow">
          <b>Categories to watch</b>
          <p class="small muted">Tick the ones you want a separate limit for. Amounts start at your recent average. The rest go to “Everything else”.</p>
          <div class="wz-cats">${cats.map((c, i) => {
            const on = c.budget > 0 || (!d.category_budgeted && i < 5 && c.avg3 > 0 && (c.kind === "wants" || c.kind === "needs"));
            return `<label class="wz-cat"><input type="checkbox" data-id="${c.id}" ${on ? "checked" : ""}><span class="grow">${catLabel(c)}${c.avg3 ? ` <span class="small muted">avg ${money(c.avg3)}</span>` : ""}</span>
              <input type="number" min="0" step="any" class="wz-amt num" data-id="${c.id}" value="${c.budget || c.suggested || 0}"></label>`;
          }).join("")}</div>
          <p class="small" id="wz-sum"></p>
        </div></div>
        <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save budget</button></div>
      </form>`, {
      wide: true,
      onMount: (m, close) => {
        const form = $("#wz", m);
        const recalc = () => {
          const inc = Number(form.income.value) || 0, total = Number(form.total.value) || 0;
          const after = inc - d.goals_monthly;
          $("#wz-left", m).textContent = inc ? `This covers everything, bills included. Your income${d.goals_monthly ? " after goals" : ""} is ${money(after)}.` : "";
          let sum = 0;
          $$(".wz-cat", m).forEach((row) => { if ($("input[type=checkbox]", row).checked) sum += Number($(".wz-amt", row).value) || 0; });
          const el = $("#wz-sum", m);
          el.innerHTML = sum > total ? `<span style="color:var(--bad)">Category budgets add up to ${money(sum)}, more than the ${money(total)} total. The total will rise to match.</span>`
            : `${money(sum)} in categories · <b>${money(total - sum)}</b> for everything else`;
          if (inc && total > after) $("#wz-left", m).innerHTML += ` <b style="color:var(--bad)">This budget is ${esc(money(total - after))} more than that.</b>`;
        };
        $$("input", form).forEach((x) => (x.oninput = recalc));
        recalc();
        form.onsubmit = async (e) => {
          e.preventDefault();
          const btn = $("button.primary", form); btn.disabled = true;
          try {
            const inc = Math.max(0, Number(form.income.value) || 0);
            await saveMe({ budget_total: Math.max(0, Number(form.total.value) || 0), income_override: Math.round(inc) === Math.round(d.expected_income) && !d.income_override ? 0 : inc });
            for (const row of $$(".wz-cat", m)) {
              const id = $("input[type=checkbox]", row).dataset.id;
              const v = $("input[type=checkbox]", row).checked ? Math.max(0, Number($(".wz-amt", row).value) || 0) : 0;
              const c = catById(id);
              if (c && (c.budget || 0) !== v) await pb.collection("categories").update(id, { budget: v });
            }
            close(); toast("Budget saved"); route();
          } catch (err) { fail(err); btn.disabled = false; }
        };
      },
    });
  }

  function editCategory(cat) {
    const isNew = !cat;
    cat = cat || { name: "", kind: "wants", icon: "", budget: 0 };
    modal(isNew ? "New category" : "Edit category", `
      <form id="cat-form" class="stack">
        <label class="field"><span>Name</span><input name="name" required value="${esc(cat.name)}"></label>
        <div class="field"><span>Icon</span><div class="icon-pick" role="radiogroup" aria-label="Icon">${CAT_ICON_KEYS.map((k) => `<label title="${esc(k)}"><input type="radio" name="icon" value="${k}" ${k === catIconKey(cat.name ? cat : { name: "", icon: cat.icon }) ? "checked" : ""}><span>${catSvg(k)}</span></label>`).join("")}</div></div>
        <label class="field"><span>Type</span><select name="kind">${Object.keys(KINDS).map((k) => `<option value="${k}" ${k === cat.kind ? "selected" : ""}>${KINDS[k]}</option>`).join("")}</select></label>
        <label class="field"><span>Monthly budget</span><input name="budget" type="number" min="0" step="1" value="${cat.budget || 0}"></label>
        <div class="actions">
          ${!isNew ? `<button type="button" class="btn danger" id="arch">Archive</button><div class="spacer"></div>` : ""}
          <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>
        </div>
      </form>`, {
      onMount: (m, close) => {
        $("#cat-form", m).onsubmit = async (e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(e.target));
          const data = { name: fd.name.trim(), kind: fd.kind, icon: fd.icon, budget: Number(fd.budget) || 0 };
          try {
            if (isNew) await pb.collection("categories").create({ ...data, user: pb.authStore.record.id });
            else await pb.collection("categories").update(cat.id, data);
            close(); route();
          } catch (err) { fail(err); }
        };
        const a = $("#arch", m);
        if (a) a.onclick = async () => {
          try { await pb.collection("categories").update(cat.id, { archived: true }); close(); toast("Archived — existing transactions keep the category."); route(); } catch (err) { fail(err); }
        };
      },
    });
  }

  // ------------------------------------------------------------------ accounts
  async function renderAccounts(view) {
    const [conns] = await Promise.all([pb.collection("bank_connections").getFullList({ sort: "created" }), loadAccounts()]);
    const byConn = {};
    for (const a of state.accounts) (byConn[a.connection || ""] = byConn[a.connection || ""] || []).push(a);

    const moreMenu = (label, items) => `<details class="menu"><summary class="btn sm icon-btn" aria-label="${esc(label)}">${icon("more")}</summary><div class="menu-pop">${items}</div></details>`;
    const accRow = (a, connected) => `<tr data-id="${a.id}">
      <td><input class="inline acc-name" value="${esc(a.name)}" aria-label="Account name">${a.institution ? `<div class="small muted">${esc(a.institution)}</div>` : ""}</td>
      <td><select class="inline acc-type" aria-label="Account type">${ACCOUNT_TYPES.map((t) => `<option value="${t}" ${t === a.type ? "selected" : ""}>${cap(t)}</option>`).join("")}</select></td>
      <td class="right num">${a.connection ? money(a.balance) : `<input class="inline acc-bal num" type="number" step="0.01" value="${a.balance || 0}" aria-label="Balance" style="width:120px;text-align:right">`}</td>
      <td class="center"><input type="checkbox" class="acc-onb" aria-label="Count in budget" ${a.on_budget ? "checked" : ""}></td>
      <td class="center"><input type="checkbox" class="acc-hide" aria-label="Hide from net worth" ${a.hidden ? "checked" : ""}></td>
      ${connected ? `<td class="center"><input type="checkbox" class="acc-flip" aria-label="Invert amounts" ${a.flip_amounts ? "checked" : ""}></td>` : ""}
      <td class="right">${moreMenu(`More actions for ${a.name}`, `<button type="button" class="menu-i danger-t acc-del">Delete account…</button>`)}</td>
    </tr>`;
    const th = (label, tip) => `<th class="center"><span class="th-tip" ${tipAttr(esc(tip))}>${label}</span></th>`;
    const accTable = (list, connected) => list && list.length ? `<div class="table-wrap"><table class="acc-t"><thead><tr><th>Account</th><th>Type</th><th class="right">Balance</th>
      ${th("In budget", "Count this account's transactions in your budget and spending")}
      ${th("Hide from net worth", "Leave this account out of your net worth")}
      ${connected ? th("Invert amounts", "Turn on if this bank reports purchases as positive amounts. Applies from the next sync.") : ""}
      <th><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map((a) => accRow(a, connected)).join("")}</tbody></table></div>` : `<div class="muted small">No accounts.</div>`;

    view.innerHTML = `
      <div class="stack">
        <div class="card">
          <div class="card-h"><h2>Bank connections</h2><div class="spacer"></div>
            ${conns.length ? `<button class="btn" id="sync-all">↻ Sync now</button>` : ""}
            <button class="btn primary" id="connect">+ Connect bank</button></div>
          ${conns.length ? conns.map((c) => `
            <div class="callout" style="margin-bottom:12px">
              <div class="row"><b>${esc(c.name)}</b>
                <span class="pill ${c.status === "ok" ? "ok" : "err"}">${c.status === "ok" ? "Connected" : "Needs attention"}</span>
                <span class="small muted" title="${c.last_sync ? esc(new Date(c.last_sync.replace(" ", "T")).toLocaleString()) : ""}">${c.last_sync ? "Synced " + ago(c.last_sync) : "Never synced"}</span>
                <div class="spacer"></div>
                ${moreMenu("Connection options", `<button type="button" class="menu-i danger-t conn-del" data-id="${c.id}">Disconnect bank…</button>`)}</div>
              ${c.last_error ? `<div class="small" style="color:var(--${c.status === "ok" ? "muted" : "bad"});margin-top:6px">${esc(c.last_error)}</div>` : ""}
              <div style="margin-top:10px">${accTable(byConn[c.id], true)}</div>
            </div>`).join("") : `<div class="muted">Connect your bank through <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noopener">SimpleFIN Bridge</a> to sync balances and transactions automatically, or use manual accounts with CSV import below.</div>`}
        </div>

        <div class="card">
          <div class="card-h"><h2>Manual accounts</h2><div class="spacer"></div>
            <button class="btn" id="import-csv">Import CSV</button>
            <button class="btn primary" id="add-acc">+ Account</button></div>
          ${accTable(byConn[""], false)}
        </div>
      </div>`;

    const patch = async (id, data) => { try { await pb.collection("accounts").update(id, data); const a = accById(id); if (a) Object.assign(a, data); } catch (err) { fail(err); } };
    $$("tr[data-id]", view).forEach((tr) => {
      const id = tr.dataset.id;
      $(".acc-name", tr).onchange = (e) => patch(id, { name: e.target.value });
      $(".acc-type", tr).onchange = (e) => patch(id, { type: e.target.value });
      const bal = $(".acc-bal", tr); if (bal) bal.onchange = (e) => patch(id, { balance: Number(e.target.value) || 0 });
      $(".acc-onb", tr).onchange = (e) => patch(id, { on_budget: e.target.checked });
      $(".acc-hide", tr).onchange = (e) => patch(id, { hidden: e.target.checked });
      const flip = $(".acc-flip", tr); if (flip) flip.onchange = (e) => patch(id, { flip_amounts: e.target.checked });
      $(".acc-del", tr).onclick = async () => {
        $$("details.menu[open]").forEach((dd) => dd.removeAttribute("open"));
        const a = accById(id);
        if (!(await confirmBox(`Delete “${a ? a.name : "this account"}” and all of its transactions? This can't be undone.`, "Delete account"))) return;
        try { await pb.collection("accounts").delete(id); route(); } catch (err) { fail(err); }
      };
    });
    $$(".conn-del", view).forEach((b) => (b.onclick = async () => {
      $$("details.menu[open]").forEach((dd) => dd.removeAttribute("open"));
      if (!(await confirmBox("Disconnect this bank? Its accounts and transaction history stay here as manual accounts.", "Disconnect"))) return;
      try { await pb.collection("bank_connections").delete(b.dataset.id); route(); } catch (err) { fail(err); }
    }));
    const sa = $("#sync-all");
    if (sa) sa.onclick = async () => {
      sa.disabled = true; sa.textContent = "Syncing…";
      try {
        const r = await api("/api/budget/sync", { method: "POST" });
        toast(`Synced ${plural(r.accounts, "account")}, ${plural(r.new_transactions, "new transaction")}`);
        if (r.errors.length) toast(r.errors.join("\n"), true);
      } catch (err) { fail(err); }
      route();
    };
    $("#connect").onclick = simplefinDialog;
    $("#add-acc").onclick = addAccountDialog;
    $("#import-csv").onclick = () => importDialog();
  }

  function simplefinDialog() {
    modal("Connect a bank with SimpleFIN", `
      <div class="stack">
        <div class="callout small">
          <ol style="margin:0;padding-left:18px">
            <li>Create an account at <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noopener">SimpleFIN Bridge</a> (about $1.50/month) and link your banks there.</li>
            <li>Choose <b>New app connection</b> and copy the <b>setup token</b>.</li>
            <li>Paste it below. The token is single-use; your access key is stored on this server only.</li>
          </ol>
        </div>
        <form id="sf-form" class="stack">
          <label class="field"><span>Name</span><input name="name" placeholder="e.g. My banks" value="SimpleFIN"></label>
          <label class="field"><span>Setup token</span><textarea name="setup_token" rows="3" required class="code" placeholder="aHR0cHM6Ly9..."></textarea></label>
          <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Connect &amp; sync</button></div>
        </form>
      </div>`, {
      onMount: (m, close) => {
        $("#sf-form", m).onsubmit = async (e) => {
          e.preventDefault();
          const btn = $("button.primary", e.target); btn.disabled = true; btn.classList.add("loading"); btn.textContent = "Connecting… (up to a minute)";
          try {
            const r = await api("/api/budget/connect", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
            close();
            toast(`Connected · ${plural(r.sync.accounts, "account")}, ${plural(r.sync.new_transactions, "transaction")} imported`);
            route();
          } catch (err) { fail(err); btn.disabled = false; btn.textContent = "Connect & sync"; }
        };
      },
    });
  }

  function addAccountDialog() {
    modal("New manual account", `
      <form id="acc-form" class="stack">
        <label class="field"><span>Name</span><input name="name" required placeholder="e.g. Cash, Credit Union Checking"></label>
        <div class="form-grid">
          <label class="field"><span>Type</span><select name="type">${ACCOUNT_TYPES.map((t) => `<option value="${t}">${cap(t)}</option>`).join("")}</select></label>
          <label class="field"><span>Current balance</span><input name="balance" type="number" step="0.01" value="0"></label>
        </div>
        <label class="check"><input type="checkbox" name="on_budget" checked> Include in budget</label>
        <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create</button></div>
      </form>`, {
      onMount: (m, close) => {
        $("#acc-form", m).onsubmit = async (e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(e.target));
          try {
            await pb.collection("accounts").create({ user: pb.authStore.record.id, name: fd.name, type: fd.type, balance: Number(fd.balance) || 0, on_budget: !!fd.on_budget, currency: "USD" });
            close(); route();
          } catch (err) { fail(err); }
        };
      },
    });
  }

  // ---- CSV import
  function parseCSV(text) {
    const rows = []; let row = [], field = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((v) => v.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
    return rows;
  }
  function parseAmount(s) {
    if (s == null) return NaN;
    let v = String(s).trim();
    if (!v) return NaN;
    const neg = /^\(.*\)$/.test(v) || /-$/.test(v);
    v = v.replace(/[()$€£,\s]/g, "").replace(/-$/, "");
    const n = parseFloat(v);
    return neg ? -Math.abs(n) : n;
  }
  function parseDate(s, fmtHint) {
    s = String(s || "").trim();
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) {
      let [a, b, y] = [+m[1], +m[2], +m[3]];
      if (y < 100) y += 2000;
      const [mo, d] = fmtHint === "dmy" ? [b, a] : [a, b];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return `${y}-${pad(mo)}-${pad(d)}`;
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : ymd(new Date(t));
  }
  function guessCol(headers, re) { const i = headers.findIndex((h) => re.test(h)); return i < 0 ? "" : String(i); }

  function importDialog() {
    if (!state.accounts.length) { toast("Create an account first, then import into it.", true); return; }
    modal("Import transactions from CSV", `
      <div class="stack">
        <p class="muted small" style="margin:0">Download a CSV from your bank's website. Re-importing the same file won't create duplicates.</p>
        <div class="form-grid">
          <label class="field"><span>Into account</span><select id="imp-acc">${accountOptions(state.accounts.find((a) => !a.connection)?.id)}</select></label>
          <label class="field"><span>CSV file</span><input type="file" id="imp-file" accept=".csv,text/csv"></label>
        </div>
        <div id="imp-map"></div>
        <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="imp-go" disabled>Import</button></div>
      </div>`, {
      wide: true,
      onMount: (m, close) => {
        let rows = [], headers = [];
        const map = $("#imp-map", m);
        const build = () => {
          const g = (id) => $("#" + id, m).value;
          const amtMode = g("map-mode");
          const out = [];
          for (const r of rows) {
            const date = parseDate(r[+g("map-date")], g("map-fmt"));
            let amount;
            if (amtMode === "single") amount = parseAmount(r[+g("map-amt")]);
            else {
              const debit = parseAmount(r[+g("map-debit")]); const credit = parseAmount(r[+g("map-credit")]);
              amount = (isNaN(credit) ? 0 : Math.abs(credit)) - (isNaN(debit) ? 0 : Math.abs(debit));
              if (isNaN(debit) && isNaN(credit)) amount = NaN;
            }
            if ($("#map-flip", m).checked) amount = -amount;
            const description = g("map-desc") === "" ? "" : (r[+g("map-desc")] || "").trim();
            if (!date || isNaN(amount)) continue;
            out.push({ date, amount: Math.round(amount * 100) / 100, description });
          }
          return out;
        };
        const preview = () => {
          const out = build();
          $("#imp-prev", m).innerHTML = `<p class="small muted">${out.length} of ${plural(rows.length, "row")} look valid. Spending should be negative.</p>
            <div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th class="right">Amount</th></tr></thead><tbody>
            ${out.slice(0, 6).map((r) => `<tr><td class="num">${r.date}</td><td class="desc">${esc(r.description)}</td><td class="right num">${money(r.amount)}</td></tr>`).join("")}</tbody></table></div>`;
          $("#imp-go", m).disabled = !out.length;
        };
        $("#imp-file", m).onchange = async (e) => {
          const file = e.target.files[0]; if (!file) return;
          const all = parseCSV(await file.text());
          if (all.length < 2) { toast("That file has no rows.", true); return; }
          headers = all[0].map((h) => h.trim()); rows = all.slice(1);
          const opts = (sel) => `<option value="">—</option>` + headers.map((h, i) => `<option value="${i}" ${String(i) === sel ? "selected" : ""}>${esc(h || "Column " + (i + 1))}</option>`).join("");
          const amt = guessCol(headers, /^amount|amount$/i), debit = guessCol(headers, /debit|withdraw/i), credit = guessCol(headers, /credit|deposit/i);
          const mode = amt === "" && debit !== "" ? "split" : "single";
          map.innerHTML = `
            <div class="form-grid">
              <label class="field"><span>Date column</span><select id="map-date">${opts(guessCol(headers, /date/i) || "0")}</select></label>
              <label class="field"><span>Date format</span><select id="map-fmt"><option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option></select></label>
              <label class="field"><span>Description column</span><select id="map-desc">${opts(guessCol(headers, /desc|payee|merchant|name|memo/i))}</select></label>
              <label class="field"><span>Amount style</span><select id="map-mode"><option value="single" ${mode === "single" ? "selected" : ""}>One amount column</option><option value="split" ${mode === "split" ? "selected" : ""}>Separate debit / credit</option></select></label>
              <label class="field amt-single"><span>Amount column</span><select id="map-amt">${opts(amt)}</select></label>
              <label class="field amt-split"><span>Debit (money out)</span><select id="map-debit">${opts(debit)}</select></label>
              <label class="field amt-split"><span>Credit (money in)</span><select id="map-credit">${opts(credit)}</select></label>
            </div>
            <label class="check" style="margin-top:10px"><input type="checkbox" id="map-flip"> Flip signs (use if purchases show as positive, common for credit cards)</label>
            <div id="imp-prev" style="margin-top:12px"></div>`;
          const sync = () => { $$(".amt-single", m).forEach((x) => x.classList.toggle("hidden", $("#map-mode", m).value !== "single")); $$(".amt-split", m).forEach((x) => x.classList.toggle("hidden", $("#map-mode", m).value === "single")); preview(); };
          $$("select, input[type=checkbox]", map).forEach((x) => (x.onchange = sync));
          sync();
        };
        $("#imp-go", m).onclick = async () => {
          const out = build();
          const btn = $("#imp-go", m); btn.disabled = true; btn.textContent = "Importing…";
          try {
            const r = await api("/api/budget/import", { method: "POST", body: { account: $("#imp-acc", m).value, rows: out } });
            close(); toast(`Imported ${r.inserted} · skipped ${plural(r.skipped, "duplicate")}${r.invalid ? ` · ${r.invalid} invalid` : ""}`);
            route();
          } catch (err) { fail(err); btn.disabled = false; btn.textContent = "Import"; }
        };
      },
    });
  }

  // ------------------------------------------------------------------ goals
  // Goal numbers come from /api/budget/goals: a linked goal follows its account's balance.
  const GOAL_STATUS = { done: ["ok", "Reached"], on_track: ["ok", "On track"], behind: ["warn-p", "Behind"], overdue: ["err", "Past due"], no_date: ["", "No deadline"] };
  const GOAL_ACCOUNT_TYPES = { checking: 1, savings: 1, investment: 1, cash: 1, other: 1 };
  const fullDate = (d) => `${prettyDate(d)} ${dateOnly(d).slice(0, 4)}`;
  // 12 days, 5 months, 3.5 years
  const span = (days) => days < 60 ? plural(days, "day") : days < 730 ? plural(Math.round(days / 30.44), "month") : `${Math.round(days / 182.6) / 2} years`;
  const goalPill = (g) => { const [c, t] = GOAL_STATUS[g.status] || ["", ""]; return `<span class="pill ${c}">${t}</span>`; };
  function goalLine(g) {
    if (g.status === "done") return `Goal reached${g.linked ? ". Keep the balance at or above it." : "."}`;
    if (g.status === "overdue") return `${money(g.left)} to go. The target date has passed.`;
    if (g.per_day != null) return `Add <b class="num">${money(g.per_day)}</b>/day (${money(g.per_month)}/mo) to reach it by ${esc(fullDate(g.target_date))}`;
    if (g.projected_date) return `${money(g.left)} to go. At your pace, done around ${esc(fullDate(g.projected_date))}.`;
    return `${money(g.left)} to go`;
  }
  function sparkline(vals) {
    if (!vals || vals.length < 2) return "";
    const W = 96, H = 28, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 3 - ((v - lo) / span) * (H - 6)).toFixed(1)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function goalCard(g) {
    const pct = Math.round(g.pct * 100);
    return `<div class="card goal" data-id="${g.id}" role="button" tabindex="0" aria-label="${esc(g.name)} goal details">
      <div class="row"><b class="cl">${catMark({ name: g.name, icon: "target" }, true)}<span>${esc(g.name)}</span></b><div class="spacer"></div>${goalPill(g)}</div>
      <div class="small muted g-src">${g.linked ? `Tracks ${esc(acctLabel(g.account))}` : "Tracked by hand"}</div>
      <div class="row g-amt"><div><span class="g-cur num">${money(g.current)}</span> <span class="muted small">of ${money(g.target)}</span></div><div class="spacer"></div>${sparkline(g.spark)}</div>
      <div class="bar ${g.status === "done" ? "good" : ""}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <div class="small muted">${pct}% · ${goalLine(g)}</div>
    </div>`;
  }
  const bindGoalCards = (root) => $$(".goal[data-id]", root).forEach((el) => {
    el.onclick = () => openGoal(el.dataset.id);
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGoal(el.dataset.id); } };
  });

  async function renderGoals(view) {
    const [d] = await Promise.all([api("/api/budget/goals"), loadAccounts()]);
    const goals = d.goals, t = d.totals;
    const open = goals.filter((g) => g.status !== "done");
    const onTrack = goals.filter((g) => g.status === "on_track").length;
    const dated = goals.filter((g) => g.target_date && g.status !== "done").length;
    view.innerHTML = `
      <div class="stack">
        <div class="row"><p class="muted" style="margin:0">${goals.length ? `Link a goal to a savings account and Keel follows the balance for you.` : "Set savings goals (an emergency fund, a trip, a down payment) and see what to put away each day to get there."}</p>
          <div class="spacer"></div><button class="btn primary" id="add-goal">+ Goal</button></div>
        ${goals.length ? `<div class="grid kpis">
          <div class="card kpi"><div class="label">Saved toward goals</div><div class="value num">${money(t.saved)}</div><div class="sub">of ${money(t.target)} · ${t.target ? Math.round((t.saved / t.target) * 100) : 0}%</div></div>
          <div class="card kpi"><div class="label">Needed to stay on schedule</div><div class="value num">${money(t.per_month)}<span class="muted" style="font-size:14px;font-weight:500">/mo</span></div><div class="sub">${t.per_month ? `About ${money(t.per_month / 30.44)} a day` : "No dated goals left"}</div></div>
          <div class="card kpi"><div class="label">On track</div><div class="value num">${dated ? `${onTrack} of ${dated}` : "—"}</div><div class="sub">${open.length ? `${plural(open.length, "goal")} in progress` : "Every goal reached"}</div></div>
        </div>
        <div class="grid goals-grid">${goals.map(goalCard).join("")}</div>` : `<div class="card empty">No goals yet.</div>`}
      </div>`;
    bindGoalCards(view);
    $("#add-goal").onclick = () => editGoal(null);
  }

  // Detail: where you are, what it takes per day, your actual pace, and the path to the target.
  async function openGoal(id) {
    let g;
    try { g = await api(`/api/budget/goals/${id}`); } catch (err) { return fail(err); }
    const pct = Math.round(g.pct * 100);
    const stat = (label, v, sub) => `<div class="h-stat"><div class="label">${label}</div><div class="h-v num">${v}</div>${sub ? `<div class="small muted">${sub}</div>` : ""}</div>`;
    const paceSub = g.pace_per_day == null ? (g.linked ? "Not enough history yet" : "Shows after two weeks") : `${signed(g.pace_per_day * 30.44, true)}/mo over the last ${plural(g.pace_days, "day")}`;
    let finish = "—", finishSub = g.status === "done" ? "Already there" : "Needs a positive pace";
    if (g.projected_date) {
      finish = esc(fullDate(g.projected_date));
      if (g.target_date) {
        const diff = Math.round((new Date(g.target_date + "T12:00:00") - new Date(g.projected_date + "T12:00:00")) / 86400000);
        finishSub = diff >= 0 ? `${span(diff)} early` : `<span class="negc">${span(-diff)} late</span>`;
      } else finishSub = "At your current pace";
    } else if (g.status === "done") finish = "Done";
    const need = g.status === "done" ? stat("Need per day", money(0), "You've reached it")
      : g.per_day != null ? stat("Need per day", money(g.per_day), `${money(g.per_week)}/week · ${money(g.per_month)}/month`)
      : stat("Need per day", "—", g.target_date ? "The target date has passed" : "Add a target date to see this");
    const months = (g.months || []).filter((x) => x.change != null);
    const mMax = Math.max(1, ...months.map((x) => Math.abs(x.change)));
    modal(g.name, `
      <div class="stack g-detail">
        <div>
          <div class="row" style="align-items:baseline;flex-wrap:wrap;gap:8px"><span class="g-big num">${money(g.current)}</span><span class="muted">of ${money(g.target)}${g.target_date ? ` by ${esc(fullDate(g.target_date))}` : ""}</span><div class="spacer"></div>${goalPill(g)}</div>
          <div class="bar ${g.status === "done" ? "good" : ""}" style="margin:12px 0 6px"><i style="width:${pct}%"></i></div>
          <div class="small muted">${pct}% · ${g.linked ? `Follows the balance of ${esc(acctLabel(g.account))}` : "Tracked by hand"}${g.since_start ? ` · ${signed(g.since_start, true)} since ${esc(fullDate(g.start_day))}` : ""}</div>
        </div>
        <div class="h-stats g-stats">
          ${stat("Left to go", money(g.left))}
          ${need}
          ${stat("Your pace", g.pace_per_day == null ? "—" : `${g.pace_per_day < 0 ? "−" : ""}${money(Math.abs(g.pace_per_day))}<span class="muted" style="font-size:13px;font-weight:500">/day</span>`, paceSub)}
          ${stat("Projected finish", finish, finishSub)}
        </div>
        ${g.linked && g.history && g.history.length > 1 ? `<div><div class="kind-h">Balance and the path to your target</div><div id="g-chart"></div></div>` : ""}
        ${months.length ? `<div><div class="kind-h row"><span>Added each month</span><div class="spacer"></div><span class="small muted">Net change in the account</span></div>
          <div class="g-months">${months.map((x) => `<div class="g-month" ${tipAttr(`<b>${esc(monthLabel(x.month))}</b><br>${x.change >= 0 ? "Added" : "Took out"} ${money(Math.abs(x.change))}`)}><span class="small muted">${esc(shortMonth(x.month))}</span><div class="g-track"><i class="${x.change < 0 ? "neg" : ""}" style="width:${Math.max(x.change ? 2 : 0, (Math.abs(x.change) / mMax) * 100)}%"></i></div><span class="num small ${x.change < 0 ? "negc" : x.change ? "" : "muted"}">${x.change ? `${x.change < 0 ? "−" : "+"}${money(Math.abs(x.change))}` : "No change"}</span></div>`).join("")}</div></div>` : ""}
        ${!g.linked && g.status !== "done" ? `<form class="row" id="g-add"><input type="number" step="0.01" name="amt" placeholder="Amount" aria-label="Amount to add" style="max-width:160px" required><button class="btn">Add money</button><span class="small muted">Or link this goal to an account to track it automatically.</span></form>` : ""}
        <div class="actions"><button type="button" class="btn" id="g-edit">Edit goal</button><div class="spacer"></div><button type="button" class="btn primary" data-close>Done</button></div>
      </div>`, {
      wide: true,
      onMount: (m, close) => {
        $("#g-edit", m).onclick = async () => { close(); const rec = await pb.collection("goals").getOne(g.id); editGoal(rec); };
        const add = $("#g-add", m);
        if (add) add.onsubmit = async (e) => {
          e.preventDefault();
          const v = Number(new FormData(add).get("amt")) || 0;
          try { await pb.collection("goals").update(g.id, { saved: Math.round((g.saved + v) * 100) / 100 }); close(); await route(); openGoal(g.id); } catch (err) { fail(err); }
        };
        const box = $("#g-chart", m);
        if (box) box.innerHTML = goalChart(g);
      },
    });
  }

  // Balance so far, then two lines into the future: what's needed to land on the target date,
  // and where your current pace goes. Long spans are drawn weekly.
  function goalChart(g) {
    const DAYMS = 86400000;
    const ms = (d) => new Date(d + "T12:00:00").getTime();
    const hist = g.history;
    const today = hist[hist.length - 1].day;
    const first = Math.max(ms(hist[0].day), Math.min(ms(g.start_day) - 30 * DAYMS, ms(today) - 90 * DAYMS));
    let end = ms(today);
    if (g.target_date && ms(g.target_date) > end) end = ms(g.target_date);
    else if (g.projected_date) end = Math.min(ms(g.projected_date), ms(today) + 730 * DAYMS);
    end = Math.max(end, ms(today) + 14 * DAYMS);
    const total = Math.round((end - first) / DAYMS);
    const step = total > 400 ? 14 : total > 180 ? 7 : 1;
    // walk back from today so today always lands on a point
    const days = [];
    for (let t = ms(today); t >= first; t -= step * DAYMS) days.unshift(t);
    for (let t = ms(today) + step * DAYMS; t <= end + (step - 1) * DAYMS; t += step * DAYMS) days.push(t);
    const ti = days.indexOf(ms(today));
    const byDay = Object.fromEntries(hist.map((p) => [p.day, p]));
    const dayStr = (t) => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const actual = days.map((t, i) => (i <= ti ? (byDay[dayStr(t)] || {}).value ?? null : null));
    const tEnd = g.target_date ? ms(g.target_date) : null;
    const done = g.status === "done";
    const needed = days.map((t, i) => (done || !tEnd || tEnd <= ms(today) || i < ti || t > tEnd + (step - 1) * DAYMS ? null : g.current + (g.target - g.current) * Math.min(1, (t - ms(today)) / (tEnd - ms(today)))));
    const pace = days.map((t, i) => (done || g.pace_per_day == null || i < ti ? null : g.current + g.pace_per_day * ((t - ms(today)) / DAYMS)));
    const series = [{ values: actual, color: "var(--s1)", area: true, endDot: true }];
    if (needed.some((v) => v != null)) series.push({ values: needed, color: "var(--s3)", dashed: true });
    if (pace.some((v) => v != null)) series.push({ values: pace, color: "var(--s2)", dashed: true });
    const est = hist.some((p) => p.estimated);
    const chart = lineChart({
      series, n: days.length, height: 240, yMinZero: false,
      yMax: Math.max(g.target, ...actual.filter((v) => v != null)) * 1.04,
      refs: [{ v: g.target, label: `Target ${compact(g.target)}` }],
      xLabel: (i) => { const d = dayStr(days[i]); return total > 300 ? `${shortMonth(d.slice(0, 7))} ’${d.slice(2, 4)}` : prettyDate(d); },
      ariaLabel: `${g.name}: balance over time with the path to ${money(g.target)}`,
      tipFor: (i) => {
        const d = dayStr(days[i]);
        let h = `<b>${esc(fullDate(d))}</b>`;
        if (actual[i] != null) h += `<br>Balance ${money(actual[i])}${(byDay[d] || {}).estimated ? ' <span class="muted">(estimated)</span>' : ""}`;
        if (i > ti && needed[i] != null) h += `<br>Needed ${money(needed[i])}`;
        if (i > ti && pace[i] != null) h += `<br>At your pace ${money(pace[i])}`;
        return h;
      },
    });
    const legend = [`<span style="--c:var(--s1)">Balance</span>`];
    if (series.some((s) => s.color === "var(--s3)")) legend.push(`<span class="dash" style="--c:var(--s3)">Needed to hit the date</span>`);
    if (series.some((s) => s.color === "var(--s2)")) legend.push(`<span class="dash" style="--c:var(--s2)">At your pace</span>`);
    return chart + `<div class="row" style="margin-top:4px;gap:12px;flex-wrap:wrap"><div class="legend" style="margin:0">${legend.join("")}</div>${est ? `<span class="small muted">Older balances are estimated from transactions.</span>` : ""}</div>`;
  }

  function editGoal(g) {
    const isNew = !g;
    g = g || { name: "", target: "", saved: 0, target_date: "", account: "" };
    const accts = (state.accounts || []).filter((a) => !a.hidden && GOAL_ACCOUNT_TYPES[a.type || "other"]);
    const savings = accts.find((a) => a.type === "savings");
    const selAcct = isNew ? (savings ? savings.id : "") : g.account || "";
    modal(isNew ? "New goal" : "Edit goal", `
      <form id="goal-form" class="stack">
        <label class="field"><span>Name</span><input name="name" required value="${esc(g.name)}" placeholder="Emergency fund"></label>
        <label class="field"><span>Track with</span><select name="account">
          ${accts.map((a) => `<option value="${a.id}" ${a.id === selAcct ? "selected" : ""}>${esc(acctLabel(a))} · ${money(a.balance)}</option>`).join("")}
          <option value="" ${!selAcct ? "selected" : ""}>Track by hand</option>
        </select><small class="muted" id="g-hint"></small></label>
        <div class="form-grid">
          <label class="field"><span id="g-target-l">Target</span><input name="target" type="number" min="0" step="1" required value="${g.target}"></label>
          <label class="field"><span>Target date <span class="muted">(optional)</span></span><input name="target_date" type="date" value="${dateOnly(g.target_date)}"></label>
        </div>
        <label class="field" id="g-saved"><span>Saved so far</span><input name="saved" type="number" min="0" step="0.01" value="${g.saved || 0}"></label>
        <div class="actions">
          ${!isNew ? `<button type="button" class="btn danger" id="del">Delete</button><div class="spacer"></div>` : ""}
          <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>
        </div>
      </form>`, {
      onMount: (m, close) => {
        const form = $("#goal-form", m);
        const sel = $("[name=account]", form);
        const sync = () => {
          const a = accts.find((x) => x.id === sel.value);
          $("#g-saved", m).style.display = a ? "none" : "";
          $("#g-target-l", m).textContent = a ? "Balance to reach" : "Target";
          $("#g-hint", m).textContent = a ? `Progress is this account's balance (${money(a.balance)} now), updated every sync.` : "You add money to it yourself.";
        };
        sel.onchange = sync; sync();
        form.onsubmit = async (e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(form));
          const a = accts.find((x) => x.id === fd.account);
          const data = { name: fd.name, target: Number(fd.target) || 0, target_date: fd.target_date ? fd.target_date + " 12:00:00.000Z" : "", account: fd.account || "" };
          if (!a) data.saved = Number(fd.saved) || 0;
          // where it started, for "since you set this goal" (reset when what it tracks changes)
          if (isNew || (g.account || "") !== data.account) { data.start_day = ymd(new Date()); data.start_amount = a ? a.balance : data.saved; }
          try {
            if (isNew) await pb.collection("goals").create({ ...data, user: pb.authStore.record.id });
            else await pb.collection("goals").update(g.id, data);
            close(); route();
          } catch (err) { fail(err); }
        };
        const del = $("#del", m);
        if (del) del.onclick = async () => { close(); if (await confirmBox(`Delete goal “${g.name}”?`)) { try { await pb.collection("goals").delete(g.id); route(); } catch (err) { fail(err); } } };
      },
    });
  }

  // ------------------------------------------------------------------ settings
  async function renderSettings(view) {
    const [me, rules] = await Promise.all([
      pb.collection("users").getOne(pb.authStore.record.id),
      pb.collection("rules").getFullList({ sort: "pattern" }),
      loadCategories(),
    ]);
    view.innerHTML = `
      <div class="grid two">
        <div class="stack">
          ${installCard()}
          <div class="card">
            <div class="card-h"><h2>Email alerts</h2><div class="spacer"></div><span class="pill ${state.status.smtp ? "ok" : "err"}">${state.status.smtp ? "SMTP connected" : "SMTP not configured"}</span></div>
            ${state.status.smtp ? "" : `<p class="small muted">Set the <span class="code">SMTP_*</span> variables in <span class="code">.env</span> and restart the container to turn on emails.</p>`}
            <form id="prefs" class="stack">
              <label class="field"><span>Name</span><input name="name" value="${esc(me.name)}"></label>
              <label class="check"><input type="checkbox" name="alerts_enabled" ${me.alerts_enabled ? "checked" : ""}> Email me when a category nears or passes its budget</label>
              <div class="form-grid">
                <label class="field"><span>Warn at (% of budget)</span><input name="alert_threshold" type="number" min="1" max="200" value="${me.alert_threshold || 90}"></label>
                <label class="field"><span>Large transaction alert ($)</span><input name="large_txn_threshold" type="number" min="0" step="1" value="${me.large_txn_threshold || 0}"></label>
              </div>
              <label class="check"><input type="checkbox" name="weekly_digest" ${me.weekly_digest ? "checked" : ""}> Weekly summary email</label>
              <label class="check"><input type="checkbox" name="bill_reminders" ${me.bill_reminders ? "checked" : ""}> Email me 3 days before a bill or subscription is due</label>
              <label class="check"><input type="checkbox" name="update_notes" ${me.update_notes ? "checked" : ""}> Show what's new when Keel updates (top-right popup)</label>
              <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" id="digest-now" ${state.status.smtp ? "" : "disabled"}>Send me a summary now</button></div>
            </form>
          </div>
          <div class="card">
            <div class="card-h"><h2>Account</h2></div>
            <p class="small muted" style="margin-top:0">Signed in as ${esc(me.email)}${me.verified ? "" : " (unverified)"}. Running Keel v${esc(state.status.version)}${state.status.released ? ` (${esc(state.status.released)})` : ""}.</p>
            <div class="row">
              ${state.status.smtp ? `<button class="btn" id="reset-pw">Email me a password reset link</button>` : ""}
              ${state.status.smtp && !me.verified ? `<button class="btn" id="verify">Resend verification</button>` : ""}
              <button class="btn danger" id="logout">Sign out</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h2>Categorization rules</h2><div class="spacer"></div><button class="btn" id="run-rules">Apply to uncategorized</button><button class="btn primary" id="add-rule">+ Rule</button></div>
          <p class="small muted" style="margin-top:0">Rules come first: any transaction whose description or payee contains the text gets that category. After that, Keel uses the categories you have picked by hand for each merchant, then its built-in list of common merchants.</p>
          ${rules.length ? `<table><tbody>${rules.map((r) => { const c = catById(r.category); return `<tr><td class="code">${esc(r.pattern)}</td><td>→ ${c ? catLabel(c) : "?"}</td><td class="right"><button class="btn sm danger rule-del" data-id="${r.id}">Remove</button></td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">No rules yet. Tip: when you change a transaction's category you'll be offered a rule.</div>`}
        </div>
      </div>`;

    $("#prefs").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const saved = await pb.collection("users").update(me.id, {
          name: fd.get("name"), alerts_enabled: fd.has("alerts_enabled"), weekly_digest: fd.has("weekly_digest"), update_notes: fd.has("update_notes"), bill_reminders: fd.has("bill_reminders"),
          alert_threshold: Number(fd.get("alert_threshold")) || 90, large_txn_threshold: Number(fd.get("large_txn_threshold")) || 0,
        });
        pb.authStore.save(pb.authStore.token, saved);
        toast("Preferences saved");
      } catch (err) { fail(err); }
    };
    const ia = $("#install-app"); if (ia) ia.onclick = runInstall;
    $("#digest-now").onclick = async () => { try { const r = await api("/api/budget/digest", { method: "POST" }); toast("Sent to " + r.to); } catch (err) { fail(err); } };
    $("#logout").onclick = () => { pb.authStore.clear(); history.replaceState(null, "", location.pathname); renderLanding(); };
    const rp = $("#reset-pw"); if (rp) rp.onclick = async () => { try { await pb.collection("users").requestPasswordReset(me.email); toast("Reset link sent"); } catch (err) { fail(err); } };
    const vf = $("#verify"); if (vf) vf.onclick = async () => { try { await pb.collection("users").requestVerification(me.email); toast("Verification email sent"); } catch (err) { fail(err); } };
    $("#add-rule").onclick = () => createRuleDialog("", "");
    $("#run-rules").onclick = async () => { try { const r = await api("/api/budget/apply-rules", { method: "POST" }); toast(`Categorized ${plural(r.updated, "transaction")}`); } catch (err) { fail(err); } };
    $$(".rule-del", view).forEach((b) => (b.onclick = async () => { try { await pb.collection("rules").delete(b.dataset.id); route(); } catch (err) { fail(err); } }));
  }

  // ------------------------------------------------------------------ update notes
  // The server is auto-updated (Watchtower). We show a small "what's new" card when
  // the running version differs from the last one this user acknowledged.
  // v = the version this page's code came from; pending = the server has a newer one.
  // state.status.version keeps showing the code that's actually running until we reload.
  const loadedVersion = { v: "", pending: false };
  const reloadIfPending = () => {
    if (!loadedVersion.pending || $(".modal-bg")) return false;
    location.reload();
    return true;
  };

  function notesEnabled() {
    const me = pb.authStore.isValid && pb.authStore.record;
    return !!(me && me.update_notes !== false);
  }

  async function markSeen(version) {
    const me = pb.authStore.record;
    if (!me || me.last_seen_version === version) return;
    try {
      const saved = await pb.collection("users").update(me.id, { last_seen_version: version });
      pb.authStore.save(pb.authStore.token, saved);
    } catch (_) {}
  }

  function showUpdate(info, needsReload) {
    if (!info.version || info.version === "dev") return;
    let el = $("#update-pop");
    if (!el) { el = document.createElement("div"); el.id = "update-pop"; document.body.appendChild(el); }
    el.className = "update-pop";
    el.setAttribute("role", "status");
    el.innerHTML = `
      <button class="x" aria-label="Dismiss">×</button>
      <div class="up-h"><span class="up-badge">New</span> ${esc(state.status.app_name)} updated to <b>v${esc(info.version)}</b></div>
      ${info.released ? `<div class="small muted">${esc(info.released)}</div>` : ""}
      ${info.motd ? `<p>${esc(info.motd)}</p>` : ""}
      <div class="row">
        ${needsReload ? `<button class="btn primary sm" id="up-reload">Reload now</button>` : `<button class="btn primary sm" id="up-ok">Got it</button>`}
        <div class="spacer"></div>
        <button class="btn link small" id="up-off">Don't show these</button>
      </div>`;
    const close = () => { markSeen(info.version); el.remove(); };
    $(".x", el).onclick = close;
    const ok = $("#up-ok", el); if (ok) ok.onclick = close;
    const rl = $("#up-reload", el); if (rl) rl.onclick = async () => { await markSeen(info.version); location.reload(); };
    $("#up-off", el).onclick = async () => {
      el.remove();
      try {
        const saved = await pb.collection("users").update(pb.authStore.record.id, { update_notes: false, last_seen_version: info.version });
        pb.authStore.save(pb.authStore.token, saved);
        toast("Update notes turned off. Turn them back on in Settings.");
      } catch (err) { fail(err); }
    };
  }

  function checkSeenVersion() {
    const me = pb.authStore.record;
    if (notesEnabled() && state.status.version && me.last_seen_version !== state.status.version) {
      showUpdate(state.status, false);
    }
  }

  async function pollVersion() {
    let s;
    try { s = await api("/api/budget/status"); } catch (_) { return; } // server restarting mid-update
    if (!s.version || s.version === loadedVersion.v) return;
    loadedVersion.v = s.version;
    loadedVersion.pending = true;
    // hidden (backgrounded, other tab): switch over quietly. Otherwise the next page change does it.
    if (document.hidden) return void location.reload();
    if (notesEnabled()) showUpdate(s, true);
  }
  // Phones keep an installed app alive in the background for days: check again on resume,
  // and use the moment the app goes to the background to load a pending update.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (loadedVersion.pending) location.reload(); }
    else if (pb.authStore.isValid) pollVersion();
  });

  // ------------------------------------------------------------------ install (PWA)
  // Android/desktop Chrome and Edge fire `beforeinstallprompt`; iOS needs Share > Add to Home Screen.
  const install = { prompt: null };
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share" style="vertical-align:-3px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>';

  // "ready" (can show the install button), "ios" (show instructions), "installed", "insecure" or "unavailable".
  function installState() {
    if (isStandalone()) return "installed";
    if (install.prompt) return "ready";
    if (isIOS()) return "ios";
    if (!window.isSecureContext) return "insecure";
    return "unavailable";
  }

  async function runInstall() {
    if (!install.prompt) return;
    install.prompt.prompt();
    const { outcome } = await install.prompt.userChoice;
    install.prompt = null;
    if (outcome === "accepted") toast("Keel is on your home screen");
    if (currentRoute() === "settings" || currentRoute() === "dashboard") route();
  }

  function installCard() {
    const st = installState();
    const body = {
      installed: `<p class="small muted" style="margin:0">You're using the installed app.</p>`,
      ready: `<p class="small muted" style="margin-top:0">Add Keel to your home screen or desktop. It opens in its own window, without the browser bar.</p><button class="btn primary" id="install-app">Install Keel</button>`,
      ios: `<p class="small muted" style="margin:0">In Safari, tap ${SHARE_ICON} <b>Share</b>, then <b>Add to Home Screen</b>. Keel opens full screen from its icon.</p>`,
      insecure: `<p class="small muted" style="margin:0">Phones only offer to install apps from a secure (https://) address. Open Keel through your https address to install it. Until then, your browser's menu may offer <b>Add to Home Screen</b> as a shortcut.</p>`,
      unavailable: `<p class="small muted" style="margin:0">Use your browser's menu and choose <b>Install app</b> or <b>Add to Home Screen</b>. If you don't see it, Keel may already be installed.</p>`,
    }[st];
    return `<div class="card"><div class="card-h"><h2>Install the app</h2><div class="spacer"></div>${st === "installed" ? `<span class="pill ok">Installed</span>` : ""}</div>${body}</div>`;
  }

  // A one-time, dismissible nudge on the Overview page for phone users.
  function installBanner() {
    const st = installState();
    let dismissed = false;
    try { dismissed = localStorage.getItem("keel_install_dismissed") === "1"; } catch (_) {}
    if (dismissed || !(st === "ready" || st === "ios") || !matchMedia("(max-width: 760px), (pointer: coarse)").matches) return "";
    return `<div class="card install-banner" id="install-banner"><img src="brand/icon-192.png" alt="" width="44" height="44">
      <div class="grow"><div class="b-name">Get the Keel app</div><div class="small muted">${st === "ios" ? `Tap ${SHARE_ICON} Share, then Add to Home Screen.` : "Open Keel from your home screen, full screen."}</div></div>
      ${st === "ready" ? `<button class="btn primary sm" id="banner-install">Install</button>` : ""}<button class="btn link" id="banner-x" aria-label="Dismiss">Not now</button></div>`;
  }
  function bindInstallBanner(root) {
    const b = $("#banner-install", root); if (b) b.onclick = runInstall;
    const x = $("#banner-x", root); if (x) x.onclick = () => { try { localStorage.setItem("keel_install_dismissed", "1"); } catch (_) {} $("#install-banner", root).remove(); };
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    install.prompt = e;
    if (pb.authStore.isValid && (currentRoute() === "settings" || currentRoute() === "dashboard") && !$(".modal-bg")) route();
  });
  window.addEventListener("appinstalled", () => { install.prompt = null; });
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((err) => console.warn("service worker", err)));
  }
  window.addEventListener("offline", () => toast("You're offline. Keel will catch up when you reconnect.", true));
  window.addEventListener("online", () => { toast("Back online"); if (pb.authStore.isValid) route(); });

  // ------------------------------------------------------------------ boot
  async function start() {
    if (/^#\/?(login|register)?$/.test(location.hash)) history.replaceState(null, "", "#/dashboard");
    renderShell();
    await Promise.all([loadCategories(), loadAccounts()]).catch(() => {});
    route();
    checkSeenVersion();
  }

  window.addEventListener("hashchange", route);
  bindTooltips();
  (async () => {
    try { state.status = await api("/api/budget/status"); } catch (_) {}
    loadedVersion.v = state.status.version || "";
    setInterval(pollVersion, 60 * 1000);
    if (pb.authStore.isValid) {
      try { await pb.collection("users").authRefresh(); } catch (err) { if (err && (err.status === 401 || err.status === 403 || err.status === 404)) pb.authStore.clear(); }
    }
    if (pb.authStore.isValid) start(); else renderPublic();
  })();
})();
