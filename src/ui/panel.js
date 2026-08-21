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
    manualAccount: "",
    useManual: false,
    manualDecided: false,
    showDiagnostics: false,
    from: firstOfMonth(),
    to: today(),
    busy: false,
    message: "",
    tone: "neutral",
    results: null,
    resultsContext: null,
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

      select, input[type="date"], input[type="text"] {
        width: 100%; height: 35px; padding: 0 10px;
        border: 1px solid rgba(0,0,0,.13); border-radius: 9px;
        background: #fafafb; color: #1a1a1a; font-size: 13px; outline: none; appearance: none;
      }
      select:focus, input:focus { border-color: rgba(0,0,0,.32); background: #fff; }
      select:disabled, input:disabled { color: #a2a7ac; cursor: not-allowed; }

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
      .chip:hover { background: #f2f3f4; color: #1a1a1a; }
      .chip[aria-pressed="true"] { background: #1a1a1a; border-color: #1a1a1a; color: #fff; }

      .primary {
        width: 100%; height: 39px; border: 0; border-radius: 10px;
        background: #1a1a1a; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .primary:hover { background: #303030; }
      .primary:disabled { background: #dcdee1; color: #fff; cursor: not-allowed; }

      .secondary { display: flex; gap: 8px; }
      .ghost {
        flex: 1; height: 33px; border: 1px solid rgba(0,0,0,.11); border-radius: 9px;
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
        select, input[type="date"], input[type="text"] { background: #232426; color: #f2f3f4; border-color: rgba(255,255,255,.13); }
        input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(1); opacity: .9; cursor: pointer;
        }
        select:focus, input:focus { background: #2a2b2e; border-color: rgba(255,255,255,.32); }
        .status, .diag-list { background: #232426; color: #b6babe; }
        .chip, .ghost { background: #232426; color: #d5d7da; border-color: rgba(255,255,255,.13); }
        .chip:hover, .ghost:hover:not(:disabled) { background: #2c2d30; color: #fff; }
        .chip[aria-pressed="true"] { background: #f2f3f4; border-color: #f2f3f4; color: #17181a; }
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
              <select id="country"></select>
            </div>
            <div>
              <span class="label">Bank</span>
              <select id="bank"></select>
            </div>
          </div>

          <div class="status"><span class="dot" id="dot"></span><span class="text" id="status"></span></div>

          <div>
            <span class="label">Account</span>
            <select id="account"></select>
            <input id="accountManual" type="text" placeholder="e.g. 00000000000" hidden />
            <p class="msg" id="accountHint" hidden>Clatri could not read your account list. Type the
              number as your bank shows it, digits only, no dashes or spaces.</p>
            <div style="margin-top:7px"><button class="link" id="toggleManual"></button></div>
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

          <div class="presets">
            <button class="chip" data-preset="this-month">This month</button>
            <button class="chip" data-preset="last-month">Last month</button>
            <button class="chip" data-preset="last-3">Last 3 months</button>
            <button class="chip" data-preset="this-year">This year</button>
          </div>

          <button class="primary" id="run">Download CSV</button>
          <div class="secondary">
            <button class="ghost" id="json" disabled>JSON</button>
            <button class="ghost" id="copy" disabled>Copy</button>
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
    if (ui.useManual) {
      const number = ui.manualAccount.trim();
      if (!number) return null;
      return (
        accounts.find((account) => account.number === number) || {
          number,
          type: "",
          currency: currentBank()?.currency || "",
          name: "",
        }
      );
    }
    return accounts.find((account) => account.number === ui.accountNumber) || null;
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

  function fillSelect(node, items, value) {
    node.innerHTML = items
      .map(
        (item) =>
          `<option value="${escapeHtml(item.value)}"${item.value === value ? " selected" : ""}>` +
          `${escapeHtml(item.label)}</option>`
      )
      .join("");
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

    // A live session with no readable account list used to leave the download
    // button greyed out with no way forward. Fall back to typing the number.
    if (live && !accounts.length && !ui.manualDecided) ui.useManual = true;

    const accountSelect = el("account");
    accountSelect.hidden = ui.useManual;
    el("accountManual").hidden = !ui.useManual;
    el("accountHint").hidden = !(ui.useManual && !accounts.length);
    el("toggleManual").textContent = ui.useManual
      ? "Pick from detected accounts"
      : "Enter account number manually";

    if (!ui.useManual) {
      if (accounts.length) {
        if (!accounts.some((account) => account.number === ui.accountNumber)) {
          ui.accountNumber = accounts[0].number;
        }
        fillSelect(
          accountSelect,
          accounts.map((account) => ({
            value: account.number,
            label:
              `${account.typeLabel || "Account"} ${account.number}` +
              (account.balance === null || account.balance === undefined
                ? ""
                : ` · ${formatAmount(account.balance, account.currency)}`),
          })),
          ui.accountNumber
        );
        accountSelect.disabled = false;
      } else {
        accountSelect.innerHTML = "<option>No accounts detected yet</option>";
        accountSelect.disabled = true;
      }
    }

    el("dot").classList.toggle("live", live);
    el("launcherDot").classList.toggle("live", live);

    const bank = currentBank();
    if (!bankIsHere()) {
      el("status").textContent = `Open ${bank ? bank.name : "the bank"} to export from it`;
    } else if (live) {
      const exact = Boolean(engine?.state.template);
      el("status").textContent = !accounts.length
        ? "Session detected · type your account number below"
        : exact
          ? `Ready · ${accounts.length} account${accounts.length === 1 ? "" : "s"}, exact request copied`
          : `Ready · ${accounts.length} account${accounts.length === 1 ? "" : "s"}, using a rebuilt request`;
    } else {
      el("status").textContent = bank?.hint || "Waiting for the bank session";
    }

    el("from").value = ui.from;
    el("to").value = ui.to;
    root.querySelectorAll(".chip").forEach((chip) => {
      const [from, to] = presetRange(chip.dataset.preset);
      chip.setAttribute("aria-pressed", String(from === ui.from && to === ui.to));
    });

    const runnable = live && !ui.busy && Boolean(selectedAccount());
    el("run").disabled = !runnable;
    el("run").textContent = ui.busy ? "Working…" : "Download CSV";

    const hasResults = Boolean(ui.results && ui.results.length);
    el("json").disabled = !hasResults || ui.busy;
    el("copy").disabled = !hasResults || ui.busy;

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

    const summary = [
      `session ....... ${state?.headers ? "captured" : "not captured"}`,
      `accounts ...... ${state?.accounts?.length || 0}`,
      `tx template ... ${state?.template ? "captured" : "rebuilt from the accounts call"}`,
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

  function contextFor(account) {
    const bank = currentBank();
    const country = registry.country(ui.countryCode);
    return {
      bank: bank?.name || "",
      country: country?.name || ui.countryCode,
      account: account.number,
      currency: account.currency || bank?.currency || "",
      from: ui.from,
      to: ui.to,
    };
  }

  async function run() {
    const account = selectedAccount();
    if (!account) return;
    if (ui.from > ui.to) {
      say("The start date is after the end date.", "error");
      return;
    }

    ui.busy = true;
    ui.results = null;
    say("Requesting transactions…");

    try {
      const { transactions, rangeApplied, fetched, windows, truncated, covered } = await engine.fetchRange({
        account,
        from: ui.from,
        to: ui.to,
        onProgress: ({ total, from, to }) =>
          say(`${total} transactions so far… (${from} to ${to})`),
      });

      ui.busy = false;
      ui.results = truncated ? null : transactions;
      ui.resultsContext = contextFor(account);

      // Without a date filter to rewrite, Clatri only gets the bank's own window.
      const teachRange =
        " Clatri found no date filter in the request the bank made, so it can only" +
        " read the range the bank chose. Set Desde and Hasta on the bank's own search," +
        " press the magnifier once, then come back.";

      // A partial ledger is more dangerous than no ledger: importing it looks
      // successful. Keep the recovered count in the message, but do not create
      // a file or enable the alternate export buttons.
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
          rangeApplied
            ? "No transactions in that range."
            : `The bank returned ${fetched} transactions, none inside your dates.${teachRange}`,
          "neutral"
        );
        return;
      }

      exporter.download(
        exporter.toCsv(transactions, ui.resultsContext),
        exporter.filename(ui.resultsContext, "csv"),
        "text/csv"
      );

      const split =
        windows > 1
          ? ` Clatri checked ${windows} smaller date windows to avoid the bank's response limits.`
          : "";

      // State the span actually covered, so a gap at either edge is visible here
      // rather than only after opening the file.
      const span = covered ? ` Transaction dates: ${covered.from} to ${covered.to}.` : "";

      say(
        `${transactions.length} transactions exported.${span}${split}` +
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
  });

  el("accountManual").addEventListener("input", (event) => {
    ui.manualAccount = event.target.value;
    el("run").disabled = !(sessionReady() && !ui.busy && Boolean(selectedAccount()));
  });

  el("toggleManual").addEventListener("click", () => {
    ui.useManual = !ui.useManual;
    ui.manualDecided = true;
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

  el("run").addEventListener("click", run);

  el("json").addEventListener("click", () => {
    if (!ui.results) return;
    exporter.download(
      exporter.toJson(ui.results, ui.resultsContext),
      exporter.filename(ui.resultsContext, "json"),
      "application/json"
    );
  });

  el("copy").addEventListener("click", async () => {
    if (!ui.results) return;
    try {
      await exporter.copy(exporter.toCsv(ui.results, ui.resultsContext));
      say("Copied to the clipboard.", "ok");
    } catch {
      say("Could not reach the clipboard.", "error");
    }
  });

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
