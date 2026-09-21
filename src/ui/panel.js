/**
 * Floating panel. Rendered into a shadow root so the bank's stylesheet and ours
 * never touch each other.
 */
(() => {
  "use strict";
  const NS = (window.__clatri = window.__clatri || {});
  const { registry, engine, exporter, shape } = NS;
  const { t, locale } = globalThis.ClatriI18n;
  const kit = globalThis.ClatriKit;
  if (!registry || !exporter || !shape || !kit || NS.panel) return;
  if (window.top !== window.self) return;

  const countries = registry.countries();
  if (!countries.length) return;

  const LOGO = document.documentElement.dataset.clatriLogo || "";

  const host = document.createElement("div");
  host.id = "clatri-root";
  host.lang = locale();
  const root = host.attachShadow({ mode: "open" });

  const ui = {
    open: false,
    countryCode: countries[0].code,
    bankId: engine?.bank?.id || registry.forCountry(countries[0].code)[0]?.id || null,
    accountNumber: "",
    from: firstOfMonth(),
    to: today(),
    busy: false,
    mode: "send",
    instructionsOpen: false,
    preparedKey: null,
    preparing: false,
    prepareFailed: false,
    prepareLoud: false,
    staging: false,
    stagedKey: null,
    message: "",
    tone: "neutral",
    format: "csv",
    results: null,
    partial: null,
    resultsContext: null,
    resultsKey: null,
  };

  root.innerHTML = `
    <style>
      ${kit.css}

      /* Panel layout only. Colours, controls and motion come from the kit. */
      * { font-family: var(--font); }

      /* Clear of the bank's own chat launcher, which also sits bottom right. */
      .wrap {
        position: fixed; right: 20px; bottom: 96px; z-index: 2147483000;
        display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      }

      .orb { border-radius: 50%; flex: none; display: block; object-fit: contain; }
      .orb.fallback { background: radial-gradient(circle at 34% 32%, #b48cf0, #5b3ba8 62%, #241443); }
      .orb.s24 { width: 24px; height: 24px; }
      .orb.s32 { width: 32px; height: 32px; }

      .launcher {
        display: inline-flex; align-items: center; gap: 9px;
        height: 40px; padding: 0 15px 0 8px; border: 1px solid var(--c-line);
        border-radius: var(--r-pill); background: var(--c-bg); color: var(--c-ink);
        font-size: 13px; font-weight: 550; letter-spacing: -.005em; cursor: pointer;
        box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 10px 28px rgba(0,0,0,.1);
        transition: transform var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease);
        animation: surface-in var(--t-med) var(--ease) both;
      }
      .launcher:hover { transform: translateY(-1px); box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 14px 32px rgba(0,0,0,.14); }
      .launcher:active { transform: translateY(0); }

      .panel {
        width: 348px; background: var(--c-bg); color: var(--c-ink);
        border: 1px solid var(--c-line); border-radius: 16px;
        box-shadow: 0 2px 4px rgba(0,0,0,.04), 0 24px 56px rgba(0,0,0,.18);
        overflow: hidden;
        display: flex; flex-direction: column;
        max-height: calc(100vh - 170px);
        transform-origin: bottom right;
        animation: surface-in var(--t-med) var(--ease) both;
      }
      @keyframes surface-in { from { opacity: 0; transform: translateY(8px) scale(.97); } }

      header { flex: none; display: flex; align-items: center; gap: 11px; padding: 14px 12px 13px 16px; border-bottom: 1px solid var(--c-line); }
      .titles { flex: 1; min-width: 0; }
      h1 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.012em; }
      .sub { margin: 1px 0 0; font-size: 12px; color: var(--c-ink-2); }
      .close { width: 28px; padding: 0; justify-content: center; }

      .body {
        padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 14px;
        overflow-y: auto; min-height: 0; overscroll-behavior: contain;
      }
      /* Flex children shrink by default, which was squashing the buttons
         whenever the panel ran out of room. Let the body scroll instead. */
      .body > * { flex: none; }

      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .stack { display: grid; gap: 14px; }
      .presets { display: flex; flex-wrap: wrap; gap: 6px; }
      .actions { display: flex; gap: 8px; }
      /* Instructions come as one string; blank lines in it separate the steps. */
      .bank-help { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: var(--c-ink-2); white-space: pre-line; }

      @media (max-width: 420px) {
        .wrap { right: 12px; }
        .panel { width: calc(100vw - 24px); }
      }
    </style>

    <div class="wrap">
      <div class="panel" hidden>
        <header>
          ${logoTag(32)}
          <div class="titles">
            <h1>Clatri</h1>
            <p class="sub">${t("Export bank transactions")}</p>
          </div>
          <button class="quiet close" title="${t("Close")}" aria-label="${t("Close")}">${kit.icons.close}</button>
        </header>

        <div class="body">
          <div class="row">
            <div>
              <span class="label" id="countryLabel">${t("Country")}</span>
              <div class="picker" id="country" aria-expanded="false"></div>
            </div>
            <div>
              <span class="label" id="bankLabel">${t("Bank")}</span>
              <div class="picker" id="bank" aria-expanded="false"></div>
            </div>
          </div>

          <div class="status"><span class="dot" id="dot"></span><span class="text" id="status"></span></div>

          <div id="bankInstructions">
            <button type="button" class="disclosure" id="bankInstructionsToggle" aria-expanded="false" aria-controls="bankInstructionsRegion">${kit.icons.chevron}<span>${t("Bank instructions")}</span></button>
            <div class="collapse" id="bankInstructionsRegion" data-open="false">
              <div class="collapse-inner"><p class="bank-help" id="bankInstructionsText"></p></div>
            </div>
          </div>

          <div>
            <span class="label" id="accountLabel">${t("Account")}</span>
            <div class="picker" id="account" aria-expanded="false"></div>
          </div>

          <div class="stack">
            <div class="row">
              <div>
                <label class="label" for="from">${t("From")}</label>
                <input class="field" id="from" type="date" />
              </div>
              <div>
                <label class="label" for="to">${t("To")}</label>
                <input class="field" id="to" type="date" />
              </div>
            </div>

            <p class="msg" id="rangeNote" hidden>${t("The bank does not filter this card’s movements by date. Clatri downloads everything it offers.")}</p>

            <div class="presets">
              <button class="chip" data-preset="this-month">${t("This month")}</button>
              <button class="chip" data-preset="last-month">${t("Last month")}</button>
              <button class="chip" data-preset="last-3">${t("Last 3 months")}</button>
            </div>
          </div>

          <div class="segmented" id="modeTabs" role="tablist" aria-label="${t("Transactions")}" data-index="0">
            <span class="segmented-thumb" aria-hidden="true"></span>
            <button id="sendTab" role="tab" aria-controls="sendPanel" aria-selected="true">${kit.icons.send}<span>${t("Send")}</span></button>
            <button id="downloadTab" role="tab" aria-controls="downloadPanel" aria-selected="false">${kit.icons.download}<span>${t("Download")}</span></button>
          </div>

          <!-- Both modes stay in the tree so switching animates their height. -->
          <div>
            <div class="collapse" id="downloadPanel" role="tabpanel" aria-labelledby="downloadTab" data-open="false">
              <div class="collapse-inner stack">
                <div>
                  <span class="label" id="formatLabel">${t("Format")}</span>
                  <div class="picker" id="format" aria-expanded="false"></div>
                </div>
                <div class="actions">
                  <button class="primary" id="run">${t("Download CSV")}</button>
                  <button class="icon" id="copy" title="${t("Copy to clipboard")}" aria-label="${t("Copy to clipboard")}">${kit.icons.copy}</button>
                </div>
                <p class="msg" id="msg" aria-live="polite"></p>
                <button class="ghost" id="downloadPartial" hidden></button>
              </div>
            </div>
            <div class="collapse" id="sendPanel" role="tabpanel" aria-labelledby="sendTab" data-open="true" data-settled="true">
              <div class="collapse-inner stack">
                <button class="primary" id="sendClatri">${t("Load transactions")}</button>
                <p class="msg" id="sendMsg" aria-live="polite"></p>
                <div class="stack" id="transferSkeleton" aria-hidden="true" hidden>
                  <span class="skeleton short"></span><span class="skeleton"></span>
                  <span class="skeleton short"></span><span class="skeleton"></span>
                </div>
                <div id="transfer-slot"></div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <button class="launcher" id="launcher">${logoTag(24)}<span class="dot" id="launcherDot"></span>Clatri</button>
    </div>
  `;

  function logoTag(size) {
    return LOGO
      ? `<img class="orb s${size}" src="${LOGO}" width="${size}" height="${size}" alt="" />`
      : `<span class="orb fallback s${size}"></span>`;
  }

  const el = (id) => root.getElementById(id);
  const panel = root.querySelector(".panel");

  // --- dates ----------------------------------------------------------------
  // Ranges live in shape.js so the panel and date helpers agree. Declarations
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
      return new Intl.NumberFormat(locale(), {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return String(value);
    }
  }

  // --- rendering ------------------------------------------------------------

  // Pickers, the segmented control and the collapses are the kit's. A picker
  // behaves like a select from the outside: `node.value` plus a "change" event.
  const fillSelect = kit.picker.fill;

  /** A thrown render must never leave a dead panel: show the failure in place. */
  let previousSelection = null;
  function render() {
    const selection=exportKey(selectedAccount());
    if(previousSelection!==null && previousSelection!==selection) {ui.preparedKey=null;ui.preparing=false;ui.prepareFailed=false;ui.stagedKey=null;window.postMessage({channel:'clatri-clear-transfer'},location.origin);}
    previousSelection=selection;
    ensurePrepared();
    try {
      paint();
    } catch (error) {
      console.error("[clatri] render failed", error);
      try {
        showMessage(t("The panel could not be updated. Please reload the page."), "error");
      } catch {}
    }
  }

  function paint() {
    fillSelect(
      el("country"),
      countries.map((country) => ({ value: country.code, label: country.name })),
      ui.countryCode,
      { labelledby: "countryLabel" }
    );
    fillSelect(
      el("bank"),
      registry.forCountry(ui.countryCode).map((bank) => ({ value: bank.id, label: bank.name })),
      ui.bankId,
      { labelledby: "bankLabel" }
    );

    const accounts = engine?.state.accounts || [];
    const live = sessionReady();

    // Products show up one call at a time: the savings list first, the cards
    // once the portal asks for them. Say how many are in the list right now.
    el("accountLabel").textContent = accounts.length
      ? t("Account · {count} detected", { count: accounts.length })
      : t("Account");

    if (accounts.length && !accounts.some((account) => account.number === ui.accountNumber)) {
      ui.accountNumber = accounts[0].number;
    }
    fillSelect(
      el("account"),
      accounts.map((account) => ({
        value: account.number,
        label: `${t(account.typeLabel || "Account")} ${displayNumber(account.number)}`,
        hint:
          account.balance === null || account.balance === undefined
            ? ""
            : formatAmount(account.balance, account.currency),
      })),
      ui.accountNumber,
      { placeholder: t("No accounts detected yet"), labelledby: "accountLabel" }
    );

    el("dot").classList.toggle("live", live);
    el("launcherDot").classList.toggle("live", live);

    const bank = currentBank();
    el("bankInstructions").hidden = !bank?.instructions;
    el("bankInstructionsText").textContent = bank?.instructions ? t(bank.instructions) : "";
    el("bankInstructionsToggle").setAttribute("aria-expanded", String(ui.instructionsOpen));
    kit.collapse(el("bankInstructionsRegion"), ui.instructionsOpen);
    if (!bankIsHere()) {
      el("status").textContent = t("Open {bank} to export from it", { bank: bank ? bank.name : t("the bank") });
    } else if (live) {
      const chosen = selectedAccount();
      const exact = Boolean(chosen && engine?.templateFor && engine.templateFor(chosen));
      el("status").textContent = !accounts.length
        ? t("Session detected · open Tus productos so Clatri can list your accounts")
        : exact
          ? t("Ready · accounts: {count}, exact request copied", { count: accounts.length })
          : t("Ready · accounts: {count}, using a rebuilt request", { count: accounts.length });
    } else {
      el("status").textContent = t(bank?.hint || "Waiting for the bank session");
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
    fillSelect(el("format"), FORMATS.map((entry) => ({ value: entry.id, label: entry.label })), ui.format, { labelledby: "formatLabel" });
    el("run").disabled = !runnable;
    el("run").textContent = ui.busy ? t("Working…") : t("Download {format}", { format: formatOf(ui.format).label });
    el("copy").disabled = !runnable;
    // A result belongs to its captured account and dates, never to a new selection.
    if (ui.partial && ui.partial.key !== exportKey(selectedAccount())) ui.partial = null;
    el("downloadPartial").hidden = !ui.partial || ui.busy;
    el("downloadPartial").disabled = ui.busy;
    // Loading is the first step of a send, so it leads until rows are staged;
    // after that the frame's own Send button is the one that matters.
    const staged = Boolean(ui.stagedKey) && ui.stagedKey === exportKey(selectedAccount());
    el("sendClatri").disabled = ui.busy || !selectedAccount();
    el("sendClatri").className = staged ? "ghost" : "primary";
    el("sendClatri").textContent = t(ui.busy ? "Requesting transactions…" : staged ? "Reload transactions" : "Load transactions");
    el("transferSkeleton").hidden = !ui.preparing;
    el("modeTabs").dataset.index = String(MODES.indexOf(ui.mode));
    for (const mode of MODES) {
      kit.collapse(el(mode+"Panel"), ui.mode === mode);
      el(mode+"Tab").setAttribute("aria-selected", String(ui.mode === mode));
      el(mode+"Tab").tabIndex = ui.mode === mode ? 0 : -1;
    }
    el("downloadPartial").textContent = t("Download recovered rows ({count}) · incomplete", { count: ui.partial?.transactions.length || 0 });

    showMessage(ui.message, ui.tone);
    // Say what Load is for only while nothing else is being said.
    if (!ui.message && !ui.busy && !staged) el("sendMsg").textContent = t("Load your transactions to send them to Clatri.");
  }

  /** Each mode reports right under its own action; the folded one is not read out. */
  function showMessage(text, tone) {
    for (const id of ["msg", "sendMsg"]) {
      el(id).textContent = text;
      el(id).className = `msg${tone === "error" ? " error" : tone === "ok" ? " ok" : ""}`;
    }
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

  const MODES = ["send", "download"];
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
    if(format.id==='csv') window.postMessage({channel:'clatri-csv-generated',product:selectedAccount()?.kind==='card' ? 'card' : 'deposit'},location.origin);
  }

  const exportKey = (account) => `${ui.countryCode}|${ui.bankId}|${account?.number || ""}|${ui.from}|${ui.to}`;

  /**
   * `mode` is "download" or "copy". A download always asks the bank again; a
   * copy reuses the rows of the last export when nothing has changed since.
   */
  async function run(mode = "download") {
    const account = selectedAccount();
    if (!account) return;
    const locked = datesLocked(account);
    if (!locked && ui.from > ui.to) {
      say(t("The start date is after the end date."), "error");
      return;
    }

    if (mode === "copy" && ui.results && ui.resultsKey === exportKey(account)) {
      try {
        await deliver("copy", ui.results, ui.resultsContext);
        say(t("{count} transactions copied as {format}.", { count: ui.results.length, format: formatOf(ui.format).label }), "ok");
      } catch {
        say(t("Could not reach the clipboard."), "error");
      }
      return;
    }

    if(mode==='send') selectMode('send');
    const requestKey = exportKey(account);
    ui.busy = true;
    ui.partial = null;
    ui.results = null;
    ui.resultsKey = null;
    say(t("Requesting transactions…"));

    try {
      const { transactions, rangeApplied, fetched, windows, truncated, covered, completion } = await engine.fetchRange({
        account,
        from: ui.from,
        to: ui.to,
        onProgress: ({ total, page, from, to }) =>
          say(locked ? t("{count} transactions so far… (page {page})", { count: total, page }) : t("{count} transactions so far… ({from} to {to})", { count: total, from, to })),
      });

      ui.busy = false;
      if (requestKey !== exportKey(selectedAccount())) {
        say(t("The selection changed during the request. Download again for the selected account and dates."));
        return;
      }
      const usable = !truncated || completion === "unknown";
      ui.results = usable ? transactions : null;
      ui.resultsContext = { ...contextFor(account, covered), ...(completion === "unknown" ? { completion: "unknown" } : {}) };
      ui.resultsKey = usable ? exportKey(account) : null;

      // Without a date filter to rewrite, Clatri only gets the bank's own window.
      const teachRange = t(" Clatri found no date filter in the bank request, so it can only read the range the bank chose. Set Desde and Hasta in the bank’s search, press search once, then come back.");

      // Never download an incomplete capture automatically or offer it for
      // automatic import. A separate explicit download can recover the rows.
      if (mode === 'send' && transactions.length) {
        if (transactions.length > 500) { say(t("Choose a shorter period: one send supports up to 500 transactions."), 'error'); return; }
        const items = transactions.map(row => ({
          booking_date:row.date, description:row.description, reference:row.reference || null,
          original_amount:row.exactAmount === undefined ? String(Math.abs(row.amount)) : row.exactAmount, original_currency:row.currency || account.currency,
          direction:row.amount < 0 ? 'outgoing' : 'incoming',
          status:row.bankType === 'PENDIENTE' ? 'pending' : 'completed', timezone:'America/Bogota',
        }));
        ui.stagedKey = requestKey;
        ui.staging = true;
        window.postMessage({channel:'clatri-stage-transfer',capture:{institution:'co-bancolombia',product:account.kind === 'card' ? 'card' : 'deposit',number:account.number,from:locked ? covered.from : ui.from,to:locked ? covered.to : ui.to,complete:!truncated,items}},location.origin);
        say(t("Choose the destination below to send your transactions."));
        return;
      }
      if (truncated && completion !== "unknown") {
        if (transactions.length) {
          ui.partial = {
            transactions,
            context: { ...ui.resultsContext, complete: false },
            key: exportKey(account),
          };
        }
        say(transactions.length
          ? t("We could not confirm that the bank returned every transaction. {count} transactions were recovered. You can retry or download only those rows as an incomplete file.", { count: transactions.length })
          : t("The bank did not complete the request and no transactions were recovered. Open the transactions in the bank and retry."), "error");
        return;
      }

      if (!transactions.length) {
        say(
          locked
            ? t("The bank has no movements for this card.")
            : rangeApplied
              ? t("No transactions in that range.")
              : t("The bank returned {count} transactions, none inside your dates.{help}", { count: fetched, help: teachRange }),
          "neutral"
        );
        return;
      }

      try {
        await deliver(mode, transactions, ui.resultsContext);
      } catch {
        say(t("Could not reach the clipboard."), "error");
        return;
      }

      const split =
        windows > 1
          ? t(" Clatri checked {count} smaller date windows to avoid the bank’s response limits.", { count: windows })
          : "";

      // State the span actually covered, so a gap at either edge is visible here
      // rather than only after opening the file.
      const span = covered ? t(" Transaction dates: {from} to {to}.", covered) : "";

      const resultMessage = mode === "copy"
        ? t("{count} transactions copied as {format}.", { count: transactions.length, format: formatOf(ui.format).label })
        : t("{count} transactions exported.", { count: transactions.length });
      const ending = completion === "unknown" ? t(" The bank did not confirm the end of the list; the file contains every transaction received.") : "";
      say(resultMessage + span + ending + split + (rangeApplied ? "" : teachRange),
        !rangeApplied ? "neutral" : "ok"
      );
    } catch (error) {
      ui.busy = false;
      ui.results = null;
      const status = /^The bank returned (\d+)\.$/.exec(error.message || "");
      say(status ? t("The bank returned {status}.", { status: status[1] }) : t(error.message || "Something went wrong."), "error");
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

  // Menus are clipped by the scrolling body, so they flip and size against it.
  const scroller = root.querySelector(".body");
  ["country", "bank", "account", "format"].forEach((id) => kit.picker.wire(el(id), { boundary: scroller }));
  // Clicks inside a shadow root are retargeted at the document; listen here too.
  root.addEventListener("click", kit.picker.closeOutside);
  // The bridge only stages after a real click in the panel, so a quiet failure
  // gets another go on the next one.
  root.addEventListener("click", () => {
    if (ui.prepareFailed) {
      ensurePrepared({ retry: true });
      render();
    }
  });

  el("bankInstructionsToggle").addEventListener("click", () => {
    ui.instructionsOpen = !ui.instructionsOpen;
    render();
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
    ui.message = "";
    // A card locks the date fields and reads its own template, so repaint.
    render();
  });

  el("downloadPartial").addEventListener("click", async () => {
    const partial = ui.partial;
    if (ui.busy || !partial || partial.key !== exportKey(selectedAccount())) return;
    try {
      await deliver("download", partial.transactions, partial.context);
      say(t("Incomplete file downloaded: {count} recovered transactions. Other transactions may be missing.", { count: partial.transactions.length }), "neutral");
    } catch {
      say(t("The file could not be downloaded. Please retry."), "error");
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

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'clatri-transfer-staged') return;
    ui.preparing=false;
    // A preparation nobody asked for (the panel opening on Send, a new account
    // appearing) fails quietly; the Send tab or Load retries it out loud.
    const loud=ui.prepareLoud || ui.staging;
    ui.staging=false;
    if (!event.data.ok) {
      ui.prepareFailed=true;ui.stagedKey=null;
      if(loud) {say(t("The transactions could not be prepared. Reload the extension and the bank page, then retry."), 'error');return;}
    }
    render();
  });
  /** Ask the extension for the destination frame that matches the current selection. */
  function ensurePrepared({explicit=false,retry=explicit}={}) {
    const account=selectedAccount();
    if(ui.mode!=='send' || !account || (!explicit && !ui.open)) return;
    const key=exportKey(account);
    if(ui.preparedKey===key && !(retry && ui.prepareFailed)) return;
    ui.preparedKey=key;ui.prepareFailed=false;ui.prepareLoud=explicit;ui.preparing=true;
    window.postMessage({channel:'clatri-prepare-transfer',capture:{institution:'co-bancolombia',product:account.kind==='card'?'card':'deposit',number:account.number,from:ui.from,to:ui.to}},location.origin);
  }
  function selectMode(mode) {
    ui.mode=mode;
    ensurePrepared({explicit:true});
    render();
  }
  for (const mode of MODES) {
    el(mode+'Tab').addEventListener('click',()=>selectMode(mode));
    el(mode+'Tab').addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?MODES[0]:event.key==='End'?MODES[MODES.length-1]:MODES[(MODES.indexOf(mode)+(event.key==='ArrowRight'?1:MODES.length-1))%MODES.length];
      selectMode(next);el(next+'Tab').focus();
    });
  }
  el("sendClatri").addEventListener('click', () => run('send'));
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
