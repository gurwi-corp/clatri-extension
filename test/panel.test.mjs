/**
 * Loads every content script the way the browser does, into a DOM stub, and
 * checks the panel actually appears.
 *
 * This exists because it did not once. Changing two helpers from function
 * declarations to const arrows put them in the temporal dead zone at the moment
 * the initial state was built, panel.js threw on load, and the extension simply
 * vanished from the page with nothing in the interface to say why.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import vm from "vm";

const BASE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const missingIds = [];
const spanish = process.env.CLATRI_TEST_LOCALE === "es-CO";

function makeEl(tag = "div") {
  const listeners = {};
  const el = {
    tagName: tag,
    style: {},
    dataset: {},
    children: [],
    hidden: false,
    textContent: "",
    innerHTML: "",
    disabled: false,
    value: "",
    className: "",
    classList: {
      _on: new Set(),
      toggle(name, force) {
        if (force) el.classList._on.add(name);
        else el.classList._on.delete(name);
      },
      add(name) {
        el.classList._on.add(name);
      },
      remove(name) {
        el.classList._on.delete(name);
      },
      contains: (name) => el.classList._on.has(name),
    },
    setAttribute() {},
    getAttribute: () => null,
    addEventListener(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    fire(name, event = {}) {
      (listeners[name] || []).forEach((fn) => fn.call(el, { target: el, ...event }));
    },
    listenerCount: (name) => (listeners[name] || []).length,
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    remove() {},
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    attachShadow() {
      const root = makeEl("#shadow-root");
      let ids = {};
      let bySelector = {};
      let chips = [];

      Object.defineProperty(root, "innerHTML", {
        set(html) {
          ids = {};
          bySelector = {};
          chips = [];
          // Read the whole tag so the stub starts in the state the markup
          // declares, `hidden` included.
          const isHidden = (attrs) => /\shidden(\s|$|=|\/)/.test(attrs);

          for (const match of html.matchAll(/<(\w+)((?:[^>"]|"[^"]*")*id="([^"]+)"(?:[^>"]|"[^"]*")*)>/g)) {
            const stub = makeEl(match[1]);
            stub.hidden = isHidden(match[2]);
            ids[match[3]] = stub;
          }
          for (const match of html.matchAll(/<(\w+)((?:[^>"]|"[^"]*")*class="([^"]+)"(?:[^>"]|"[^"]*")*)>/g)) {
            for (const name of match[3].split(/\s+/)) {
              if (bySelector[`.${name}`]) continue;
              const stub = makeEl(match[1]);
              stub.hidden = isHidden(match[2]);
              bySelector[`.${name}`] = stub;
            }
          }
          for (const match of html.matchAll(/data-preset="([^"]+)"/g)) {
            const chip = makeEl("button");
            chip.dataset.preset = match[1];
            chips.push(chip);
          }
        },
        get: () => "",
      });

      root.getElementById = (id) => {
        if (!ids[id]) missingIds.push(id);
        return ids[id] || makeEl();
      };
      root.querySelector = (selector) => bySelector[selector] || makeEl();
      root.querySelectorAll = (selector) => (selector === ".chip" ? chips : []);
      root._ids = () => ids;
      root._chips = () => chips;
      el.shadowRoot = root;
      return root;
    },
  };
  return el;
}

const documentElement = makeEl("html");
const sandbox = {
  console: { ...console, error: () => {} },
  crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" },
  Headers: globalThis.Headers,
  Request: globalThis.Request,
  URL: globalThis.URL,
  Blob: globalThis.Blob,
  XMLHttpRequest: class {
    open() {}
    send() {}
    setRequestHeader() {}
    addEventListener() {}
  },
  setTimeout,
  Intl,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  location: {
    hostname: "svpersonas.apps.bancolombia.com",
    href: "https://svpersonas.apps.bancolombia.com/home",
  },
  navigator: { language: process.env.CLATRI_TEST_LOCALE || "en-US" },
  document: {
    documentElement,
    body: makeEl("body"),
    readyState: "complete",
    createElement: makeEl,
    addEventListener() {},
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.top = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let failures = 0;
function ok(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}
function check(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Same order and grouping as the manifest's content_scripts.
console.log("\nloading content scripts");
const SCRIPTS = [
  "src/core/shape.js",
  "src/core/registry.js",
  "src/banks/co-bancolombia.js",
  "src/core/engine.js",
  "src/core/export.js",
  "src/core/i18n.js",
  "src/ui/panel.js",
];
for (const file of SCRIPTS) {
  let error = null;
  try {
    vm.runInContext(readFileSync(`${BASE}/${file}`, "utf8"), sandbox, { filename: file });
  } catch (thrown) {
    error = thrown;
  }
  ok(file, !error, error ? `\n       ${String(error.stack).split("\n").slice(0, 3).join("\n       ")}` : "");
}

const NS = sandbox.__clatri;

console.log("\nthe panel appears");
ok("registry, shape, engine and exporter are all present", Boolean(NS?.registry && NS?.shape && NS?.engine && NS?.exporter));
ok("the bank adapter registered", NS?.registry?.banks?.length === 1);
ok("the panel finished setting itself up", Boolean(NS?.panel));
ok("it attached itself to the page", documentElement.children.length === 1);
check("no element was asked for that the markup does not contain", missingIds, []);

console.log("\nit responds to a click");
const host = documentElement.children[0];
const shadow = host.shadowRoot;
const byId = shadow._ids();
const panelEl = shadow.querySelector(".panel");
const closeEl = shadow.querySelector(".close");

ok("the launcher has a click handler", byId.launcher.listenerCount("click") === 1);
ok("the panel starts closed", panelEl.hidden === true);

byId.launcher.fire("click");
ok("clicking the launcher opens it", panelEl.hidden === false);
ok("the launcher hides while the panel is open", byId.launcher.hidden === true);

closeEl.fire("click");
ok("the close button closes it", panelEl.hidden === true);
ok("closing restores the launcher", byId.launcher.hidden === false);

check("all three presets are wired", shadow._chips().map((c) => c.dataset.preset), [
  "this-month",
  "last-month",
  "last-3",
]);
ok(
  "every preset has a handler",
  shadow._chips().every((chip) => chip.listenerCount("click") === 1)
);
ok("the download button has a handler", byId.run.listenerCount("click") === 1);

let rendered = true;
try {
  NS.panel.render();
} catch (error) {
  rendered = false;
  console.log(`       ${error.message}`);
}
ok("rendering does not throw", rendered);
ok("the date fields are filled", /^\d{4}-\d{2}-\d{2}$/.test(byId.from.value), byId.from.value);

console.log("\nit survives a live session appearing");
NS.engine.state.headers = { authorization: "Bearer x" };
NS.panel.render();
ok("empty-account guidance follows the browser language", (spanish ? /Sesión detectada/ : /Session detected/).test(byId.status.textContent));
NS.engine.state.accounts = [
  { number: "00000000000", name: "Ahorros", type: "CUENTA_DE_AHORRO", typeLabel: "Savings", currency: "COP", balance: 1000000 },
];
let updated = true;
try {
  NS.panel.render();
} catch (error) {
  updated = false;
  console.log(`       ${error.message}`);
}
ok("rendering with accounts does not throw", updated);
check("still no missing elements after a full render", missingIds, []);

console.log("\nit lists a credit card next to the accounts");
NS.engine.state.accounts.push({
  kind: "card",
  number: "************1234",
  name: "VISA GOLD",
  type: "TARJETA_DE_CREDITO",
  typeLabel: "Credit card",
  currency: "COP",
  balance: 3500000,
  card: { masked: "************1234", enc: "ENC-TOKEN-1234" },
});
NS.engine.state.templates = { card: { url: "https://x.bancolombia.com/cards", body: {}, headers: {} } };
let withCard = true;
try {
  NS.panel.render();
} catch (error) {
  withCard = false;
  console.log(`       ${error.message}`);
}
ok("rendering with a card does not throw", withCard);
check("still no missing elements", missingIds, []);
ok("the status reads the deposit account's template, not the card's", (spanish ? /solicitud reconstruida/ : /rebuilt request/).test(byId.status.textContent), byId.status.textContent);
byId.account.value = "************1234";
byId.account.fire("change");
ok("choosing the card repaints on its own", (spanish ? /solicitud original/ : /exact request copied/).test(byId.status.textContent), byId.status.textContent);
ok("switching to the card reports its own template", (spanish ? /solicitud original/ : /exact request copied/).test(byId.status.textContent), byId.status.textContent);
ok("the dates lock for a card the bank cannot filter", byId.from.disabled === true && byId.to.disabled === true);
ok("the presets lock too", shadow._chips().every((chip) => chip.disabled === true));
ok("it says why", byId.rangeNote.hidden === false);
byId.account.value = "00000000000";
byId.account.fire("change");
NS.panel.render();
ok("the dates unlock again for a deposit account", byId.from.disabled === false && byId.to.disabled === false);
ok("the presets unlock too", shadow._chips().every((chip) => chip.disabled === false));
ok("the note goes away", byId.rangeNote.hidden === true);
ok("there is no manual account entry", !("accountManual" in byId) && !("toggleManual" in byId));
ok("the account field is our own picker, not a native select", byId.account.tagName === "div");

console.log("\npartial downloads require a separate explicit action");
let downloads = 0;
NS.exporter.download = () => {
  downloads += 1;
};
NS.engine.fetchRange = async () => ({
  transactions: [
    {
      date: "2026-07-03",
      description: "PARTIAL",
      amount: 10,
      reference: "",
      bankType: "DEBITO",
      account: "00000000000",
      currency: "COP",
    },
  ],
  rangeApplied: true,
  fetched: 1,
  windows: 1,
  truncated: true,
  covered: { from: "2026-07-03", to: "2026-07-03" },
});
byId.run.fire("click");
ok("busy action follows the browser language", (spanish ? /Procesando/ : /Working/).test(byId.run.textContent));
ok("request status follows the browser language", (spanish ? /Consultando movimientos/ : /Requesting transactions/).test(byId.msg.textContent));
await new Promise((resolve) => setTimeout(resolve, 0));
check("no file is downloaded", downloads, 0);
ok("incompleteness is explained", (spanish ? /no pudimos confirmar/i : /could not confirm/i).test(byId.msg.textContent), byId.msg.textContent);
ok("recovered rows are offered explicitly", byId.downloadPartial.hidden === false);
NS.exporter.download = (content, name) => { downloads += 1; sandbox.__partialDownload = { content, name }; };
byId.downloadPartial.fire("click");
await new Promise((resolve) => setTimeout(resolve, 0));
check("explicit recovery downloads once", downloads, 1);
ok("partial file is marked in its name", /-incomplete\.csv$/.test(sandbox.__partialDownload.name));
ok("partial CSV carries machine-readable incompleteness", /capture_complete/.test(sandbox.__partialDownload.content) && /false/.test(sandbox.__partialDownload.content));
byId.from.value = "2026-07-02";
byId.from.fire("change");
ok("changing the range hides stale partial data", byId.downloadPartial.hidden === true);
byId.downloadPartial.fire("click");
await new Promise((resolve) => setTimeout(resolve, 0));
check("a stale partial action cannot download", downloads, 1);
downloads = 0;

console.log("\none download button, a format picker and a copy icon");
ok("there is no separate JSON button", !("json" in byId));
ok("the format picker is our own", byId.format.tagName === "div");
ok("the button names the format", (spanish ? /Descargar CSV/ : /Download CSV/).test(byId.run.textContent), byId.run.textContent);
byId.format.value = "json";
byId.format.fire("change");
ok("switching the format renames the button", (spanish ? /Descargar JSON/ : /Download JSON/).test(byId.run.textContent), byId.run.textContent);
NS.exporter.download = (content, name, mime) => {
  downloads += 1;
  sandbox.__lastDownload = { name, mime, content };
};
NS.engine.fetchRange = async () => ({
  transactions: [
    { date: "2026-07-03", description: "FULL", amount: 10, reference: "", bankType: "DEBITO", account: "00000000000", currency: "COP" },
  ],
  rangeApplied: true,
  fetched: 1,
  windows: 1,
  truncated: false,
  covered: { from: "2026-07-03", to: "2026-07-03" },
});
byId.run.fire("click");
await new Promise((resolve) => setTimeout(resolve, 0));
check("a complete export downloads once", downloads, 1);
ok("in the chosen format", sandbox.__lastDownload.mime === "application/json" && /\.json$/.test(sandbox.__lastDownload.name), sandbox.__lastDownload.name);
let copied = null;
NS.exporter.copy = async (text) => {
  copied = text;
};
byId.copy.fire("click");
await new Promise((resolve) => setTimeout(resolve, 0));
ok("the copy icon reuses the rows without a new download", downloads === 1 && copied !== null);
ok("and copies them in the chosen format", /"transactions"/.test(copied || ""));
ok("says so", (spanish ? /copiados como JSON/ : /copied as JSON/).test(byId.msg.textContent), byId.msg.textContent);

// Changes made while a request is pending must not relabel old account data.
let finishRequest;
NS.engine.fetchRange = () => new Promise(resolve => { finishRequest = resolve; });
byId.run.fire("click");
byId.to.value = "2026-07-04";
byId.to.fire("change");
finishRequest({ transactions: [{ date: "2026-07-03", description: "OLD", amount: 10 }], truncated: false });
await new Promise(resolve => setTimeout(resolve, 0));
check("no automatic download after selection changed mid-flight", downloads, 1);
ok("a changed selection requires a new request", (spanish ? /selección cambió/ : /selection changed/).test(byId.msg.textContent));

console.log(failures ? `\n${failures} failing check(s)\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
