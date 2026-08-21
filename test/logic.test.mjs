import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import vm from "vm";

const BASE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- minimal browser-ish sandbox -------------------------------------------
let fetchCalls = [];
let fetchImpl = async () => {
  throw new Error("no fetch stub");
};

/** XHR double that lets a test drive open/send and then fire "load". */
class FakeXHR {
  constructor() {
    this.listeners = {};
    this.status = 200;
    this.responseType = "";
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  send() {}
  addEventListener(name, fn) {
    (this.listeners[name] = this.listeners[name] || []).push(fn);
  }
  fire(name) {
    (this.listeners[name] || []).forEach((fn) => fn.call(this));
  }
}

const sandbox = {
  console,
  crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" },
  Headers: globalThis.Headers,
  Request: globalThis.Request,
  URL: globalThis.URL,
  XMLHttpRequest: FakeXHR,
  setTimeout,
  Intl,
  fetch: (...args) => fetchImpl(...args),
  location: { hostname: "svpersonas.apps.bancolombia.com", href: "https://svpersonas.apps.bancolombia.com/home" },
  navigator: {},
  document: {
    createElement: () => ({ style: {}, click() {}, remove() {} }),
    body: { appendChild() {} },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of [
  "src/core/shape.js",
  "src/core/registry.js",
  "src/banks/co-bancolombia.js",
  "src/core/engine.js",
  "src/core/export.js",
]) {
  vm.runInContext(readFileSync(`${BASE}/${file}`, "utf8"), sandbox, { filename: file });
}

const { registry, engine, exporter } = sandbox.__clatri;
const hookedFetch = sandbox.window.fetch;

// --- assertions -------------------------------------------------------------
let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
  }
}
function ok(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

const bank = registry.byId("bancolombia");
const respond = (json) => ({
  ok: true,
  status: 200,
  clone: () => ({ json: async () => json }),
  json: async () => json,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

// 1. registry ----------------------------------------------------------------
console.log("\nregistry");
check("countries with an adapter", registry.countries().map((c) => c.code), ["CO"]);
check("banks in CO", registry.forCountry("CO").map((b) => b.name), ["Bancolombia"]);
ok("host match", bank.matchesHost("svpersonas.apps.bancolombia.com"));
ok("rejects lookalike host", !bank.matchesHost("bancolombia.com.evil.io"));

// 2. date ranges -------------------------------------------------------------
// Computed from a supplied `now`, never written down as a calendar literal.
console.log("\ndate ranges");
const { shape } = sandbox.__clatri;
const mid = new Date(2026, 6, 15); // 15 July 2026
check("this month runs from the first to today", shape.range("this-month", mid), ["2026-07-01", "2026-07-15"]);
check("last month is a whole month", shape.range("last-month", mid), ["2026-06-01", "2026-06-30"]);
check("last three months reaches back two", shape.range("last-3", mid), ["2026-05-01", "2026-07-15"]);
check("this year starts in january", shape.range("this-year", mid), ["2026-01-01", "2026-07-15"]);
check("unknown preset returns nothing", shape.range("next-decade", mid), null);
check("presets offered", shape.rangeNames(), ["this-month", "last-month", "last-3", "this-year"]);

// Rolling back across a year boundary, and a February that is not 30 days.
const january = new Date(2026, 0, 20);
check("last month crosses into the previous year", shape.range("last-month", january), [
  "2025-12-01",
  "2025-12-31",
]);
check("last three months crosses too", shape.range("last-3", january), ["2025-11-01", "2026-01-20"]);
check("february ends on the 28th in a common year", shape.range("last-month", new Date(2026, 2, 5)), [
  "2026-02-01",
  "2026-02-28",
]);
check("february ends on the 29th in a leap year", shape.range("last-month", new Date(2028, 2, 5)), [
  "2028-02-01",
  "2028-02-29",
]);

check("halving a month gives two adjacent windows", shape.halve("2026-07-01", "2026-07-31"), [
  ["2026-07-01", "2026-07-16"],
  ["2026-07-17", "2026-07-31"],
]);
check("halving two days leaves one each", shape.halve("2026-07-01", "2026-07-02"), [
  ["2026-07-01", "2026-07-01"],
  ["2026-07-02", "2026-07-02"],
]);
check("a single day cannot be halved", shape.halve("2026-07-01", "2026-07-01"), null);
check("halving crosses month boundaries", shape.halve("2026-01-30", "2026-02-02"), [
  ["2026-01-30", "2026-01-31"],
  ["2026-02-01", "2026-02-02"],
]);

// 3. request filter ----------------------------------------------------------
console.log("\nrequest filter");
ok("watches the portal origin", bank.isApiRequest("https://svpersonas.apps.bancolombia.com/api/v1/home"));
ok("watches the old gateway", bank.isApiRequest("https://canalpersonas-ext.apps.bancolombia.com/super-svp/x"));
ok("watches any bank subdomain", bank.isApiRequest("https://whatever.apps.bancolombia.com/x/y"));
ok("skips static assets", !bank.isApiRequest("https://svpersonas.apps.bancolombia.com/main.a1b2.js"));
ok("skips other sites", !bank.isApiRequest("https://google.com/api"));

// 3. accounts ----------------------------------------------------------------
console.log("\naccounts");
const accountsResponse = {
  meta: { status: "OK" },
  data: {
    accounts: [
      {
        type: "CUENTA_DE_AHORRO",
        number: "00000000000",
        name: "Ahorros",
        currency: "COP",
        balances: { available: 1000000, total: 1000000 },
      },
      {
        type: "CUENTA_CORRIENTE",
        number: "12345678901",
        name: "Corriente",
        currency: "COP",
        balances: { available: 40000 },
      },
    ],
  },
};
const accounts = bank.parseAccounts(accountsResponse);
check("two accounts parsed", accounts.length, 2);
check("balance read from nested object", accounts[0].balance, 1000000);
check("type label mapped", accounts.map((a) => a.typeLabel), ["Savings", "Checking"]);

// 4. transactions ------------------------------------------------------------
console.log("\ntransactions");
const txResponse = (rows) => ({ data: { transactions: rows } });
const parsed = bank.parseTransactions(
  txResponse([
    { transactionDate: "2026/07/28", description: "PAGO NEQUI", amount: -85000, type: "CREDITO", reference1: "998877" },
    { transactionDate: "2026/07/30", description: "ABONO NOMINA", amount: 3200000, type: "DEBITO", reference1: null },
  ])
);
check("dates normalized to ISO", parsed.map((t) => t.date), ["2026-07-28", "2026-07-30"]);
check("null reference becomes empty", parsed[1].reference, "");
check("raw bank label preserved", parsed.map((t) => t.bankType), ["CREDITO", "DEBITO"]);

const renamed = bank.parseTransactions({
  payload: { movements: { items: [{ fecha: "31/07/2026", descripcion: "COMPRA", valor: "-12.500,75" }] } },
});
check("finds list under unknown keys", renamed.length, 1);
check("dd/mm/yyyy normalized", renamed[0].date, "2026-07-31");
check("es-CO formatted amount parsed", renamed[0].amount, -12500.75);

ok("an accounts payload is not read as transactions", bank.parseTransactions(accountsResponse).length === 0);
ok("a transactions payload is not read as accounts", bank.parseAccounts(txResponse(parsed)).length === 0);

// 5. capture through the fetch hook ------------------------------------------
console.log("\ncapture (fetch)");
fetchImpl = async () => respond(accountsResponse);
await hookedFetch("https://svpersonas.apps.bancolombia.com/main.abc.js", {});
await flush();
check("static asset ignored", engine.state.seen, 0);

const appHeaders = {
  Authorization: "Bearer live-token",
  "device-id": "dev-1",
  "session-tracker": "sess-1",
  "app-version": "4.2.5",
};
await hookedFetch(
  "https://canalpersonas-ext.apps.bancolombia.com/super-svp/api/v1/security-filters/ch-ms-deposits/hybrid/accounts/customization/consolidated-balance",
  { method: "GET", headers: appHeaders }
);
await flush();
ok("session captured from a live request", engine.ready());
check("accounts captured", engine.state.accounts.map((a) => a.number), ["00000000000", "12345678901"]);
ok("auth header lowercased", engine.state.headers.authorization === "Bearer live-token");

const appTxUrl =
  "https://canalpersonas-ext.apps.bancolombia.com/super-svp/api/v1/security-filters/ch-ms-deposits/account/transactions";
fetchImpl = async () => respond(txResponse([{ transactionDate: "2026/07/03", description: "X", amount: -1, type: "CREDITO" }]));
await hookedFetch(appTxUrl, {
  method: "POST",
  headers: appHeaders,
  body: JSON.stringify({
    account: { number: "00000000000", type: "CUENTA_DE_AHORRO", alias: "keep-me" },
    pagination: { key: 1 },
    filter: { dateFrom: "2026/07/01", dateTo: "2026/07/31", description: "" },
  }),
});
await flush();
ok("transactions template captured", Boolean(engine.state.template), JSON.stringify(engine.state.template));
check("template keeps the real url", engine.state.template.url, appTxUrl);

// The app may call fetch("/api/...") rather than an absolute URL.
fetchImpl = async () => respond(accountsResponse);
await hookedFetch("/api/v1/products/consolidated", { headers: { Authorization: "Bearer relative-token" } });
await flush();
ok(
  "relative fetch url resolved and captured",
  engine.state.headers.authorization === "Bearer relative-token",
  engine.state.headers.authorization
);
ok("richer device headers kept across requests", engine.state.headers["device-id"] === "dev-1");

// An account carrying its own date field must not be discarded.
const datedAccounts = bank.parseAccounts({
  data: {
    accounts: [
      {
        number: "00000000000",
        type: "CUENTA_DE_AHORRO",
        openingDate: "2020/01/15",
        balances: { available: 10 },
      },
    ],
  },
});
check("account with an opening date still detected", datedAccounts.length, 1);
check(
  "account detected from type alone",
  bank.parseAccounts({ items: [{ number: "5", type: "CUENTA_CORRIENTE" }] }).length,
  1
);

// 6. capture through the XHR hook (Angular uses responseType json) -----------
console.log("\ncapture (xhr)");
const before = engine.state.seen;
const xhr = new sandbox.XMLHttpRequest();
xhr.open("GET", "/api/v1/products/summary");
xhr.setRequestHeader("Authorization", "Bearer xhr-token");
xhr.send();
xhr.responseType = "json";
xhr.response = accountsResponse;
xhr.fire("load");
await flush();
check("relative xhr url observed", engine.state.seen, before + 1);
ok("json responseType read without responseText", engine.state.headers.authorization === "Bearer xhr-token");

// 7. request building --------------------------------------------------------
console.log("\nrequest building");
const account = accounts[0];
const fresh = bank.buildTransactionsRequest({ account, from: "2026-07-01", to: "2026-07-31", page: 1, template: null });
check("fallback dates use slashes", fresh.body.filter.dateFrom, "2026/07/01");

const derived = bank.buildTransactionsRequest({
  account,
  from: "2026-07-01",
  to: "2026-07-31",
  page: 1,
  template: null,
  referenceUrl:
    "https://newgateway.apps.bancolombia.com/svp/api/v2/ch-ms-deposits/hybrid/accounts/customization/consolidated-balance",
});
check(
  "url derived from the observed gateway",
  derived.url,
  "https://newgateway.apps.bancolombia.com/svp/api/v2/ch-ms-deposits/account/transactions"
);

const template = {
  url: appTxUrl,
  body: {
    account: { number: "00000000000", type: "CUENTA_CORRIENTE", alias: "keep-me" },
    pagination: { key: 1 },
    filter: { dateFrom: "2026-06-01", dateTo: "2026-06-30", description: "", extra: "keep-me-too" },
    unknownField: { nested: true },
  },
};
const replayed = bank.buildTransactionsRequest({ account, from: "2026-07-01", to: "2026-07-31", page: 3, template });
check("template separator honoured", replayed.body.filter.dateFrom, "2026-07-01");
check("end of range written", replayed.body.filter.dateTo, "2026-07-31");
check("page swapped", replayed.body.pagination.key, 3);
check("account swapped", replayed.body.account.number, "00000000000");
check("unknown sibling fields preserved", replayed.body.unknownField, { nested: true });
check("unknown filter fields preserved", replayed.body.filter.extra, "keep-me-too");
ok("template not mutated", template.body.pagination.key === 1 && template.body.account.number === "00000000000");
ok("range reported as applied", replayed.rangeApplied === true);

// A portal that names things differently must still work: values are located by
// what they look like, and nothing is invented.
const foreign = {
  url: "https://svpersonas.apps.bancolombia.com/api/v2/movements/search",
  method: "POST",
  body: {
    producto: { numeroProducto: "00000000000", tipoProducto: "CUENTA_DE_AHORRO" },
    rango: { fechaInicial: "01/06/2026", fechaFinal: "30/06/2026" },
    paginacion: { indice: 1 },
  },
};
const foreignRequest = bank.buildTransactionsRequest({
  account,
  from: "2026-07-01",
  to: "2026-07-31",
  page: 2,
  template: foreign,
});
check("dd/mm/yyyy layout preserved", foreignRequest.body.rango.fechaInicial, "01/07/2026");
check("end date in the same layout", foreignRequest.body.rango.fechaFinal, "31/07/2026");
check("spanish account field rewritten", foreignRequest.body.producto.numeroProducto, "00000000000");
check("spanish page cursor moved", foreignRequest.body.paginacion.indice, 2);
check("keeps the portal's own url", foreignRequest.url, foreign.url);
check("no invented fields", Object.keys(foreignRequest.body).sort(), ["paginacion", "producto", "rango"]);

// Moving a page size instead of a page cursor would silently change how many
// rows come back rather than which ones.
const sized = bank.buildTransactionsRequest({
  account,
  from: "2026-07-01",
  to: "2026-07-31",
  page: 4,
  template: {
    url: appTxUrl,
    body: {
      filter: { dateFrom: "2026/06/01", dateTo: "2026/06/30" },
      pagination: { pageSize: 50, pageNumber: 1 },
    },
  },
});
check("page size left alone", sized.body.pagination.pageSize, 50);
check("page number moved", sized.body.pagination.pageNumber, 4);

// The portal opens Movimientos with the range boxes empty, so the request it
// sends has the date fields present but blank. Those must still get filled.
const blankFilter = {
  url: appTxUrl,
  body: {
    account: { number: "00000000000", type: "CUENTA_DE_AHORRO" },
    pagination: { key: 1 },
    filter: { dateFrom: "", dateTo: "", description: "" },
  },
};
const filled = bank.buildTransactionsRequest({
  account,
  from: "2026-07-01",
  to: "2026-07-31",
  page: 1,
  template: blankFilter,
});
check("blank dateFrom filled in the bank's format", filled.body.filter.dateFrom, "2026/07/01");
check("blank dateTo filled in the bank's format", filled.body.filter.dateTo, "2026/07/31");
ok("range reported as applied", filled.rangeApplied === true);
check("description left blank", filled.body.filter.description, "");

// The failure that produced "no podemos continuar con tu solicitud": a body with
// no date filter must be replayed untouched, not have one grafted onto it.
const dateless = {
  url: appTxUrl,
  body: { account: { number: "00000000000", type: "CUENTA_DE_AHORRO" } },
};
const untouched = bank.buildTransactionsRequest({
  account,
  from: "2026-07-01",
  to: "2026-07-31",
  page: 1,
  template: dateless,
});
check("no filter grafted on", Object.keys(untouched.body).sort(), ["account"]);
ok("reports that the range was not applied", untouched.rangeApplied === false);
ok("reports that it cannot paginate", untouched.canPaginate === false);

// 8. engine paging + dedupe --------------------------------------------------
console.log("\npaging");
engine.state.template = template;
engine.state.headers = {
  authorization: "Bearer live-token",
  "device-id": "dev-1",
  "session-tracker": "sess-1",
  "message-id": "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  "request-timestamp": "2026-01-01 00:00:00:000",
  cookie: "should-be-dropped",
};

const pages = {
  1: [
    { transactionDate: "2026/07/30", description: "A", amount: 100, type: "DEBITO", reference1: "1" },
    { transactionDate: "2026/07/29", description: "B", amount: -50, type: "CREDITO", reference1: "2" },
  ],
  2: [
    { transactionDate: "2026/07/28", description: "C", amount: -75, type: "CREDITO", reference1: "3" },
    { transactionDate: "2026/07/30", description: "A", amount: 100, type: "DEBITO", reference1: "1" },
  ],
  3: [],
};

fetchCalls = [];
fetchImpl = async (url, init) => {
  const body = JSON.parse(init.body);
  fetchCalls.push({ url, headers: init.headers, credentials: init.credentials, body });
  return respond(txResponse(pages[body.pagination.key] || []));
};

const progress = [];
const result = await engine.fetchRange({
  account,
  from: "2026-07-24",
  to: "2026-07-30",
  onProgress: (p) => progress.push(p.page),
});

check("stops after the empty page", fetchCalls.length, 3);
check("duplicate row dropped", result.transactions.length, 3);
check("sorted oldest first", result.transactions.map((t) => t.date), ["2026-07-28", "2026-07-29", "2026-07-30"]);
check("reports the span actually covered", result.covered, { from: "2026-07-28", to: "2026-07-30" });
check("account stamped on each row", [...new Set(result.transactions.map((t) => t.account))], ["00000000000"]);
check("progress reported per page", progress, [1, 2]);
ok("range reported applied", result.rangeApplied === true);
check("volatile header refreshed", fetchCalls[0].headers["message-id"], "11111111-2222-4333-8444-555555555555");
ok("cookie header dropped", !("cookie" in fetchCalls[0].headers));
ok("authorization forwarded", fetchCalls[0].headers.authorization === "Bearer live-token");
ok("device headers forwarded", fetchCalls[0].headers["device-id"] === "dev-1");
check("credentials included", fetchCalls[0].credentials, "include");
ok(
  "timestamp refreshed",
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3}$/.test(fetchCalls[0].headers["request-timestamp"]),
  fetchCalls[0].headers["request-timestamp"]
);

// Past the last page the gateway errors instead of returning an empty one.
// Throwing there used to discard every row already collected.
console.log("\nrunning out of pages");
engine.state.template = template;
engine.state.headersByUrl = {};
engine.state.headers = { authorization: "Bearer live-token" };

const twoPages = {
  1: [
    { transactionDate: "2026/07/30", description: "A", amount: 100, type: "DEBITO", reference1: "1" },
    { transactionDate: "2026/07/29", description: "B", amount: -50, type: "CREDITO", reference1: "2" },
  ],
  2: [
    { transactionDate: "2026/07/28", description: "C", amount: -75, type: "CREDITO", reference1: "3" },
    { transactionDate: "2026/07/27", description: "D", amount: -25, type: "CREDITO", reference1: "4" },
  ],
};
const sameDayPages = {
  1: [
    { transactionDate: "2026/07/01", description: "A", amount: 100, type: "DEBITO", reference1: "1" },
    { transactionDate: "2026/07/01", description: "B", amount: -50, type: "CREDITO", reference1: "2" },
  ],
  2: [
    { transactionDate: "2026/07/01", description: "C", amount: -75, type: "CREDITO", reference1: "3" },
    { transactionDate: "2026/07/01", description: "D", amount: -25, type: "CREDITO", reference1: "4" },
  ],
};
fetchCalls = [];
fetchImpl = async (url, init) => {
  const body = JSON.parse(init.body);
  fetchCalls.push({ url, body });
  const rows = sameDayPages[body.pagination.key];
  if (!rows) {
    return {
      ok: false,
      status: 500,
      text: async () => '{"errors":[{"message":"Por el momento no podemos continuar"}]}',
    };
  }
  return respond(txResponse(rows));
};

const salvaged = await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-01" });
check("everything collected before the error is kept", salvaged.transactions.length, 4);
ok("reports it could not finish", salvaged.truncated === true);
ok("a single day cannot be split further", salvaged.windows === 1, String(salvaged.windows));

// The real bug: a wide query can return a normal-looking but incomplete middle
// slice. Proactive weekly windows recover both ends without waiting for an HTTP
// error that may never come.
console.log("\npreventing a silently capped range");
const byDay = {
  "2026-07-01": [{ transactionDate: "2026/07/01", description: "FIRST", amount: 1, type: "DEBITO" }],
  "2026-07-02": [{ transactionDate: "2026/07/02", description: "SECOND", amount: 2, type: "DEBITO" }],
  "2026-07-03": [{ transactionDate: "2026/07/03", description: "CAP START", amount: 3, type: "DEBITO" }],
  "2026-07-27": [{ transactionDate: "2026/07/27", description: "CAP END", amount: 4, type: "DEBITO" }],
  "2026-07-28": [{ transactionDate: "2026/07/28", description: "LATE", amount: 5, type: "DEBITO" }],
  "2026-07-31": [{ transactionDate: "2026/07/31", description: "LAST", amount: 6, type: "DEBITO" }],
};
fetchCalls = [];
fetchImpl = async (url, init) => {
  const body = JSON.parse(init.body);
  fetchCalls.push({ from: body.filter.dateFrom, to: body.filter.dateTo, page: body.pagination.key });
  const from = body.filter.dateFrom.replace(/\//g, "-");
  const to = body.filter.dateTo.replace(/\//g, "-");
  const span = (new Date(to) - new Date(from)) / 86400000 + 1;
  // This is the production failure: a wide request looks successful but only
  // returns the middle of the selected range.
  if (span > 7) {
    return respond(
      txResponse(
        Object.entries(byDay)
          .filter(([day]) => day >= "2026-07-03" && day <= "2026-07-27")
          .flatMap(([, value]) => value)
      )
    );
  }
  const rows = Object.entries(byDay)
    .filter(([day]) => day >= from && day <= to)
    .flatMap(([, value]) => value);
  // This is Bancolombia's real empty-page contract: it answers 400 rather than
  // returning an empty transactions array.
  if (!rows.length) {
    return {
      ok: false,
      status: 400,
      text: async () => '{"message":"Aún no tienes movimientos en este producto."}',
    };
  }
  if (body.pagination.key > 1) {
    return {
      ok: false,
      status: 500,
      text: async () =>
        '{"message":"Por el momento no podemos continuar con tu solicitud, estamos trabajando para solucionarlo pronto."}',
    };
  }
  return respond(txResponse(rows));
};

const recovered = await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-31" });
const dates = recovered.transactions.map((t) => t.date);
check("uses five weekly windows", recovered.windows, 5);
ok("did not give up", recovered.truncated === false);
ok("generic errors after short pages are treated as the end", recovered.windowResults.every((w) => !w.partial));
ok("recovered the first day", dates.includes("2026-07-01"), dates.join());
ok("recovered the second day", dates.includes("2026-07-02"), dates.join());
ok("recovered the first day after the silent cap", dates.includes("2026-07-28"), dates.join());
ok("recovered the last day", dates.includes("2026-07-31"), dates.join());
check("kept every movement across the range", recovered.transactions.length, 6);
check(
  "no row returned twice",
  recovered.transactions.length,
  new Set(recovered.transactions.map((t) => `${t.date}|${t.description}|${t.amount}`)).size
);
ok(
  "every request stayed inside the range asked for",
  fetchCalls.every((c) => c.from >= "2026-07-01" && c.to <= "2026-07-31"),
  JSON.stringify(fetchCalls.slice(0, 3))
);
ok(
  "never sends a window wider than seven days",
  fetchCalls.every(
    (c) => (new Date(c.to.replace(/\//g, "-")) - new Date(c.from.replace(/\//g, "-"))) / 86400000 < 7
  ),
  JSON.stringify(fetchCalls)
);
ok("stayed well under the request budget", fetchCalls.length < 40, String(fetchCalls.length));

// A gateway error on page one is retried over smaller windows and ultimately
// reported as partial if even a single day cannot be fetched.
fetchCalls = [];
fetchImpl = async () => ({
  ok: false,
  status: 500,
  text: async () => '{"errors":[{"message":"Por el momento no podemos continuar"}]}',
});
const firstPageFailure = await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-07" });
ok("an error on page one is reported as partial", firstPageFailure.truncated === true);
ok("page-one failures are retried over smaller windows", firstPageFailure.windows > 1);

// The same generic error after a full page is ambiguous and must not be
// accepted as completion.
fetchImpl = async (url, init) => {
  const body = JSON.parse(init.body);
  if (body.pagination.key === 1) {
    return respond(
      txResponse(
        Array.from({ length: 50 }, (_, index) => ({
          transactionDate: "2026/07/01",
          description: `ROW ${index}`,
          amount: index + 1,
          type: "DEBITO",
          reference1: String(index),
        }))
      )
    );
  }
  return {
    ok: false,
    status: 500,
    text: async () => '{"message":"Por el momento no podemos continuar con tu solicitud"}',
  };
};
const fullPageFailure = await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-01" });
ok("a generic error after a full page remains partial", fullPageFailure.truncated === true);

// When the response says how many pages there are, believe it and stop early.
fetchCalls = [];
fetchImpl = async (url, init) => {
  const body = JSON.parse(init.body);
  fetchCalls.push({ url, body });
  return respond({
    data: { transactions: twoPages[body.pagination.key] || twoPages[1] },
    meta: { pages: 2, flagMoreRecords: null },
  });
};
const bounded = await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-07" });
check("stops at the advertised page count", fetchCalls.length, 2);
check("no wasted request past the end", bounded.pages, 2);
ok("finished cleanly", !bounded.stoppedBy);

fetchImpl = async () => respond(txResponse([]));
const flagged = await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-31" });
check("an empty first page is not an error", flagged.transactions.length, 0);

// Endpoints on this gateway do not share one header set. Replaying the wrong
// one, such as another call's `filter_list`, gets the request rejected.
console.log("\nper-request headers");
engine.state.headers = {
  authorization: "Bearer refreshed-token",
  "device-id": "dev-1",
  filter_list: "belongs-to-another-endpoint",
  "message-id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "request-timestamp": "2026-01-01 00:00:00:000",
};
engine.state.template = {
  ...template,
  headers: {
    authorization: "Bearer stale-token",
    "device-id": "dev-1",
    channel: "SVP",
    "message-id": "11111111-1111-4111-8111-111111111111",
    "request-timestamp": "2026-07-01 10:00:00:000",
    cookie: "nope",
  },
};

fetchCalls = [];
fetchImpl = async (url, init) => {
  fetchCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  return respond(txResponse(pages[1]));
};
await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-31" });
const sent = fetchCalls[0].headers;
ok("uses the replayed request's own headers", sent.channel === "SVP");
ok("does not borrow another endpoint's header", !("filter_list" in sent));
ok("token refreshed from the live session", sent.authorization === "Bearer refreshed-token");
ok("message id regenerated", sent["message-id"] !== "11111111-1111-4111-8111-111111111111");
ok(
  "timestamp keeps the captured layout",
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3}$/.test(sent["request-timestamp"]),
  sent["request-timestamp"]
);
ok("cookie still dropped", !("cookie" in sent));

// From /home there is no transactions call to copy, only the accounts call.
// Its headers belong to the same microservice, so they are the right ones to
// borrow, and far better than the session-wide mix.
console.log("\nheaders without a template");
const accountsUrl =
  "https://canalpersonas-ext.apps.bancolombia.com/super-svp/api/v1/security-filters/ch-ms-deposits/hybrid/accounts/customization/consolidated-balance";
const fraudUrl =
  "https://canalpersonas-ext.apps.bancolombia.com/super-svp/api/v1/security-filters/fraud-monitoring/transactionalRiskAssessment";

engine.state.template = null;
engine.state.accountsUrl = accountsUrl;
engine.state.headersByUrl = {
  [accountsUrl]: { authorization: "Bearer a", "device-id": "dev-1", channel: "SVP" },
  [fraudUrl]: {
    authorization: "Bearer a",
    "device-id": "dev-1",
    "user-document-type": "belongs-to-fraud-monitoring",
    "filter_list": "belongs-elsewhere",
  },
};
engine.state.headers = engine.state.headersByUrl[fraudUrl];

fetchCalls = [];
fetchImpl = async (url, init) => {
  fetchCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  return respond(txResponse(pages[1]));
};
const rebuilt = await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-31" });

check(
  "endpoint derived from the accounts call",
  fetchCalls[0].url,
  "https://canalpersonas-ext.apps.bancolombia.com/super-svp/api/v1/security-filters/ch-ms-deposits/account/transactions"
);
check("body matches the portal's real shape", Object.keys(fetchCalls[0].body).sort(), [
  "account",
  "filter",
  "pagination",
]);
check("dates in the bank's format", fetchCalls[0].body.filter.dateFrom, "2026/07/01");
ok("borrows the sibling service's headers", fetchCalls[0].headers.channel === "SVP");
ok("not the unrelated service's headers", !("user-document-type" in fetchCalls[0].headers));
ok("nor its filter_list", !("filter_list" in fetchCalls[0].headers));
ok("still returns transactions", rebuilt.transactions.length === 2);
ok("range reported applied without a template", rebuilt.rangeApplied === true);

// The sibling we borrow from carries its own header too. Sending `filter_list`
// on to a service that never asked for it is why this only worked from the
// transactions page and errored everywhere else.
console.log("\nborrowing without contaminating");
const svc = "https://canalpersonas-ext.apps.bancolombia.com/super-svp/api/v1/security-filters";
const core = {
  authorization: "Bearer a",
  "device-id": "dev-1",
  channel: "SVP",
  ip: "1.2.3.4",
  "session-tracker": "sess-1",
};
engine.state.template = null;
engine.state.accountsUrl = `${svc}/ch-ms-deposits/hybrid/accounts/customization/consolidated-balance`;
engine.state.headersByUrl = {
  [engine.state.accountsUrl]: { ...core, filter_list: "belongs-to-the-accounts-call" },
  [`${svc}/fraud-monitoring/generateCSID`]: { ...core },
  [`${svc}/ds-ms-dr-customer-management-preferences/retrieve-name`]: {
    ...core,
    "user-document-type": "belongs-to-retrieve-name",
  },
  [`${svc}/super-svp-ch-ms-channel-campaigns-manager/campaign/user`]: { ...core },
};
engine.state.headers = engine.state.headersByUrl[engine.state.accountsUrl];

fetchCalls = [];
fetchImpl = async (url, init) => {
  fetchCalls.push({ url, headers: init.headers });
  return respond(txResponse(twoPages[1]));
};
await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-31" });
const borrowed = fetchCalls[0].headers;
ok("keeps the headers every endpoint sends", borrowed.channel === "SVP" && borrowed.ip === "1.2.3.4");
ok("authorization always survives", borrowed.authorization === "Bearer a");
ok("drops the sibling's own header", !("filter_list" in borrowed), Object.keys(borrowed).join());
ok("drops the unrelated endpoint's header", !("user-document-type" in borrowed));

// An exact match is the real thing and must be sent whole, oddities included.
engine.state.headersByUrl[`${svc}/ch-ms-deposits/account/transactions`] = {
  ...core,
  filter_list: "this-endpoint-really-does-send-it",
};
fetchCalls = [];
await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-31" });
ok(
  "an exact endpoint match is not trimmed",
  fetchCalls[0].headers.filter_list === "this-endpoint-really-does-send-it"
);

const isoHeaders = bank.freshHeaders({
  "request-timestamp": "2026-07-31T23:44:12.345Z",
  "message-id": "11111111-1111-4111-8111-111111111111",
});
ok(
  "an iso timestamp stays iso",
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(isoHeaders["request-timestamp"]),
  isoHeaders["request-timestamp"]
);
const oddHeaders = bank.freshHeaders({
  "request-timestamp": "1722470652",
  "message-id": "SVP-000123",
});
check("unfamiliar timestamp passed through", oddHeaders["request-timestamp"], "1722470652");
check("non-uuid message id preserved", oddHeaders["message-id"], "SVP-000123");

// With no date filter to rewrite, the selected range would be cosmetic. Refuse
// the export before making a bank request instead of producing a plausible but
// incomplete file.
engine.state.template = dateless;
fetchCalls = [];
fetchImpl = async (url, init) => {
  fetchCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  return respond(
    txResponse([
      { transactionDate: "2026/07/15", description: "IN RANGE", amount: 10, type: "DEBITO" },
      { transactionDate: "2026/05/02", description: "TOO OLD", amount: 20, type: "DEBITO" },
    ])
  );
};
let datelessError = "";
try {
  await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-31" });
} catch (error) {
  datelessError = error.message;
}
check("no call when the selected range cannot be applied", fetchCalls.length, 0);
ok("explains how to capture a request with dates", /open movimientos/i.test(datelessError), datelessError);

engine.state.template = template;
fetchImpl = async () => ({ ok: false, status: 401, text: async () => "token invalido" });
let caught = "";
try {
  await engine.fetchRange({ account, from: "2026-07-01", to: "2026-07-31" });
} catch (error) {
  caught = error.message;
}
ok("401 explained to the user", /session expired/i.test(caught), caught);

// 9. export ------------------------------------------------------------------
console.log("\nexport");
const context = {
  bank: "Bancolombia",
  country: "Colombia",
  account: "00000000000",
  currency: "COP",
  from: "2026-07-01",
  to: "2026-07-31",
};
const csv = exporter.toCsv(
  [
    { date: "2026-07-29", description: 'CAFE "EL SOL", S.A.', amount: -12500, bankType: "CREDITO", reference: "9", currency: "COP", account: "00000000000" },
    { date: "2026-07-30", description: "NOMINA", amount: 3200000, bankType: "DEBITO", reference: "", currency: "COP", account: "00000000000" },
  ],
  context
);
const lines = csv.split("\r\n");
check("header row", lines[0], "date,description,amount,direction,currency,reference,bank_type,account,bank,country");
check(
  "quotes and commas escaped",
  lines[1],
  '2026-07-29,"CAFE ""EL SOL"", S.A.",-12500,outflow,COP,9,CREDITO,00000000000,Bancolombia,Colombia'
);
check("inflow direction from sign", lines[2].split(",")[3], "inflow");
ok("rows written in the order given, oldest first", lines[1] < lines[2]);
check("filename", exporter.filename(context, "csv"), "bancolombia-00000000000-2026-07-01_2026-07-31.csv");

// 10. debug report is safe to share -----------------------------------------
console.log("\ndebug report");
const reportText = sandbox.__clatri.report();
const report = JSON.parse(reportText);
ok("names the fields the bank sent", JSON.stringify(report.responseShapes).includes("balances"));
ok("records whether a session was captured", report.sessionCaptured === true);
ok("lists header names", report.headerNames.includes("authorization"));
ok("never leaks a token", !reportText.includes("live-token") && !reportText.includes("relative-token"));
ok("never leaks a balance", !reportText.includes("1000000"));
ok("never leaks an account number", !reportText.includes("00000000000"));
ok("never leaks a description", !reportText.includes("PAGO NEQUI") && !reportText.includes("NOMINA"));

console.log(failures ? `\n${failures} failing check(s)\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
