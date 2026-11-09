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
    transactions: { title: "Transactions", render: renderTransactions, month: true },
    budget: { title: "Budget", render: renderBudget, month: true },
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

  // ------------------------------------------------------------------ dashboard
  function barClass(pct) { return pct == null ? "" : pct > 100 ? "bad" : pct >= 85 ? "warn" : "good"; }

  function trendChart(trend) {
    const W = 560, H = 190, P = 26, max = Math.max(1, ...trend.map((t) => Math.max(t.income, t.spend)));
    const gw = (W - P * 2) / trend.length, bw = Math.min(22, gw / 3);
    const y = (v) => H - 24 - (v / max) * (H - 44);
    let bars = "";
    trend.forEach((t, i) => {
      const x = P + i * gw + gw / 2;
      bars += `<rect x="${x - bw - 2}" y="${y(t.income)}" width="${bw}" height="${H - 24 - y(t.income)}" rx="3" fill="var(--good)"><title>Income ${money(t.income)}</title></rect>`;
      bars += `<rect x="${x + 2}" y="${y(t.spend)}" width="${bw}" height="${H - 24 - y(t.spend)}" rx="3" fill="var(--primary)"><title>Spent ${money(t.spend)}</title></rect>`;
      bars += `<text x="${x}" y="${H - 6}" text-anchor="middle">${shortMonth(t.month)}</text>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and spending, last 6 months">
      <line x1="${P}" x2="${W - P}" y1="${H - 24}" y2="${H - 24}" stroke="var(--border)"/>${bars}</svg></div>
      <div class="legend"><span style="--c:var(--good)">Income</span><span style="--c:var(--primary)">Spending</span></div>`;
  }

  async function renderDashboard(view) {
    const [d, goals] = await Promise.all([
      api("/api/budget/insights", { query: { month: state.month } }),
      pb.collection("goals").getFullList({ sort: "target_date" }),
      loadAccounts(),
    ]);
    const visibleAccounts = state.accounts.filter((a) => !a.hidden);
    const netWorth = visibleAccounts.reduce((s, a) => s + (a.balance || 0), 0);
    const spendCats = d.categories.filter((c) => c.kind !== "income" && (c.budget > 0 || c.spent > 0));
    const income = d.expected_income || 1;

    const catSection = ["needs", "wants", "savings"].map((kind) => {
      const list = spendCats.filter((c) => c.kind === kind).sort((a, b) => (b.pct || 0) - (a.pct || 0));
      if (!list.length) return "";
      return `<div class="kind-h">${KINDS[kind]}</div>` + list.map((c) => {
        const pct = c.budget > 0 ? Math.min(100, (c.spent / c.budget) * 100) : 100;
        const proj = c.budget > 0 && d.is_current ? Math.min(100, (c.projected / c.budget) * 100) : null;
        return `<div class="cat-row">
          <div>${esc(c.icon)} ${esc(c.name)}</div>
          <div class="num">${money(c.spent)} <span class="muted">/ ${c.budget > 0 ? money(c.budget) : "no budget"}</span></div>
          <div class="bar ${c.budget > 0 ? barClass(c.pct) : "warn"}"><i style="width:${pct}%"></i>${proj != null && proj > pct ? `<b style="left:${proj}%" title="Projected ${money(c.projected)}"></b>` : ""}</div>
        </div>`;
      }).join("");
    }).join("");

    const sp = d.split;
    view.innerHTML = `
      <div class="stack">
        <div class="grid kpis">
          <div class="card kpi"><div class="label">Income</div><div class="value num pos">${money(d.income)}</div><div class="sub">Typical: ${money(d.expected_income)}</div></div>
          <div class="card kpi"><div class="label">Spent</div><div class="value num">${money(d.spent)}</div><div class="sub">${d.is_current ? "Projected " + money(d.projected_spend) : "of " + money(d.budgeted) + " budgeted"}</div></div>
          <div class="card kpi"><div class="label">Left in budget</div><div class="value num ${d.budget_left < 0 ? "" : "pos"}" style="${d.budget_left < 0 ? "color:var(--bad)" : ""}">${money(d.budget_left)}</div><div class="sub">${money(d.budgeted)} budgeted</div></div>
          ${d.is_current ? `<div class="card kpi"><div class="label">Safe to spend</div><div class="value num">${money(d.safe_per_day)}<span class="muted" style="font-size:14px">/day</span></div><div class="sub">${d.remaining_days} days left</div></div>` : ""}
          <div class="card kpi"><div class="label">Net worth</div><div class="value num">${money(netWorth)}</div><div class="sub">${visibleAccounts.length} account${visibleAccounts.length === 1 ? "" : "s"}</div></div>
        </div>

        <div class="grid two">
          <div class="card">
            <div class="card-h"><h2>Spending by category</h2><div class="spacer"></div><a href="#/budget" class="small">Edit budget →</a></div>
            ${catSection || `<div class="empty">No spending yet this month.</div>`}
            ${d.uncategorized.count ? `<div class="cat-row"><div>❔ <a href="#/transactions?uncat=1">Uncategorized (${d.uncategorized.count})</a></div><div class="num">${money(d.uncategorized.amount)}</div></div>` : ""}
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-h"><h2>Insights</h2></div>
              ${d.tips.length ? `<ul class="tips">${d.tips.map((t) => `<li class="${t.level}">${esc(t.text)}</li>`).join("")}</ul>` : `<div class="muted">You're on track. Nice work.</div>`}
            </div>
            <div class="card">
              <div class="card-h"><h2>50 / 30 / 20 check</h2></div>
              <div class="split">
                <i style="width:${Math.min(100, (sp.needs / income) * 100)}%;background:var(--needs)"></i>
                <i style="width:${Math.min(100, (sp.wants / income) * 100)}%;background:var(--wants)"></i>
                <i style="width:${Math.max(0, Math.min(100, (sp.savings / income) * 100))}%;background:var(--savings)"></i>
              </div>
              <div class="legend">
                <span style="--c:var(--needs)">Needs ${sp.needs_pct}% <em class="muted">(≤50%)</em></span>
                <span style="--c:var(--wants)">Wants ${sp.wants_pct}% <em class="muted">(≤30%)</em></span>
                <span style="--c:var(--savings)">Left / saved ${sp.savings_pct}% <em class="muted">(≥20%)</em></span>
              </div>
            </div>
          </div>
        </div>

        <div class="grid two">
          <div class="card"><div class="card-h"><h2>Last 6 months</h2></div>${trendChart(d.trend)}</div>
          <div class="card">
            <div class="card-h"><h2>Recurring charges</h2><div class="spacer"></div><span class="num muted">${money(d.recurring_total)}/mo</span></div>
            ${d.recurring.length ? `<table><tbody>${d.recurring.slice(0, 8).map((r) => `<tr><td class="desc">${esc(r.name)}<div class="small muted">${r.months} months · last ${prettyDate(r.last_date)}</div></td><td class="right num">${money(r.amount)}</td></tr>`).join("")}</tbody></table>` : `<div class="muted">Recurring charges show up after ~3 months of history.</div>`}
          </div>
        </div>

        ${goals.length ? `<div class="card"><div class="card-h"><h2>Goals</h2><div class="spacer"></div><a href="#/goals" class="small">All goals →</a></div>
          <div class="grid goals-grid">${goals.map(goalCard).join("")}</div></div>` : ""}
      </div>`;
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
    box.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Account</th><th>Category</th><th class="right">Amount</th></tr></thead>
        <tbody>${res.items.map((t) => {
          const acc = accById(t.account);
          return `<tr class="click" data-id="${t.id}">
            <td class="num">${prettyDate(t.date)}</td>
            <td class="desc" title="${esc(t.description)}">${esc(t.payee || t.description)}${t.pending ? ' <span class="pill">pending</span>' : ""}${t.notes ? `<div class="small muted desc">${esc(t.notes)}</div>` : ""}</td>
            <td class="hide-sm muted small">${esc(acc ? acc.name : "")}</td>
            <td><select class="inline cat-sel" data-id="${t.id}">${categoryOptions(t.category)}</select></td>
            <td class="right num ${t.amount > 0 ? "pos" : ""}">${money(t.amount)}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
      <div class="row" style="margin-top:12px">
        <span class="muted small">${res.totalItems} transaction(s) · net ${money(total)} on this page</span>
        <div class="spacer"></div>
        ${res.page > 1 ? `<button class="btn sm" id="pprev">‹ Prev</button>` : ""}
        ${res.page < res.totalPages ? `<button class="btn sm" id="pnext">Next ›</button>` : ""}
      </div>`;
    const items = Object.fromEntries(res.items.map((t) => [t.id, t]));
    $$(".cat-sel", box).forEach((s) => {
      s.onclick = (e) => e.stopPropagation();
      s.onchange = async () => {
        const tx = items[s.dataset.id];
        try {
          await pb.collection("transactions").update(tx.id, { category: s.value });
          tx.category = s.value;
          if (s.value) offerRule(tx, s.value);
        } catch (err) { fail(err); }
      };
    });
    $$("tr.click", box).forEach((tr) => (tr.onclick = () => editTx(items[tr.dataset.id])));
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
          const data = { payee: fd.payee, category: fd.category, notes: fd.notes };
          if (manual) Object.assign(data, { date: fd.date + " 12:00:00.000Z", amount: Number(fd.amount), description: fd.description });
          try {
            if (isNew) await pb.collection("transactions").create({ ...data, user: pb.authStore.record.id, account: fd.account });
            else await pb.collection("transactions").update(tx.id, data);
            close(); toast("Saved"); loadTx();
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
  async function renderBudget(view) {
    const [d] = await Promise.all([api("/api/budget/insights", { query: { month: state.month } }), loadCategories()]);
    const stats = Object.fromEntries(d.categories.map((c) => [c.id, c]));
    const spendBudget = state.categories.filter((c) => !c.archived && c.kind !== "income" && c.kind !== "transfer").reduce((s, c) => s + (c.budget || 0), 0);
    const unassigned = d.expected_income - spendBudget;

    const section = (kind) => {
      const cats = state.categories.filter((c) => c.kind === kind && !c.archived);
      if (!cats.length) return "";
      const showBudget = kind !== "income" && kind !== "transfer";
      return `<tr><td colspan="6" class="kind-h" style="padding-top:18px">${KINDS[kind]}</td></tr>` + cats.map((c) => {
        const s = stats[c.id] || { spent: 0, avg3: 0, suggested: 0, pct: null };
        return `<tr data-id="${c.id}">
          <td><button class="btn link edit-cat" style="color:inherit;font-weight:500">${esc(c.icon)} ${esc(c.name)}</button></td>
          <td class="right">${showBudget ? `<input class="budget-input num" type="number" min="0" step="1" value="${c.budget || 0}" data-id="${c.id}">` : `<span class="muted">—</span>`}</td>
          <td class="right num">${showBudget ? money(s.spent) : ""}</td>
          <td class="right num hide-sm">${showBudget ? `<div class="bar ${barClass(s.pct)}" style="width:80px;display:inline-block;vertical-align:middle"><i style="width:${Math.min(100, s.pct || 0)}%"></i></div>` : ""}</td>
          <td class="right num muted hide-sm">${showBudget ? money(s.avg3) : ""}</td>
          <td class="right">${showBudget && s.suggested && s.suggested !== c.budget ? `<button class="btn sm use-sugg" data-id="${c.id}" data-v="${s.suggested}" title="Based on your 3-month average">Use ${money(s.suggested)}</button>` : ""}</td>
        </tr>`;
      }).join("");
    };

    view.innerHTML = `
      <div class="stack">
        <div class="grid kpis">
          <div class="card kpi"><div class="label">Typical income</div><div class="value num">${money(d.expected_income)}</div><div class="sub">This month or 3-month average</div></div>
          <div class="card kpi"><div class="label">Budgeted</div><div class="value num" id="budgeted-total">${money(spendBudget)}</div><div class="sub">Needs, wants &amp; savings</div></div>
          <div class="card kpi"><div class="label">${unassigned >= 0 ? "Left to assign" : "Over-assigned"}</div><div class="value num" id="unassigned" style="color:${unassigned >= 0 ? "var(--good)" : "var(--bad)"}">${money(Math.abs(unassigned))}</div><div class="sub">Give every dollar a job</div></div>
        </div>
        <div class="card">
          <div class="row" style="margin-bottom:8px">
            <p class="muted small" style="margin:0">Budgets apply every month. Edit an amount and it saves automatically.</p>
            <div class="spacer"></div>
            <button class="btn" id="all-sugg">Fill empty budgets from history</button>
            <button class="btn primary" id="add-cat">+ Category</button>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Category</th><th class="right">Monthly budget</th><th class="right">Spent</th><th class="right hide-sm">Used</th><th class="right hide-sm">3-mo avg</th><th></th></tr></thead>
            <tbody>${["needs", "wants", "savings", "income", "transfer"].map(section).join("")}</tbody>
          </table></div>
          ${state.categories.some((c) => c.archived) ? `<p class="small muted">${state.categories.filter((c) => c.archived).length} archived categor(ies) hidden.</p>` : ""}
        </div>
      </div>`;

    const saveBudget = async (id, value) => {
      const v = Math.max(0, Number(value) || 0);
      try {
        await pb.collection("categories").update(id, { budget: v });
        const c = catById(id); if (c) c.budget = v;
        const total = state.categories.filter((c) => !c.archived && c.kind !== "income" && c.kind !== "transfer").reduce((s, c) => s + (c.budget || 0), 0);
        $("#budgeted-total").textContent = money(total);
        const un = d.expected_income - total;
        const u = $("#unassigned"); u.textContent = money(Math.abs(un)); u.style.color = un >= 0 ? "var(--good)" : "var(--bad)";
      } catch (err) { fail(err); }
    };
    $$(".budget-input", view).forEach((inp) => (inp.onchange = () => saveBudget(inp.dataset.id, inp.value)));
    $$(".use-sugg", view).forEach((b) => (b.onclick = async () => { await saveBudget(b.dataset.id, b.dataset.v); route(); }));
    $$(".edit-cat", view).forEach((b) => (b.onclick = () => editCategory(catById(b.closest("tr").dataset.id))));
    $("#add-cat").onclick = () => editCategory(null);
    $("#all-sugg").onclick = async () => {
      const todo = d.categories.filter((c) => c.kind !== "income" && !c.budget && c.suggested);
      if (!todo.length) return toast("No empty budgets with spending history.");
      try { for (const c of todo) await pb.collection("categories").update(c.id, { budget: c.suggested }); toast(`Set ${todo.length} budget(s)`); route(); } catch (err) { fail(err); }
    };
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
                <span class="pill">${c.provider === "teller" ? "Teller" : "SimpleFIN"}</span>
                <span class="pill ${c.status === "ok" ? "ok" : "err"}">${c.status === "reconnect" ? "reconnect needed" : c.status === "error" ? "needs attention" : "connected"}</span>
                <span class="small muted">${c.last_sync ? "Last sync " + new Date(c.last_sync.replace(" ", "T")).toLocaleString() : "Never synced"}</span>
                <div class="spacer"></div>
                ${c.provider === "teller" && c.status !== "ok" && state.status.teller ? `<button class="btn sm primary conn-reconnect" data-id="${c.id}">Reconnect</button>` : ""}
                <button class="btn sm danger conn-del" data-id="${c.id}">Disconnect</button></div>
              ${c.last_error ? `<div class="small" style="color:var(--${c.status === "ok" ? "muted" : "bad"});margin-top:6px">${esc(c.last_error)}</div>` : ""}
              <div style="margin-top:10px">${accTable(byConn[c.id])}</div>
            </div>`).join("") : `<div class="muted">Connect your bank to sync balances and transactions automatically${state.status.teller ? " with Teller" : ` (set up <a href="https://teller.io" target="_blank" rel="noopener">Teller</a> in .env for free syncing, or use SimpleFIN Bridge)`}, or use manual accounts with CSV import below.</div>`}
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
    $("#connect").onclick = connectDialog;
    $$(".conn-reconnect", view).forEach((b) => (b.onclick = () => openTeller(conns.find((c) => c.id === b.dataset.id))));
    $("#add-acc").onclick = addAccountDialog;
    $("#import-csv").onclick = () => importDialog();
  }

  function loadTellerScript() {
    if (window.TellerConnect) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.teller.io/connect/connect.js";
      sc.onload = resolve;
      sc.onerror = () => reject(new Error("Couldn't load Teller Connect. Check your connection or ad blocker."));
      document.head.appendChild(sc);
    });
  }

  // Opens Teller Connect. Pass an existing connection to repair a disconnected enrollment.
  async function openTeller(connection) {
    const t = state.status.teller;
    try { await loadTellerScript(); } catch (err) { return fail(err); }
    const tc = window.TellerConnect.setup({
      applicationId: t.app_id,
      environment: t.environment,
      products: ["balance", "transactions"],
      selectAccount: "multiple",
      ...(connection && connection.enrollment_id ? { enrollmentId: connection.enrollment_id } : {}),
      onSuccess: async (enr) => {
        toast("Bank linked, syncing…");
        try {
          let r;
          if (enr && enr.accessToken) {
            r = await api("/api/budget/teller/enroll", { method: "POST", body: {
              access_token: enr.accessToken,
              enrollment_id: enr.enrollment && enr.enrollment.id,
              institution: enr.enrollment && enr.enrollment.institution && enr.enrollment.institution.name,
              connection: connection ? connection.id : "",
            } });
            r = r.sync;
          } else {
            r = await api("/api/budget/sync", { method: "POST" });
          }
          toast(`Synced ${r.accounts} account(s), ${r.new_transactions} new transaction(s)`);
          if (r.errors && r.errors.length) toast(r.errors.join("; "), true);
        } catch (err) { fail(err); }
        route();
      },
    });
    tc.open();
  }

  function connectDialog() {
    if (state.status.teller) {
      modal("Connect a bank", `
        <div class="stack">
          <div class="callout">
            <b>Teller</b> <span class="pill">recommended · free</span>
            <p class="small muted" style="margin:6px 0 10px">Log in to your bank in Teller's secure window. This server gets read-only access, and your bank password never touches this app.</p>
            <button class="btn primary" id="go-teller">Connect with Teller</button>
          </div>
          <div class="callout">
            <b>SimpleFIN Bridge</b> <span class="pill">~$15/yr</span>
            <p class="small muted" style="margin:6px 0 10px">Use this if Teller doesn't support your bank.</p>
            <button class="btn" id="go-sfin">Use a SimpleFIN setup token</button>
          </div>
          <div class="actions"><button class="btn" data-close>Cancel</button></div>
        </div>`, {
        onMount: (m, close) => {
          $("#go-teller", m).onclick = () => { close(); openTeller(null); };
          $("#go-sfin", m).onclick = () => { close(); simplefinDialog(); };
        },
      });
      return;
    }
    simplefinDialog();
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
          name: fd.get("name"), alerts_enabled: fd.has("alerts_enabled"), weekly_digest: fd.has("weekly_digest"), update_notes: fd.has("update_notes"),
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
