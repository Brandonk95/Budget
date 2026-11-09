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

  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
    transactions: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    budget: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    accounts: '<path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3 3 8h18z"/>',
    spending: '<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    recurring: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    networth: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

  // a simple keel/hull mark
  const LOGO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18l-3.5 7.5a3 3 0 0 1-2.7 1.5H9.2a3 3 0 0 1-2.7-1.5z"/><path d="M12 9V3M12 18v3"/></svg>';

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
      html += `<optgroup label="${esc(KINDS[kind])}">` + cats.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.icon)} ${esc(c.name)}</option>`).join("") + "</optgroup>";
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
        <div class="brand" style="padding:0 0 6px"><div class="logo">${LOGO}</div>${esc(state.status.app_name)}</div>
        <p class="muted" style="margin:0">Track your accounts, spend with intention.</p>
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
    $$(".tabs button").forEach((b) => (b.onclick = () => renderAuth(b.dataset.m)));
    const f = $("#forgot"); if (f) f.onclick = (e) => { e.preventDefault(); renderAuth("forgot"); };
    const bk = $("#back"); if (bk) bk.onclick = (e) => { e.preventDefault(); renderAuth("login"); };
    $("#auth-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const btn = $("button.primary", e.target); btn.disabled = true;
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
      } catch (err) { fail(err); btn.disabled = false; }
    };
  }

  // ------------------------------------------------------------------ shell / router
  const ROUTES = {
    dashboard: { title: "Dashboard", render: renderDashboard, month: true },
    budget: { title: "Budget", render: renderBudget, month: true },
    spending: { title: "Spending", render: renderSpending, month: true },
    recurring: { title: "Recurring", render: renderRecurring, month: true },
    transactions: { title: "Transactions", render: renderTransactions, month: true },
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
    $("#app").innerHTML = `
      <div class="shell">
        <aside class="side">
          <div class="brand"><div class="logo">${LOGO}</div>${esc(state.status.app_name)}</div>
          <nav class="nav">${Object.keys(ROUTES).map((k) => `<a href="#/${k}" data-r="${k}">${icon(k)}<span>${ROUTES[k].title}</span></a>`).join("")}</nav>
          <div class="foot">${esc(pb.authStore.record.email)}<br><span class="muted">v${esc(state.status.version || "")}</span></div>
        </aside>
        <main>
          <div class="topbar">
            <h1 id="page-title"></h1>
            <div class="spacer"></div>
            <div class="month-picker" id="month-picker">
              <button id="mprev" aria-label="Previous month">‹</button><span id="mlabel"></span><button id="mnext" aria-label="Next month">›</button>
            </div>
          </div>
          <div id="view"></div>
        </main>
      </div>`;
    $("#mprev").onclick = () => { state.month = shiftMonth(state.month, -1); route(); };
    $("#mnext").onclick = () => { state.month = shiftMonth(state.month, 1); route(); };
  }

  async function route() {
    if (!pb.authStore.isValid) return renderAuth();
    if (!$(".shell")) renderShell();
    const r = currentRoute();
    const def = ROUTES[r];
    document.title = `${def.title} · ${state.status.app_name}`;
    $("#page-title").textContent = def.title;
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.r === r));
    $("#month-picker").classList.toggle("hidden", !def.month);
    $("#mlabel").textContent = monthLabel(state.month);
    const view = $("#view");
    view.innerHTML = `<div class="empty">Loading…</div>`;
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
    document.addEventListener("pointerdown", (e) => { if (!(e.target.closest && e.target.closest("[data-tip]"))) hide(); });
    window.addEventListener("scroll", hide, { passive: true });
  }

  // Generic line chart: series = [{ values:[...], color, dashed, area, label }], x labels by index.
  function lineChart({ series, n, xLabel, tipFor, height = 220, yMinZero = true, ariaLabel }) {
    const W = 640, H = height, L = 52, R = 14, T = 12, B = 26;
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    const lo = yMinZero ? Math.min(0, ...all) : Math.min(...all), hi = Math.max(1, ...all);
    const sc = scale(lo, hi);
    const x = (i) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - (v - sc.min) / (sc.max - sc.min)) * (H - T - B);
    let g = "";
    for (const t of sc.ticks) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
    const xt = n <= 1 ? [0] : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1];
    for (const i of [...new Set(xt)]) g += `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(xLabel(i))}</text>`;
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
      const ys = series.map((s, si) => `data-y${si}="${s.values[i] == null ? "" : y(s.values[i]).toFixed(1)}"`).join(" ");
      hits += `<rect class="hit" x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${H - T - B}" data-x="${x(i).toFixed(1)}" ${ys} ${tipAttr(tipFor(i))}/>`;
    }
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel || "")}">${g}${paths}<line class="xh" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/>${hits}</svg></div>`;
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
      <text x="100" y="98" text-anchor="middle" class="d-big">${esc(money0(total))}</text>
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
  const avatar = (name, icon) => `<span class="av" aria-hidden="true">${icon ? esc(icon) : esc((String(name || "?").trim().charAt(0) || "?").toUpperCase())}</span>`;
  const FREQ = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };
  const RKIND = { subscription: "Subscriptions", bill: "Bills & utilities", income: "Income" };
  const GROUPS = [["checking", "Checking"], ["credit", "Credit cards"], ["savings", "Savings"], ["investment", "Investments"], ["loan", "Loans"], ["cash", "Cash"], ["other", "Other"]];
  const dueText = (n) => (n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);
  function barClass(pct) { return pct == null ? "" : pct > 100 ? "bad" : pct >= 85 ? "warn" : "good"; }

  function txLine(t) {
    const c = catById(t.category);
    const acc = accById(t.account);
    return `<div class="tx-line click" data-id="${t.id}">
      ${avatar(t.payee || t.description, c && c.icon)}
      <div class="grow"><div class="t-name">${esc(t.payee || t.description || "Transaction")}${t.pending ? ' <span class="pill">pending</span>' : ""}${t.exclude ? ' <span class="pill">excluded</span>' : ""}</div>
        <div class="small muted">${esc(c ? c.name : "Uncategorized")}${acc ? " · " + esc(acc.name) : ""}</div></div>
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
      pb.collection("goals").getFullList({ sort: "target_date" }),
      loadCategories(), loadAccounts(),
    ]);
    const today = d.daily.today;
    const cur = d.daily.current, prev = d.daily.previous;
    const curNow = today ? cur[today - 1] : 0;
    const prevSame = today ? prev[Math.min(today, prev.length) - 1] || 0 : 0;
    const diff = curNow - prevSame;
    const prevTotal = prev[prev.length - 1] || 0;
    const compare = !prevTotal && !curNow ? "No spending yet."
      : d.is_current ? (Math.abs(diff) < 1 ? "About the same as last month at this point" : diff < 0 ? `<b class="pos">${money(-diff)} less</b> than last month at this point` : `<b>${money(diff)} more</b> than last month at this point`)
        : `Last month: ${money(prevTotal)}`;
    const n = Math.max(cur.length, prev.length);
    const prevKey = shiftMonth(state.month, -1);
    const chart = lineChart({
      n, ariaLabel: "Cumulative spending this month vs last month",
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
      <div class="stack">
        <div class="grid dash-top">
          <div class="card hero">
            <div class="card-h"><div><div class="label">Spent ${d.is_current ? "this month" : "in " + esc(monthLabel(state.month))}</div>
              <div class="big num">${money(d.spent)}</div><div class="small muted">${compare}</div></div>
              <div class="spacer"></div>
              <div class="legend"><span style="--c:var(--s1)">This month</span><span class="dash" style="--c:var(--muted)">Last month</span></div></div>
            ${chart}
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-h"><h2>Left to spend</h2><div class="spacer"></div><a href="#/budget" class="small">Budget →</a></div>
              ${d.budgeted > 0 ? `
                <div class="big num" style="color:${left < 0 ? "var(--bad)" : "var(--text)"}">${money(left)}</div>
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
              <div class="small muted">${nw.change === 0 ? "No change" : `<b class="${nw.change > 0 ? "pos" : ""}">${nw.change > 0 ? "+" : ""}${money(nw.change)}</b>`} over the last 30 days</div>
              <div class="accts">${groups || `<div class="muted small" style="margin-top:10px">No accounts yet.</div>`}</div>
            </div>
            <div class="card">
              <div class="card-h"><h2>Top categories</h2><div class="spacer"></div><a href="#/spending" class="small">Spending →</a></div>
              ${spendCats.length ? spendCats.map((c) => `<div class="cat-row"><div>${esc(c.icon)} ${esc(c.name)}</div><div class="num">${money(c.spent)}${c.budget ? ` <span class="muted">/ ${money0(c.budget)}</span>` : ""}</div>
                <div class="bar ${c.budget ? barClass(c.pct) : ""}"><i style="width:${(c.spent / topMax) * 100}%"></i></div></div>`).join("") : `<div class="muted small">No spending yet this month.</div>`}
              ${d.uncategorized.count ? `<div class="small" style="margin-top:8px"><a href="#/transactions?uncat=1">${d.uncategorized.count} uncategorized (${money(d.uncategorized.amount)})</a></div>` : ""}
            </div>
          </div>
        </div>

        ${d.tips.length ? `<div class="card"><div class="card-h"><h2>Insights</h2></div><ul class="tips">${d.tips.map((t) => `<li class="${t.level}">${esc(t.text)}</li>`).join("")}</ul></div>` : ""}
        ${goals.length ? `<div class="card"><div class="card-h"><h2>Goals</h2><div class="spacer"></div><a href="#/goals" class="small">All goals →</a></div>
          <div class="grid goals-grid">${goals.map(goalCard).join("")}</div></div>` : ""}
      </div>`;
    const byId = Object.fromEntries(recent.items.map((t) => [t.id, t]));
    $$(".tx-line", view).forEach((el) => (el.onclick = () => editTx(byId[el.dataset.id])));
  }

  // ------------------------------------------------------------------ spending
  async function renderSpending(view) {
    const [s] = await Promise.all([api("/api/budget/spending", { query: { month: state.month } }), loadCategories()]);
    const top = s.categories.slice(0, 7);
    const rest = s.categories.slice(7);
    const items = top.map((c, i) => ({ label: `${c.icon || ""} ${c.name}`.trim(), value: c.total, color: SERIES(i), id: c.id }));
    if (rest.length) items.push({ label: `Other (${rest.length})`, value: rest.reduce((a, c) => a + c.total, 0), color: "var(--muted)", id: null });
    const vsAvg = s.average ? s.total - s.average : 0;
    const merchMax = Math.max(1, ...s.merchants.map((m) => m.total));

    view.innerHTML = `
      <div class="stack">
        <div class="grid kpis">
          <div class="card kpi"><div class="label">Spent</div><div class="value num">${money(s.total)}</div><div class="sub">${s.transactions} purchase(s)</div></div>
          <div class="card kpi"><div class="label">vs 5-month average</div><div class="value num">${s.average ? money(Math.abs(vsAvg)) + `<span class="muted" style="font-size:14px"> ${vsAvg > 0 ? "over" : "under"}</span>` : "—"}</div><div class="sub">Average ${money(s.average)}</div></div>
          <div class="card kpi"><div class="label">Income</div><div class="value num pos">${money(s.income)}</div><div class="sub">${s.income ? `Spent ${Math.round((s.total / s.income) * 100)}% of income` : "No income this month"}</div></div>
        </div>
        <div class="grid two">
          <div class="card">
            <div class="card-h"><h2>By category</h2></div>
            ${s.categories.length ? `<div class="donut-wrap">${donut(items, s.total, "spent")}
              <div class="d-legend">${items.map((it) => `<button class="d-item" ${it.id != null ? `data-cat="${it.id}"` : "disabled"}><i style="background:${it.color}"></i><span class="grow">${esc(it.label)}</span><span class="num">${money(it.value)}</span><span class="num muted small">${s.total ? Math.round((it.value / s.total) * 100) : 0}%</span></button>`).join("")}</div></div>`
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
        <div class="cal-d">${d}</div>
        ${list.slice(0, 2).map((c) => `<div class="chip ${c.kind === "income" ? "inc" : ""} ${c.paid ? "paid" : ""}">${c.paid ? "✓ " : ""}${esc(c.name)}</div>`).join("")}
        ${list.length > 2 ? `<div class="small muted">+${list.length - 2} more</div>` : ""}
        ${list.length ? `<div class="cal-dots">${list.map((c) => `<i class="${c.kind === "income" ? "inc" : ""}"></i>`).join("")}</div>` : ""}
      </div>`;
    }
    const wd = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));
    return `<div class="cal">${wd.map((w) => `<div class="cal-h">${esc(w)}</div>`).join("")}${cells}</div>`;
  }

  function recRow(it) {
    const c = catById(it.category);
    const sub = it.status === "active"
      ? `${FREQ[it.frequency]}${it.next_due ? ` · next ${prettyDate(it.next_due)} (${dueText(it.days_until).toLowerCase()})` : ""}`
      : `${it.status === "cancelled" ? "Cancelled" : "Not recurring"}${it.last_date ? ` · last ${prettyDate(it.last_date)}` : ""}`;
    return `<div class="tx-line click rec" data-id="${it.id}">${avatar(it.name, c && c.icon)}
      <div class="grow"><div class="t-name">${esc(it.name)}${it.source === "auto" && !it.edited ? ' <span class="pill">detected</span>' : ""}</div><div class="small muted">${sub}</div></div>
      <div class="right"><div class="num ${it.kind === "income" ? "pos" : ""}">${it.kind === "income" ? "+" : ""}${money(it.amount)}</div>${it.frequency !== "monthly" ? `<div class="small muted">${money(it.monthly)}/mo</div>` : ""}</div></div>`;
  }

  async function renderRecurring(view) {
    const [r] = await Promise.all([api("/api/budget/recurring", { query: { month: state.month } }), loadCategories(), loadAccounts()]);
    const active = r.items.filter((x) => x.status === "active");
    const inactive = r.items.filter((x) => x.status !== "active");
    const t = r.totals;
    const tab = recState.tab;
    const section = (kind) => {
      const list = active.filter((x) => x.kind === kind).sort((a, b) => b.monthly - a.monthly);
      if (!list.length) return "";
      const sum = list.reduce((s, x) => s + x.monthly, 0);
      return `<div class="kind-h row"><span>${RKIND[kind]}</span><div class="spacer"></div><span class="num">${money(sum)}/mo</span></div>${list.map(recRow).join("")}`;
    };
    const upcoming = r.upcoming.slice(0, 12);
    view.innerHTML = `
      <div class="stack">
        <div class="grid kpis">
          <div class="card kpi"><div class="label">Bills &amp; subscriptions</div><div class="value num">${money(t.expenses)}<span class="muted" style="font-size:14px">/mo</span></div><div class="sub">${active.filter((x) => x.kind !== "income").length} active</div></div>
          <div class="card kpi"><div class="label">Subscriptions</div><div class="value num">${money(t.subscriptions)}<span class="muted" style="font-size:14px">/mo</span></div><div class="sub">${money(t.subscriptions * 12)} a year</div></div>
          <div class="card kpi"><div class="label">Still due ${state.month === thisMonth() ? "this month" : ""}</div><div class="value num">${money(t.remaining_this_month)}</div><div class="sub">${money(t.paid_this_month)} paid so far</div></div>
          <div class="card kpi"><div class="label">Recurring income</div><div class="value num pos">${money(t.income)}<span class="muted" style="font-size:14px">/mo</span></div><div class="sub">Paychecks &amp; deposits</div></div>
        </div>
        <div class="card">
          <div class="row" style="margin-bottom:14px">
            <div class="seg" role="tablist">
              ${[["upcoming", "Upcoming"], ["all", "All recurring"], ["inactive", `Cancelled &amp; ignored${inactive.length ? ` (${inactive.length})` : ""}`]].map(([k, l]) => `<button role="tab" data-tab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}
            </div>
            <div class="spacer"></div>
            <button class="btn" id="rec-scan" title="Look through your transactions for repeating charges">↻ Rescan</button>
            <button class="btn primary" id="rec-add">+ Add</button>
          </div>
          ${tab === "upcoming" ? `<div class="grid rec-up">
              <div>${billCalendar(state.month, r.calendar, r.today)}<div class="legend"><span style="--c:var(--s1)">Bill or subscription</span><span style="--c:var(--good)">Income</span><span>✓ paid</span></div></div>
              <div><div class="kind-h">Next 30 days</div>${upcoming.length ? upcoming.map((u) => { const it = r.items.find((x) => x.id === u.id); return `<div class="tx-line click rec" data-id="${u.id}">${avatar(u.name, it && catById(it.category) && catById(it.category).icon)}<div class="grow"><div class="t-name">${esc(u.name)}</div><div class="small muted">${dueText(u.days_until)} · ${prettyDate(u.date)}</div></div><div class="num ${u.kind === "income" ? "pos" : ""}">${u.kind === "income" ? "+" : ""}${money(u.amount)}</div></div>`; }).join("") : `<div class="muted small">Nothing due in the next 30 days.</div>`}</div>
            </div>`
            : tab === "all" ? (active.length ? ["subscription", "bill", "income"].map(section).join("") : `<div class="empty">No recurring items yet. Keel finds them after about three months of history, or add your own.</div>`)
            : (inactive.length ? inactive.map(recRow).join("") : `<div class="empty">Nothing here. Items you cancel or mark as not recurring show up here.</div>`)}
        </div>
      </div>`;
    $$(".seg button", view).forEach((b) => (b.onclick = () => { recState.tab = b.dataset.tab; route(); }));
    const byId = Object.fromEntries(r.items.map((x) => [x.id, x]));
    $$(".rec", view).forEach((el) => (el.onclick = () => editRecurring(byId[el.dataset.id])));
    $("#rec-add").onclick = () => editRecurring(null);
    $("#rec-scan").onclick = async (e) => {
      e.target.disabled = true;
      try { const x = await api("/api/budget/recurring/detect", { method: "POST" }); toast(x.found ? `Found ${x.found} new recurring item(s)` : "No new recurring items found"); route(); } catch (err) { fail(err); e.target.disabled = false; }
    };
  }

  function editRecurring(it) {
    const isNew = !it;
    it = it || { name: "", amount: "", kind: "bill", frequency: "monthly", next_date: ymd(new Date()), category: "", status: "active", source: "manual" };
    const sel = (name, map, v) => `<select name="${name}">${Object.keys(map).map((k) => `<option value="${k}" ${k === v ? "selected" : ""}>${map[k]}</option>`).join("")}</select>`;
    modal(isNew ? "Add recurring" : it.name, `
      <form id="rec-form" class="stack">
        ${!isNew && it.last_date ? `<div class="callout small">Last ${it.kind === "income" ? "deposit" : "charge"}: <b>${money(it.last_amount || it.amount)}</b> on ${prettyDate(it.last_date)} ${dateOnly(it.last_date).slice(0, 4)}${it.source === "auto" ? " · detected from your transactions" : ""}</div>` : ""}
        <label class="field"><span>Name</span><input name="name" required value="${esc(it.name)}" placeholder="e.g. Netflix, Rent, Electric"></label>
        <div class="form-grid">
          <label class="field"><span>Amount</span><input name="amount" type="number" min="0" step="0.01" required value="${it.amount}"></label>
          <label class="field"><span>Type</span>${sel("kind", { subscription: "Subscription", bill: "Bill", income: "Income" }, it.kind)}</label>
        </div>
        <div class="form-grid">
          <label class="field"><span>How often</span>${sel("frequency", FREQ, it.frequency)}</label>
          <label class="field"><span>Next due</span><input name="next_date" type="date" value="${dateOnly(it.next_due || it.next_date)}"></label>
        </div>
        <label class="field"><span>Category</span><select name="category">${categoryOptions(it.category, { noneLabel: "None" })}</select></label>
        <div class="actions">
          ${!isNew ? (it.status === "active"
            ? `<button type="button" class="btn" id="r-cancel" title="You stopped this; keep it for reference">Mark cancelled</button><button type="button" class="btn" id="r-ignore" title="This isn't actually recurring">Not recurring</button>`
            : `<button type="button" class="btn" id="r-active">Track again</button>`) + (it.source === "manual" ? `<button type="button" class="btn danger" id="r-del">Delete</button>` : "") + `<div class="spacer"></div>` : ""}
          <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>
        </div>
      </form>`, {
      onMount: (m, close) => {
        const form = $("#rec-form", m);
        const save = async (extra) => {
          const fd = Object.fromEntries(new FormData(form));
          const data = { name: fd.name.trim(), amount: Math.abs(Number(fd.amount) || 0), kind: fd.kind, frequency: fd.frequency, category: fd.category, next_date: fd.next_date ? fd.next_date + " 12:00:00.000Z" : "", ...extra };
          try {
            if (isNew) await pb.collection("recurring").create({ ...data, user: pb.authStore.record.id, status: "active" });
            else await pb.collection("recurring").update(it.id, data);
            close(); route();
          } catch (err) { fail(err); }
        };
        form.onsubmit = (e) => { e.preventDefault(); save({}); };
        const on = (id, fn) => { const b = $(id, m); if (b) b.onclick = fn; };
        on("#r-cancel", () => save({ status: "cancelled" }));
        on("#r-ignore", () => save({ status: "ignored" }));
        on("#r-active", () => save({ status: "active" }));
        on("#r-del", async () => { close(); if (await confirmBox(`Delete “${it.name}”?`)) { try { await pb.collection("recurring").delete(it.id); route(); } catch (err) { fail(err); } } });
      },
    });
  }

  // ------------------------------------------------------------------ net worth
  const nwState = { days: 90 };
  async function renderNetWorth(view) {
    const nw = await api("/api/budget/networth", { query: { days: nwState.days } });
    const pts = nw.points;
    const est = pts.some((p) => p.estimated);
    const chart = pts.length > 1 ? lineChart({
      n: pts.length, yMinZero: false, height: 240, ariaLabel: "Net worth over time",
      series: [{ values: pts.map((p) => p.net), color: "var(--s1)", area: false, endDot: true }],
      xLabel: (i) => prettyDate(pts[i].day),
      tipFor: (i) => `<b>${esc(prettyDate(pts[i].day))}</b><br>${money(pts[i].net)}${pts[i].estimated ? '<br><span class="muted">estimated</span>' : ""}`,
    }) : `<div class="empty">Not enough history yet.</div>`;
    const assetG = [], liabG = [];
    for (const [k, label] of GROUPS) {
      const g = nw.groups[k]; if (!g) continue;
      (k === "credit" || k === "loan" ? liabG : assetG).push({ label, g });
    }
    const list = (arr) => arr.length ? arr.map(({ label, g }) => `<div class="kind-h row"><span>${label}</span><div class="spacer"></div><span class="num">${money(Math.abs(g.total))}</span></div>
      ${g.accounts.map((a) => `<div class="acct-row"><span>${esc(a.name)}${a.institution ? ` <span class="muted small">${esc(a.institution)}</span>` : ""}</span><span class="num">${money(Math.abs(a.value))}</span></div>`).join("")}`).join("") : `<div class="muted small">None.</div>`;
    view.innerHTML = `
      <div class="stack">
        <div class="card hero">
          <div class="card-h"><div><div class="label">Net worth</div><div class="big num">${money(nw.net)}</div>
            <div class="small muted">${nw.change === 0 ? "No change" : `<b class="${nw.change > 0 ? "pos" : ""}">${nw.change > 0 ? "+" : ""}${money(nw.change)}</b>`} over the last ${nwState.days} days</div></div>
            <div class="spacer"></div>
            <div class="seg">${[[30, "1M"], [90, "3M"], [180, "6M"], [365, "1Y"]].map(([dd, l]) => `<button data-days="${dd}" class="${nwState.days === dd ? "on" : ""}">${l}</button>`).join("")}</div></div>
          ${chart}
          ${est ? `<p class="small muted" style="margin:6px 0 0">Earlier points are estimated from your transactions; Keel records your balances daily from now on.</p>` : ""}
        </div>
        <div class="grid halves">
          <div class="card"><div class="card-h"><h2>Assets</h2><div class="spacer"></div><span class="num pos">${money(nw.assets)}</span></div>${list(assetG)}</div>
          <div class="card"><div class="card-h"><h2>Liabilities</h2><div class="spacer"></div><span class="num">${money(nw.liabilities)}</span></div>${list(liabG)}</div>
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
          <select id="tcat" class="inline"><option value="">All categories</option><option value="__none" ${txState.category === "__none" ? "selected" : ""}>❔ Uncategorized</option>${categoryOptions(txState.category, { includeNone: false })}</select>
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
      try { const r = await api("/api/budget/apply-rules", { method: "POST" }); toast(`Categorized ${r.updated} transaction(s)`); loadTx(); } catch (err) { fail(err); }
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
        <span class="muted small">${res.totalItems} transaction(s) · net ${money(total)} on this page</span>
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
    el.innerHTML = `Always put “${esc(pattern)}” in ${esc(cat.name)}? <button class="btn sm" style="margin-left:8px">Create rule</button>`;
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
            if (fd.apply) { const r = await api("/api/budget/apply-rules", { method: "POST" }); toast(`Rule saved · ${r.updated} transaction(s) categorized`); }
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
            close(); toast("Saved");
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
    const pct = c.available > 0 ? Math.min(100, (c.spent / c.available) * 100) : (c.spent > 0 ? 100 : 0);
    const proj = d.is_current && c.available > 0 && c.projected > c.spent ? Math.min(100, (c.projected / c.available) * 100) : null;
    return `<div class="b-row click" data-id="${c.id || ""}">
      <div class="row"><span class="b-name">${esc(c.icon || "")} ${esc(c.name)}</span>${c.rollover ? `<span class="pill" title="Unspent money carries over to next month">rollover</span>` : ""}
        <div class="spacer"></div><span class="num ${over ? "over" : ""}">${over ? money(-c.remaining) + " over" : money(c.remaining) + " left"}</span></div>
      <div class="bar ${barClass(c.available > 0 ? Math.round((c.spent / c.available) * 100) : null)}"><i style="width:${pct}%"></i>${proj != null && proj > pct ? `<b style="left:${proj}%" title="On pace for ${esc(money(c.projected))}"></b>` : ""}</div>
      <div class="small muted">${money(c.spent)} of ${money(c.available)}${c.carry ? ` · ${c.carry > 0 ? "+" : ""}${money(c.carry)} rolled over` : ""}${c.avg3 ? ` · usually ${money0(c.avg3)}` : ""}</div>
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
          <div class="b-ring">${ring(usedPct, ringCls, money0(Math.abs(d.budget_left)), d.budget_left < 0 ? "over budget" : "left to spend")}
            <div class="small muted center">${money(d.spent)} spent of ${money(d.budgeted)}</div>
            ${d.is_current && d.remaining_days && d.budget_left > 0 ? `<div class="small center"><b class="num">${money(d.safe_per_day)}</b>/day for ${d.remaining_days} more days</div>` : ""}
          </div>
          <div class="b-math">
            <div class="m-row"><span>Income <button class="btn link sm" id="edit-income">${d.income_override ? "edit" : "auto · edit"}</button></span><span class="num pos">${money(d.expected_income)}</span></div>
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
            ${hasBudget ? budgetRow({ id: "", name: "Everything else", icon: "📦", available: ee.budget, spent: ee.spent, remaining: ee.remaining, carry: 0, avg3: ee.avg3, projected: 0 }, d) : ""}
            ${unbudgeted.filter((c) => c.spent > 0).length ? `<details class="else-list"><summary class="small muted">What's in “Everything else”</summary>
              ${unbudgeted.filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent).map((c) => `<div class="acct-row"><span>${esc(c.icon)} ${esc(c.name)}</span><span class="num">${money(c.spent)}</span></div>`).join("")}
              ${d.uncategorized.amount ? `<div class="acct-row"><a href="#/transactions?uncat=1">❔ Uncategorized</a><span class="num">${money(d.uncategorized.amount)}</span></div>` : ""}</details>` : ""}
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
            ${Object.keys(KINDS).map((k) => { const list = state.categories.filter((c) => c.kind === k && !c.archived); return list.length ? `<tr><td colspan="3" class="kind-h">${KINDS[k]}</td></tr>` + list.map((c) => `<tr><td>${esc(c.icon)} ${esc(c.name)}</td><td class="right num muted">${c.budget ? money(c.budget) + "/mo" : ""}</td><td class="right"><button class="btn sm edit-cat" data-id="${c.id}">Edit</button></td></tr>`).join("") : ""; }).join("")}
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
    modal(`${c.icon || ""} ${c.name}`.trim(), `
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
    modal("Add a category budget", `<div class="pick">${options.map((c) => `<button class="pick-i" data-id="${c.id}">${esc(c.icon)} ${esc(c.name)}<span class="spacer"></span><span class="small muted">${c.avg3 ? "avg " + money0(c.avg3) : ""}</span></button>`).join("")}</div>
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
            return `<label class="wz-cat"><input type="checkbox" data-id="${c.id}" ${on ? "checked" : ""}><span class="grow">${esc(c.icon)} ${esc(c.name)}${c.avg3 ? ` <span class="small muted">avg ${money0(c.avg3)}</span>` : ""}</span>
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
        <div class="form-grid">
          <label class="field" style="max-width:90px"><span>Icon</span><input name="icon" maxlength="4" value="${esc(cat.icon)}" placeholder="🙂"></label>
          <label class="field"><span>Name</span><input name="name" required value="${esc(cat.name)}"></label>
        </div>
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

    const accRow = (a) => `<tr data-id="${a.id}">
      <td><input class="inline acc-name" value="${esc(a.name)}" style="min-width:150px">${a.institution ? `<div class="small muted">${esc(a.institution)}</div>` : ""}</td>
      <td><select class="inline acc-type">${ACCOUNT_TYPES.map((t) => `<option ${t === a.type ? "selected" : ""}>${t}</option>`).join("")}</select></td>
      <td class="right num">${a.connection ? money(a.balance) : `<input class="inline acc-bal num" type="number" step="0.01" value="${a.balance || 0}" style="width:120px;text-align:right">`}</td>
      <td class="center"><label class="check" title="Count this account's transactions in your budget"><input type="checkbox" class="acc-onb" ${a.on_budget ? "checked" : ""}> <span class="small">In budget</span></label></td>
      <td><label class="check" title="Hide from net worth"><input type="checkbox" class="acc-hide" ${a.hidden ? "checked" : ""}> <span class="small">Hide</span></label></td>
      ${a.connection ? `<td><label class="check" title="Use if this bank reports purchases as positive amounts (applies from the next sync)"><input type="checkbox" class="acc-flip" ${a.flip_amounts ? "checked" : ""}> <span class="small">Flip ±</span></label></td>` : `<td></td>`}
      <td class="right"><button class="btn sm danger acc-del">Delete</button></td>
    </tr>`;
    const accTable = (list) => list && list.length ? `<div class="table-wrap"><table><thead><tr><th>Account</th><th>Type</th><th class="right">Balance</th><th></th><th></th><th></th><th></th></tr></thead><tbody>${list.map(accRow).join("")}</tbody></table></div>` : `<div class="muted small">No accounts.</div>`;

    view.innerHTML = `
      <div class="stack">
        <div class="card">
          <div class="card-h"><h2>Bank connections</h2><div class="spacer"></div>
            ${conns.length ? `<button class="btn" id="sync-all">↻ Sync now</button>` : ""}
            <button class="btn primary" id="connect">+ Connect bank</button></div>
          ${conns.length ? conns.map((c) => `
            <div class="callout" style="margin-bottom:12px">
              <div class="row"><b>${esc(c.name)}</b>
                <span class="pill ${c.status === "ok" ? "ok" : "err"}">${c.status === "ok" ? "connected" : "needs attention"}</span>
                <span class="small muted">${c.last_sync ? "Last sync " + new Date(c.last_sync.replace(" ", "T")).toLocaleString() : "Never synced"}</span>
                <div class="spacer"></div>
                <button class="btn sm danger conn-del" data-id="${c.id}">Disconnect</button></div>
              ${c.last_error ? `<div class="small" style="color:var(--${c.status === "ok" ? "muted" : "bad"});margin-top:6px">${esc(c.last_error)}</div>` : ""}
              <div style="margin-top:10px">${accTable(byConn[c.id])}</div>
            </div>`).join("") : `<div class="muted">Connect your bank through <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noopener">SimpleFIN Bridge</a> to sync balances and transactions automatically, or use manual accounts with CSV import below.</div>`}
        </div>

        <div class="card">
          <div class="card-h"><h2>Manual accounts</h2><div class="spacer"></div>
            <button class="btn" id="import-csv">Import CSV</button>
            <button class="btn primary" id="add-acc">+ Account</button></div>
          ${accTable(byConn[""])}
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
        if (!(await confirmBox("Delete this account and all of its transactions?"))) return;
        try { await pb.collection("accounts").delete(id); route(); } catch (err) { fail(err); }
      };
    });
    $$(".conn-del", view).forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox("Disconnect this bank? Its accounts and transaction history stay here as manual accounts."))) return;
      try { await pb.collection("bank_connections").delete(b.dataset.id); route(); } catch (err) { fail(err); }
    }));
    const sa = $("#sync-all");
    if (sa) sa.onclick = async () => {
      sa.disabled = true; sa.textContent = "Syncing…";
      try {
        const r = await api("/api/budget/sync", { method: "POST" });
        toast(`Synced ${r.accounts} account(s), ${r.new_transactions} new transaction(s)`);
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
          const btn = $("button.primary", e.target); btn.disabled = true; btn.textContent = "Connecting… (up to a minute)";
          try {
            const r = await api("/api/budget/connect", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
            close();
            toast(`Connected · ${r.sync.accounts} account(s), ${r.sync.new_transactions} transaction(s) imported`);
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
          <label class="field"><span>Type</span><select name="type">${ACCOUNT_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>
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
          $("#imp-prev", m).innerHTML = `<p class="small muted">${out.length} of ${rows.length} row(s) look valid. Spending should be negative.</p>
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
            close(); toast(`Imported ${r.inserted} · skipped ${r.skipped} duplicate(s)${r.invalid ? ` · ${r.invalid} invalid` : ""}`);
            route();
          } catch (err) { fail(err); btn.disabled = false; btn.textContent = "Import"; }
        };
      },
    });
  }

  // ------------------------------------------------------------------ goals
  function goalMath(g) {
    const left = Math.max(0, (g.target || 0) - (g.saved || 0));
    let monthly = null, months = null;
    if (g.target_date && left > 0) {
      const [y, m] = dateOnly(g.target_date).split("-").map(Number);
      const now = new Date();
      months = Math.max(1, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()));
      monthly = left / months;
    }
    return { left, monthly, months, pct: g.target ? Math.min(100, ((g.saved || 0) / g.target) * 100) : 0 };
  }
  function goalCard(g) {
    const x = goalMath(g);
    return `<div class="card goal" data-id="${g.id}">
      <div class="row"><b>${esc(g.icon || "🎯")} ${esc(g.name)}</b><div class="spacer"></div><span class="num muted">${Math.round(x.pct)}%</span></div>
      <div class="bar ${x.pct >= 100 ? "good" : ""}"><i style="width:${x.pct}%"></i></div>
      <div class="small"><span class="num">${money(g.saved)}</span> <span class="muted">of ${money(g.target)}</span></div>
      <div class="small muted" style="margin-top:4px">${x.left <= 0 ? "Goal reached 🎉" : x.monthly != null ? `Save ${money(x.monthly)}/mo to hit it by ${prettyDate(g.target_date)} ${dateOnly(g.target_date).slice(0, 4)}` : `${money(x.left)} to go`}</div>
    </div>`;
  }

  async function renderGoals(view) {
    const goals = await pb.collection("goals").getFullList({ sort: "target_date" });
    const monthlyNeed = goals.reduce((s, g) => s + (goalMath(g).monthly || 0), 0);
    view.innerHTML = `
      <div class="stack">
        <div class="row"><p class="muted" style="margin:0">${goals.length ? `To stay on schedule, set aside about <b class="num">${money(monthlyNeed)}</b>/month across your goals. Add that to a Savings category on the Budget page.` : "Set savings goals — an emergency fund, a trip, a down payment — and see what to save each month."}</p>
          <div class="spacer"></div><button class="btn primary" id="add-goal">+ Goal</button></div>
        ${goals.length ? `<div class="grid goals-grid">${goals.map((g) => goalCard(g).replace('class="card goal"', 'class="card goal" style="cursor:pointer"')).join("")}</div>` : `<div class="card empty">No goals yet.</div>`}
      </div>`;
    const byId = Object.fromEntries(goals.map((g) => [g.id, g]));
    $$(".goal", view).forEach((el) => (el.onclick = () => editGoal(byId[el.dataset.id])));
    $("#add-goal").onclick = () => editGoal(null);
  }

  function editGoal(g) {
    const isNew = !g;
    g = g || { name: "", target: "", saved: 0, target_date: "", icon: "🎯" };
    modal(isNew ? "New goal" : "Edit goal", `
      <form id="goal-form" class="stack">
        <div class="form-grid">
          <label class="field" style="max-width:90px"><span>Icon</span><input name="icon" maxlength="4" value="${esc(g.icon)}"></label>
          <label class="field"><span>Name</span><input name="name" required value="${esc(g.name)}" placeholder="Emergency fund"></label>
        </div>
        <div class="form-grid">
          <label class="field"><span>Target</span><input name="target" type="number" min="0" step="1" required value="${g.target}"></label>
          <label class="field"><span>Saved so far</span><input name="saved" type="number" min="0" step="0.01" value="${g.saved || 0}"></label>
          <label class="field"><span>Target date</span><input name="target_date" type="date" value="${dateOnly(g.target_date)}"></label>
        </div>
        ${!isNew ? `<div class="row"><input id="contrib" type="number" step="0.01" placeholder="Amount" style="max-width:140px"><button type="button" class="btn" id="add-contrib">+ Add contribution</button></div>` : ""}
        <div class="actions">
          ${!isNew ? `<button type="button" class="btn danger" id="del">Delete</button><div class="spacer"></div>` : ""}
          <button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button>
        </div>
      </form>`, {
      onMount: (m, close) => {
        const form = $("#goal-form", m);
        const ac = $("#add-contrib", m);
        if (ac) ac.onclick = () => { const v = Number($("#contrib", m).value) || 0; const s = $("[name=saved]", form); s.value = Math.round(((Number(s.value) || 0) + v) * 100) / 100; $("#contrib", m).value = ""; };
        form.onsubmit = async (e) => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(form));
          const data = { name: fd.name, icon: fd.icon, target: Number(fd.target) || 0, saved: Number(fd.saved) || 0, target_date: fd.target_date ? fd.target_date + " 12:00:00.000Z" : "" };
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
          <p class="small muted" style="margin-top:0">New transactions whose description or payee contains the text get that category. Built-in guesses handle common merchants; your rules win.</p>
          ${rules.length ? `<table><tbody>${rules.map((r) => { const c = catById(r.category); return `<tr><td class="code">${esc(r.pattern)}</td><td>→ ${c ? esc(c.icon + " " + c.name) : "?"}</td><td class="right"><button class="btn sm danger rule-del" data-id="${r.id}">Remove</button></td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">No rules yet. Tip: when you change a transaction's category you'll be offered a rule.</div>`}
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
    $("#digest-now").onclick = async () => { try { const r = await api("/api/budget/digest", { method: "POST" }); toast("Sent to " + r.to); } catch (err) { fail(err); } };
    $("#logout").onclick = () => { pb.authStore.clear(); location.hash = ""; renderAuth(); };
    const rp = $("#reset-pw"); if (rp) rp.onclick = async () => { try { await pb.collection("users").requestPasswordReset(me.email); toast("Reset link sent"); } catch (err) { fail(err); } };
    const vf = $("#verify"); if (vf) vf.onclick = async () => { try { await pb.collection("users").requestVerification(me.email); toast("Verification email sent"); } catch (err) { fail(err); } };
    $("#add-rule").onclick = () => createRuleDialog("", "");
    $("#run-rules").onclick = async () => { try { const r = await api("/api/budget/apply-rules", { method: "POST" }); toast(`Categorized ${r.updated} transaction(s)`); } catch (err) { fail(err); } };
    $$(".rule-del", view).forEach((b) => (b.onclick = async () => { try { await pb.collection("rules").delete(b.dataset.id); route(); } catch (err) { fail(err); } }));
  }

  // ------------------------------------------------------------------ update notes
  // The server is auto-updated (Watchtower). We show a small "what's new" card when
  // the running version differs from the last one this user acknowledged.
  const loadedVersion = { v: "" };

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
    state.status = s;
    loadedVersion.v = s.version;
    if (notesEnabled()) showUpdate(s, true);
    else if (document.hidden) location.reload(); // pick up the new UI quietly
  }

  // ------------------------------------------------------------------ boot
  async function start() {
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
      try { await pb.collection("users").authRefresh(); } catch (_) { pb.authStore.clear(); }
    }
    if (pb.authStore.isValid) start(); else renderAuth();
  })();
})();
