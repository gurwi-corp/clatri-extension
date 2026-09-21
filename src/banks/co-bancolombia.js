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

  const GATEWAY = "https://canalpersonas-ext.apps.bancolombia.com/super-svp/api/v1/security-filters";
  const FALLBACK_TRANSACTIONS_URL = `${GATEWAY}/ch-ms-deposits/account/transactions`;
  const CARD_TRANSACTIONS_PATH =
    "super-svp-ch-ms-transactional-creditcard-consult/list-transactions-credit-card";
  const FALLBACK_CARD_TRANSACTIONS_URL = `${GATEWAY}/${CARD_TRANSACTIONS_PATH}`;

  const STATIC_ASSET = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|html)(\?|#|$)/i;

  const ACCOUNT_TYPE_LABELS = {
    CUENTA_DE_AHORRO: "Savings",
    CUENTA_AHORRO: "Savings",
    CUENTA_CORRIENTE: "Checking",
    TARJETA_DE_CREDITO: "Credit card",
  };

  const isDateKey = (row) => shape.hasKey(row, "transactiondate", "date", "fecha");
  const isAmountKey = (row) => shape.hasKey(row, "amount", "valor", "value");
  const isDescriptionKey = (row) => shape.hasKey(row, "description", "descripcion", "concept");
  const isBalanceKey = (row) => shape.hasKey(row, "balances", "balance", "saldo");
  const isNumberKey = (row) => shape.hasKey(row, "number", "numero");
  const isTypeKey = (row) => shape.hasKey(row, "type", "tipo");

  /**
   * A credit card row does not carry its number at the top level. The portal
   * wraps it as `customerCard.number.{masked, enc}`: `masked` is what the user
   * sees and `enc` is the token the card services actually key off.
   */
  const cardNumberOf = (row) => {
    const holder = shape.valLike(row, "customercard", "card") || row;
    const number = holder && typeof holder === "object" ? shape.valLike(holder, "number") : null;
    if (!number || typeof number !== "object") return null;
    const masked = shape.valLike(number, "masked", "mask");
    const enc = shape.valLike(number, "enc", "encrypted", "token");
    if (typeof masked !== "string" || typeof enc !== "string" || !masked || !enc) return null;
    return { masked: masked.trim(), enc: enc.trim(), holder };
  };
  const isCardRow = (row) => Boolean(cardNumberOf(row));
  const isCardTransactionRow = (row) =>
    shape.hasKey(row, "isposted", "installment", "outstandingbalance");

  // --- parsing --------------------------------------------------------------

  /**
   * Deliberately permissive. A deposit account row is anything carrying a number
   * plus either a balance or a product type. We do not reject rows that also
   * have a date field, because accounts legitimately carry things like an
   * opening date, and rejecting on that was silently hiding real accounts. A
   * transactions payload cannot reach here: the engine tries transactions first
   * and only falls through when that finds nothing.
   *
   * Credit cards come from a different service with a different shape, so they
   * are recognised separately and tagged `kind: "card"`. `url` is where the
   * list came from; the card request builder derives its endpoint from it.
   */
  function parseAccounts(json, url) {
    const rows = shape.findArray(
      json,
      (row) => isCardRow(row) || (isNumberKey(row) && (isBalanceKey(row) || isTypeKey(row)))
    );
    const sourceUrl = typeof url === "string" ? url : "";

    return rows
      .map((row) => (isCardRow(row) ? parseCard(row, sourceUrl) : parseDeposit(row, sourceUrl)))
      .filter((account) => account.number);
  }

  function parseDeposit(row, sourceUrl) {
    const balances = shape.valLike(row, "balances");
    let balance = null;
    if (balances && typeof balances === "object") {
      balance = shape.num(shape.valLike(balances, "available", "disponible", "balance"));
    }
    if (balance === null) balance = shape.num(shape.valLike(row, "balance", "saldo"));

    const type = String(shape.valLike(row, "type", "tipo") ?? "").trim();
    return {
      kind: "deposit",
      number: String(shape.valLike(row, "number", "numero") ?? "").trim(),
      name: String(shape.valLike(row, "name", "alias", "nombre") ?? "").trim(),
      type,
      typeLabel: ACCOUNT_TYPE_LABELS[type] || humanize(type),
      currency: String(shape.valLike(row, "currency", "moneda") ?? "COP").trim() || "COP",
      balance,
      sourceUrl,
    };
  }

  /**
   * The card list reports several balances side by side. Available credit is
   * the one shown, matching what "balance" means for a deposit account.
   */
  function parseCard(row, sourceUrl) {
    const { masked, enc, holder } = cardNumberOf(row);
    const balances = shape.valLike(holder, "balance", "balances") ?? shape.valLike(row, "balance");
    let balance = null;
    let currency = "";
    if (Array.isArray(balances)) {
      const pick = (label) =>
        balances.find((entry) =>
          new RegExp(label, "i").test(String(shape.valLike(entry, "description", "type") ?? ""))
        );
      const chosen = pick("^SALDO_DISPONIBLE(_TOTAL)?$") || pick("DISPONIBLE") || balances[0];
      if (chosen && typeof chosen === "object") {
        balance = shape.num(shape.valLike(chosen, "amount", "valor", "value"));
        currency = String(shape.valLike(chosen, "currency", "moneda") ?? "").trim();
      }
    }

    const type = "TARJETA_DE_CREDITO";
    const name = [
      shape.valLike(row, "customname"),
      shape.valLike(row, "description"),
      shape.valLike(row, "franchise"),
    ].find((value) => typeof value === "string" && value.trim());

    return {
      kind: "card",
      number: masked,
      name: String(name ?? "").trim(),
      type,
      typeLabel: ACCOUNT_TYPE_LABELS[type],
      currency: currency || "COP",
      balance,
      card: { masked, enc },
      sourceUrl,
    };
  }

  /**
   * Card purchases arrive positive and payments negative, the opposite of a
   * deposit account, where money leaving is negative. The export derives
   * `direction` from the sign, so card amounts are flipped: a purchase is money
   * going out, an "abono" is money coming in.
   */
  function exactAmount(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    let text = String(value).replace(/[^0-9,.-]/g,'');
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g,'').replace(',','.');
    else text = text.replace(/,/g,'');
    text = text.replace(/^-/, '');
    if (!/^[0-9]{1,16}(?:\.[0-9]{1,8})?$/.test(text)) return null;
    // A JSON number has already crossed a floating-point boundary. Refuse
    // unsafe precision instead of pretending to recover the original cents.
    if (typeof value === 'number' && (String(value).includes('e') || text.replace(/^0+|\./g,'').length > 15)) return null;
    return text;
  }

  function parseTransactions(json) {
    const rows = shape.findArray(
      json,
      (row) => isDateKey(row) && isAmountKey(row) && isDescriptionKey(row)
    );

    return rows
      .map((row) => {
        const raw = shape.num(shape.valLike(row, "amount", "valor", "value"));
        const isCard = isCardTransactionRow(row);
        const amount = isCard && raw !== null ? -raw || 0 : raw;
        const posted = shape.valLike(row, "isposted");
        return {
          date: shape.normDate(shape.valLike(row, "transactiondate", "date", "fecha")),
          description: String(
            shape.valLike(row, "description", "descripcion", "concept") ?? ""
          ).trim(),
          amount,
          exactAmount: exactAmount(shape.valLike(row, "amount", "valor", "value")),
          currency: String(shape.valLike(row, "currency", "moneda") ?? "").trim().toUpperCase() || undefined,
          bankType: isCard
            ? posted === false || posted === "false"
              ? "PENDIENTE"
              : ""
            : String(shape.valLike(row, "type", "tipo") ?? "").trim(),
          reference: (isCard ? ['id','authorizationcode'] : ['reference1','reference','referencia'])
            .map(key => shape.valLike(row,key)).filter(value => value != null && String(value).trim() && String(value).trim() !== 'null').map(String)[0]?.trim() || '',
        };
      })
      .filter((tx) => tx.date && tx.amount !== null);
  }

  // --- request building -----------------------------------------------------

  const kindOf = (account) => (account && account.kind === "card" ? "card" : "deposit");

  /**
   * Which template a captured transactions call belongs to. Deposit accounts
   * and credit cards are served by different microservices with different
   * bodies, so a copy of one must never be replayed for the other.
   */
  function kindOfRequest({ url, body }) {
    if (/credit-?card|creditcard|tarjeta/i.test(String(url || ""))) return "card";
    if (body && typeof body === "object" && cardNumberOf(body.data || body)) return "card";
    return "deposit";
  }

  /**
   * The card service has no date filter: it hands back the whole history,
   * newest first, one page at a time. So every page it offers is fetched, the
   * selected range is ignored, and there are no 7-day windows and no refusal
   * when the range cannot be written into the request.
   */
  function profileFor(account) {
    if (kindOf(account) !== "card") return {};
    return {
      dateFilter: "none",
      requireRangeApplied: false,
      maxWindowDays: 0,
      pageSizeHint: null,
      // The card service says `hasMoreRecords: false` on its last page, so an
      // error on a page it promised is a real failure, not the end.
      errorAfterRowsIsEnd: false,
    };
  }

  /**
   * One page of the transactions request. When we captured a real request from
   * the page we clone it and swap only dates, account and page, so any field we
   * do not understand survives untouched.
   */
  function buildTransactionsRequest({ account, from, to, page, template, referenceUrl }) {
    if (kindOf(account) === "card") return buildCardRequest({ account, page, template });

    if (!template?.body) {
      return {
        url: deriveTransactionsUrl(account?.sourceUrl, referenceUrl),
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

  /**
   * A card is addressed by its masked number plus the bank's own encrypted
   * token, both read from the card list. The request carries no dates, so
   * `rangeApplied` is always false here and the engine filters by date itself.
   */
  function buildCardRequest({ account, page, template }) {
    if (template?.body) {
      const body = shape.clone(template.body);
      if (applyCard(body, account)) {
        return {
          url: template.url,
          method: template.method || "POST",
          body,
          rangeApplied: false,
          canPaginate: applyPage(body, page),
        };
      }
    }

    return {
      url: deriveCardTransactionsUrl(account.sourceUrl),
      method: "POST",
      body: {
        data: {
          card: { number: { masked: account.card.masked, enc: account.card.enc } },
          filters: { includeUnposted: true },
          pagination: { pageNumber: page },
        },
      },
      rangeApplied: false,
      canPaginate: true,
    };
  }

  /** Overwrite the `{ masked, enc }` pair wherever the body carries one. */
  function applyCard(body, account) {
    const card = account && account.card;
    if (!card || !card.masked || !card.enc) return false;
    let applied = false;
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      const maskedKey = shape.keyLike(node, "masked", "mask");
      const encKey = shape.keyLike(node, "enc", "encrypted", "token");
      if (maskedKey && encKey && typeof node[maskedKey] === "string" && typeof node[encKey] === "string") {
        node[maskedKey] = card.masked;
        node[encKey] = card.enc;
        applied = true;
        return;
      }
      Object.values(node).forEach(visit);
    };
    visit(body);
    return applied;
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
   * block carrying `flagMoreRecords` and `pages`, and the card service with a
   * `pagination` block carrying `hasMoreRecords`, so when either is there we
   * use it rather than walking until something breaks.
   */
  function paginationState(json, page) {
    // A response can have tracing metadata AND a separate pagination block.
    // Read all supported locations; never treat pageSize as a page count.
    const blocks = [json?.meta, json?.pagination, json?.data?.meta, json?.data?.pagination]
      .filter(value => value && typeof value === "object" && !Array.isArray(value));
    const moreKeys = new Set(["flagmorerecords", "morerecords", "hasmore", "hasmorerecords", "moredata"]);
    const countKeys = new Set(["pages", "totalpages", "pagecount"]);
    const flags = [];
    const counts = [];
    for (const block of blocks) {
      for (const [key, value] of Object.entries(block)) {
        const name = key.toLowerCase();
        if (moreKeys.has(name)) {
          const flag = String(value).toLowerCase();
          if (["true", "1", "y", "s"].includes(flag)) flags.push(true);
          else if (["false", "0", "n"].includes(flag)) flags.push(false);
        }
        if (countKeys.has(name) && /^(?:[1-9]\d*)$/.test(String(value))) {
          const count = Number(value);
          if (Number.isSafeInteger(count)) counts.push(count);
        }
      }
    }
    // Conflicting signals cannot prove completion. A promised next page wins.
    if (flags.includes(true)) return "more";
    if (flags.includes(false)) return "last";
    return counts.length ? (counts.every(count => page >= count) ? "last" : "more") : "unknown";
  }

  const isLastPage = (json, page) => paginationState(json, page) === "last";
  const hasNextPage = (json, page) => paginationState(json, page) === "more";

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
  function deriveTransactionsUrl(...candidates) {
    const marker = "/ch-ms-deposits/";
    for (const candidate of candidates) {
      if (!candidate) continue;
      const at = candidate.indexOf(marker);
      if (at !== -1) return `${candidate.slice(0, at + marker.length)}account/transactions`;
    }
    return FALLBACK_TRANSACTIONS_URL;
  }

  /**
   * The card list and the card transactions live under the same gateway, in
   * sibling services. Reuse the gateway the list came through.
   */
  function deriveCardTransactionsUrl(referenceUrl) {
    if (!referenceUrl) return FALLBACK_CARD_TRANSACTIONS_URL;
    const marker = "/security-filters/";
    const at = referenceUrl.indexOf(marker);
    if (at !== -1) return `${referenceUrl.slice(0, at + marker.length)}${CARD_TRANSACTIONS_PATH}`;
    return FALLBACK_CARD_TRANSACTIONS_URL;
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
    instructions: "Clatri reads the product you open in the bank. For a savings account’s transactions, go into that savings account in Sucursal Virtual Personas and view its transactions. For a credit card’s, go into that card. Repeat for each product you want.\n\nOnce you can see the transactions, return to Clatri to download them or send them to your Clatri account.\n\nFor accounts, set the dates in the bank’s search and search once before downloading.",

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
    hasNextPage,

    parseAccounts,
    parseTransactions,
    buildTransactionsRequest,
    kindOf,
    kindOfRequest,
    profileFor,
    isEmptyResponse,
    isEndOfWindowError,
    describeError,

    hint: "Open Tus productos, then an account or a credit card, so Clatri can see the session.",
  });
})();
