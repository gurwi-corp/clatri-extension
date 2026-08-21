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
  navigator: {},
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

check("all four presets are wired", shadow._chips().map((c) => c.dataset.preset), [
  "this-month",
  "last-month",
  "last-3",
  "this-year",
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

console.log("\nit refuses a partial export");
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
await new Promise((resolve) => setTimeout(resolve, 0));
check("no file is downloaded", downloads, 0);
ok("the cancellation is explained", /export cancelled/i.test(byId.msg.textContent), byId.msg.textContent);
ok("alternate exports stay disabled", byId.json.disabled && byId.copy.disabled);

console.log(failures ? `\n${failures} failing check(s)\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
