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
  // ---- theme: System (default), Light or Dark, kept on this device
  const THEME_KEY = "keel.theme";
  const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || "system"; } catch (_) { return "system"; } };
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "light" || t === "dark") root.dataset.theme = t; else delete root.dataset.theme;
    const dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    $$('meta[name="theme-color"]').forEach((m) => { if (t === "system") return; m.removeAttribute("media"); m.content = dark ? "#101827" : "#f5f7fa"; });
  }
  applyTheme(getTheme());
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
      const destructive = /delete|remove|disconnect/i.test(okLabel);
      modal("Are you sure?", `<p>${esc(text)}</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn ${destructive ? "danger solid" : "primary"}" id="ok">${esc(okLabel)}</button></div>`, {
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
    reports: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 18v-2"/><path d="M12 18v-4"/><path d="M16 18v-6"/>',
    cashflow: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
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

  // ------------------------------------------------------------------ email links
  // Pages the account emails link to: confirm email, choose a new password, confirm a new email.
  function actionCard(inner) {
    $("#app").innerHTML = `<div class="auth act"><div class="card">
      ${isKeel() ? `<span class="wordmark act-mark" role="img" aria-label="Keel"></span>` : `<div class="brand" style="padding:0 0 6px;justify-content:center"><div class="logo">${LOGO}</div>${esc(state.status.app_name)}</div>`}
      <div id="act-body" aria-live="polite">${inner}</div></div></div>`;
  }
  const actSeal = (ok) => `<div class="act-seal ${ok ? "ok" : "bad"}" aria-hidden="true"><svg viewBox="0 0 52 52">
      <circle class="act-ring" cx="26" cy="26" r="23"/>${ok ? `<path class="act-tick" d="M15 27l7.5 7.5L37.5 19"/>` : `<path class="act-tick" d="M18 18l16 16M34 18L18 34"/>`}</svg></div>`;
  // Lucide bell, calendar, mail
  const ACT_ICONS = {
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  };
  const actIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ACT_ICONS[k]}</svg>`;
  const goHome = () => { history.replaceState(null, "", "#/"); route(); };

  async function renderAction(kind, token) {
    const name = state.status.app_name || "Keel";
    const signedIn = pb.authStore.isValid;
    const openBtn = `<button class="btn primary act-go" id="act-go">${signedIn ? `Open ${esc(name)}` : "Sign in"}</button>`;
    const done = (title, text, extra = "") => {
      $("#act-body").innerHTML = `${actSeal(true)}<h1 class="act-h">${title}</h1><p class="act-p">${text}</p>${extra}${openBtn}`;
      $("#act-go").onclick = () => { history.replaceState(null, "", signedIn ? "#/" : "#/login"); route(); };
    };
    const failed = (title, text) => {
      document.title = `${title} · ${name}`;
      $("#act-body").innerHTML = `${actSeal(false)}<h1 class="act-h">${title}</h1><p class="act-p">${text}</p>
        ${signedIn && kind === "verify" && state.status.smtp ? `<button class="btn primary act-go" id="act-resend">Send a new link</button>` : ""}
        <button class="btn act-go" id="act-home">${signedIn ? `Open ${esc(name)}` : "Back to sign in"}</button>`;
      const rs = $("#act-resend");
      if (rs) rs.onclick = async () => { try { await pb.collection("users").requestVerification(pb.authStore.record.email); rs.disabled = true; rs.textContent = "New link sent. Check your email."; } catch (err) { fail(err); } };
      $("#act-home").onclick = () => { history.replaceState(null, "", signedIn ? "#/" : "#/login"); route(); };
    };
    document.title = `${name}`;

    if (kind === "verify") {
      document.title = `Email confirmed · ${name}`;
      actionCard(`<div class="act-wait"><span class="loading-dots">Confirming your email</span></div>`);
      try {
        await pb.collection("users").confirmVerification(token);
        if (signedIn) { try { await pb.collection("users").authRefresh(); } catch (_) {} }
        const email = signedIn ? pb.authStore.record.email : "";
        done("You're verified", `${email ? `<b>${esc(email)}</b> is confirmed.` : "Your email is confirmed."} ${esc(name)} can now email you:`,
          `<ul class="act-list">
            <li>${actIcon("bell")}<span>Alerts when a budget gets close or goes over</span></li>
            <li>${actIcon("calendar")}<span>Reminders before bills are due</span></li>
            <li>${actIcon("mail")}<span>Your weekly summary</span></li>
          </ul><p class="small muted act-p">Choose which ones in Settings.</p>`);
      } catch (_) {
        // already verified counts as success
        if (signedIn) {
          try { await pb.collection("users").authRefresh(); } catch (_) {}
          if (pb.authStore.record && pb.authStore.record.verified) return done("You're already verified", `<b>${esc(pb.authStore.record.email)}</b> was confirmed earlier. Nothing else to do.`);
        }
        failed("This link didn't work", "It may have expired or already been used. Confirmation links last 3 days.");
      }
      return;
    }

    if (kind === "reset") {
      document.title = `Choose a new password · ${name}`;
      actionCard(`<h1 class="act-h">Choose a new password</h1><p class="act-p">At least 8 characters.</p>
        <form id="act-form" class="stack" style="text-align:left">
          <label class="field"><span>New password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
          <label class="field"><span>Type it again</span><input name="confirm" type="password" required minlength="8" autocomplete="new-password"></label>
          <button class="btn primary" style="width:100%;justify-content:center">Save new password</button>
        </form>`);
      $("#act-form input").focus();
      $("#act-form").onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        if (fd.password !== fd.confirm) return toast("The two passwords don't match.");
        const btn = $("button.primary", e.target); btn.disabled = true; btn.classList.add("loading");
        try {
          await pb.collection("users").confirmPasswordReset(token, fd.password, fd.confirm);
          pb.authStore.clear(); // other sessions are signed out by the reset
          $("#act-body").innerHTML = `${actSeal(true)}<h1 class="act-h">Password updated</h1><p class="act-p">Sign in with your new password.</p><button class="btn primary act-go" id="act-go">Sign in</button>`;
          $("#act-go").onclick = () => { history.replaceState(null, "", "#/login"); route(); };
        } catch (_) {
          failed("This link didn't work", "Reset links expire after 30 minutes and work once. Ask for a new one from the sign-in page.");
        }
      };
      return;
    }

    // email-change: PocketBase asks for the account password to confirm
    document.title = `Confirm your new email · ${name}`;
    actionCard(`<h1 class="act-h">Confirm your new email</h1><p class="act-p">Enter your password to finish the change.</p>
      <form id="act-form" class="stack" style="text-align:left">
        <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn primary" style="width:100%;justify-content:center">Confirm</button>
      </form>`);
    $("#act-form").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("button.primary", e.target); btn.disabled = true; btn.classList.add("loading");
      try {
        await pb.collection("users").confirmEmailChange(token, new FormData(e.target).get("password"));
        pb.authStore.clear();
        $("#act-body").innerHTML = `${actSeal(true)}<h1 class="act-h">Email updated</h1><p class="act-p">Sign in with your new email address.</p><button class="btn primary act-go" id="act-go">Sign in</button>`;
        $("#act-go").onclick = () => { history.replaceState(null, "", "#/login"); route(); };
      } catch (_) {
        btn.disabled = false; btn.classList.remove("loading");
        toast("That didn't work. Check your password, or the link may have expired.");
      }
    };
    void goHome;
  }

  // ------------------------------------------------------------------ public homepage
  function renderPublic() {
    const h = location.hash.replace(/^#\/?/, "");
    if (h === "login" || h === "register") return renderAuth(h);
    const act = /^(verify|reset|email-change)\/([^/?#]+)/.exec(h);
    if (act) return renderAction(act[1], decodeURIComponent(act[2]));
    if (h.startsWith("reset") || h.startsWith("verify") || h.startsWith("email-change")) return renderAuth("login");
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
      </div>
      <div class="lp-cf"><div><div class="label">Lowest balance, next 30 days</div><div class="num lp-cf-v">$842.10 <span class="small muted">on Nov 21, before payday</span></div></div><div class="spacer"></div>${sparkline([2400, 2210, 1980, 1620, 1290, 980, 842, 2650, 2480, 2300, 2120])}</div>
      </div>`;
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
    reports: { title: "Reports", render: renderReports, month: true },
    recurring: { title: "Recurring", render: renderRecurring, month: true },
    subscriptions: { title: "Recurring", hidden: true, render: () => { recState.tab = "subscriptions"; history.replaceState(null, "", "#/recurring"); return route(); } },
    cashflow: { title: "Cash flow", render: renderCashflow },
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
      <nav class="sheet-nav">${[["Plan", ["recurring", "cashflow", "goals"]], ["Money", ["reports", "networth", "accounts"]], ["You", ["settings"]]].map(([h, ks]) => `<div class="sheet-h">${h}</div>${ks.filter((k) => ROUTES[k]).map((k) => `<a href="#/${k}" class="${k === r ? "active" : ""}">${icon(k)}${ROUTES[k].title}</a>`).join("")}`).join("")}</nav>
      <div class="foot">${esc(pb.authStore.record.email)} · Keel v${esc(state.status.version || "")}</div></div></div>`;
    const bg = $(".modal-bg", root);
    const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    $$("a", root).forEach((a) => a.addEventListener("click", close));
    const first = $("a", root); if (first) first.focus();
  }

  const skCard = (body) => `<div class="sk">${body}</div>`;
  const SKELETON = `<div class="sk-page" aria-busy="true" aria-label="Loading"><div class="sk-row">${skCard('<i class="s"></i><i class="h"></i><i></i>').repeat(3)}</div>${skCard('<i class="s"></i><i class="t"></i>')}${skCard('<i></i><i></i><i class="s"></i>')}</div>`;

  async function route() {
    // a re-render removes whatever was hovered, so drop any open tooltip with it
    const tip = $("#viz-tip"); if (tip) tip.style.opacity = 0;
    if (reloadIfPending()) return; // a newer version is waiting: load it instead of rendering old code
    const act = /^#\/?(verify|reset|email-change)\/([^/?#]+)/.exec(location.hash);
    if (act) return renderAction(act[1], decodeURIComponent(act[2]));
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
    const moved = view.dataset.r !== r;
    view.dataset.r = r;
    if (moved) { view.classList.remove("enter"); view.innerHTML = SKELETON; window.scrollTo(0, 0); }
    try { await def.render(view); } catch (err) { fail(err); view.innerHTML = `<div class="card empty"><b>Couldn't load this page.</b><p class="small">${esc(errText(err))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; }
    if (moved) { void view.offsetWidth; view.classList.add("enter"); }
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
  // marks = [{ i, v, label, cls }] pins a labelled dot on a point, e.g. the lowest balance.
  function lineChart({ series, n, xLabel, tipFor, height = 220, yMinZero = true, ariaLabel, yMax = null, refs = [], marks = [] }) {
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
    // a reference label goes at the first corner of its line (right/left, above/below) the data doesn't run through
    const pts = series.flatMap((s) => s.values.map((v, i) => (v == null ? null : [x(i), y(Math.min(v, sc.max))])).filter(Boolean));
    for (const r of refs) {
      const ry = y(r.v), w = r.label.length * 6.2 + 6;
      const spots = [[W - R, ry - 5, "end"], [W - R, ry + 13, "end"], [L + 4, ry - 5, "start"], [L + 4, ry + 13, "start"]];
      const free = ([lx, ly, a]) => {
        const x0 = a === "end" ? lx - w : lx, x1 = a === "end" ? lx : lx + w;
        return !pts.some(([px, py]) => px >= x0 - 4 && px <= x1 + 4 && py >= ly - 13 && py <= ly + 4);
      };
      const [lx, ly, a] = spots.find(free) || spots[0];
      g += `<line class="ref" x1="${L}" x2="${W - R}" y1="${ry}" y2="${ry}"/><text class="ax ref-l" x="${lx}" y="${ly}" text-anchor="${a}">${esc(r.label)}</text>`;
    }
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
    for (const mk of marks) {
      const mx = x(mk.i), my = y(mk.v);
      const below = my < T + 30;
      const anchor = mx < L + 40 ? "start" : mx > W - R - 40 ? "end" : "middle";
      paths += `<circle class="mk-pt ${mk.cls || ""}" cx="${mx}" cy="${my}" r="6"/><text class="mk-l ${mk.cls || ""}" x="${mx}" y="${below ? my + 20 : my - 12}" text-anchor="${anchor}">${esc(mk.label)}</text>`;
    }
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
    items.forEach((it, i) => {
      const len = total ? (it.value / total) * C : 0;
      const dash = Math.max(0.5, len - GAP);
      segs += `<circle class="d-seg ${it.id != null ? "click" : ""}" data-i="${i}" r="${R}" cx="100" cy="100" fill="none" stroke="${it.color}" stroke-width="${SW}" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)" ${tipAttr(`<b>${esc(it.label)}</b><br>${money(it.value)} · ${total ? Math.round((it.value / total) * 100) : 0}%`)}/>`;
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
        <div class="small muted">${t.split ? `Split · ${esc(c ? c.name : "Uncategorized")} and more` : esc(c ? c.name : "Uncategorized")}${acc && state.accounts.length > 1 ? " · " + esc(acctLabel(acc)) : ""}</div></div>
      <div class="right"><div class="num ${t.amount > 0 ? "pos" : ""}">${t.amount > 0 ? "+" : "−"}${money(Math.abs(t.amount))}</div><div class="small muted">${prettyDate(t.date)}</div></div>
    </div>`;
  }

  // Upcoming bill with its date up front and urgency you can see without reading
  function dueLine(u, href = "#/recurring") {
    const [, m, dd] = dateOnly(u.date).split("-").map(Number);
    const mon = new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
    const urgent = u.days_until <= 1, soon = u.days_until <= 3;
    const when = urgent || soon ? `<span class="pill ${urgent ? "warn-p" : ""}">${esc(dueText(u.days_until))}</span>` : `<span class="small muted">${esc(dueText(u.days_until))}</span>`;
    return `<a class="bill-line due-line" href="${href}"><span class="due-d${urgent ? " soon" : ""}" aria-hidden="true"><b>${dd}</b><span>${esc(mon)}</span></span>
      <div class="grow"><div class="t-name">${esc(u.name)}</div><div>${when}</div></div><div class="num ${u.kind === "income" ? "pos" : ""}">${u.kind === "income" ? "+" : ""}${money(u.amount)}</div></a>`;
  }

  // ------------------------------------------------------------------ dashboard
  // Answers three things first: how am I doing (Left to spend + status), what needs me (attention list),
  // what's coming (upcoming bills). Everything else supports those.
  async function renderDashboard(view) {
    const b = monthBounds(state.month);
    const [d, rec, nw, recent, goals, cf] = await Promise.all([
      api("/api/budget/insights", { query: { month: state.month } }),
      api("/api/budget/recurring", { query: { month: state.month } }),
      api("/api/budget/networth", { query: { days: 30 } }),
      pb.collection("transactions").getList(1, 6, { sort: "-date,-created", filter: pb.filter("date < {:e}", { e: b.end }) }),
      api("/api/budget/goals").then((x) => x.goals.filter((g) => g.status !== "done").slice(0, 4)),
      api("/api/budget/forecast", { query: { days: 30, accounts: cfAccountsParam() } }).catch(() => null),
      loadCategories(), loadAccounts(),
    ]);
    const today = d.daily.today;
    const cur = d.daily.current, prev = d.daily.previous;
    const [yy, mm] = state.month.split("-").map(Number);
    const dim = new Date(yy, mm, 0).getDate();
    const curNow = today ? cur[today - 1] : 0;
    const prevSame = today ? prev[Math.min(today, prev.length) - 1] || 0 : 0;
    const diff = curNow - prevSame;
    const prevTotal = prev[prev.length - 1] || 0;
    const compare = !prevTotal && !curNow ? "No spending yet."
      : d.is_current ? (Math.abs(diff) < 1 ? "About the same as last month so far" : diff < 0 ? `<b class="pos">${money(-diff)} less</b> than last month so far` : `<b class="negc">${money(diff)} more</b> than last month so far`)
        : `Last month: ${money(prevTotal)}`;
    const n = Math.max(cur.length, prev.length);
    const prevKey = shiftMonth(state.month, -1);
    const curMax = Math.max(0, ...cur.slice(0, today || cur.length));
    const prevMax = Math.max(0, ...prev);
    const target = d.budgeted > 0 ? d.budgeted : 0;
    const capAt = Math.max(curMax * 1.25, target * 1.1, prevSame * 1.25, 1);
    const yMax = prevMax > capAt ? capAt : null;
    const chart = lineChart({
      n, ariaLabel: "Cumulative spending this month vs last month", yMax, height: 170,
      refs: target ? [{ v: target, label: `Budget ${compact(target)}` }] : [],
      series: [
        { values: prev.concat(Array(n - prev.length).fill(null)), color: "var(--muted)", dashed: true },
        { values: cur.map((v, i) => (i < today ? v : null)), color: "var(--s1)", area: true, endDot: true },
      ],
      xLabel: (i) => dayLabel(state.month, i + 1),
      tipFor: (i) => `<b>${esc(dayLabel(state.month, i + 1))}</b><br>This month: ${i < today ? money(cur[i]) : "—"}<br><span class="muted">${esc(dayLabel(prevKey, Math.min(i + 1, prev.length)))}: ${prev[i] != null ? money(prev[i]) : "—"}</span>`,
    });

    // ---- how am I doing: bills are lumpy (rent on the 1st), so pace is judged on everyday spending
    const left = d.budget_left;
    const hasBudget = d.budgeted > 0;
    const usedPct = hasBudget ? Math.min(100, (d.spent / d.budgeted) * 100) : 0;
    const flexBudget = Math.max(0, d.budgeted - d.bills.expenses);
    const flexSpent = Math.max(0, d.spent - d.bills.paid_this_month);
    const flexPace = d.is_current && today ? flexBudget * (today / dim) : flexBudget;
    const paceGap = flexPace - flexSpent;
    const expectNow = hasBudget && d.is_current ? Math.min(100, ((d.bills.paid_this_month + flexPace) / d.budgeted) * 100) : null;
    let status = null;
    if (hasBudget) {
      if (left < 0) status = ["bad", "Over budget", d.is_current ? `You're ${money(-left)} past this month's budget. Anything more adds to it.` : `This month ended ${money(-left)} over budget.`];
      else if (!d.is_current) status = state.month < thisMonth() ? ["good", "Finished under", `This month ended ${money(left)} under budget.`] : null;
      else if (paceGap >= 0) status = ["good", "On track", `Everyday spending is ${money(paceGap)} under pace for day ${today}. Keep it under ${money(d.safe_per_day)} a day.`];
      else status = ["warn", "Ahead of pace", `Everyday spending is ${money(-paceGap)} ahead of pace for day ${today}. ${money(d.safe_per_day)} a day keeps you on budget.`];
    }

    // ---- what needs my attention
    const att = [];
    if (cf && !cf.empty && cf.below_floor_day) att.push(["warn", `Checking may drop below ${money(cf.floor)} around ${prettyDate(cf.below_floor_day)}`, "#/cashflow", "See forecast"]);
    if (cf && !cf.empty && cf.low.balance < 0 && !cf.below_floor_day) att.push(["bad", `Checking is projected to go negative around ${prettyDate(cf.low.day)}`, "#/cashflow", "See forecast"]);
    const dueSoon = rec.upcoming.filter((u) => u.kind !== "income" && u.days_until >= 0 && u.days_until <= 3);
    if (dueSoon.length === 1) att.push(["info", `${dueSoon[0].name} (${money(dueSoon[0].amount)}) is due ${dueText(dueSoon[0].days_until).toLowerCase()}`, "#/recurring", "Recurring"]);
    else if (dueSoon.length > 1) att.push(["info", `${dueSoon.length} bills due in the next 3 days, ${money(dueSoon.reduce((s, u) => s + u.amount, 0))} in all`, "#/recurring", "Recurring"]);
    for (const c of d.categories.filter((c) => c.kind !== "income" && c.budget > 0 && c.available > 0).sort((a, z) => z.spent / z.available - a.spent / a.available)) {
      if (c.remaining < 0) att.push(["bad", `${c.name} is ${money(-c.remaining)} over budget`, "#/budget", "Budget"]);
      // a bill paid in full (rent: $1,650 of $1,650) isn't a warning
      else if (d.is_current && c.remaining >= 1 && c.spent / c.available >= 0.85) att.push(["warn", `${c.name} has ${money(c.remaining)} left (${Math.round((c.spent / c.available) * 100)}% used)`, "#/budget", "Budget"]);
    }
    if (d.uncategorized.count) att.push(["info", `${plural(d.uncategorized.count, "transaction")} (${money(d.uncategorized.amount)}) need a category`, "#/transactions?uncat=1", "Categorize"]);
    for (const g of goals.filter((g) => g.status === "behind" && g.per_day != null).slice(0, 1)) att.push(["info", `${g.name} is behind: add ${money(g.per_day)}/day to reach it by ${prettyDate(g.target_date)}`, "#/goals", "Goals"]);
    const attention = att.slice(0, 5);
    const tips = d.tips.slice(0, Math.max(0, 4 - attention.length));

    const bills = rec.upcoming.filter((u) => u.days_until >= 0 && u.days_until <= 14);
    const billsOut = bills.filter((u) => u.kind !== "income").reduce((s, u) => s + u.amount, 0);
    const spendCats = d.categories.filter((c) => c.kind !== "income" && c.spent > 0).sort((a, z) => z.spent - a.spent).slice(0, 5);
    const topMax = Math.max(1, ...spendCats.map((c) => Math.max(c.spent, c.budget)));
    const nwPct = nw.net - nw.change !== 0 ? (nw.change / Math.abs(nw.net - nw.change)) * 100 : 0;

    const hero = hasBudget ? `
      <section class="card ov-hero" aria-labelledby="ov-left">
        <div class="row"><h2 id="ov-left" class="label">Left to spend${d.is_current ? "" : ` in ${esc(monthLabel(state.month))}`}</h2><div class="spacer"></div>${status ? `<span class="pill ${status[0] === "good" ? "ok" : status[0] === "bad" ? "err" : "warn-p"}">${status[1]}</span>` : ""}</div>
        <div class="ov-big num ${left < 0 ? "negc" : ""}">${left < 0 ? "−" : ""}${money(Math.abs(left))}</div>
        ${status ? `<p class="ov-status">${status[2]}</p>` : ""}
        <div class="bar ov-bar ${barClass(Math.round((d.spent / d.budgeted) * 100))}" role="progressbar" aria-label="Budget used" aria-valuenow="${Math.round(usedPct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${usedPct}%"></i>${expectNow != null ? `<b style="left:${expectNow}%" ${tipAttr(`Where you'd be today on pace: <b>${esc(money(d.budgeted * expectNow / 100))}</b>`)}></b>` : ""}</div>
        <div class="ov-facts">
          <div><span class="label">Spent</span><b class="num">${money(d.spent)}</b><span class="small muted">of ${money(d.budgeted)}</span></div>
          ${d.is_current && d.remaining_days ? `<div><span class="label">Safe per day</span><b class="num">${money(Math.max(0, d.safe_per_day))}</b><span class="small muted">${plural(d.remaining_days, "day")} left</span></div>` : ""}
          <div><span class="label">Bills still due</span><b class="num">${money(d.bills.remaining_this_month)}</b><span class="small muted">${money(d.bills.paid_this_month)} paid</span></div>
        </div>
        <a class="ov-more" href="#/budget">Open budget <span aria-hidden="true">→</span></a>
      </section>` : `
      <section class="card ov-hero">
        <h2 class="label">Spent ${d.is_current ? "this month" : "in " + esc(monthLabel(state.month))}</h2>
        <div class="ov-big num">${money(d.spent)}</div>
        <p class="ov-status">${compare}. Set one monthly spending number and Keel shows what's left, what's safe per day and whether you're on track.</p>
        <a class="btn primary" href="#/budget">Create a budget</a>
      </section>`;

    view.innerHTML = `
      <div class="stack">${installBanner()}
        <div class="grid ov-top">
          ${hero}
          <section class="card" aria-labelledby="ov-att">
            <div class="card-h"><h2 id="ov-att">Needs attention</h2>${attention.length ? `<span class="pill">${attention.length}</span>` : ""}</div>
            ${attention.length ? `<ul class="att">${attention.map(([lv, text, href, label]) => `<li class="${lv}"><span class="grow">${esc(text)}</span><a class="btn sm" href="${href}">${label}</a></li>`).join("")}</ul>`
              : `<div class="att-ok"><span class="act-seal ok sm" aria-hidden="true"><svg viewBox="0 0 52 52"><path class="act-tick" d="M16 27l7 7 14-15"/></svg></span><div><b>You're all caught up</b><div class="small muted">No bills due in the next few days, nothing over budget, nothing to categorize.</div></div></div>`}
            ${tips.length ? `<div class="kind-h">Insights</div><ul class="tips">${tips.map((t) => `<li class="${t.level}">${esc(t.text)}</li>`).join("")}</ul>` : ""}
          </section>
        </div>

        <div class="grid ov-mid">
          <section class="card" aria-labelledby="ov-pace">
            <div class="card-h"><div><h2 id="ov-pace">Spending this month</h2><div class="small muted">${compare}</div></div><div class="spacer"></div>
              <div class="legend" style="margin:0"><span style="--c:var(--s1)">This month</span><span class="dash" style="--c:var(--muted)">Last month${yMax != null ? ` (${esc(compact(prevTotal))})` : ""}</span></div></div>
            ${chart}
          </section>
          <section class="card" aria-labelledby="ov-up">
            <div class="card-h"><h2 id="ov-up">Upcoming</h2><div class="spacer"></div><span class="small muted">next 14 days${billsOut ? ` · ${money(billsOut)} out` : ""}</span></div>
            ${bills.length ? bills.slice(0, 5).map((u) => dueLine(u)).join("") + (bills.length > 5 ? `<a class="small ov-more" href="#/recurring">${bills.length - 5} more →</a>` : "")
              : `<div class="muted small">Nothing due in the next two weeks.${rec.items.length ? "" : ` Recurring charges are detected from your history; <a href="#/recurring">add one</a>.`}</div>`}
          </section>
        </div>

        <div class="grid two">
          <section class="card" aria-labelledby="ov-rec">
            <div class="card-h"><h2 id="ov-rec">Recent transactions</h2><div class="spacer"></div><a href="#/transactions" class="small">See all →</a></div>
            ${recent.items.length ? recent.items.map(txLine).join("") : `<div class="empty">No transactions yet. <a href="#/accounts">Connect a bank</a> or import a CSV.</div>`}
          </section>
          <div class="stack">
            ${cf && !cf.empty ? `<a class="card" href="#/cashflow" aria-label="Cash flow forecast">
              <div class="card-h"><h2>Cash flow</h2><div class="spacer"></div><span class="small link-t">Forecast →</span></div>
              <div class="row" style="align-items:flex-end;flex-wrap:nowrap"><div><div class="label">Lowest in the next 30 days</div><div class="kpi-v num ${cf.below_floor_day || cf.low.balance < 0 ? "negc" : ""}">${money(cf.low.balance)}</div>
                <div class="small muted">${cf.low.day === cf.today ? "Today" : esc(prettyDate(cf.low.day))}${cf.next_income ? ` · next deposit ${esc(prettyDate(cf.next_income.day))}` : ""}</div></div>
                <div class="spacer"></div>${sparkline(cf.points.filter((p, i) => i % 2 === 0).map((p) => p.balance))}</div>
            </a>` : ""}
            <a class="card" href="#/networth" aria-label="Net worth">
              <div class="card-h"><h2>Net worth</h2><div class="spacer"></div><span class="small link-t">Details →</span></div>
              <div class="kpi-v num">${money(nw.net)}</div>
              <div class="small muted">${nw.change === 0 ? "No change" : `${signed(nw.change)} (${nwPct >= 0 ? "+" : "−"}${Math.abs(nwPct).toFixed(1)}%)`} in the last 30 days</div>
            </a>
            <section class="card" aria-labelledby="ov-cat">
              <div class="card-h"><h2 id="ov-cat">Top categories</h2><div class="spacer"></div><a href="#/spending" class="small">Spending →</a></div>
              ${spendCats.length ? spendCats.map((c) => `<div class="cat-row"><div>${catLabel(c)}</div><div class="num">${money(c.spent)}${c.budget ? ` <span class="muted">/ ${money(c.budget)}</span>` : ""}</div>
                <div class="bar ${c.budget ? barClass(c.pct) : ""}"><i style="width:${(c.spent / topMax) * 100}%"></i></div></div>`).join("") : `<div class="muted small">No spending yet this month.</div>`}
            </section>
          </div>
        </div>

        ${goals.length ? `<section class="card"><div class="card-h"><h2>Goals</h2><div class="spacer"></div><a href="#/goals" class="small">All goals →</a></div>
          <div class="grid goals-grid">${goals.map(goalCard).join("")}</div></section>` : ""}
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
    const big = s.categories[0];
    const said = [];
    if (big && s.total) said.push(`<b>${esc(big.name)}</b> is your biggest category at ${Math.round((big.total / s.total) * 100)}% of spending`);
    if (base && Math.abs(vsAvg) >= Math.max(5, base * 0.03)) said.push(`you're spending ${money(Math.abs(vsAvg))} ${vsAvg > 0 ? "more" : "less"} than ${paced ? "usual at this point in the month" : "an average month"}`);
    else if (base) said.push(`you're spending about what you usually do${paced ? " by now" : ""}`);
    if (s.merchants[0] && s.merchants[0].count > 2) said.push(`${esc(s.merchants[0].name)} shows up ${s.merchants[0].count} times`);
    const summary = said.length ? `<p class="sp-sum">${cap(said.join(", ").replace(/, ([^,]*)$/, said.length > 2 ? ", and $1" : " and $1"))}.</p>` : "";

    view.innerHTML = `
      <div class="stack">
        ${summary}
        <div class="grid kpis">
          <div class="card kpi"><div class="label">Spent</div><div class="value num">${money(s.total)}</div><div class="sub">${plural(s.transactions, "purchase")}</div></div>
          <div class="card kpi"><div class="label">${paced ? "vs usual at this point" : `vs ${s.months_compared || 5}-month average`}</div><div class="value num">${base ? money(Math.abs(vsAvg)) + `<span class="${vsAvg > 0 ? "negc" : "pos"}" style="font-size:14px;font-weight:600"> ${vsAvg > 0 ? "more" : "less"}</span>` : "—"}</div><div class="sub">${paced ? `Usually ${money(base)} by day ${s.day} · ${money(s.average)} a full month` : `Average ${money(s.average)} a month`}</div></div>
          <div class="card kpi"><div class="label">Income</div><div class="value num pos">${money(s.income)}</div><div class="sub">${s.income ? `Spent ${Math.round((s.total / s.income) * 100)}% of income` : "No income this month"}</div></div>
        </div>
        <div class="grid two">
          <div class="card">
            <div class="card-h"><h2>By category</h2>${uncat ? `<div class="spacer"></div><span class="small muted">${money(uncat.total)} uncategorized</span><a class="btn sm" href="#/transactions?uncat=1">Categorize</a>` : ""}</div>
            ${s.categories.length ? `<div class="donut-wrap">${donut(items, s.total, "spent")}
              <div class="d-legend">${items.map((it, i) => `<button class="d-item" data-i="${i}" ${it.id != null ? `data-cat="${it.id}"` : "disabled"}>${catMark(it.cat, true)}<span class="grow">${esc(it.label)}</span><span class="num">${money(it.value)}</span><span class="num muted small">${s.total ? Math.round((it.value / s.total) * 100) : 0}%</span></button>`).join("")}</div></div>`
              : `<div class="empty">No spending in ${esc(monthLabel(state.month))}.</div>`}
            ${s.excluded && s.excluded.count ? `<div class="row small muted ex-note"><span>${plural(s.excluded.count, "transaction")} (${money(Math.abs(s.excluded.total))}) not counted because you excluded ${s.excluded.count === 1 ? "it" : "them"}</span><div class="spacer"></div><a href="#/transactions?excluded=1">View</a></div>` : ""}
          </div>
          <div class="card">
            <div class="card-h"><h2>Top merchants</h2><div class="spacer"></div><span class="small muted">${esc(monthLabel(state.month))}</span></div>
            ${s.merchants.length ? `<ol class="m-list">${s.merchants.slice(0, 10).map((m, i) => `<li><span class="m-rank num">${i + 1}</span><span class="grow desc">${esc(m.name)}</span><span class="small muted num">${plural(m.count, "visit")}</span><span class="m-meter" aria-hidden="true"><i style="width:${(m.total / merchMax) * 100}%"></i></span><span class="num m-amt">${money(m.total)}</span></li>`).join("")}</ol>` : `<div class="muted small">Nothing yet.</div>`}
          </div>
        </div>
        <div class="card"><div class="card-h"><h2>Last 6 months</h2></div>${monthBars(s.trend, s.average, state.month)}</div>
      </div>`;
    const goCat = (id) => { txState.category = id || "__none"; txState.page = 1; location.hash = "#/transactions"; };
    $$(".d-item[data-cat]", view).forEach((b) => (b.onclick = () => goCat(b.dataset.cat)));
    // the donut and its legend highlight each other; a slice opens its transactions
    const dw = $(".donut-wrap", view);
    if (dw) {
      const hi = (i) => { dw.classList.toggle("hl", i != null); $$("[data-i]", dw).forEach((el) => el.classList.toggle("on", el.dataset.i === i)); };
      $$("[data-i]", dw).forEach((el) => { el.addEventListener("mouseenter", () => hi(el.dataset.i)); el.addEventListener("mouseleave", () => hi(null)); el.addEventListener("focus", () => hi(el.dataset.i)); el.addEventListener("blur", () => hi(null)); });
      $$(".d-seg.click", dw).forEach((el) => el.addEventListener("click", () => { const it = items[+el.dataset.i]; if (it && it.id != null) goCat(it.id); }));
    }
  }

  // ------------------------------------------------------------------ reports
  // Month or year in review: what came in, what went out, what you kept, and what changed.
  const repState = { kind: "month", year: null };

  // income and spending side by side for each month of a year
  function pairBars(months) {
    const W = 640, H = 220, L = 52, R = 14, T = 14, B = 26;
    const sc = scale(0, Math.max(1, ...months.map((m) => Math.max(m.income, m.spent))));
    const y = (v) => T + (1 - v / sc.max) * (H - T - B);
    const gw = (W - L - R) / months.length, bw = Math.min(16, gw * 0.3), gap = 2;
    let g = "";
    for (const t of sc.ticks) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
    const bar = (x0, v, color) => {
      if (!(v > 0)) return "";
      const top = y(v), base = y(0), r = Math.min(3, (base - top) / 2);
      return `<path d="M${x0} ${base}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x0 + bw - r}Q${x0 + bw} ${top} ${x0 + bw} ${top + r}V${base}Z" fill="${color}"/>`;
    };
    let bars = "";
    months.forEach((m, i) => {
      const cx = L + i * gw + gw / 2;
      bars += bar(cx - bw - gap / 2, m.income, "var(--s3)") + bar(cx + gap / 2, m.spent, "var(--s1)");
      const net = m.income - m.spent;
      const tip = m.future ? `<b>${esc(monthLabel(m.month))}</b><br><span class="muted">Not here yet</span>`
        : `<b>${esc(monthLabel(m.month))}</b><br>In ${money(m.income)}<br>Spent ${money(m.spent)}${m.income || m.spent ? `<br>${net >= 0 ? "Kept" : "Short"} ${money(Math.abs(net))}` : ""}`;
      bars += `<rect class="hit" x="${L + i * gw}" y="${T}" width="${gw}" height="${H - T - B}" ${tipAttr(tip)}/>`;
      bars += `<text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle" ${m.future ? 'opacity=".45"' : ""}>${esc(shortMonth(m.month))}</text>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and spending by month">${g}${bars}</svg></div>`;
  }

  async function renderReports(view) {
    const isYear = repState.kind === "year";
    const year = repState.year || Number(state.month.slice(0, 4));
    const d = await api("/api/budget/reports", { query: isYear ? { kind: "year", year } : { month: state.month } });
    await loadCategories();
    // the month picker steps months; a year report has its own year switcher
    $("#month-picker").classList.toggle("hidden", isYear);
    const thisYear = Number(thisMonth().slice(0, 4));
    const label = isYear ? String(d.year) : monthLabel(d.key);
    const prevLabel = isYear ? String(d.prev.year) : monthLabel(d.prev.key).split(" ")[0];
    const soFar = d.is_current;
    const delta = (n, goodUp) => {
      if (Math.abs(n) < 0.5) return `<span class="muted">same as</span>`;
      const good = goodUp ? n > 0 : n < 0;
      return `<b class="${good ? "pos" : "negc"}">${n > 0 ? "+" : "−"}${money(Math.abs(n))}</b> vs`;
    };
    const vs = d.prev.has_data ? `${d.prev.partial ? `${prevLabel} at this point` : prevLabel}` : "";
    const sub = (cur, before, goodUp) => (d.prev.has_data ? `${delta(cur - before, goodUp)} ${esc(vs)}` : `<span class="muted">No ${isYear ? "earlier year" : "earlier month"} to compare</span>`);

    const empty = !(d.income > 0 || d.spent > 0);
    // one plain sentence first
    let say = "";
    if (!empty) {
      say = `${soFar ? `So far in ${isYear ? d.year : monthLabel(d.key).split(" ")[0]}` : `In ${esc(label)}`} you brought in <b>${money(d.income)}</b> and spent <b>${money(d.spent)}</b>`;
      if (d.income > 0) say += d.net >= 0 ? `, keeping <b>${money(d.net)}</b>${d.savings_rate != null ? ` (${d.savings_rate}% of income)` : ""}` : `, <b>${money(-d.net)}</b> more than came in`;
      say += ".";
      if (d.prev.has_data && Math.abs(d.spent - d.prev.spent) >= 1) say += ` Spending was ${money(Math.abs(d.spent - d.prev.spent))} ${d.spent > d.prev.spent ? "higher" : "lower"} than ${esc(vs)}.`;
      if (d.up && d.up[0]) say += ` The biggest jump was <b>${esc(d.up[0].name)}</b>, up ${money(d.up[0].change)}.`;
    }
    const cmpLabel = isYear ? `vs ${d.prev.year}${d.prev.partial ? " at this point" : ""}` : `vs your ${d.compare_months}-month average${d.is_current ? " at this point" : ""}`;
    const mover = (c) => `<li><span class="grow">${catLabel(c.id ? catById(c.id) || c : null)}</span><span class="small muted num">${money(c.before)} → ${money(c.total)}</span><span class="num rep-ch ${c.change > 0 ? "negc" : "pos"}">${c.change > 0 ? "+" : "−"}${money(Math.abs(c.change))}</span></li>`;
    const merchMax = Math.max(1, ...d.merchants.map((m) => m.total));
    const subMax = Math.max(1, ...d.subscriptions.items.map((m) => m.total));
    const yearNav = isYear ? `<div class="month-picker rep-year"><button id="ry-prev" aria-label="Previous year">${icon("left")}</button><span aria-live="polite">${d.year}</span><button id="ry-next" aria-label="Next year" ${d.year >= thisYear ? "disabled" : ""}>${icon("right")}</button></div>` : "";

    view.innerHTML = `
      <div class="stack">
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <div class="seg" role="tablist" aria-label="Report period">${[["month", "Month"], ["year", "Year"]].map(([k, l]) => `<button role="tab" data-kind="${k}" aria-selected="${repState.kind === k}" class="${repState.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>
          ${yearNav}<div class="spacer"></div>
          ${soFar ? `<span class="pill">${isYear ? "Year" : "Month"} in progress</span>` : ""}
        </div>
        ${empty ? `<div class="card empty">Nothing recorded for ${esc(label)} yet.</div>` : `
        <p class="sp-sum">${say}</p>
        <div class="grid kpis">
          <div class="card kpi"><div class="label">Income</div><div class="value num pos">${money(d.income)}</div><div class="sub">${sub(d.income, d.prev.income, true)}</div></div>
          <div class="card kpi"><div class="label">Spent</div><div class="value num">${money(d.spent)}</div><div class="sub">${sub(d.spent, d.prev.spent, false)}</div></div>
          <div class="card kpi"><div class="label">${d.net >= 0 ? "Kept" : "Short"}</div><div class="value num ${d.net < 0 ? "negc" : ""}">${money(Math.abs(d.net))}${d.savings_rate != null && d.net > 0 ? `<span class="muted" style="font-size:14px;font-weight:600"> ${d.savings_rate}% saved</span>` : ""}</div>
            <div class="sub">${d.prev.has_data && d.prev.savings_rate != null ? `${d.prev.savings_rate}% in ${esc(vs)}` : d.income > 0 ? "Of what came in" : "No income recorded"}</div></div>
        </div>
        ${isYear ? `<section class="card" aria-labelledby="rep-mo">
          <div class="card-h"><div><h2 id="rep-mo">Month by month</h2><div class="small muted">${d.avg_spent ? `About ${money(d.avg_spent)} spent a month` : ""}${d.best_month ? ` · best ${esc(shortMonth(d.best_month.month))} (kept ${money(d.best_month.income - d.best_month.spent)})` : ""}${d.worst_month && d.worst_month.month !== (d.best_month || {}).month ? ` · toughest ${esc(shortMonth(d.worst_month.month))}` : ""}</div></div><div class="spacer"></div>
            <div class="legend" style="margin:0"><span style="--c:var(--s3)">Income</span><span style="--c:var(--s1)">Spent</span></div></div>
          ${pairBars(d.months)}
        </section>` : ""}
        <div class="grid two top-align">
          <section class="card" aria-labelledby="rep-ch">
            <div class="card-h"><div><h2 id="rep-ch">What changed</h2><div class="small muted">${esc(cmpLabel)}</div></div></div>
            ${d.up.length || d.down.length ? `
              ${d.up.length ? `<div class="kind-h">Up</div><ul class="rep-list">${d.up.map(mover).join("")}</ul>` : ""}
              ${d.down.length ? `<div class="kind-h">Down</div><ul class="rep-list">${d.down.map(mover).join("")}</ul>` : ""}`
              : `<div class="muted small">${(isYear ? d.prev.has_data : d.compare_months) ? "No category moved by more than $10." : `Not enough history yet. This fills in once there's an earlier ${isYear ? "year" : "month"} to compare with.`}</div>`}
          </section>
          <section class="card" aria-labelledby="rep-me">
            <div class="card-h"><h2 id="rep-me">Top merchants</h2></div>
            ${d.merchants.length ? `<ol class="m-list">${d.merchants.map((m, i) => `<li><span class="m-rank num">${i + 1}</span><span class="grow desc">${esc(m.name)}</span><span class="small muted num">${plural(m.count, "visit")}</span><span class="m-meter" aria-hidden="true"><i style="width:${(m.total / merchMax) * 100}%"></i></span><span class="num m-amt">${money(m.total)}</span></li>`).join("")}</ol>` : `<div class="muted small">No purchases.</div>`}
          </section>
        </div>
        <div class="grid two top-align">
          <section class="card" aria-labelledby="rep-ca">
            <div class="card-h"><h2 id="rep-ca">By category</h2><div class="spacer"></div><span class="small muted">${d.prev.has_data || d.compare_months ? esc(cmpLabel.replace(/^vs /, "Change vs ")) : ""}</span></div>
            <div class="rep-cats">${d.categories.filter((c) => c.total > 0).map((c) => `<div class="rep-cat"><span class="grow">${catLabel(c.id ? catById(c.id) || c : null)}</span><span class="num">${money(c.total)}</span><span class="num small rep-ch ${Math.abs(c.change) < 1 ? "muted" : c.change > 0 ? "negc" : "pos"}">${(isYear ? d.prev.has_data : d.compare_months) ? (Math.abs(c.change) < 1 ? "—" : `${c.change > 0 ? "+" : "−"}${money(Math.abs(c.change))}`) : ""}</span></div>`).join("")}</div>
          </section>
          <div class="stack">
            <section class="card" aria-labelledby="rep-su">
              <div class="card-h"><h2 id="rep-su">Subscriptions</h2><div class="spacer"></div><span class="num"><b>${money(d.subscriptions.total)}</b></span></div>
              ${d.subscriptions.items.length ? `<ol class="m-list">${d.subscriptions.items.map((s) => `<li><span class="grow desc">${esc(s.name)}${s.status !== "active" ? ' <span class="pill">cancelled</span>' : ""}</span><span class="small muted num">${plural(s.count, "charge")}</span><span class="m-meter" aria-hidden="true"><i style="width:${(s.total / subMax) * 100}%;background:var(--s7)"></i></span><span class="num m-amt">${money(s.total)}</span></li>`).join("")}</ol>
                ${isYear ? "" : `<p class="small muted" style="margin:10px 0 0">About ${money(d.subscriptions.total * 12)} a year at this rate. <a href="#/recurring">Review subscriptions</a></p>`}`
                : `<div class="muted small">No subscription charges ${isYear ? "this year" : "this month"}.</div>`}
            </section>
            <section class="card" aria-labelledby="rep-la">
              <div class="card-h"><h2 id="rep-la">Largest purchases</h2></div>
              ${d.largest.length ? d.largest.map((t) => `<div class="m-row"><span>${esc(t.name)} <span class="muted small">${esc(prettyDate(t.date))}</span></span><span class="num">${money(t.amount)}</span></div>`).join("") : `<div class="muted small">None.</div>`}
            </section>
          </div>
        </div>`}
      </div>`;
    $$("[data-kind]", view).forEach((b) => (b.onclick = () => { repState.kind = b.dataset.kind; repState.year = null; route(); }));
    const yp = $("#ry-prev"), yn = $("#ry-next");
    if (yp) yp.onclick = () => { repState.year = d.year - 1; route(); };
    if (yn) yn.onclick = () => { if (d.year < thisYear) { repState.year = d.year + 1; route(); } };
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
              <div><div class="kind-h">Next 30 days</div>${upcoming.length ? upcoming.map((u) => {
                const [, mo, dd] = dateOnly(u.date).split("-").map(Number);
                const urgent = u.days_until <= 1, soon = u.days_until <= 3;
                const kindL = u.kind === "income" ? "Income" : u.kind === "subscription" ? "Subscription" : "Bill";
                return `<div class="tx-line click rec due-line" data-id="${u.id}" role="button" tabindex="0"><span class="due-d${urgent ? " soon" : ""}" aria-hidden="true"><b>${dd}</b><span>${esc(new Date(2000, mo - 1, 1).toLocaleDateString(undefined, { month: "short" }))}</span></span>
                  <div class="grow"><div class="t-name">${esc(u.name)}</div><div class="small muted">${urgent || soon ? `<span class="pill ${urgent ? "warn-p" : ""}">${esc(dueText(u.days_until))}</span>` : esc(dueText(u.days_until))} · <span class="rk rk-${u.kind}">${kindL}</span></div></div><div class="num ${u.kind === "income" ? "pos" : ""}">${u.kind === "income" ? "+" : ""}${money(u.amount)}</div></div>`;
              }).join("") : `<div class="muted small">Nothing due in the next 30 days.</div>`}</div>
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
    $$(".rec", view).forEach((el) => {
      el.onclick = () => editRecurring(byId[el.dataset.id]);
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } };
    });
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
    const list = (arr) => arr.length ? arr.map(({ label, g }) => `<details class="nw-g" open><summary><span class="nw-chev" aria-hidden="true">▸</span><span class="grow"><b>${label}</b> <span class="muted small">${plural(g.accounts.length, "account")}</span></span><span class="num">${money(Math.abs(g.total))}</span></summary>
      ${g.accounts.map((a) => `<div class="acct-row"><span>${esc(acctLabel(a))}${a.institution ? ` <span class="muted small">${esc(a.institution)}</span>` : ""}</span><span class="num">${money(Math.abs(a.value))}</span></div>`).join("")}</details>`).join("") : "";
    const startNet = nw.net - nw.change;
    const pctCh = startNet ? (nw.change / Math.abs(startNet)) * 100 : 0;
    view.innerHTML = `
      <div class="stack">
        <div class="card hero">
          <div class="card-h"><div><div class="label">Net worth</div><div class="big num">${money(nw.net)}</div>
            <div class="small muted">${nw.change === 0 ? "No change" : `<span class="${nw.change > 0 ? "pos" : "negc"}">${signed(nw.change)}${startNet ? ` (${pctCh >= 0 ? "+" : "−"}${Math.abs(pctCh).toFixed(1)}%)` : ""}</span>`} over the last ${nwState.days} days</div></div>
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

  // One transaction as a table row on desktop (merchant, category, account, amount) and a two-line row on phones.
  function txRow(t) {
    const c = catById(t.category);
    const acc = accById(t.account);
    const catName = c ? c.name : "Uncategorized";
    const inflow = t.amount > 0;
    return `<div class="tx-row click" data-id="${t.id}" role="button" tabindex="0">
      ${avatar(t.payee || t.description, c)}
      <div class="tx-m"><div class="t-name">${esc(t.payee || t.description || "Transaction")}${t.pending ? ' <span class="pill">pending</span>' : ""}${t.exclude ? ' <span class="pill">excluded</span>' : ""}</div>
        <div class="small muted tx-sub">${t.split ? `Split · ${esc(catName)} and more` : esc(catName)}${acc && state.accounts.length > 1 ? " · " + esc(acctLabel(acc)) : ""}</div></div>
      <div class="tx-c">${t.split ? `<span class="cl">${catMark(c, true)}<span>${esc(catName)} <span class="muted">+ split</span></span></span>` : catLabel(c)}</div>
      <div class="tx-a small muted">${acc ? esc(acctLabel(acc)) : ""}</div>
      <div class="tx-amt num ${inflow ? "pos" : ""}">${inflow ? "+" : "−"}${money(Math.abs(t.amount))}${inflow ? '<span class="sr-only"> in</span>' : '<span class="sr-only"> out</span>'}</div>
    </div>`;
  }

  async function renderTransactions(view) {
    await Promise.all([loadCategories(), loadAccounts()]);
    if (/uncat=1/.test(location.hash)) { txState.category = "__none"; history.replaceState(null, "", "#/transactions"); }
    if (/excluded=1/.test(location.hash)) { txState.category = "__excluded"; history.replaceState(null, "", "#/transactions"); }
    const active = (txState.account ? 1 : 0) + (txState.category ? 1 : 0);
    view.innerHTML = `
      <div class="card tx-card">
        <div class="tx-bar">
          <label class="search"><span class="sr-only">Search transactions</span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input id="tq" type="search" placeholder="${matchMedia("(max-width: 760px)").matches ? "Search" : "Search merchant, description or notes"}" value="${esc(txState.q)}"></label>
          <button class="btn tx-filt-btn" id="tfilt" aria-expanded="false" aria-controls="tx-filters">Filters${active ? ` <span class="pill">${active}</span>` : ""}</button>
          <div class="tx-filters" id="tx-filters">
            <select id="tacc" aria-label="Account">${accountOptions(txState.account, true)}</select>
            <select id="tcat" aria-label="Category"><option value="">All categories</option><option value="__none" ${txState.category === "__none" ? "selected" : ""}>Uncategorized</option><option value="__split" ${txState.category === "__split" ? "selected" : ""}>Split</option><option value="__excluded" ${txState.category === "__excluded" ? "selected" : ""}>Excluded from budget</option>${categoryOptions(txState.category, { includeNone: false })}</select>
            ${active ? `<button class="btn link" id="tclear">Clear</button>` : ""}
          </div>
          <div class="spacer"></div>
          <button class="btn" id="apply-rules" title="Run your rules on uncategorized transactions">Apply rules</button>
          <button class="btn primary" id="add-tx">+ Add</button>
        </div>
        <div class="tx-head" aria-hidden="true"><span></span><span>Merchant</span><span>Category</span><span>Account</span><span class="right">Amount</span></div>
        <div id="tx-list">${SKELETON_ROWS}</div>
      </div>`;
    let t;
    $("#tq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { txState.q = e.target.value; txState.page = 1; loadTx(); }, 250); };
    $("#tacc").onchange = (e) => { txState.account = e.target.value; txState.page = 1; renderTransactions(view); };
    $("#tcat").onchange = (e) => { txState.category = e.target.value; txState.page = 1; renderTransactions(view); };
    const clr = $("#tclear"); if (clr) clr.onclick = () => { txState.account = ""; txState.category = ""; txState.page = 1; renderTransactions(view); };
    $("#tfilt").onclick = (e) => { const box = $("#tx-filters"); const open = box.classList.toggle("open"); e.currentTarget.setAttribute("aria-expanded", open); };
    if (active && matchMedia("(max-width: 760px)").matches) { $("#tx-filters").classList.add("open"); $("#tfilt").setAttribute("aria-expanded", "true"); }
    $("#add-tx").onclick = () => editTx(null);
    $("#apply-rules").onclick = async (e) => {
      const btn = e.currentTarget; btn.classList.add("loading");
      try { const r = await api("/api/budget/apply-rules", { method: "POST" }); toast(`Categorized ${plural(r.updated, "transaction")}`); loadTx(); } catch (err) { fail(err); }
      btn.classList.remove("loading");
    };
    await loadTx();
  }
  const SKELETON_ROWS = `<div class="sk-rows" aria-busy="true">${'<div class="sk-tx"><i class="c"></i><i></i><i class="s"></i></div>'.repeat(6)}</div>`;

  async function loadTx() {
    const box = $("#tx-list"); if (!box) return;
    const b = monthBounds(state.month);
    const parts = ["date >= {:s} && date < {:e}"];
    const params = { s: b.start, e: b.end };
    if (txState.q) { parts.push("(description ~ {:q} || payee ~ {:q} || notes ~ {:q})"); params.q = txState.q; }
    if (txState.account) { parts.push("account = {:a}"); params.a = txState.account; }
    if (txState.category === "__none") parts.push("category = ''");
    else if (txState.category === "__split") parts.push("split = true");
    else if (txState.category === "__excluded") parts.push("exclude = true");
    // a split transaction shows up under every category it has a part in
    else if (txState.category) { parts.push("(category = {:c} || tx_splits_via_transaction.category ?= {:c})"); params.c = txState.category; }
    const res = await pb.collection("transactions").getList(txState.page, 100, { filter: pb.filter(parts.join(" && "), params), sort: "-date,-created" });
    if (!res.items.length) {
      const filtered = txState.q || txState.account || txState.category;
      box.innerHTML = `<div class="empty">${filtered ? `Nothing matches in ${esc(monthLabel(state.month))}. Try another search or clear the filters.`
        : `No transactions for ${esc(monthLabel(state.month))}.${state.accounts.length ? "" : ` <a href="#/accounts">Connect a bank or import a CSV</a> to get started.`}`}</div>`;
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
      ${days.map((g) => { const sum = g.items.reduce((s, t) => s + t.amount, 0); return `<div class="day-h"><span>${esc(dayHead(g.d))}</span><span class="spacer"></span><span class="num">${sum > 0 ? "+" : sum < 0 ? "−" : ""}${money(Math.abs(sum))}</span></div>
        ${g.items.map(txRow).join("")}`; }).join("")}
      <div class="row tx-foot">
        <span class="muted small">${plural(res.totalItems, "transaction")} · net ${money(total)}${res.totalPages > 1 ? " on this page" : ""}</span>
        <div class="spacer"></div>
        ${res.page > 1 ? `<button class="btn sm" id="pprev">‹ Prev</button>` : ""}
        ${res.page < res.totalPages ? `<button class="btn sm" id="pnext">Next ›</button>` : ""}
      </div>`;
    const items = Object.fromEntries(res.items.map((t) => [t.id, t]));
    $$(".tx-row", box).forEach((el) => {
      el.onclick = () => editTx(items[el.dataset.id]);
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } };
    });
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
        ${tx.split ? `<div class="field"><span>Category</span><div id="tx-parts" class="tx-parts"><span class="muted small loading-dots">Loading split</span></div></div>`
          : `<div class="field"><span>Category</span><div class="row" style="flex-wrap:nowrap"><select name="category" class="grow">${categoryOptions(tx.category)}</select>${!isNew ? `<button type="button" class="btn" id="split-btn" title="Divide this across categories">Split</button>` : ""}</div></div>`}
        <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(tx.notes)}</textarea></label>
        <label class="check ex-check"><input type="checkbox" name="exclude" ${tx.exclude ? "checked" : ""}><span><b>Don't count this in my budget or spending</b><span class="small muted">For transfers between your accounts, reimbursements you'll be paid back, or one-off purchases you don't want skewing your numbers. It still counts toward your balances.</span></span></label>
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
          const data = { payee: fd.payee, notes: fd.notes, exclude: !!fd.exclude };
          if (!tx.split) data.category = fd.category;
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
        if (mk) mk.onclick = () => { const sel = $("[name=category]", form); close(); createRuleDialog(suggestPattern(tx), sel ? sel.value : tx.category); };
        const sb = $("#split-btn", m);
        if (sb) sb.onclick = () => { const cat = $("[name=category]", form).value; close(); editSplit(tx, null, cat); };
        const box = $("#tx-parts", m);
        if (box) pb.collection("tx_splits").getFullList({ filter: pb.filter("transaction = {:t}", { t: tx.id }), sort: "position" }).then((parts) => {
          box.innerHTML = `${parts.map((x) => { const c = catById(x.category); return `<div class="tx-part">${catMark(c, true)}<span class="grow">${esc(c ? c.name : "Uncategorized")}${x.note ? ` <span class="muted small">· ${esc(x.note)}</span>` : ""}</span><span class="num">${money(Math.abs(x.amount))}</span></div>`; }).join("")}
            <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="split-edit">Edit split</button><button type="button" class="btn sm" id="split-undo">Undo split</button></div>`;
          $("#split-edit", box).onclick = () => { close(); editSplit(tx, parts); };
          $("#split-undo", box).onclick = async () => {
            try { await api(`/api/budget/transactions/${tx.id}/split`, { method: "POST", body: { parts: [] } }); close(); toast("Split removed"); if (currentRoute() === "transactions") loadTx(); else route(); } catch (err) { fail(err); }
          };
        }).catch(() => { box.innerHTML = `<span class="muted small">Couldn't load the split.</span>`; });
      },
    });
  }

  // Divide one transaction across categories. The first row takes whatever the others don't,
  // until you type in it yourself; Save only works once the parts add up.
  function editSplit(tx, parts, firstCat) {
    const total = Math.round(Math.abs(tx.amount) * 100) / 100;
    let rows = parts && parts.length ? parts.map((x) => ({ category: x.category, amount: Math.abs(x.amount), note: x.note || "" }))
      : [{ category: firstCat || tx.category || "", amount: total, note: "" }, { category: "", amount: "", note: "" }];
    let firstTouched = !!(parts && parts.length);
    const name = tx.payee || tx.description || "Transaction";
    const rowHtml = (r, i) => `<div class="sp-row" data-i="${i}">
        <select class="sp-cat" aria-label="Category for part ${i + 1}">${categoryOptions(r.category)}</select>
        <input class="sp-amt num" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" aria-label="Amount for part ${i + 1}" value="${r.amount === "" ? "" : r.amount}">
        <button type="button" class="btn sm icon-btn sp-del" aria-label="Remove part ${i + 1}" ${rows.length <= 2 ? "disabled" : ""}>×</button>
        <input class="sp-note" placeholder="Note (optional)" aria-label="Note for part ${i + 1}" value="${esc(r.note)}" maxlength="200">
      </div>`;
    modal("Split transaction", `
      <div class="sp-head"><div class="grow"><b>${esc(name)}</b><div class="small muted">${esc(prettyDate(tx.date))} ${dateOnly(tx.date).slice(0, 4)}</div></div><div class="num sp-total">${money(total)}</div></div>
      ${tx.pending ? `<div class="callout small" style="margin-bottom:12px">This charge is still pending. Banks sometimes give it a new ID when it posts, which would drop the split, so it's safest to split it after it posts.</div>` : ""}
      <form id="sp-form" class="stack">
        <div id="sp-rows"></div>
        <div class="row"><button type="button" class="btn sm" id="sp-add">+ Add a part</button><button type="button" class="btn sm" id="sp-even">Split evenly</button><div class="spacer"></div><span id="sp-left" class="small" aria-live="polite"></span><button type="button" class="btn sm" id="sp-fill" hidden>Fill the rest</button></div>
        <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="sp-save">Save split</button></div>
      </form>`, {
      onMount: (m, close) => {
        m.classList.add("mid");
        const box = $("#sp-rows", m);
        const cents = (v) => Math.round((Number(v) || 0) * 100);
        const sync = () => {
          const used = rows.reduce((s2, r) => s2 + cents(r.amount), 0);
          const left = cents(total) - used;
          const el = $("#sp-left", m);
          const filled = rows.filter((r) => cents(r.amount) > 0).length;
          el.className = "small " + (left === 0 ? "pos" : "negc");
          el.textContent = left === 0 ? (filled >= 2 ? "Adds up" : "Give at least two parts an amount") : left > 0 ? `${money(left / 100)} left to assign` : `${money(-left / 100)} too much`;
          if (left === 0 && filled < 2) el.className = "small muted";
          $("#sp-save", m).disabled = left !== 0 || filled < 2;
          $("#sp-fill", m).hidden = left <= 0;
        };
        // "Fill the rest" puts what's left on the part you were last typing in (or the last empty one)
        let lastI = null;
        const draw = () => {
          box.innerHTML = rows.map(rowHtml).join("");
          $$(".sp-row", box).forEach((el) => {
            const i = +el.dataset.i;
            $(".sp-cat", el).onchange = (e) => { rows[i].category = e.target.value; };
            $(".sp-note", el).oninput = (e) => { rows[i].note = e.target.value; };
            $(".sp-amt", el).onfocus = () => { lastI = i; };
            $(".sp-amt", el).oninput = (e) => {
              rows[i].amount = e.target.value;
              if (i === 0) firstTouched = true;
              else if (!firstTouched) {
                // the first row absorbs the rest
                const others = rows.slice(1).reduce((s2, r) => s2 + cents(r.amount), 0);
                rows[0].amount = Math.max(0, cents(total) - others) / 100;
                $(".sp-row[data-i='0'] .sp-amt", box).value = rows[0].amount;
              }
              sync();
            };
            $(".sp-del", el).onclick = () => { rows.splice(i, 1); draw(); };
          });
          sync();
        };
        $("#sp-add", m).onclick = () => {
          const used = rows.reduce((s2, r) => s2 + cents(r.amount), 0);
          const left = Math.max(0, cents(total) - used);
          rows.push({ category: "", amount: left ? left / 100 : "", note: "" });
          draw();
          const last = $$(".sp-row", box).pop(); if (last) $(".sp-cat", last).focus();
        };
        $("#sp-fill", m).onclick = () => {
          const left = cents(total) - rows.reduce((s2, r) => s2 + cents(r.amount), 0);
          if (left <= 0) return;
          let i = lastI != null && rows[lastI] ? lastI : rows.findIndex((r) => !cents(r.amount));
          if (i < 0) i = rows.length - 1;
          rows[i].amount = (cents(rows[i].amount) + left) / 100;
          firstTouched = true;
          draw();
        };
        $("#sp-even", m).onclick = () => {
          const n = rows.length, each = Math.floor(cents(total) / n);
          rows.forEach((r, i) => { r.amount = (each + (i === 0 ? cents(total) - each * n : 0)) / 100; });
          firstTouched = true;
          draw();
        };
        $("#sp-form", m).onsubmit = async (e) => {
          e.preventDefault();
          try {
            await api(`/api/budget/transactions/${tx.id}/split`, { method: "POST", body: { parts: rows.map((r) => ({ category: r.category, amount: Number(r.amount) || 0, note: r.note })) } });
            close(); toast("Split saved");
            if (currentRoute() === "transactions") loadTx(); else route();
          } catch (err) { fail(err); }
        };
        draw();
        const second = $(".sp-row[data-i='1'] .sp-cat", box); if (second) second.focus();
      },
    });
  }

  // ------------------------------------------------------------------ budget
  // Rocket Money-style: one monthly spending budget. Categories you care about get their
  // own slice; everything without a slice shares "Everything else".
  function ring(pct, cls, big, sub) {
    const R = 64, C = 2 * Math.PI * R, p = Math.max(0, Math.min(100, pct));
    return `<svg class="ring ${cls}" viewBox="0 0 160 160" role="img" aria-label="${esc(sub)}">
      <circle r="${R}" cx="80" cy="80" fill="none" stroke="var(--track)" stroke-width="18"/>
      <circle r="${R}" cx="80" cy="80" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round"
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
    const used = c.available > 0 ? Math.round((c.spent / c.available) * 100) : null;
    const onPlan = c.available > 0 && Math.abs(c.remaining) < 0.5;
    const cls = onPlan ? "good" : barClass(used);
    return `<div class="b-row click" data-id="${c.id || ""}" role="button" tabindex="0" aria-label="${esc(c.name)}: ${esc(over ? money(-c.remaining) + " over" : money(c.remaining) + " left")}. Edit budget">
      <div class="row"><span class="b-name">${catLabel(c)}</span>${c.rollover ? `<span class="pill" title="Unspent money carries over to next month">rollover</span>` : ""}
        <div class="spacer"></div>${used != null ? `<span class="b-pct num ${cls}">${onPlan ? "Paid" : used + "%"}</span>` : ""}<span class="num b-left ${over ? "over" : ""}">${over ? money(-c.remaining) + " over" : money(c.remaining) + " left"}</span></div>
      <div class="bar ${cls}"><i style="width:${pct}%"></i>${proj != null && proj > pct ? `<b style="left:${proj}%" ${tipAttr(`On pace for <b>${esc(money(c.projected))}</b> by the end of the month`)}></b>` : ""}</div>
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
            ${d.expected_income > 0 ? (() => {
              // where the month's income goes: goals, the spending budget, and what's left (or the shortfall)
              const inc = d.expected_income, g = d.goals_monthly, sp = d.budgeted, rest = inc - g - sp;
              const tot = Math.max(inc, g + sp);
              const seg = (v, c, l) => v > 0 ? `<i style="width:${(v / tot) * 100}%;background:${c}" ${tipAttr(`<b>${esc(l)}</b><br>${esc(money(v))}`)}></i>` : "";
              return `<div class="alloc" aria-label="Where your income goes"><div class="split">${seg(g, "var(--s7)", "Savings goals")}${seg(sp, "var(--s1)", "Spending budget")}${seg(Math.max(0, rest), "var(--good)", "Left over")}${seg(Math.max(0, -rest), "var(--bad)", "Short")}</div>
                <div class="legend">${g ? `<span style="--c:var(--s7)">Goals ${money(g)}</span>` : ""}<span style="--c:var(--s1)">Budget ${money(sp)}</span>${rest >= 0 ? `<span style="--c:var(--good)">Left over ${money(rest)}</span>` : `<span style="--c:var(--bad)">Short ${money(-rest)}</span>`}</div></div>`;
            })() : ""}
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
              ${hasBudget ? `<button class="btn sm" id="wizard" title="Walk through income, bills and category limits again">Adjust budget</button>` : ""}<button class="btn sm primary" id="add-budget">+ Category budget</button></div>
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
    $$(".b-row", view).forEach((el) => {
      el.onclick = () => (el.dataset.id ? editCategoryBudget(statsById[el.dataset.id]) : editTotal(d));
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } };
    });
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
  const ACCT_LOOK = { checking: ["banknote", 1], savings: ["coins", 3], credit: ["card", 2], investment: ["trend", 7], loan: ["receipt", 8], cash: ["banknote", 4], other: ["box", 0] };
  const acctMark = (a) => { const [ic, slot] = ACCT_LOOK[a.type] || ACCT_LOOK.other; return `<span class="cm" style="--c:${slot ? `var(--s${slot})` : "var(--subtle)"}" aria-hidden="true">${catSvg(ic)}</span>`; };

  async function renderAccounts(view) {
    const [conns] = await Promise.all([pb.collection("bank_connections").getFullList({ sort: "created" }), loadAccounts()]);
    const byConn = {};
    for (const a of state.accounts) (byConn[a.connection || ""] = byConn[a.connection || ""] || []).push(a);
    const moreMenu = (label, items) => `<details class="menu"><summary class="btn sm icon-btn" aria-label="${esc(label)}">${icon("more")}</summary><div class="menu-pop">${items}</div></details>`;
    const isDebt = (a) => a.type === "credit" || a.type === "loan";

    const accRow = (a) => `<div class="acc-row" data-id="${a.id}" role="button" tabindex="0" aria-label="Edit ${esc(acctLabel(a))}">
      ${acctMark(a)}
      <div class="grow acc-main"><div class="t-name">${esc(acctLabel(a))}</div>
        <div class="small muted">${esc(cap(a.type || "other"))}${a.institution ? ` · ${esc(a.institution)}` : ""}</div>
        ${!a.on_budget || a.hidden ? `<div class="acc-tags">${!a.on_budget ? `<span class="pill">Not in budget</span>` : ""}${a.hidden ? `<span class="pill">Hidden from net worth</span>` : ""}</div>` : ""}</div>
      <div class="right"><div class="acc-bal num">${a.balance < 0 ? "−" : ""}${money(Math.abs(a.balance))}</div>${isDebt(a) ? `<div class="small muted">owed</div>` : ""}</div>
      <span class="acc-go" aria-hidden="true">›</span>
    </div>`;
    const list = (arr) => arr && arr.length ? `<div class="acc-list">${arr.map(accRow).join("")}</div>` : `<div class="muted small">No accounts.</div>`;
    const sum = (arr) => (arr || []).filter((a) => !a.hidden).reduce((s, a) => s + (a.balance || 0), 0);

    view.innerHTML = `
      <div class="stack">
        <div class="row"><p class="muted" style="margin:0;flex:1 1 320px">Your accounts and where their balances come from. Select an account to rename it, change its type, or choose whether it counts in your budget.</p>
          ${conns.length ? `<button class="btn" id="sync-all">↻ Sync now</button>` : ""}
          <button class="btn primary" id="connect">+ Connect bank</button></div>

        ${conns.map((c) => `
          <section class="card" aria-label="${esc(c.name)}">
            <div class="card-h acc-conn"><span class="cm" style="--c:var(--s1)" aria-hidden="true">${catSvg("swap")}</span>
              <div class="grow"><h2>${esc(c.name)}</h2><div class="small muted" title="${c.last_sync ? esc(new Date(c.last_sync.replace(" ", "T")).toLocaleString()) : ""}">${c.last_sync ? "Synced " + ago(c.last_sync) : "Never synced"} · ${plural((byConn[c.id] || []).length, "account")}</div></div>
              <span class="pill ${c.status === "ok" ? "ok" : "err"}">${c.status === "ok" ? "Connected" : "Needs attention"}</span>
              ${moreMenu("Connection options", `<button type="button" class="menu-i danger-t conn-del" data-id="${c.id}">Disconnect bank…</button>`)}</div>
            ${c.last_error ? `<div class="callout small ${c.status === "ok" ? "" : "cf-warn"}" style="margin-bottom:12px">${esc(c.last_error)}</div>` : ""}
            ${list(byConn[c.id])}
          </section>`).join("")}

        ${!conns.length ? `<section class="card acc-empty"><span class="cm" style="--c:var(--s1)" aria-hidden="true">${catSvg("swap")}</span><div class="grow"><b>Connect your bank</b><div class="small muted">Sync balances and transactions every day through <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noopener">SimpleFIN Bridge</a>, or keep manual accounts and import CSV files.</div></div></section>` : ""}

        <section class="card" aria-labelledby="acc-man">
          <div class="card-h"><div class="grow"><h2 id="acc-man">Manual accounts</h2><div class="small muted">You update these yourself or with a CSV import${byConn[""] && byConn[""].length ? ` · ${money(sum(byConn[""]))} in all` : ""}</div></div>
            <button class="btn" id="import-csv">Import CSV</button>
            <button class="btn primary" id="add-acc">+ Account</button></div>
          ${list(byConn[""])}
        </section>
      </div>`;

    $$(".acc-row", view).forEach((el) => {
      el.onclick = () => editAccount(accById(el.dataset.id));
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } };
    });
    $$(".conn-del", view).forEach((b) => (b.onclick = async () => {
      $$("details.menu[open]").forEach((dd) => dd.removeAttribute("open"));
      if (!(await confirmBox("Disconnect this bank? Its accounts and transaction history stay here as manual accounts.", "Disconnect"))) return;
      try { await pb.collection("bank_connections").delete(b.dataset.id); toast("Bank disconnected"); route(); } catch (err) { fail(err); }
    }));
    const sa = $("#sync-all");
    if (sa) sa.onclick = async () => {
      sa.disabled = true; sa.classList.add("loading");
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

  // Everything you can change about an account, in one place.
  function editAccount(a) {
    if (!a) return;
    const connected = !!a.connection;
    const sw = (name, on, title, desc) => `<label class="set-row"><span class="grow"><b>${title}</b><span class="small muted">${desc}</span></span><input type="checkbox" class="sw" name="${name}" ${on ? "checked" : ""}></label>`;
    modal(acctLabel(a), `
      <form id="acc-form" class="stack">
        <div class="sp-head">${acctMark(a)}<div class="grow"><b>${esc(a.institution || (connected ? "Bank account" : "Manual account"))}</b><div class="small muted">${connected ? "Balance updates on every sync" : "You keep this balance up to date"}</div></div><div class="num sp-total">${money(a.balance)}</div></div>
        <label class="field"><span>Name</span><input name="name" required value="${esc(a.name)}"></label>
        <div class="form-grid">
          <label class="field"><span>Type</span><select name="type">${ACCOUNT_TYPES.map((t) => `<option value="${t}" ${t === a.type ? "selected" : ""}>${cap(t)}</option>`).join("")}</select></label>
          ${connected ? "" : `<label class="field"><span>Balance</span><input name="balance" type="number" step="0.01" value="${a.balance || 0}"></label>`}
        </div>
        <div>
          ${sw("on_budget", a.on_budget, "Count in budget", "Its transactions count toward your budget and spending")}
          ${sw("in_nw", !a.hidden, "Include in net worth", "Leave off for accounts you track but don't own outright")}
          ${connected ? sw("flip_amounts", a.flip_amounts, "Invert amounts", "Turn on if this bank reports purchases as positive. Applies from the next sync.") : ""}
        </div>
        <div class="actions"><button type="button" class="btn danger" id="acc-del">Delete account…</button><div class="spacer"></div><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div>
      </form>`, {
      onMount: (m, close) => {
        const form = $("#acc-form", m);
        form.onsubmit = async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const data = { name: String(fd.get("name")).trim(), type: fd.get("type"), on_budget: fd.has("on_budget"), hidden: !fd.has("in_nw") };
          if (!connected) data.balance = Number(fd.get("balance")) || 0;
          if (connected) data.flip_amounts = fd.has("flip_amounts");
          const btn = $("button.primary", form); btn.classList.add("loading");
          try { await pb.collection("accounts").update(a.id, data); close(); toast("Account saved"); route(); } catch (err) { fail(err); btn.classList.remove("loading"); }
        };
        $("#acc-del", m).onclick = async () => {
          close();
          if (!(await confirmBox(`Delete “${acctLabel(a)}” and all of its transactions? This can't be undone.`, "Delete account"))) return;
          try { await pb.collection("accounts").delete(a.id); toast("Account deleted"); route(); } catch (err) { fail(err); }
        };
      },
    });
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

  // ------------------------------------------------------------------ cash flow
  // Day-by-day projection of checking: recurring bills and paychecks on their dates plus usual everyday spending.
  const cfState = { days: 45, whatIf: null };
  const cfAccounts = () => { try { return JSON.parse(localStorage.getItem("keel.cf.accounts") || "null"); } catch (_) { return null; } };
  const cfAccountsParam = () => (cfAccounts() || []).join(",");
  const weekday = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });

  async function renderCashflow(view) {
    const f = await api("/api/budget/forecast", { query: { days: cfState.days, accounts: cfAccountsParam() } });
    const me = pb.authStore.record;
    const picker = `<details class="menu cf-acc"><summary class="btn sm">${f.accounts.length ? esc(f.accounts.length === 1 ? acctLabel(f.accounts[0]) : `${f.accounts.length} accounts`) : "Choose accounts"} ▾</summary>
      <div class="menu-pop stack" style="gap:6px;min-width:250px">${f.choices.map((a) => `<label class="check"><input type="checkbox" value="${a.id}" ${a.selected ? "checked" : ""}> <span class="grow">${esc(acctLabel(a))}</span> <span class="num muted small">${money(a.balance)}</span></label>`).join("")}
        <div class="row"><button type="button" class="btn sm" id="cf-reset">Checking only</button><div class="spacer"></div><button type="button" class="btn sm primary" id="cf-apply">Apply</button></div></div></details>`;
    const head = `<div class="row" style="flex-wrap:wrap;gap:10px"><p class="muted" style="margin:0;flex:1 1 320px">Where your balance is headed, day by day: bills and paychecks on their dates plus your usual everyday spending.</p>
      ${picker}<div class="seg">${[[30, "30 days"], [45, "45 days"], [90, "90 days"]].map(([dd, l]) => `<button data-days="${dd}" class="${cfState.days === dd ? "on" : ""}">${l}</button>`).join("")}</div></div>`;
    if (f.empty) {
      view.innerHTML = `<div class="stack">${head}<div class="card empty">Pick at least one checking or cash account to forecast. <a href="#/accounts">Accounts</a></div></div>`;
      return bindCashflow(view);
    }
    const pts = f.points;
    // what-if: a one-off amount on a day, applied here only (nothing is saved)
    const wi = cfState.whatIf && cfState.whatIf.amount ? cfState.whatIf : null;
    const alt = wi ? pts.map((p) => p.balance + (p.day >= wi.day ? wi.amount : 0)) : null;
    const altLowI = alt ? alt.reduce((bi, v, i) => (v < alt[bi] ? i : bi), 0) : -1;
    const change = f.end_balance - f.start;
    const lowI = Math.max(0, pts.findIndex((p) => p.day === f.low.day));
    const lowWhen = f.low.day === f.today ? "today" : `${weekday(f.low.day)} ${prettyDate(f.low.day)}`;
    const danger = f.below_floor_day || f.low.balance < 0;
    let callout = "";
    const actions = `<div class="row cf-act"><a class="btn sm" href="#cf-list" data-jump="cf-list">See what's coming up</a><button type="button" class="btn sm" data-jump="cf-floor">Change warning level</button></div>`;
    if (f.below_floor_day) {
      const p = pts.find((x) => x.day === f.below_floor_day);
      callout = `<div class="callout cf-warn"><b>Heads up:</b> your balance is projected to drop to <b>${money(p.balance)}</b> around <b>${esc(prettyDate(f.below_floor_day))}</b>, below your ${money(f.floor)} warning level${f.next_income && f.next_income.day > f.below_floor_day ? `, before your next deposit on ${esc(prettyDate(f.next_income.day))}` : ""}. Moving a bill, trimming everyday spending or a transfer in would cover it.${actions}</div>`;
    } else if (f.low.balance < 0) {
      callout = `<div class="callout cf-warn"><b>Heads up:</b> your balance is projected to go negative around <b>${esc(prettyDate(pts.find((x) => x.balance < 0).day))}</b>.${actions}</div>`;
    } else if (!f.has_income) {
      callout = `<div class="callout small">No regular paycheck was found, so deposits that aren't recurring are averaged in as about ${money(f.other_in_per_day)} a day. <a href="#/recurring">Add your paycheck</a> for a sharper forecast.</div>`;
    }
    const refs = [];
    if (f.floor > 0) refs.push({ v: f.floor, label: `Warning ${compact(f.floor)}` });
    if (f.low.balance < 0 || (alt && alt[altLowI] < 0)) refs.push({ v: 0, label: "$0" });
    const series = [{ values: pts.map((p) => p.balance), color: "var(--s1)", area: true }];
    if (alt) series.push({ values: alt, color: "var(--s7)", dashed: true });
    const chart = lineChart({
      series, n: pts.length, height: 240, yMinZero: false,
      xLabel: (i) => (i === 0 ? "Today" : prettyDate(pts[i].day)),
      ariaLabel: `Projected balance over the next ${f.days} days. Lowest ${money(f.low.balance)} on ${lowWhen}.`,
      refs,
      marks: [{ i: lowI, v: f.low.balance, label: `Low ${f.low.balance < 0 ? "−" : ""}$${Math.round(Math.abs(f.low.balance)).toLocaleString()}`, cls: danger ? "bad" : "" }],
      tipFor: (i) => {
        const p = pts[i];
        return `<b>${i === 0 ? "Today" : esc(`${weekday(p.day)} ${prettyDate(p.day)}`)}</b><br>${money(p.balance)} projected${alt ? `<br><span class="muted">With what-if: ${money(alt[i])}</span>` : ""}${p.events.map((e) => `<br><span class="${e.amount > 0 ? "pos" : ""}">${e.amount > 0 ? "+" : "−"}${money(Math.abs(e.amount))}</span> ${esc(e.name)}`).join("")}`;
      },
    });
    // event days marked under the chart: paydays and bills
    const marks = pts.map((p, i) => p.events.length ? `<i class="${p.events.some((e) => e.amount > 0) ? "in" : "out"}" style="left:${((52 + (i / (pts.length - 1)) * 574) / 640 * 100).toFixed(2)}%" ${tipAttr(`<b>${esc(prettyDate(p.day))}</b>${p.events.map((e) => `<br>${e.amount > 0 ? "+" : "−"}${money(Math.abs(e.amount))} ${esc(e.name)}`).join("")}`)}></i>` : "").join("");
    const rows = pts.filter((p) => p.events.length).map((p) => `
      <div class="cf-day ${p.day === f.low.day ? "is-low" : ""}"><div class="cf-date"><b>${esc(weekday(p.day))}</b><span>${esc(prettyDate(p.day))}</span></div>
        <div class="grow">${p.events.map((e) => `<div class="cf-ev"><span>${esc(e.name)}${e.late ? ' <span class="pill warn-p">Not posted yet</span>' : ""}</span><span class="spacer"></span><span class="num ${e.amount > 0 ? "pos" : ""}">${e.amount > 0 ? "+" : "−"}${money(Math.abs(e.amount))}</span></div>`).join("")}</div>
        <div class="cf-bal num ${p.balance < f.floor || p.balance < 0 ? "negc" : "muted"}" ${tipAttr("Projected balance at the end of the day")}><span class="cf-bl">Balance </span>${money(p.balance)}</div></div>`).join("");
    const wiDay = wi ? wi.day : ymd(new Date(Date.now() + 7 * 86400000));
    const wiResult = alt ? (() => {
      const lo = alt[altLowI], d0 = pts[altLowI].day;
      const below = (f.floor > 0 && lo < f.floor) || lo < 0;
      return `<div class="callout small ${below ? "cf-warn" : ""}" style="margin-top:12px">With this, your lowest point would be <b>${money(lo)}</b> on ${esc(prettyDate(d0))}${below ? (lo < 0 ? ", below zero." : `, under your ${money(f.floor)} warning level.`) : `, ${money(lo - f.low.balance)} ${lo >= f.low.balance ? "above" : "below"} the forecast.`}</div>`;
    })() : "";
    view.innerHTML = `
      <div class="stack">
        ${head}
        <div class="grid kpis cf-kpis">
          <div class="card kpi cf-low ${danger ? "danger" : ""}"><div class="label">Lowest point</div><div class="value num ${danger ? "negc" : ""}">${money(f.low.balance)}</div><div class="sub">${esc(cap(lowWhen))}${f.before_payday && f.before_payday.day !== f.low.day && f.next_income ? `<br>${money(f.before_payday.balance)} before your ${esc(prettyDate(f.next_income.day))} deposit` : ""}</div></div>
          <div class="card kpi"><div class="label">Balance now</div><div class="value num">${money(f.start)}</div><div class="sub">${esc(f.accounts.map(acctLabel).join(", "))}</div></div>
          <div class="card kpi"><div class="label">In ${f.days} days</div><div class="value num">${money(f.end_balance)}</div><div class="sub">${change === 0 ? "No change" : signed(change)} from today</div></div>
        </div>
        ${callout}
        <section class="card" aria-labelledby="cf-chart-h">
          <div class="card-h"><div><h2 id="cf-chart-h">Projected balance</h2><div class="small muted">A projection from your bills, paychecks and usual spending, not a guarantee</div></div><div class="spacer"></div>
            <div class="legend" style="margin:0"><span class="mk-in">Deposit</span><span class="mk-out">Bill</span>${alt ? `<span class="dash" style="--c:var(--s7)">What-if</span>` : ""}</div></div>
          ${chart}
          <div class="cf-marks" aria-hidden="true">${marks}</div>
        </section>
        <div class="grid two cf-cols">
          <section class="card" id="cf-list" aria-labelledby="cf-list-h">
            <div class="card-h"><h2 id="cf-list-h">Coming up</h2><div class="spacer"></div><span class="small muted">+${money(f.income_total)} in · −${money(f.bills_total)} bills</span></div>
            ${rows || `<div class="muted small">No bills or paychecks expected in this window.</div>`}
          </section>
          <div class="stack">
            <section class="card" aria-labelledby="cf-wi-h">
              <div class="card-h"><h2 id="cf-wi-h">What if…</h2></div>
              <p class="small muted" style="margin-top:0">Try a one-off expense or deposit and see how it changes the forecast. Nothing is saved.</p>
              <form id="cf-wi" class="cf-wi">
                <select name="dir" aria-label="Expense or deposit"><option value="-1" ${!wi || wi.amount < 0 ? "selected" : ""}>I spend</option><option value="1" ${wi && wi.amount > 0 ? "selected" : ""}>I receive</option></select>
                <input name="amt" type="number" min="0" step="1" placeholder="Amount" aria-label="Amount" required value="${wi ? Math.abs(wi.amount) : ""}">
                <input name="day" type="date" aria-label="On" min="${esc(f.today)}" value="${esc(wiDay)}">
                <button class="btn primary">Try it</button>${wi ? `<button type="button" class="btn" id="cf-wi-clear">Clear</button>` : ""}
              </form>
              ${wiResult}
            </section>
            <section class="card" aria-labelledby="cf-how-h">
              <div class="card-h"><h2 id="cf-how-h">How it's worked out</h2></div>
              <div class="m-row"><span>Balance now</span><span class="num">${money(f.start)}</span></div>
              <div class="m-row"><span>Paychecks and deposits <span class="muted small">scheduled</span></span><span class="num pos">+${money(f.income_total)}</span></div>
              <div class="m-row"><span>Bills and subscriptions <span class="muted small">scheduled</span></span><span class="num">−${money(f.bills_total)}</span></div>
              <div class="m-row"><span>Everyday spending <span class="muted small">estimated, about ${money(f.spend_per_day)}/day</span></span><span class="num">−${money(f.spend_total)}</span></div>
              ${f.other_in_per_day ? `<div class="m-row"><span>Other deposits <span class="muted small">estimated, about ${money(f.other_in_per_day)}/day</span></span><span class="num pos">+${money(f.other_in_per_day * f.days)}</span></div>` : ""}
              <div class="m-row total"><span>In ${f.days} days</span><span class="num">${money(f.end_balance)}</span></div>
              <p class="small muted" style="margin:10px 0 0">Everyday spending is what usually leaves these accounts outside your recurring bills (card payments and transfers out included), averaged over the last ${plural(f.lookback_days, "day")}. Bills charged to a credit card are left out, since they're paid through the card payment.</p>
            </section>
            <section class="card" aria-labelledby="cf-floor-h">
              <div class="card-h"><h2 id="cf-floor-h">Low balance warning</h2></div>
              <form id="cf-floor" class="stack">
                <label class="field"><span>Warn me if it's projected below ($)</span><input name="floor" type="number" min="0" step="1" value="${f.floor || 0}"></label>
                <label class="set-row" style="border:0;padding:0"><span class="grow"><b>Email me</b><span class="small muted">When it's coming up in the next 2 weeks${state.status.smtp ? "" : " (needs email set up)"}</span></span><input type="checkbox" class="sw" name="alerts" ${me.cash_alerts ? "checked" : ""} ${state.status.smtp ? "" : "disabled"}></label>
                <div><button class="btn primary sm">Save warning</button></div>
              </form>
            </section>
          </div>
        </div>
      </div>`;
    bindCashflow(view);
    $$("[data-jump]", view).forEach((b) => (b.onclick = (e) => {
      e.preventDefault();
      const el = $("#" + b.dataset.jump); if (!el) return;
      el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      const inp = $("input", el); if (b.dataset.jump === "cf-floor" && inp) setTimeout(() => inp.focus({ preventScroll: true }), 300);
    }));
    $("#cf-wi").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amt = Math.abs(Number(fd.get("amt")) || 0) * Number(fd.get("dir"));
      cfState.whatIf = amt ? { amount: amt, day: fd.get("day") || f.today } : null;
      route();
    };
    const wc = $("#cf-wi-clear"); if (wc) wc.onclick = () => { cfState.whatIf = null; route(); };
    $("#cf-floor").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const saved = await pb.collection("users").update(me.id, { cash_floor: Number(fd.get("floor")) || 0, cash_alerts: fd.has("alerts") });
        pb.authStore.save(pb.authStore.token, saved);
        toast("Warning saved"); route();
      } catch (err) { fail(err); }
    };
  }
  function bindCashflow(view) {
    $$(".seg button", view).forEach((b) => (b.onclick = () => { cfState.days = +b.dataset.days; route(); }));
    const save = (ids) => { try { if (ids) localStorage.setItem("keel.cf.accounts", JSON.stringify(ids)); else localStorage.removeItem("keel.cf.accounts"); } catch (_) {} route(); };
    const apply = $("#cf-apply", view);
    if (apply) apply.onclick = () => save($$(".cf-acc input:checked", view).map((x) => x.value));
    const reset = $("#cf-reset", view);
    if (reset) reset.onclick = () => save(null);
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
        <div class="grid goals-grid">${goals.map(goalCard).join("")}</div>` : `<div class="card empty-cta"><span class="cm" style="--c:var(--s3)" aria-hidden="true">${catSvg("target")}</span>
          <div><h2>Start your first goal</h2><p class="muted">Pick a target and a date. Keel works out what to put away each day, and if you link a savings account it follows the balance on every sync.</p>
          <div class="row" style="gap:8px;flex-wrap:wrap">${["Emergency fund", "Vacation", "New car"].map((n) => `<button type="button" class="btn sm g-idea" data-name="${n}">${n}</button>`).join("")}</div></div></div>`}
      </div>`;
    bindGoalCards(view);
    $("#add-goal").onclick = () => editGoal(null);
    $$(".g-idea", view).forEach((b) => (b.onclick = () => editGoal(null, b.dataset.name)));
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
    const where = g.linked ? ` into ${esc(acctLabel(g.account))}` : "";
    let next;
    if (g.status === "done") next = `<b>You've reached it.</b> Raise the target or start a new goal when you're ready.`;
    else if (g.per_day != null) {
      const gap = g.pace_per_day == null ? null : g.per_day - g.pace_per_day;
      next = `<b>Put about ${money(g.per_day)} a day (${money(g.per_month)} a month)${where}</b> to reach it by ${esc(fullDate(g.target_date))}.`
        + (gap == null ? "" : gap > 0.01 ? ` That's ${money(gap * 30.44)} a month more than you've been adding lately.` : ` You've been adding enough lately, so keep it up.`);
    } else if (g.target_date) next = `<b>The target date has passed.</b> Pick a new date to see what to put away each day.`;
    else next = g.projected_date ? `<b>At your current pace you'll get there around ${esc(fullDate(g.projected_date))}.</b> Add a target date to see what it takes to get there sooner.` : `<b>Add a target date</b> to see what to put away each day.`;
    const behind = g.status === "behind";
    const months = (g.months || []).filter((x) => x.change != null);
    const mMax = Math.max(1, ...months.map((x) => Math.abs(x.change)));
    modal(g.name, `
      <div class="stack g-detail">
        <div>
          <div class="row" style="align-items:baseline;flex-wrap:wrap;gap:8px"><span class="g-big num">${money(g.current)}</span><span class="muted">of ${money(g.target)}${g.target_date ? ` by ${esc(fullDate(g.target_date))}` : ""}</span><div class="spacer"></div>${goalPill(g)}</div>
          <div class="bar ${g.status === "done" ? "good" : ""}" style="margin:12px 0 6px"><i style="width:${pct}%"></i></div>
          <div class="small muted">${pct}% · ${g.linked ? `Follows the balance of ${esc(acctLabel(g.account))}` : "Tracked by hand"}${g.since_start ? ` · ${signed(g.since_start, true)} since ${esc(fullDate(g.start_day))}` : ""}</div>
        </div>
        <div class="callout g-next ${behind ? "cf-warn" : g.status === "done" ? "good" : ""}"><div class="label">${g.status === "done" ? "Done" : "What to do next"}</div>${next}</div>
        ${g.linked && g.history && g.history.length > 1 ? `<div><div class="kind-h">Balance and the path to your target</div><div id="g-chart"></div></div>` : ""}
        <div class="h-stats g-stats">
          ${stat("Left to go", money(g.left))}
          ${need}
          ${stat("Your pace", g.pace_per_day == null ? "—" : `${g.pace_per_day < 0 ? "−" : ""}${money(Math.abs(g.pace_per_day))}<span class="muted" style="font-size:13px;font-weight:500">/day</span>`, paceSub)}
          ${stat("Projected finish", finish, finishSub)}
        </div>
        ${months.length ? `<details class="g-more"><summary class="kind-h row"><span>Added each month</span><div class="spacer"></div><span class="small muted">Net change in the account</span></summary>
          <div class="g-months">${months.map((x) => `<div class="g-month" ${tipAttr(`<b>${esc(monthLabel(x.month))}</b><br>${x.change >= 0 ? "Added" : "Took out"} ${money(Math.abs(x.change))}`)}><span class="small muted">${esc(shortMonth(x.month))}</span><div class="g-track"><i class="${x.change < 0 ? "neg" : ""}" style="width:${Math.max(x.change ? 2 : 0, (Math.abs(x.change) / mMax) * 100)}%"></i></div><span class="num small ${x.change < 0 ? "negc" : x.change ? "" : "muted"}">${x.change ? `${x.change < 0 ? "−" : "+"}${money(Math.abs(x.change))}` : "No change"}</span></div>`).join("")}</div></details>` : ""}
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

  function editGoal(g, name = "") {
    const isNew = !g;
    g = g || { name, target: "", saved: 0, target_date: "", account: "" };
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
    const theme = getTheme();
    const smtp = state.status.smtp;
    // a setting with its explanation on the left and a switch on the right
    const sw = (name, on, title, desc) => `<label class="set-row"><span class="grow"><b>${title}</b>${desc ? `<span class="small muted">${desc}</span>` : ""}</span><input type="checkbox" class="sw" name="${name}" ${on ? "checked" : ""}></label>`;
    const link = (href, ic, title, desc) => `<a class="set-link" href="${href}">${icon(ic)}<span class="grow"><b>${title}</b><span class="small muted">${desc}</span></span><span class="muted" aria-hidden="true">›</span></a>`;
    view.innerHTML = `
      <div class="grid two top-align">
        <div class="stack">
          <section class="card" aria-labelledby="set-ap">
            <div class="card-h"><h2 id="set-ap">Appearance</h2></div>
            <div class="set-row"><span class="grow"><b>Theme</b><span class="small muted">System follows your device's light or dark setting.</span></span>
              <div class="seg" role="radiogroup" aria-label="Theme">${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<button type="button" role="radio" aria-checked="${theme === k}" data-theme-pick="${k}" class="${theme === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
          </section>

          <section class="card" aria-labelledby="set-no">
            <div class="card-h"><h2 id="set-no">Notifications</h2><div class="spacer"></div><span class="pill ${smtp ? "ok" : "err"}">${smtp ? "Email ready" : "Email not set up"}</span></div>
            ${smtp ? "" : `<p class="small muted" style="margin-top:0">Set the <span class="code">SMTP_*</span> variables in <span class="code">.env</span> and restart the container to turn on emails.</p>`}
            <form id="prefs">
              <div class="set-h">Spending</div>
              ${sw("alerts_enabled", me.alerts_enabled, "Budget alerts", "When a category nears or passes its budget")}
              <div class="form-grid set-sub">
                <label class="field"><span>Warn at (% of budget)</span><input name="alert_threshold" type="number" min="1" max="200" value="${me.alert_threshold || 90}"></label>
                <label class="field"><span>Large transaction alert ($)</span><input name="large_txn_threshold" type="number" min="0" step="1" value="${me.large_txn_threshold || 0}"></label>
              </div>
              ${sw("alert_duplicates", me.alert_duplicates, "Possible double charges", "The same merchant and amount twice within two days")}
              ${sw("cash_alerts", me.cash_alerts, "Low balance", `When checking is projected to drop below <a href="#/cashflow">your warning level</a>${me.cash_floor ? ` (${money(me.cash_floor)})` : ""}`)}
              ${sw("alert_paycheck", me.alert_paycheck, "Paycheck arrived", "When a regular deposit lands, with what's left to spend")}
              <div class="set-h">Bills and subscriptions</div>
              ${sw("bill_reminders", me.bill_reminders, "Bill reminders", "3 days before a bill or subscription is due")}
              ${sw("alert_renewals", me.alert_renewals, "Yearly renewals", "A week before a yearly or quarterly charge")}
              ${sw("alert_price", me.alert_price, "Price increases", "When a subscription charges more than last time")}
              <div class="set-h">Summaries</div>
              ${sw("weekly_digest", me.weekly_digest, "Weekly summary", "A short recap of your week by email")}
              ${sw("monthly_report", me.monthly_report, "Monthly report", `Last month in review on the 1st, like the <a href="#/reports">Reports</a> page`)}
              ${sw("update_notes", me.update_notes, "What's new", "A small popup after Keel updates")}
              <div class="row" style="margin-top:16px"><button class="btn primary">Save notifications</button><button type="button" class="btn" id="digest-now" ${smtp ? "" : 'disabled title="Needs email set up"'}>Send a summary now</button></div>
            </form>
          </section>

          <section class="card" aria-labelledby="set-pr">
            <div class="card-h"><h2 id="set-pr">Profile</h2></div>
            <form id="profile" class="stack">
              <label class="field"><span>Name</span><div class="row" style="flex-wrap:nowrap"><input name="name" value="${esc(me.name)}" class="grow"><button class="btn">Save</button></div></label>
              <div class="set-row" style="border:0;padding-bottom:0"><span class="grow"><b>${esc(me.email)}</b><span class="small muted">${me.verified ? "Verified" : "Not verified yet"} · Keel v${esc(state.status.version)}${state.status.released ? ` (${esc(state.status.released)})` : ""}</span></span></div>
            </form>
            <div class="row" style="margin-top:16px">
              ${smtp ? `<button class="btn" id="reset-pw">Email me a password reset link</button>` : ""}
              ${smtp && !me.verified ? `<button class="btn" id="verify">Resend verification</button>` : ""}
              <div class="spacer"></div><button class="btn danger" id="logout">Sign out</button>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card" aria-labelledby="set-ru">
            <div class="card-h"><h2 id="set-ru">Categorization rules</h2><div class="spacer"></div><button class="btn sm" id="run-rules">Apply now</button><button class="btn sm primary" id="add-rule">+ Rule</button></div>
            <p class="small muted" style="margin-top:0">A transaction whose description or payee contains the text gets that category. After rules, Keel uses what you've picked by hand for each merchant, then its list of common merchants.</p>
            ${rules.length ? `<div class="rule-list">${rules.map((r) => { const c = catById(r.category); return `<div class="rule"><span class="code">${esc(r.pattern)}</span><span class="muted" aria-hidden="true">→</span><span class="grow">${c ? catLabel(c) : "?"}</span><button class="btn sm danger rule-del" data-id="${r.id}" aria-label="Remove rule ${esc(r.pattern)}">Remove</button></div>`; }).join("")}</div>`
              : `<div class="empty small">No rules yet. When you change a transaction's category, Keel offers to make one.</div>`}
          </section>
          <section class="card" aria-labelledby="set-el">
            <div class="card-h"><h2 id="set-el">More settings</h2></div>
            ${link("#/budget", "budget", "Categories and budgets", "Add, rename or archive categories; set monthly limits")}
            ${link("#/accounts", "accounts", "Accounts and bank connections", "Connect a bank, add manual accounts, import a CSV")}
            ${link("#/cashflow", "cashflow", "Low balance warning", me.cash_floor ? `Warns below ${money(me.cash_floor)}` : "Not set")}
          </section>
          ${installCard()}
        </div>
      </div>`;

    $$("[data-theme-pick]", view).forEach((b) => (b.onclick = () => {
      const t = b.dataset.themePick;
      try { if (t === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch (_) {}
      applyTheme(t);
      $$("[data-theme-pick]", view).forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); });
      toast(`Theme: ${b.textContent}`);
    }));
    $("#prefs").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = $("button.primary", e.target); btn.classList.add("loading");
      try {
        const saved = await pb.collection("users").update(me.id, {
          alerts_enabled: fd.has("alerts_enabled"), weekly_digest: fd.has("weekly_digest"), update_notes: fd.has("update_notes"), bill_reminders: fd.has("bill_reminders"), cash_alerts: fd.has("cash_alerts"),
          alert_duplicates: fd.has("alert_duplicates"), alert_price: fd.has("alert_price"), alert_renewals: fd.has("alert_renewals"), alert_paycheck: fd.has("alert_paycheck"), monthly_report: fd.has("monthly_report"),
          alert_threshold: Number(fd.get("alert_threshold")) || 90, large_txn_threshold: Number(fd.get("large_txn_threshold")) || 0,
        });
        pb.authStore.save(pb.authStore.token, saved);
        toast("Notifications saved");
      } catch (err) { fail(err); }
      btn.classList.remove("loading");
    };
    $("#profile").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await saveMe({ name: new FormData(e.target).get("name") });
        toast("Name saved");
        const who = $(".side .who"); if (who) who.textContent = pb.authStore.record.name || pb.authStore.record.email;
      } catch (err) { fail(err); }
    };
    const ia = $("#install-app"); if (ia) ia.onclick = runInstall;
    $("#digest-now").onclick = async () => { try { const r = await api("/api/budget/digest", { method: "POST" }); toast("Sent to " + r.to); } catch (err) { fail(err); } };
    $("#logout").onclick = () => { pb.authStore.clear(); history.replaceState(null, "", location.pathname); renderLanding(); };
    const rp = $("#reset-pw"); if (rp) rp.onclick = async () => { try { await pb.collection("users").requestPasswordReset(me.email); toast("Reset link sent"); } catch (err) { fail(err); } };
    const vf = $("#verify"); if (vf) vf.onclick = async () => { try { await pb.collection("users").requestVerification(me.email); toast("Verification email sent"); } catch (err) { fail(err); } };
    $("#add-rule").onclick = () => createRuleDialog("", "");
    $("#run-rules").onclick = async () => { try { const r = await api("/api/budget/apply-rules", { method: "POST" }); toast(`Categorized ${plural(r.updated, "transaction")}`); } catch (err) { fail(err); } };
    $$(".rule-del", view).forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox(`Remove the rule for “${b.closest(".rule").querySelector(".code").textContent}”? Transactions it already filed keep their category.`, "Remove rule"))) return;
      try { await pb.collection("rules").delete(b.dataset.id); toast("Rule removed"); route(); } catch (err) { fail(err); }
    }));
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
