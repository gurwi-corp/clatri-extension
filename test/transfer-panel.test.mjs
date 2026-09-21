/** The destination form inside the bank panel, run against a stand-in DOM. */
import assert from "assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import vm from "vm";

const BASE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise(done => setTimeout(done, 0));

function load(context) {
  const nodes = {};
  // Any element the script asks for exists; what it writes can be read back.
  const element = () => new Proxy({ hidden: false, textContent: "", className: "", value: "", disabled: false, dataset: {} },
    { get: (target, key) => key in target ? target[key] : () => element() });
  const sandbox = {
    document: { getElementById: id => nodes[id] ||= element(), addEventListener() {}, createElement: () => element() },
    chrome: { runtime: { sendMessage: async message => message.type === "transfer.context" ? { ok: true, result: context } : { ok: false } },
              storage: { onChanged: { addListener() {} } } },
    ClatriI18n: { t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]), locale: () => "en" },
    ClatriKit: { icons: {}, say: (node, text) => { node.textContent = text; },
                 picker: { wire() {}, disable() {}, fill: (node, items, value) => { node.value = value; } } },
    setTimeout, clearTimeout, Intl, console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(resolve(BASE, "src/ui/transfer-panel.js"), "utf8"), sandbox);
  return { nodes, panel: sandbox.ClatriTransfer };
}

const entity = { id: "e1", name: "Personal", accounts: [{ id: "a1", name: "Bancolombia", currency: "COP" }], cards: [] };

// Loaded rows are summarized with their dates, and the form opens without an error.
{
  const { nodes, panel } = load({ entities: [entity], selection: null, job: null, sent: null,
    capture: { id: "c", product: "deposit", last4: "9061", count: 21, coverage: { start: "2026-09-01", end: "2026-09-21", complete: true } } });
  panel.authChanged(true); await tick(); await tick();
  assert.equal(nodes["capture-summary"].textContent, "21 transactions · ending 9061 · Sep 1, 2026 to Sep 21, 2026");
  assert.equal(nodes["destination"].hidden, false);
  assert.equal(nodes["transfer-status"].textContent, "");
  assert.doesNotMatch(nodes["transfer-status"].className, /error/);
  console.log("  ok   loaded rows are summarized and the destination form opens");
}

// Before anything is loaded there is nothing to summarize, and still no error.
{
  const { nodes, panel } = load({ entities: [entity], selection: null, job: null, sent: null, capture: null });
  panel.authChanged(true); await tick(); await tick();
  assert.equal(nodes["destination"].hidden, true);
  assert.doesNotMatch(nodes["transfer-status"].className, /error/);
  console.log("  ok   no capture yet opens quietly");
}
console.log("\nTransfer panel checks passed");
