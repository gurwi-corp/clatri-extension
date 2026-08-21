/**
 * Bancolombia (Colombia) adapter.
 *
 * The portal moves its gateway around, so nothing here keys off a specific URL.
 * We watch every call the page makes to a bancolombia.com host, keep the headers
 * from whichever one carries a bearer token, and recognise accounts and
 * transactions by the shape of the response rather than by its address.
 */
(() => {
  "use strict";
  const NS = (window.__clatri = window.__clatri || {});
  const { registry, shape } = NS;
  if (!registry || !shape) return;

  const FALLBACK_TRANSACTIONS_URL =
    "https://canalpersonas-ext.apps.bancolombia.com/super-svp/api/v1/security-filters" +
    "/ch-ms-deposits/account/transactions";

  const STATIC_ASSET = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|html)(\?|#|$)/i;

  const ACCOUNT_TYPE_LABELS = {
    CUENTA_DE_AHORRO: "Savings",
    CUENTA_AHORRO: "Savings",
    CUENTA_CORRIENTE: "Checking",
    TARJETA_DE_CREDITO: "Credit card",
  };

  const isDateKey = (row) => shape.hasKey(row, "transactiondate", "date", "fecha");
  const isAmountKey = (row) => shape.hasKey(row, "amount", "valor", "value");
  const isBalanceKey = (row) => shape.hasKey(row, "balances", "balance", "saldo");
  const isNumberKey = (row) => shape.hasKey(row, "number", "numero");
  const isTypeKey = (row) => shape.hasKey(row, "type", "tipo");

  // --- parsing --------------------------------------------------------------

  /**
   * Deliberately permissive. An account row is anything carrying a number plus
   * either a balance or a product type. We do not reject rows that also have a
   * date field, because accounts legitimately carry things like an opening date,
   * and rejecting on that was silently hiding real accounts. A transactions
   * payload cannot reach here: the engine tries transactions first and only
   * falls through when that finds nothing.
   */
  function parseAccounts(json) {
    const rows = shape.findArray(json, (row) => isNumberKey(row) && (isBalanceKey(row) || isTypeKey(row)));

    return rows
      .map((row) => {
        const balances = shape.valLike(row, "balances");
        let balance = null;
        if (balances && typeof balances === "object") {
          balance = shape.num(shape.valLike(balances, "available", "disponible", "balance"));
        }
        if (balance === null) balance = shape.num(shape.valLike(row, "balance", "saldo"));

        const type = String(shape.valLike(row, "type", "tipo") ?? "").trim();
        return {
          number: String(shape.valLike(row, "number", "numero") ?? "").trim(),
          name: String(shape.valLike(row, "name", "alias", "nombre") ?? "").trim(),
          type,
          typeLabel: ACCOUNT_TYPE_LABELS[type] || humanize(type),
          currency: String(shape.valLike(row, "currency", "moneda") ?? "COP").trim() || "COP",
          balance,
        };
      })
      .filter((account) => account.number);
  }

  function parseTransactions(json) {
    const rows = shape.findArray(json, (row) => isDateKey(row) && isAmountKey(row));

    return rows
      .map((row) => {
        const amount = shape.num(shape.valLike(row, "amount", "valor", "value"));
        return {
          date: shape.normDate(shape.valLike(row, "transactiondate", "date", "fecha")),
          description: String(
            shape.valLike(row, "description", "descripcion", "concept") ?? ""
          ).trim(),
          amount,
          bankType: String(shape.valLike(row, "type", "tipo") ?? "").trim(),
          reference: String(
            shape.valLike(row, "reference1", "reference", "referencia") ?? ""
          ).trim(),
        };
      })
      .filter((tx) => tx.date && tx.amount !== null);
  }

  // --- request building -----------------------------------------------------

  /**
   * One page of the transactions request. When we captured a real request from
   * the page we clone it and swap only dates, account and page, so any field we
   * do not understand survives untouched.
   */
  function buildTransactionsRequest({ account, from, to, page, template, referenceUrl }) {
    if (!template?.body) {
      return {
        url: deriveTransactionsUrl(referenceUrl),
        method: "POST",
        body: {
          account: { number: account.number, type: account.type || "CUENTA_DE_AHORRO" },
          pagination: { key: page },
          filter: { dateFrom: isoToBank(from), dateTo: isoToBank(to), description: "" },
        },
        rangeApplied: true,
        canPaginate: true,
      };
    }

    const body = shape.clone(template.body);
    applyAccount(body, account);
    return {
      url: template.url,
      method: template.method || "POST",
      body,
      rangeApplied: applyRange(body, from, to),
      canPaginate: applyPage(body, page),
    };
  }

  const lastKey = (path) => path[path.length - 1] || "";
  const samePath = (a, b) => a.path.join(".") === b.path.join(".");

  /** Overwrite whatever field holds an account number. */
  function applyAccount(body, account) {
    let applied = false;
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string" && /number|numero/i.test(key) && /^[\d\s-]{4,}$/.test(value)) {
          node[key] = account.number;
          applied = true;
        } else if (
          typeof value === "string" &&
          /type|tipo/i.test(key) &&
          /^(CUENTA|TARJETA)/i.test(value)
        ) {
          if (account.type) node[key] = account.type;
        } else if (value && typeof value === "object") {
          visit(value);
        }
      }
    };
    visit(body);
    return applied;
  }

  /**
   * Rewrite the two dates already present in the request, keeping their exact
   * format. Recognisable field names win; otherwise the earlier value is taken
   * as the start of the range.
   */
  const START_KEY = /from|desde|inicial|inicio|start/i;
  const END_KEY = /to$|hasta|final|fin$|end/i;

  function applyRange(body, from, to) {
    const dates = shape.findDateStrings(body);

    if (dates.length >= 2) {
      let start = dates.find((entry) => START_KEY.test(lastKey(entry.path)));
      let end = dates.find((entry) => END_KEY.test(lastKey(entry.path)));

      if (!start || !end || samePath(start, end)) {
        const sorted = [...dates].sort((a, b) =>
          shape.isoOf(a.value) < shape.isoOf(b.value) ? -1 : 1
        );
        start = sorted[0];
        end = sorted[sorted.length - 1];
      }
      if (!samePath(start, end)) {
        writeDate(body, start, from);
        writeDate(body, end, to);
        return true;
      }
    }

    // The portal loads Movimientos with the range boxes empty, so the request it
    // sends carries `filter.dateFrom: ""`. The field is there; it is just blank.
    const slots = shape.findDateSlots(body);
    const startSlot = slots.find((slot) => START_KEY.test(lastKey(slot.path)));
    const endSlot = slots.find((slot) => END_KEY.test(lastKey(slot.path)));
    if (startSlot && endSlot && !samePath(startSlot, endSlot)) {
      writeDate(body, startSlot, from);
      writeDate(body, endSlot, to);
      return true;
    }

    return false;
  }

  /** Keep the field's own layout when it has one, otherwise use the bank's. */
  function writeDate(body, slot, isoDate) {
    const formatted =
      slot.value && slot.value.length >= 10
        ? shape.formatLike(slot.value, isoDate)
        : isoToBank(isoDate);
    shape.setPath(body, slot.path, formatted);
  }

  /** Move whatever numeric field acts as the page cursor. */
  function applyPage(body, page) {
    const cursors = shape.findPageNumbers(body);
    if (!cursors.length) return false;
    return shape.setPath(body, cursors[0].path, page);
  }

  function isoToBank(isoDate) {
    return String(isoDate).split("-").join("/");
  }

  /**
   * Stop before the gateway complains. Sibling endpoints answer with a `meta`
   * block carrying `flagMoreRecords` and `pages`, so when it is there we use it
   * rather than walking until something breaks.
   */
  function isLastPage(json, page) {
    const meta = json && (json.meta || (json.data && json.data.meta));
    if (!meta || typeof meta !== "object") return false;

    const more = shape.valLike(meta, "flagmorerecords", "morerecords", "hasmore", "moredata");
    if (more === false || more === 0 || more === "false" || more === "N" || more === "0") {
      return true;
    }

    const pages = shape.num(shape.valLike(meta, "pages", "totalpages", "pagecount"));
    if (pages !== null && pages > 0 && page >= pages) return true;

    return false;
  }

  // --- per-request headers --------------------------------------------------

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Two headers cannot be replayed as they were. We mint replacements in the
   * same layout the page used rather than a layout we assume, and when the
   * layout is unfamiliar we hand back the bank's own value instead of guessing.
   */
  function renewVolatileHeaders(previous = {}) {
    const fresh = {};
    const priorId = previous["message-id"];
    fresh["message-id"] = !priorId || UUID.test(priorId) ? shape.uuid() : priorId;

    const stamp = renewTimestamp(previous["request-timestamp"]);
    if (stamp) fresh["request-timestamp"] = stamp;
    return fresh;
  }

  function renewTimestamp(sample) {
    const now = new Date();
    if (!sample) return shape.stamp(now);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3}$/.test(sample)) return shape.stamp(now);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(sample)) return now.toISOString();
    return sample;
  }

  /**
   * With no captured transactions call we still know where the deposits service
   * lives, because the accounts call went through the same gateway. Reuse that
   * prefix instead of trusting a hardcoded host that the portal may have moved.
   */
  function deriveTransactionsUrl(referenceUrl) {
    if (!referenceUrl) return FALLBACK_TRANSACTIONS_URL;
    const marker = "/ch-ms-deposits/";
    const at = referenceUrl.indexOf(marker);
    if (at !== -1) return `${referenceUrl.slice(0, at + marker.length)}account/transactions`;
    return FALLBACK_TRANSACTIONS_URL;
  }

  function humanize(value) {
    if (!value) return "Account";
    return value
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function describeError(status, body) {
    if (status === 401 || /token inv|sesi[oó]n|sin actividad|unauthorized/i.test(body || "")) {
      return "Your bank session expired. Reload the page, sign in again and retry.";
    }
    try {
      const json = JSON.parse(body);
      const raw = json?.errors?.[0]?.message ?? json?.message ?? json?.error;
      if (typeof raw === "string") {
        try {
          const inner = JSON.parse(raw);
          if (inner.description) return inner.description;
          if (inner.title) return inner.title;
        } catch {}
        return raw;
      }
    } catch {}
    return `The bank returned ${status}.`;
  }

  /** Bancolombia represents an empty transaction page as HTTP 400. */
  function isEmptyResponse(status, body) {
    if (status !== 400) return false;
    const message = describeError(status, body);
    return /a[uú]n no tienes? movimientos|no (?:tienes?|hay) movimientos|sin movimientos/i.test(
      message
    );
  }

  /** The gateway's response when pagination walks one page past the result. */
  function isEndOfWindowError(status, message) {
    if (status < 400) return false;
    return /por el momento no podemos continuar con tu solicitud/i.test(message || "");
  }

  registry.register({
    id: "bancolombia",
    country: "CO",
    name: "Bancolombia",
    currency: "COP",

    matchesHost: (host) => /(^|\.)bancolombia\.com$/i.test(host),

    /** Everything on a bank host that is not a static asset is worth a look. */
    isApiRequest: (url) => {
      if (!/^https?:\/\/[^/]*\bbancolombia\.com\//i.test(url)) return false;
      return !STATIC_ASSET.test(url);
    },

    /** Headers that must not be replayed verbatim: they are per-request. */
    volatileHeaders: ["message-id", "request-timestamp", "content-length", "host", "cookie"],
    freshHeaders: renewVolatileHeaders,

    supportsPagination: true,
    maxPages: 40,
    pageSizeHint: 50,
    // Wide Bancolombia queries can look successful while omitting days at both
    // ends. Query short windows up front instead of waiting for an HTTP error.
    maxWindowDays: 7,
    requireRangeApplied: true,
    isLastPage,

    parseAccounts,
    parseTransactions,
    buildTransactionsRequest,
    isEmptyResponse,
    isEndOfWindowError,
    describeError,

    hint: "Open Tus productos, then a savings account, so Clatri can see the session.",
  });
})();
