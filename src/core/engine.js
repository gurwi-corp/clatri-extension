/**
 * Capture engine.
 *
 * Wraps fetch and XMLHttpRequest at document_start so every call the bank's own
 * web app makes is observed. Nothing keys off a specific URL: we keep the
 * headers from whichever request carries a bearer token, and we recognise
 * accounts and transactions by the shape of the response. That way a gateway
 * move or a renamed endpoint does not silently break the capture.
 *
 * We never store credentials and never write to disk. Everything below lives in
 * memory for the life of the tab.
 */
(() => {
  "use strict";
  const NS = (window.__clatri = window.__clatri || {});
  const { registry, shape } = NS;
  if (!registry || !shape || NS.engine) return;

  const bank = registry.forHost(window.location.hostname);
  if (!bank) return;

  const nativeFetch = window.fetch;
  const listeners = new Set();
  const LOG_LIMIT = 80;

  const state = {
    bank,
    headers: null,
    headersSeenAt: 0,
    authUrl: null,
    accounts: [],
    accountsUrl: null,
    template: null,
    seen: 0,
    log: [],
    samples: [],
    headersByUrl: {},
    lastAttempt: null,
  };
  const SAMPLE_LIMIT = 14;
  const HEADER_URL_LIMIT = 40;

  function emit() {
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch {}
    });
  }

  function note(entry) {
    state.log.push(entry);
    if (state.log.length > LOG_LIMIT) state.log.shift();
  }

  // --- header handling ------------------------------------------------------

  function normalizeHeaders(raw) {
    const out = {};
    if (!raw) return out;
    if (typeof Headers !== "undefined" && raw instanceof Headers) {
      raw.forEach((value, key) => {
        out[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(raw)) {
      raw.forEach(([key, value]) => {
        out[String(key).toLowerCase()] = String(value);
      });
    } else if (typeof raw === "object") {
      Object.keys(raw).forEach((key) => {
        out[key.toLowerCase()] = String(raw[key]);
      });
    }
    return out;
  }

  function remember(headers, url) {
    if (!headers || !headers.authorization) return false;

    // Keep each endpoint's own set. Services here do not agree on headers:
    // `filter_list` and `user-document-type` belong to particular calls, and
    // carrying one to a service that never asked for it gets it rejected.
    if (Object.keys(state.headersByUrl).length < HEADER_URL_LIMIT || state.headersByUrl[url]) {
      state.headersByUrl[url] = headers;
    }

    // The session-wide set stays as a last resort, richest wins.
    const incoming = Object.keys(headers).length;
    const current = state.headers ? Object.keys(state.headers).length : -1;
    if (incoming < current) {
      state.headers.authorization = headers.authorization;
      state.headersSeenAt = Date.now();
      return true;
    }
    state.headers = headers;
    state.headersSeenAt = Date.now();
    state.authUrl = url;
    return true;
  }

  function sharedSegments(a, b) {
    const left = a.split("/");
    const right = b.split("/");
    let count = 0;
    while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
    return count;
  }

  /**
   * Header names that show up across many different endpoints. Those are the
   * channel's own plumbing. A name seen on only one or two calls belongs to that
   * call, `filter_list` and `user-document-type` being the ones this portal
   * sends, and carrying one to a service that never asked for it is enough to
   * have the request rejected.
   */
  function commonHeaderNames() {
    const urls = Object.keys(state.headersByUrl);
    if (urls.length < 3) return null;

    const seenOn = {};
    for (const url of urls) {
      for (const name of Object.keys(state.headersByUrl[url])) {
        seenOn[name] = (seenOn[name] || 0) + 1;
      }
    }
    const threshold = Math.ceil(urls.length / 2);
    return new Set(Object.keys(seenOn).filter((name) => seenOn[name] >= threshold));
  }

  /**
   * Headers to speak to `targetUrl` with. An exact match is the real thing and
   * is used whole. Anything else is borrowed from the observed call sharing the
   * most of its path, a sibling in the same microservice, but stripped down to
   * the names that endpoint would not consider foreign.
   */
  function pickHeaders(targetUrl) {
    if (state.template && state.template.url === targetUrl && state.template.headers) {
      return state.template.headers;
    }
    if (state.headersByUrl[targetUrl]) return state.headersByUrl[targetUrl];

    let best = null;
    let bestScore = -1;
    for (const [url, headers] of Object.entries(state.headersByUrl)) {
      const score = sharedSegments(url, targetUrl);
      if (score > bestScore) {
        bestScore = score;
        best = headers;
      }
    }
    if (!best) return state.headers || {};

    const common = commonHeaderNames();
    if (!common) return best;

    const trimmed = {};
    for (const [name, value] of Object.entries(best)) {
      if (common.has(name) || name === "authorization") trimmed[name] = value;
    }
    return trimmed;
  }

  // --- response mining ------------------------------------------------------

  /**
   * How useful a captured request is as a replay template. A body that already
   * carries a date range is worth far more than one without: it tells us exactly
   * where the dates live and in what format.
   */
  function templateScore(body) {
    let score = 1;
    if (shape.findDateStrings(body).length >= 2) score += 4;
    if (shape.findPageNumbers(body).length) score += 2;
    return score;
  }

  function observe(url, headers, requestBody, json, method) {
    state.seen += 1;
    let changed = remember(headers, url);

    let transactions = [];
    let accounts = [];
    try {
      transactions = bank.parseTransactions(json) || [];
    } catch {}
    try {
      accounts = transactions.length ? [] : bank.parseAccounts(json) || [];
    } catch {}

    if (accounts.length) {
      state.accounts = accounts;
      state.accountsUrl = url;
      changed = true;
    }

    if (transactions.length && requestBody) {
      try {
        const body = JSON.parse(requestBody);
        if (body && typeof body === "object") {
          const score = templateScore(body);
          if (!state.template || score >= state.template.score) {
            // Keep this request's own headers. Endpoints here do not share a
            // single header set: replaying another call's headers, such as the
            // `filter_list` one, gets the request rejected.
            state.template = { url, body, method: method || "POST", score, headers };
            changed = true;
          }
        }
      } catch {}
    }

    const short = shortUrl(url);
    note({
      url: short,
      auth: Boolean(headers && headers.authorization),
      accounts: accounts.length,
      transactions: transactions.length,
    });

    // A transactions response is the one shape worth keeping above all others,
    // so it never gets crowded out by the noise the portal loads on startup.
    if (!state.samples.some((entry) => entry.url === short)) {
      const sample = { url: short, shape: outline(json) };
      if (transactions.length) state.samples.unshift(sample);
      else if (state.samples.length < SAMPLE_LIMIT) state.samples.push(sample);
    }

    if (changed) emit();
  }

  function absolute(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return String(url || "");
    }
  }

  function shortUrl(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return `${parsed.host}${parsed.pathname}`;
    } catch {
      return String(url).slice(0, 120);
    }
  }

  /**
   * Key names and value types only, never values. This is what makes a bug
   * report shareable: it shows the response's shape without exposing a single
   * balance, name or amount.
   */
  function outline(node, depth = 0) {
    if (depth > 5) return "…";
    if (Array.isArray(node)) {
      return node.length ? { [`array[${node.length}]`]: outline(node[0], depth + 1) } : "array[0]";
    }
    if (node === null) return "null";
    if (typeof node !== "object") return typeof node;
    const out = {};
    for (const key of Object.keys(node).slice(0, 40)) out[key] = outline(node[key], depth + 1);
    return out;
  }

  // --- fetch hook -----------------------------------------------------------

  window.fetch = function (input, init) {
    const raw =
      typeof input === "string" ? input : input && input.url ? input.url : String(input || "");
    const promise = nativeFetch.apply(this, arguments);

    // The app may call fetch("/api/..."), so resolve before matching.
    const url = absolute(raw);

    let interesting = false;
    try {
      interesting = bank.isApiRequest(url);
    } catch {}
    if (!interesting) return promise;

    const headers = {};
    if (typeof Request !== "undefined" && input instanceof Request) {
      Object.assign(headers, normalizeHeaders(input.headers));
    }
    if (init && init.headers) Object.assign(headers, normalizeHeaders(init.headers));
    const body = init && typeof init.body === "string" ? init.body : null;

    promise
      .then((response) => {
        if (!response || !response.ok) return;
        response
          .clone()
          .json()
          .then((json) => {
            try {
              observe(url, headers, body, json, (init && init.method) || "GET");
            } catch {}
          })
          .catch(() => {});
      })
      .catch(() => {});

    return promise;
  };

  // --- XMLHttpRequest hook --------------------------------------------------

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__clatriUrl = String(url || "");
    this.__clatriMethod = String(method || "GET");
    this.__clatriHeaders = {};
    return xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    if (this.__clatriHeaders) this.__clatriHeaders[String(key).toLowerCase()] = String(value);
    return xhrSetHeader.apply(this, arguments);
  };

  /** Read an XHR body whatever responseType the app asked for. */
  function xhrPayload(xhr) {
    const type = xhr.responseType;
    if (type === "json") return xhr.response ?? null;
    if (type === "" || type === "text") {
      const text = xhr.responseText;
      return typeof text === "string" && text ? JSON.parse(text) : null;
    }
    return null;
  }

  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__clatriUrl || "";
    let interesting = false;
    try {
      interesting = bank.isApiRequest(new URL(url, window.location.href).href);
    } catch {}

    if (interesting) {
      this.addEventListener("load", () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          const payload = xhrPayload(this);
          if (!payload) return;
          observe(
            new URL(url, window.location.href).href,
            this.__clatriHeaders,
            typeof body === "string" ? body : null,
            payload,
            this.__clatriMethod
          );
        } catch {}
      });
    }
    return xhrSend.apply(this, arguments);
  };

  // --- outbound calls -------------------------------------------------------

  /**
   * `source` is the header set of the very request we are replaying. Falling
   * back to the session-wide set is a last resort, not the default.
   */
  async function call(url, method, body) {
    const base = pickHeaders(url);
    const headers = { ...base };
    const attempt = { url: shortUrl(url), method, headersFrom: headerSourceFor(url) };
    state.lastAttempt = attempt;

    // The token may have been refreshed since that request was captured.
    if (state.headers && state.headers.authorization) {
      headers.authorization = state.headers.authorization;
    }

    const fresh = bank.freshHeaders ? bank.freshHeaders(base) : {};
    (bank.volatileHeaders || []).forEach((key) => delete headers[key]);
    Object.assign(headers, fresh);
    headers["content-type"] = headers["content-type"] || "application/json";

    const response = await nativeFetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      credentials: "include",
      mode: "cors",
    });

    attempt.status = response.status;
    attempt.ok = response.ok;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // Some bank APIs use a non-2xx response to mean a normal empty page.
      // Let the adapter classify that contract before turning it into an error.
      if (bank.isEmptyResponse && bank.isEmptyResponse(response.status, text)) {
        attempt.empty = true;
        return {};
      }
      const message = bank.describeError
        ? bank.describeError(response.status, text)
        : `The bank returned ${response.status}.`;
      attempt.error = String(message).slice(0, 200);
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  function signature(tx) {
    return `${tx.date}|${tx.description}|${tx.amount}|${tx.reference}|${tx.bankType}`;
  }

  /**
   * Pull every transaction for an account in a date range, walking pages until
   * one comes back empty or repeats what we already have.
   */
  /** Walk the pages of a single date window, appending into `collected`. */
  async function fetchWindow({ account, from, to, seen, collected, budget, onProgress }) {
    const maxPages = bank.supportsPagination ? bank.maxPages || 40 : 1;
    // Separate from the run-wide `seen`. Windows overlap, so a page full of rows
    // another window already collected is still new to this one, and treating it
    // as "nothing new" would end the walk before the window was covered.
    const windowSeen = new Set();
    let stoppedBy = null;
    let stopKind = null;
    let pages = 0;
    let rangeApplied = true;
    let rowCount = 0;
    let minDate = null;
    let maxDate = null;
    let completed = false;

    for (let page = 1; page <= maxPages; page += 1) {
      if (budget.spent >= budget.limit) {
        stoppedBy = "Clatri reached its request limit for one export.";
        stopKind = "request-limit";
        break;
      }

      const request = bank.buildTransactionsRequest({
        account,
        from,
        to,
        page,
        template: state.template,
        referenceUrl: state.accountsUrl || state.authUrl,
      });
      rangeApplied = request.rangeApplied !== false;

      let json;
      budget.spent += 1;
      try {
        json = await call(request.url, request.method || "POST", request.body);
      } catch (error) {
        // Authentication failures cannot be repaired by asking for a smaller
        // date window. Gateway failures often can, including on page one.
        if (error.status === 401 || error.status === 403) throw error;
        // Bancolombia answers a request past its last page with a generic
        // failure. It is safe to accept after a non-full successful page; a
        // full page is still split because it may have hit the real row cap.
        const belowPageCap =
          rowCount > 0 && (!bank.pageSizeHint || rowCount < bank.pageSizeHint);
        if (
          belowPageCap &&
          bank.isEndOfWindowError &&
          bank.isEndOfWindowError(error.status, error.message)
        ) {
          completed = true;
          stopKind = "bank-end-after-rows";
          break;
        }
        stoppedBy = error.message;
        stopKind = "bank-error";
        break;
      }

      pages = page;
      const rows = bank.parseTransactions(json);
      if (!rows.length) {
        completed = true;
        stopKind = "empty-page";
        break;
      }

      let fresh = 0;
      for (const row of rows) {
        const key = signature(row);
        if (windowSeen.has(key)) continue;
        windowSeen.add(key);
        fresh += 1;
        rowCount += 1;
        if (!minDate || row.date < minDate) minDate = row.date;
        if (!maxDate || row.date > maxDate) maxDate = row.date;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push({ ...row, account: account.number, currency: account.currency });
      }

      if (onProgress) onProgress({ total: collected.length, page, from, to });
      // Nothing new within this window means the bank handed back a page we
      // already walked, which is where its list ends.
      if (fresh === 0) {
        completed = true;
        stopKind = "repeated-page";
        break;
      }
      if (request.canPaginate === false) {
        completed = true;
        stopKind = "not-paginated";
        break;
      }
      if (bank.isLastPage && bank.isLastPage(json, page)) {
        completed = true;
        stopKind = "bank-last-page";
        break;
      }
    }

    if (!completed && !stoppedBy && pages >= maxPages) {
      stoppedBy = `Clatri reached the ${maxPages}-page limit for one date window.`;
      stopKind = "page-limit";
    }

    return {
      stoppedBy,
      stopKind,
      pages,
      rangeApplied,
      rowCount,
      covered: minDate ? { from: minDate, to: maxDate } : null,
    };
  }

  const MAX_SPLIT_DEPTH = 4;

  /** Split an inclusive range into predictable windows before calling the bank. */
  function chunkRange(from, to, maxDays) {
    if (!maxDays || maxDays < 1) return [[from, to]];
    const chunks = [];
    let cursor = from;
    while (cursor <= to) {
      const candidate = shape.addDays(cursor, maxDays - 1);
      const end = candidate < to ? candidate : to;
      chunks.push([cursor, end]);
      cursor = shape.addDays(end, 1);
    }
    return chunks;
  }

  async function fetchRange({ account, from, to, onProgress }) {
    if (!state.headers) {
      throw new Error(bank.hint || "No bank session detected yet on this page.");
    }

    state.lastRange = [from, to];
    const collected = [];
    const seen = new Set();
    const budget = { spent: 0, limit: 120 };
    let rangeApplied = true;
    let windows = 0;
    let pages = 0;
    let truncated = false;
    let stoppedBy = null;
    const windowResults = [];

    // A captured transactions call without writable date fields would replay
    // the bank's own window and make the selected dates cosmetic. Refuse that
    // export for adapters that require an exact range.
    const probe = bank.buildTransactionsRequest({
      account,
      from,
      to,
      page: 1,
      template: state.template,
      referenceUrl: state.accountsUrl || state.authUrl,
    });
    if (bank.requireRangeApplied && probe.rangeApplied === false) {
      throw new Error(
        "Clatri could not apply the selected dates to the bank request. Open Movimientos, " +
          "set Desde and Hasta there, press search once, then retry."
      );
    }

    /**
     * The bank caps how much one query will hand back and then errors instead of
     * paging on, which silently cost whole days at both ends of a month. So a
     * window that stops early is not accepted: it is cut in half and asked
     * again, until each piece answers completely or we run out of depth.
     */
    const walk = async (windowFrom, windowTo, depth) => {
      windows += 1;
      const result = await fetchWindow({
        account,
        from: windowFrom,
        to: windowTo,
        seen,
        collected,
        budget,
        onProgress,
      });
      pages += result.pages;
      windowResults.push({
        from: windowFrom,
        to: windowTo,
        pages: result.pages,
        rows: result.rowCount,
        covered: result.covered,
        stopKind: result.stopKind,
        partial: Boolean(result.stoppedBy),
      });
      if (result.rangeApplied === false) rangeApplied = false;
      if (!result.stoppedBy) return;

      // Splitting only helps when the dates in the request are ours to set.
      const halves = depth < MAX_SPLIT_DEPTH && rangeApplied ? shape.halve(windowFrom, windowTo) : null;
      if (!halves) {
        truncated = true;
        stoppedBy = result.stoppedBy;
        return;
      }
      for (const [halfFrom, halfTo] of halves) await walk(halfFrom, halfTo, depth + 1);
    };

    // Bancolombia can silently cap a wide query and return a normal-looking
    // final page. Smaller windows avoid relying on an HTTP error to discover
    // that cap. Other adapters can opt in with their own maximum.
    const initialWindows = chunkRange(from, to, bank.maxWindowDays);
    for (const [windowFrom, windowTo] of initialWindows) {
      await walk(windowFrom, windowTo, 0);
    }

    // Always enforce the selected range locally as a final defensive boundary,
    // even when the request builder reports that the dates were applied.
    const inRange = collected.filter((row) => row.date >= from && row.date <= to);

    // Oldest first. A statement reads forwards in time, and any ledger it is
    // imported into expects to replay the movements in the order they happened.
    inRange.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // What the answer actually covers, which is not always what was asked for.
    const covered = inRange.length
      ? { from: inRange[0].date, to: inRange[inRange.length - 1].date }
      : null;

    state.lastResult = {
      windows,
      pages,
      rows: collected.length,
      kept: inRange.length,
      covered,
      requested: { from, to },
      rangeApplied,
      truncated,
      stoppedBy,
      windowResults,
    };
    return {
      transactions: inRange,
      rangeApplied,
      fetched: collected.length,
      windows,
      pages,
      covered,
      truncated,
      stoppedBy,
      windowResults,
    };
  }

  NS.engine = {
    state,
    bank,
    fetchRange,
    ready: () => Boolean(state.headers),
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  /** Type `__clatri.debug()` in the console to see what the page has revealed. */
  NS.debug = () => {
    console.log("[clatri] session:", state.headers ? "captured" : "not captured", state.authUrl || "");
    console.log("[clatri] accounts:", state.accounts);
    console.log("[clatri] transactions template:", state.template);
    console.table(state.log);
    return state;
  };

  /**
   * A shareable description of what this page revealed. Key names and value
   * types only: no balances, names, amounts or tokens. Safe to paste anywhere.
   */
  /** Which observed call's headers we would borrow to reach `targetUrl`. */
  function headerSourceFor(targetUrl) {
    if (state.template && state.template.url === targetUrl && state.template.headers) {
      return "the captured transactions request";
    }
    if (state.headersByUrl[targetUrl]) return shortUrl(targetUrl);

    let best = null;
    let bestScore = -1;
    for (const url of Object.keys(state.headersByUrl)) {
      const score = sharedSegments(url, targetUrl);
      if (score > bestScore) {
        bestScore = score;
        best = url;
      }
    }
    return best ? shortUrl(best) : "session-wide fallback";
  }

  /** Exactly what pressing download would send, in shape-only form. */
  function describePlannedCall() {
    const account = state.accounts[0];
    if (!account) return null;
    try {
      const [from, to] = state.lastRange || shape.range("this-month");
      const request = bank.buildTransactionsRequest({
        account,
        from,
        to,
        page: 1,
        template: state.template,
        referenceUrl: state.accountsUrl || state.authUrl,
      });
      return {
        url: shortUrl(request.url),
        method: request.method,
        rangeApplied: request.rangeApplied,
        canPaginate: request.canPaginate,
        bodyShape: outline(request.body),
        headersFrom: headerSourceFor(request.url),
        headerNames: Object.keys(pickHeaders(request.url)).sort(),
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  NS.report = () =>
    JSON.stringify(
      {
        page: shortUrl(window.location.href),
        bank: bank.id,
        sessionCaptured: Boolean(state.headers),
        headerNames: state.headers ? Object.keys(state.headers).sort() : [],
        accountsDetected: state.accounts.length,
        templateCaptured: Boolean(state.template),
        templateUrl: state.template ? shortUrl(state.template.url) : null,
        templateShape: state.template ? outline(state.template.body) : null,
        requestsSeen: state.seen,
        headerSetsByEndpoint: Object.keys(state.headersByUrl).map(shortUrl),
        wouldCall: describePlannedCall(),
        lastAttempt: state.lastAttempt,
        lastResult: state.lastResult || null,
        log: state.log,
        responseShapes: state.samples,
      },
      null,
      2
    );
})();
