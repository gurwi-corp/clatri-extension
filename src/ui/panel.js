/**
 * Floating panel. Rendered into a shadow root so the bank's stylesheet and ours
 * never touch each other.
 */
(() => {
  "use strict";
  const NS = (window.__clatri = window.__clatri || {});
  const { registry, engine, exporter, shape } = NS;
  if (!registry || !exporter || !shape || NS.panel) return;
  if (window.top !== window.self) return;

  const countries = registry.countries();
  if (!countries.length) return;

  const LOGO = document.documentElement.dataset.clatriLogo || "";

  const host = document.createElement("div");
  host.id = "clatri-root";
  const root = host.attachShadow({ mode: "open" });

  const ui = {
    open: false,
    countryCode: countries[0].code,
    bankId: engine?.bank?.id || registry.forCountry(countries[0].code)[0]?.id || null,
    accountNumber: "",
    showDiagnostics: false,
    from: firstOfMonth(),
    to: today(),
    busy: false,
    message: "",
    tone: "neutral",
    format: "csv",
    results: null,
    resultsContext: null,
    resultsKey: null,
  };

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      button { font: inherit; }

      /* Clear of the bank's own chat launcher, which also sits bottom right. */
      .wrap {
        position: fixed; right: 20px; bottom: 96px; z-index: 2147483000;
        display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      }

      .orb { border-radius: 50%; flex: none; display: block; object-fit: contain; }
      .orb.fallback { background: radial-gradient(circle at 34% 32%, #b48cf0, #5b3ba8 62%, #241443); }

      .launcher {
        display: inline-flex; align-items: center; gap: 9px;
        height: 40px; padding: 0 15px 0 8px; border: 1px solid rgba(0,0,0,.1);
        border-radius: 999px; background: #fff; color: #1a1a1a;
        font-size: 13px; font-weight: 550; letter-spacing: -.005em; cursor: pointer;
        box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 10px 28px rgba(0,0,0,.1);
        transition: transform .14s ease, box-shadow .14s ease;
      }
      .launcher[hidden] { display: none; }
      .launcher:hover { transform: translateY(-1px); box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 14px 32px rgba(0,0,0,.14); }
      .launcher:active { transform: translateY(0); }
      .launcher .orb { width: 24px; height: 24px; }

      .dot { width: 6px; height: 6px; border-radius: 50%; background: #c9ccd1; flex: none; }
      .dot.live { background: #17a34a; box-shadow: 0 0 0 3px rgba(23,163,74,.14); }

      .panel {
        width: 348px; background: #fff; color: #1a1a1a;
        border: 1px solid rgba(0,0,0,.09); border-radius: 16px;
        box-shadow: 0 2px 4px rgba(0,0,0,.04), 0 24px 56px rgba(0,0,0,.18);
        overflow: hidden;
        display: flex; flex-direction: column;
        max-height: calc(100vh - 170px);
      }
      .panel[hidden] { display: none; }

      header { display: flex; align-items: center; gap: 11px; padding: 15px 16px 13px; border-bottom: 1px solid rgba(0,0,0,.06); }
      header .orb { width: 32px; height: 32px; }
      .titles { flex: 1; min-width: 0; }
      h1 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.012em; }
      .sub { margin: 1px 0 0; font-size: 11.5px; color: #797e84; }
      .close { border: 0; background: none; cursor: pointer; color: #9aa0a6; font-size: 17px; line-height: 1; padding: 3px 5px; border-radius: 7px; }
      .close:hover { background: rgba(0,0,0,.05); color: #1a1a1a; }

      .body {
        padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 13px;
        overflow-y: auto; min-height: 0;
      }
      /* Flex children shrink by default, which was squashing the buttons
         whenever the panel ran out of room. Let the body scroll instead. */
      .body > * { flex: none; }
      header { flex: none; }

      .label { display: block; font-size: 10.5px; font-weight: 600; color: #8a8f95; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .045em; }

      input[type="date"], input[type="text"] {
        width: 100%; height: 35px; padding: 0 10px;
        border: 1px solid rgba(0,0,0,.13); border-radius: 9px;
        background: #fafafb; color: #1a1a1a; font-size: 13px; outline: none; appearance: none;
      }
      input:focus { border-color: rgba(0,0,0,.32); background: #fff; }
      input:disabled { color: #a2a7ac; cursor: not-allowed; }

      /* Our own dropdown. The browser's select cannot be styled inside the
         shadow root, and with its arrow hidden it read as a text box. */
      .picker { position: relative; width: 100%; }
      .picker[hidden] { display: none; }
      .picker-btn {
        display: flex; align-items: center; gap: 8px; width: 100%; height: 35px;
        padding: 0 10px; border: 1px solid rgba(0,0,0,.13); border-radius: 9px;
        background: #fafafb; color: #1a1a1a; font-size: 13px; text-align: left; cursor: pointer;
      }
      .picker-btn .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .picker-btn svg { flex: none; color: #797e84; transition: transform .14s ease; }
      .picker-btn:hover:not(:disabled) { background: #f2f3f4; }
      .picker-btn:focus-visible { outline: none; border-color: rgba(0,0,0,.32); background: #fff; }
      .picker-btn:disabled { color: #a2a7ac; cursor: not-allowed; }
      .picker-btn:disabled svg { opacity: .4; }
      .picker[aria-expanded="true"] .picker-btn { border-color: rgba(0,0,0,.32); background: #fff; }
      .picker[aria-expanded="true"] .picker-btn svg { transform: rotate(180deg); }
      .picker-menu {
        position: absolute; left: 0; right: 0; top: calc(100% + 5px); z-index: 5;
        background: #fff; border: 1px solid rgba(0,0,0,.1); border-radius: 10px;
        box-shadow: 0 2px 4px rgba(0,0,0,.04), 0 12px 28px rgba(0,0,0,.14);
        padding: 4px; max-height: 214px; overflow-y: auto;
      }
      .picker-menu[hidden] { display: none; }
      .picker-option {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 8px 9px; border-radius: 7px; font-size: 12.5px; line-height: 1.3;
        color: #1a1a1a; cursor: pointer;
      }
      .picker-option .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .picker-option:hover, .picker-option.active { background: #f2f3f4; }
      .picker-option[aria-selected="true"] { font-weight: 600; }
      .picker-option[aria-selected="true"]::after { content: "\\2713"; flex: none; font-size: 11px; color: #17803d; }

      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

      .status {
        display: flex; align-items: center; gap: 8px; font-size: 12px; color: #565b60;
        background: #f6f7f8; border-radius: 9px; padding: 9px 11px;
      }
      .status .text { flex: 1; min-width: 0; }

      .presets { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip {
        border: 1px solid rgba(0,0,0,.11); background: #fff; color: #45494e;
        border-radius: 999px; height: 27px; padding: 0 11px; font-size: 11.5px; cursor: pointer;
      }
      .chip:hover:not(:disabled) { background: #f2f3f4; color: #1a1a1a; }
      .chip[aria-pressed="true"] { background: #1a1a1a; border-color: #1a1a1a; color: #fff; }
      .chip:disabled { color: #b6babe; cursor: not-allowed; }
      .chip:disabled[aria-pressed="true"] { background: #dcdee1; border-color: #dcdee1; color: #fff; }

      .primary {
        width: 100%; height: 39px; border: 0; border-radius: 10px;
        background: #1a1a1a; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .primary:hover { background: #303030; }
      .primary:disabled { background: #dcdee1; color: #fff; cursor: not-allowed; }

      .actions { display: flex; gap: 8px; }
      .actions .primary { flex: 1; }
      .icon {
        flex: none; width: 39px; height: 39px; border: 1px solid rgba(0,0,0,.11); border-radius: 10px;
        background: #fff; color: #45494e; cursor: pointer; display: flex; align-items: center; justify-content: center;
      }
      .icon:hover:not(:disabled) { background: #f2f3f4; color: #1a1a1a; }
      .icon:disabled { color: #b6babe; cursor: not-allowed; }
      .ghost {
        width: 100%; height: 33px; border: 1px solid rgba(0,0,0,.11); border-radius: 9px;
        background: #fff; color: #45494e; font-size: 12px; cursor: pointer;
      }
      .ghost:hover:not(:disabled) { background: #f2f3f4; color: #1a1a1a; }
      .ghost:disabled { color: #b6babe; cursor: not-allowed; }

      .msg { margin: 0; font-size: 12px; line-height: 1.5; color: #6b7076; }
      .msg.error { color: #c2340f; }
      .msg.ok { color: #17803d; }
      .msg:empty { display: none; }

      .link { background: none; border: 0; padding: 0; font-size: 11.5px; color: #797e84; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
      .link:hover { color: #1a1a1a; }

      .diag { border-top: 1px solid rgba(0,0,0,.06); padding-top: 11px; display: flex; flex-direction: column; gap: 8px; }
      .diag-head { display: flex; align-items: center; justify-content: space-between; }
      .diag-list {
        margin: 0; max-height: 132px; overflow: auto; font-size: 10.5px; line-height: 1.6;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #797e84;
        background: #f6f7f8; border-radius: 8px; padding: 8px 9px;
      }
      .diag-list div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .diag-list .badge { color: #17803d; }

      @media (prefers-color-scheme: dark) {
        .launcher, .panel { background: #1b1c1e; color: #f2f3f4; border-color: rgba(255,255,255,.11); }
        header { border-bottom-color: rgba(255,255,255,.08); }
        .sub, .label, .msg, .link { color: #9aa0a6; }
        input[type="date"], input[type="text"] { background: #232426; color: #f2f3f4; border-color: rgba(255,255,255,.13); }
        .picker-btn { background: #232426; color: #f2f3f4; border-color: rgba(255,255,255,.13); }
        .picker-btn svg { color: #9aa0a6; }
        .picker-btn:hover:not(:disabled) { background: #2c2d30; }
        .picker-btn:focus-visible, .picker[aria-expanded="true"] .picker-btn { background: #2a2b2e; border-color: rgba(255,255,255,.32); }
        .picker-btn:disabled { color: #7d8288; }
        .picker-menu { background: #232426; border-color: rgba(255,255,255,.12); box-shadow: 0 12px 28px rgba(0,0,0,.5); }
        .picker-option { color: #f2f3f4; }
        .picker-option:hover, .picker-option.active { background: #2c2d30; }
        .picker-option[aria-selected="true"]::after { color: #5fd08a; }
        input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(1); opacity: .9; cursor: pointer;
        }
        input:focus { background: #2a2b2e; border-color: rgba(255,255,255,.32); }
        input:disabled { color: #7d8288; }
        input:disabled::-webkit-calendar-picker-indicator { opacity: .35; cursor: not-allowed; }
        .status, .diag-list { background: #232426; color: #b6babe; }
        .chip, .ghost, .icon { background: #232426; color: #d5d7da; border-color: rgba(255,255,255,.13); }
        .chip:hover:not(:disabled), .ghost:hover:not(:disabled), .icon:hover:not(:disabled) { background: #2c2d30; color: #fff; }
        .icon:disabled { color: #5f6469; }
        .chip[aria-pressed="true"] { background: #f2f3f4; border-color: #f2f3f4; color: #17181a; }
        .chip:disabled { color: #5f6469; }
        .chip:disabled[aria-pressed="true"] { background: #3a3b3e; border-color: #3a3b3e; color: #7d8288; }
        .primary { background: #f2f3f4; color: #17181a; }
        .primary:hover { background: #fff; }
        .primary:disabled { background: #3a3b3e; color: #7d8288; }
        .ghost:disabled { color: #5f6469; }
        .close:hover { background: rgba(255,255,255,.08); color: #fff; }
        .diag { border-top-color: rgba(255,255,255,.08); }
        .msg.error { color: #ff8f6b; }
        .msg.ok { color: #5fd08a; }
      }
    </style>

    <div class="wrap">
      <div class="panel" hidden>
        <header>
          ${logoTag(32)}
          <div class="titles">
            <h1>Clatri</h1>
            <p class="sub">Export bank transactions</p>
          </div>
          <button class="close" title="Close">&times;</button>
        </header>

        <div class="body">
          <div class="row">
            <div>
              <span class="label">Country</span>
              <div class="picker" id="country" aria-expanded="false"></div>
            </div>
            <div>
              <span class="label">Bank</span>
              <div class="picker" id="bank" aria-expanded="false"></div>
            </div>
          </div>

          <div class="status"><span class="dot" id="dot"></span><span class="text" id="status"></span></div>

          <div>
            <span class="label" id="accountLabel">Account</span>
            <div class="picker" id="account" aria-expanded="false"></div>
          </div>

          <div class="row">
            <div>
              <span class="label">From</span>
              <input id="from" type="date" />
            </div>
            <div>
              <span class="label">To</span>
              <input id="to" type="date" />
            </div>
          </div>

          <p class="msg" id="rangeNote" hidden>The bank does not filter this card's movements by
            date. Clatri downloads everything it offers.</p>

          <div class="presets">
            <button class="chip" data-preset="this-month">This month</button>
            <button class="chip" data-preset="last-month">Last month</button>
            <button class="chip" data-preset="last-3">Last 3 months</button>
            <button class="chip" data-preset="this-year">This year</button>
          </div>

          <div>
            <span class="label">Format</span>
            <div class="picker" id="format" aria-expanded="false"></div>
          </div>

          <div class="actions">
            <button class="primary" id="run">Download CSV</button>
            <button class="icon" id="copy" title="Copy to clipboard" aria-label="Copy to clipboard">
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/>
                <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>
              </svg>
            </button>
          </div>

          <p class="msg" id="msg"></p>

          <div class="diag">
            <div class="diag-head">
              <button class="link" id="toggleDiag">Show what Clatri sees</button>
              <span class="link" id="diagCount" style="text-decoration:none;cursor:default"></span>
            </div>
            <div class="diag-list" id="diagList" hidden></div>
            <button class="ghost" id="reportBtn" hidden>Copy debug report</button>
          </div>
        </div>
      </div>

      <button class="launcher" id="launcher">${logoTag(24)}<span class="dot" id="launcherDot"></span>Clatri</button>
    </div>
  `;

  function logoTag(size) {
    return LOGO
      ? `<img class="orb" src="${LOGO}" width="${size}" height="${size}" alt="" />`
      : `<span class="orb fallback" style="width:${size}px;height:${size}px"></span>`;
  }

  const el = (id) => root.getElementById(id);
  const panel = root.querySelector(".panel");

  // --- dates ----------------------------------------------------------------
  // Ranges live in shape.js so the panel and the diagnostics agree. Declarations
  // rather than const arrows on purpose: `ui` above calls them as it is built,
  // and a const would still be in its temporal dead zone at that point.

  function today() {
    return shape.today();
  }

  function firstOfMonth() {
    return shape.firstOfMonth(new Date());
  }

  function presetRange(name) {
    return shape.range(name) || [ui.from, ui.to];
  }

  // --- state helpers --------------------------------------------------------

  const currentBank = () => registry.byId(ui.bankId);
  const bankIsHere = () => Boolean(engine?.bank && engine.bank.id === ui.bankId);
  const sessionReady = () => Boolean(engine?.ready() && bankIsHere());

  function selectedAccount() {
    const accounts = engine?.state.accounts || [];
    return accounts.find((account) => account.number === ui.accountNumber) || null;
  }

  /** Whether the bank lets this product be queried by date at all. */
  function datesLocked(account) {
    if (!account || !engine?.profileFor) return false;
    return engine.profileFor(account).dateFilter === "none";
  }

  /** A masked card number reads better as ****0056 than as a wall of stars. */
  function displayNumber(number) {
    return String(number || "").replace(/\*{4,}/, "****");
  }

  function formatAmount(value, currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return String(value);
    }
  }

  // --- rendering ------------------------------------------------------------

  const CHEVRON =
    '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">' +
    '<path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /**
   * Render a picker. It behaves like a select from the outside: `node.value`
   * holds the choice and a "change" event fires when the user picks another.
   */
  function fillSelect(node, items, value, { placeholder = "" } = {}) {
    const chosen = items.find((item) => item.value === value) || items[0] || null;
    node.value = chosen ? chosen.value : "";
    node.disabled = !items.length;
    node.setAttribute("aria-expanded", "false");
    node.innerHTML =
      `<button type="button" class="picker-btn"${items.length ? "" : " disabled"}>` +
      `<span class="text">${escapeHtml(chosen ? chosen.label : placeholder)}</span>${CHEVRON}</button>` +
      `<div class="picker-menu" role="listbox" hidden>` +
      items
        .map(
          (item) =>
            `<div class="picker-option" role="option" data-value="${escapeHtml(item.value)}" ` +
            `aria-selected="${item.value === node.value}"><span class="text">${escapeHtml(item.label)}</span></div>`
        )
        .join("") +
      `</div>`;
  }

  const pickers = [];

  function setPickerOpen(node, open) {
    const menu = node.querySelector(".picker-menu");
    if (!menu) return;
    if (open && node.disabled) return;
    if (open) pickers.forEach((other) => other !== node && setPickerOpen(other, false));
    menu.hidden = !open;
    node.setAttribute("aria-expanded", String(open));
    if (!open) {
      node.querySelectorAll(".picker-option.active").forEach((option) => option.classList.remove("active"));
    }
  }

  const pickerIsOpen = (node) => node.getAttribute("aria-expanded") === "true";

  /** Clicks and keys for one picker, wired once; the markup inside is rerendered freely. */
  function wirePicker(node) {
    pickers.push(node);

    const options = () => Array.from(node.querySelectorAll(".picker-option"));
    const choose = (value) => {
      setPickerOpen(node, false);
      if (value === undefined || value === node.value) return;
      node.value = value;
      // Show the choice at once, before whoever listens gets to rerender.
      options().forEach((option) => {
        option.setAttribute("aria-selected", String(option.dataset.value === value));
        if (option.dataset.value === value) {
          const text = node.querySelector(".picker-btn .text");
          if (text) text.textContent = option.textContent;
        }
      });
      node.dispatchEvent(new Event("change"));
    };
    const activeIndex = () => options().findIndex((option) => option.classList.contains("active"));
    const highlight = (index) => {
      const list = options();
      if (!list.length) return;
      const next = (index + list.length) % list.length;
      list.forEach((option, at) => option.classList.toggle("active", at === next));
      if (list[next].scrollIntoView) list[next].scrollIntoView({ block: "nearest" });
    };

    node.addEventListener("click", (event) => {
      const target = event.target;
      const option = target && target.closest ? target.closest(".picker-option") : null;
      if (option) {
        choose(option.dataset.value);
        return;
      }
      if (target && target.closest && target.closest(".picker-btn")) {
        setPickerOpen(node, !pickerIsOpen(node));
      }
    });

    node.addEventListener("keydown", (event) => {
      const open = pickerIsOpen(node);
      if (event.key === "Escape" || event.key === "Tab") {
        if (open) setPickerOpen(node, false);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open) {
          setPickerOpen(node, true);
          const current = options().findIndex((option) => option.dataset.value === node.value);
          highlight(current === -1 ? 0 : current);
          return;
        }
        highlight(activeIndex() + (event.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && open) {
        event.preventDefault();
        const list = options();
        const at = activeIndex();
        choose(at === -1 ? undefined : list[at].dataset.value);
      }
    });
  }

  /** A click anywhere else closes whichever picker is open. */
  function closePickersOutside(event) {
    const path = event.composedPath ? event.composedPath() : [];
    pickers.forEach((node) => {
      if (pickerIsOpen(node) && !path.includes(node)) setPickerOpen(node, false);
    });
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
    );
  }

  /** A thrown render must never leave a dead panel: show the failure in place. */
  function render() {
    try {
      paint();
    } catch (error) {
      console.error("[clatri] render failed", error);
      try {
        const message = el("msg");
        message.textContent = `Panel error: ${error.message}`;
        message.className = "msg error";
      } catch {}
    }
  }

  function paint() {
    fillSelect(
      el("country"),
      countries.map((country) => ({ value: country.code, label: country.name })),
      ui.countryCode
    );
    fillSelect(
      el("bank"),
      registry.forCountry(ui.countryCode).map((bank) => ({ value: bank.id, label: bank.name })),
      ui.bankId
    );

    const accounts = engine?.state.accounts || [];
    const live = sessionReady();

    // Products show up one call at a time: the savings list first, the cards
    // once the portal asks for them. Say how many are in the list right now.
    el("accountLabel").textContent = accounts.length
      ? `Account · ${accounts.length} detected`
      : "Account";

    if (accounts.length && !accounts.some((account) => account.number === ui.accountNumber)) {
      ui.accountNumber = accounts[0].number;
    }
    fillSelect(
      el("account"),
      accounts.map((account) => ({
        value: account.number,
        label:
          `${account.typeLabel || "Account"} ${displayNumber(account.number)}` +
          (account.balance === null || account.balance === undefined
            ? ""
            : ` · ${formatAmount(account.balance, account.currency)}`),
      })),
      ui.accountNumber,
      { placeholder: "No accounts detected yet" }
    );

    el("dot").classList.toggle("live", live);
    el("launcherDot").classList.toggle("live", live);

    const bank = currentBank();
    if (!bankIsHere()) {
      el("status").textContent = `Open ${bank ? bank.name : "the bank"} to export from it`;
    } else if (live) {
      const chosen = selectedAccount();
      const exact = Boolean(chosen && engine?.templateFor && engine.templateFor(chosen));
      el("status").textContent = !accounts.length
        ? "Session detected · open Tus productos so Clatri can list your accounts"
        : exact
          ? `Ready · ${accounts.length} account${accounts.length === 1 ? "" : "s"}, exact request copied`
          : `Ready · ${accounts.length} account${accounts.length === 1 ? "" : "s"}, using a rebuilt request`;
    } else {
      el("status").textContent = bank?.hint || "Waiting for the bank session";
    }

    // A card cannot be queried by date at this bank. Lock the range so the
    // dates do not look like they mean something.
    const locked = datesLocked(selectedAccount());
    el("from").value = ui.from;
    el("to").value = ui.to;
    el("from").disabled = locked;
    el("to").disabled = locked;
    el("rangeNote").hidden = !locked;
    root.querySelectorAll(".chip").forEach((chip) => {
      const [from, to] = presetRange(chip.dataset.preset);
      chip.setAttribute("aria-pressed", String(from === ui.from && to === ui.to));
      chip.disabled = locked;
    });

    const runnable = live && !ui.busy && Boolean(selectedAccount());
    fillSelect(el("format"), FORMATS.map((entry) => ({ value: entry.id, label: entry.label })), ui.format);
    el("run").disabled = !runnable;
    el("run").textContent = ui.busy ? "Working…" : `Download ${formatOf(ui.format).label}`;
    el("copy").disabled = !runnable;

    const message = el("msg");
    message.textContent = ui.message;
    message.className = `msg${ui.tone === "error" ? " error" : ui.tone === "ok" ? " ok" : ""}`;

    renderDiagnostics();
  }

  function renderDiagnostics() {
    const state = engine?.state;
    const seen = state?.seen || 0;
    el("diagCount").textContent = `${seen} request${seen === 1 ? "" : "s"} seen`;
    el("toggleDiag").textContent = ui.showDiagnostics ? "Hide details" : "Show what Clatri sees";

    const list = el("diagList");
    list.hidden = !ui.showDiagnostics;
    el("reportBtn").hidden = !ui.showDiagnostics;
    if (!ui.showDiagnostics) return;

    const templates = Object.keys(state?.templates || {});
    const summary = [
      `session ....... ${state?.headers ? "captured" : "not captured"}`,
      `accounts ...... ${state?.accounts?.length || 0}`,
      `tx template ... ${templates.length ? `captured (${templates.join(", ")})` : "rebuilt from the accounts call"}`,
      `header sets ... ${Object.keys(state?.headersByUrl || {}).length} endpoints`,
      "",
    ];
    const rows = (state?.log || []).slice(-14).reverse().map((entry) => {
      const marks = [
        entry.auth ? "auth" : "",
        entry.accounts ? `${entry.accounts} acct` : "",
        entry.transactions ? `${entry.transactions} tx` : "",
      ].filter(Boolean);
      return `${escapeHtml(entry.url)}${marks.length ? `  <span class="badge">[${marks.join(" ")}]</span>` : ""}`;
    });

    list.innerHTML = [...summary, ...(rows.length ? rows : ["no bank requests observed yet"])]
      .map((line) => `<div>${line}</div>`)
      .join("");
  }

  function say(message, tone = "neutral") {
    ui.message = message;
    ui.tone = tone;
    render();
  }

  // --- actions --------------------------------------------------------------

  /** `covered` names the file when the dates were the bank's, not the user's. */
  function contextFor(account, covered) {
    const bank = currentBank();
    const country = registry.country(ui.countryCode);
    const span = datesLocked(account) && covered ? covered : { from: ui.from, to: ui.to };
    return {
      bank: bank?.name || "",
      country: country?.name || ui.countryCode,
      account: account.number,
      currency: account.currency || bank?.currency || "",
      from: span.from,
      to: span.to,
    };
  }

  const FORMATS = [
    { id: "csv", label: "CSV", mime: "text/csv", serialize: (rows, context) => exporter.toCsv(rows, context) },
    { id: "json", label: "JSON", mime: "application/json", serialize: (rows, context) => exporter.toJson(rows, context) },
  ];
  const formatOf = (id) => FORMATS.find((entry) => entry.id === id) || FORMATS[0];

  /** Hand the result over as a file or onto the clipboard, in the chosen format. */
  async function deliver(mode, transactions, context) {
    const format = formatOf(ui.format);
    const text = format.serialize(transactions, context);
    if (mode === "copy") {
      await exporter.copy(text);
      return;
    }
    exporter.download(text, exporter.filename(context, format.id), format.mime);
  }

  const exportKey = (account) => `${account.number}|${ui.from}|${ui.to}`;

  /**
   * `mode` is "download" or "copy". A download always asks the bank again; a
   * copy reuses the rows of the last export when nothing has changed since.
   */
  async function run(mode = "download") {
    const account = selectedAccount();
    if (!account) return;
    const locked = datesLocked(account);
    if (!locked && ui.from > ui.to) {
      say("The start date is after the end date.", "error");
      return;
    }

    if (mode === "copy" && ui.results && ui.resultsKey === exportKey(account)) {
      try {
        await deliver("copy", ui.results, ui.resultsContext);
        say(`${ui.results.length} transactions copied as ${formatOf(ui.format).label}.`, "ok");
      } catch {
        say("Could not reach the clipboard.", "error");
      }
      return;
    }

    ui.busy = true;
    ui.results = null;
    ui.resultsKey = null;
    say("Requesting transactions…");

    try {
      const { transactions, rangeApplied, fetched, windows, truncated, covered } = await engine.fetchRange({
        account,
        from: ui.from,
        to: ui.to,
        onProgress: ({ total, page, from, to }) =>
          say(locked ? `${total} transactions so far… (page ${page})` : `${total} transactions so far… (${from} to ${to})`),
      });

      ui.busy = false;
      ui.results = truncated ? null : transactions;
      ui.resultsContext = contextFor(account, covered);
      ui.resultsKey = truncated ? null : exportKey(account);

      // Without a date filter to rewrite, Clatri only gets the bank's own window.
      const teachRange =
        " Clatri found no date filter in the request the bank made, so it can only" +
        " read the range the bank chose. Set Desde and Hasta on the bank's own search," +
        " press the magnifier once, then come back.";

      // A partial ledger is more dangerous than no ledger: importing it looks
      // successful. Keep the recovered count in the message, but do not create
      // a file or keep the rows around for copying.
      if (truncated) {
        const span = covered ? ` The bank returned rows from ${covered.from} to ${covered.to}.` : "";
        say(
          `Export cancelled because the bank did not complete every date window.` +
            `${span} ${transactions.length} transactions were recovered but no partial file was created. ` +
            "Retry with a shorter range.",
          "error"
        );
        return;
      }

      if (!transactions.length) {
        say(
          locked
            ? "The bank has no movements for this card."
            : rangeApplied
              ? "No transactions in that range."
              : `The bank returned ${fetched} transactions, none inside your dates.${teachRange}`,
          "neutral"
        );
        return;
      }

      try {
        await deliver(mode, transactions, ui.resultsContext);
      } catch {
        say("Could not reach the clipboard.", "error");
        return;
      }

      const split =
        windows > 1
          ? ` Clatri checked ${windows} smaller date windows to avoid the bank's response limits.`
          : "";

      // State the span actually covered, so a gap at either edge is visible here
      // rather than only after opening the file.
      const span = covered ? ` Transaction dates: ${covered.from} to ${covered.to}.` : "";

      const verb = mode === "copy" ? `copied as ${formatOf(ui.format).label}` : "exported";
      say(
        `${transactions.length} transactions ${verb}.${span}${split}` +
          `${rangeApplied ? "" : teachRange}`,
        !rangeApplied ? "neutral" : "ok"
      );
    } catch (error) {
      ui.busy = false;
      ui.results = null;
      say(error.message || "Something went wrong.", "error");
    }
  }

  // --- wiring ---------------------------------------------------------------

  function setOpen(open) {
    ui.open = open;
    panel.hidden = !open;
    el("launcher").hidden = open;
    if (open) render();
  }

  el("launcher").addEventListener("click", () => {
    setOpen(!ui.open);
  });

  root.querySelector(".close").addEventListener("click", () => {
    setOpen(false);
  });

  ["country", "bank", "account", "format"].forEach((id) => wirePicker(el(id)));
  root.addEventListener("click", closePickersOutside);
  document.addEventListener("click", closePickersOutside);

  el("country").addEventListener("change", (event) => {
    ui.countryCode = event.target.value;
    ui.bankId = registry.forCountry(ui.countryCode)[0]?.id || null;
    render();
  });

  el("bank").addEventListener("change", (event) => {
    ui.bankId = event.target.value;
    ui.message = "";
    render();
  });

  el("account").addEventListener("change", (event) => {
    ui.accountNumber = event.target.value;
    ui.message = "";
    // A card locks the date fields and reads its own template, so repaint.
    render();
  });

  el("toggleDiag").addEventListener("click", () => {
    ui.showDiagnostics = !ui.showDiagnostics;
    renderDiagnostics();
  });

  el("reportBtn").addEventListener("click", async () => {
    try {
      await exporter.copy(NS.report ? NS.report() : "no report available");
      say("Debug report copied. It contains field names only, no values.", "ok");
    } catch {
      say("Could not reach the clipboard.", "error");
    }
  });

  el("from").addEventListener("change", (event) => {
    ui.from = event.target.value;
    render();
  });
  el("to").addEventListener("change", (event) => {
    ui.to = event.target.value;
    render();
  });

  root.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const [from, to] = presetRange(chip.dataset.preset);
      ui.from = from;
      ui.to = to;
      render();
    });
  });

  el("format").addEventListener("change", (event) => {
    ui.format = event.target.value;
    render();
  });

  el("run").addEventListener("click", () => run("download"));
  el("copy").addEventListener("click", () => run("copy"));

  if (engine) engine.onUpdate(() => render());

  function mount() {
    document.documentElement.appendChild(host);
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }

  NS.panel = {
    render,
    open() {
      ui.open = true;
      panel.hidden = false;
      render();
    },
  };
})();
