/**
 * Generic helpers for reading loosely-specified JSON coming back from a bank.
 * Nothing in here knows about a specific bank: adapters compose these so that a
 * renamed field does not break the export.
 */
(() => {
  "use strict";
  const NS = (window.__clatri = window.__clatri || {});
  if (NS.shape) return;

  /** Case-insensitive key lookup: exact match first, then "contains". */
  function keyLike(obj, ...needles) {
    if (!obj || typeof obj !== "object") return null;
    const keys = Object.keys(obj);
    for (const needle of needles) {
      const exact = keys.find((k) => k.toLowerCase() === needle);
      if (exact) return exact;
    }
    for (const needle of needles) {
      const partial = keys.find((k) => k.toLowerCase().includes(needle));
      if (partial) return partial;
    }
    return null;
  }

  function valLike(obj, ...needles) {
    const key = keyLike(obj, ...needles);
    return key === null ? undefined : obj[key];
  }

  function hasKey(obj, ...needles) {
    return keyLike(obj, ...needles) !== null;
  }

  /**
   * Walk a JSON tree and return the largest array of plain objects whose first
   * element satisfies `predicate`. Used to locate the accounts or transactions
   * list without hardcoding its path in the response.
   */
  function findArray(json, predicate) {
    let best = [];
    const seen = new Set();

    const visit = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        const allObjects =
          node.length > 0 &&
          node.every((row) => row && typeof row === "object" && !Array.isArray(row));
        if (allObjects && safe(() => predicate(node[0])) && node.length > best.length) {
          best = node;
        }
        node.forEach((row) => visit(row, depth + 1));
        return;
      }

      Object.values(node).forEach((value) => visit(value, depth + 1));
    };

    visit(json, 0);
    return best;
  }

  function safe(fn, fallback = false) {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  /** Parse an amount that may arrive as a number or a formatted string. */
  function num(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[^\d,.-]/g, "").trim();
    if (!cleaned) return null;
    // Whichever separator appears last is the decimal one.
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    let normalized = cleaned;
    if (lastComma > lastDot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
    else normalized = cleaned.replace(/,/g, "");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Normalize a bank date into YYYY-MM-DD. Accepts /, - and ISO strings. */
  function normDate(value) {
    if (!value) return "";
    const text = String(value).trim();

    const iso = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

    const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmy) return `${dmy[3]}-${pad(dmy[2])}-${pad(dmy[1])}`;

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);

    return text;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function toISODate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** Timestamp in the shape the Bancolombia gateway expects. */
  function stamp(date = new Date()) {
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:` +
      String(date.getMilliseconds()).padStart(3, "0")
    );
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // --- date ranges ----------------------------------------------------------
  //
  // One implementation, used by the panel's presets and by the diagnostics.
  // `now` is a parameter so the behaviour is testable and so no calendar month
  // is ever written down as a literal.

  const RANGES = {
    "this-month": (now) => [firstOfMonth(now), toISODate(now)],
    "last-month": (now) => [
      firstOfMonth(shiftMonths(now, -1)),
      toISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
    ],
    "last-3": (now) => [firstOfMonth(shiftMonths(now, -2)), toISODate(now)],
    "this-year": (now) => [toISODate(new Date(now.getFullYear(), 0, 1)), toISODate(now)],
  };

  function shiftMonths(date, count) {
    return new Date(date.getFullYear(), date.getMonth() + count, 1);
  }

  function firstOfMonth(date) {
    return toISODate(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  function today(now = new Date()) {
    return toISODate(now);
  }

  /** Returns [from, to] as ISO dates, or null for an unknown preset name. */
  function range(name, now = new Date()) {
    const build = RANGES[name];
    return build ? build(now) : null;
  }

  const rangeNames = () => Object.keys(RANGES);

  function addDays(isoDate, days) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return toISODate(new Date(year, month - 1, day + days));
  }

  function daysBetween(fromISO, toISO) {
    const [y1, m1, d1] = fromISO.split("-").map(Number);
    const [y2, m2, d2] = toISO.split("-").map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
  }

  /** Cut [from, to] into two adjacent halves, or null when it is a single day. */
  function halve(fromISO, toISO) {
    const span = daysBetween(fromISO, toISO);
    if (span < 1) return null;
    const mid = addDays(fromISO, Math.floor(span / 2));
    return [
      [fromISO, mid],
      [addDays(mid, 1), toISO],
    ];
  }

  // --- editing a captured request body --------------------------------------
  //
  // We rewrite a request the bank itself sent. Field names differ between
  // portal versions, so we locate values by what they look like rather than by
  // where we expect them, and we write them back in the exact same format.

  const DATE_VALUE = /^(\d{4}[/-]\d{2}[/-]\d{2})|^(\d{2}[/-]\d{2}[/-]\d{4})/;

  /** Every string in the body that starts with a date, with its path. */
  function findDateStrings(node, path = [], out = []) {
    if (typeof node === "string") {
      if (node.length >= 10 && DATE_VALUE.test(node)) out.push({ path: [...path], value: node });
      return out;
    }
    if (!node || typeof node !== "object") return out;
    for (const [key, value] of Object.entries(node)) findDateStrings(value, [...path, key], out);
    return out;
  }

  // A cursor can be named for its container rather than itself, as in
  // `paginacion.indice`, so the whole path is what gets matched. Anything that
  // reads like a page *size* is excluded: moving that would change how many
  // rows come back, not which ones.
  const CURSOR_PATH = /pag|page|key|offset|index|indice|cursor/i;
  const NOT_A_CURSOR = /size|limit|total|count|length|rows|max|per/i;

  /** Every number in the body that reads like a page cursor. */
  function findPageNumbers(node, path = [], out = []) {
    if (!node || typeof node !== "object") return out;
    for (const [key, value] of Object.entries(node)) {
      const here = [...path, key];
      const dotted = here.join(".");
      if (typeof value === "number" && CURSOR_PATH.test(dotted) && !NOT_A_CURSOR.test(key)) {
        out.push({ path: here, value });
      } else if (value && typeof value === "object") {
        findPageNumbers(value, here, out);
      }
    }
    return out;
  }

  /**
   * String fields whose *name* says date, whatever they currently hold. This is
   * how an empty `filter.dateFrom` still gets filled: the field exists, so
   * writing to it is not inventing anything.
   */
  function findDateSlots(node, path = [], out = []) {
    if (!node || typeof node !== "object") return out;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && /date|fecha/i.test(key)) {
        out.push({ path: [...path, key], value });
      } else if (value && typeof value === "object") {
        findDateSlots(value, [...path, key], out);
      }
    }
    return out;
  }

  /** The ISO date hiding at the start of a bank-formatted string. */
  function isoOf(value) {
    return normDate(String(value).slice(0, 10));
  }

  /** Rebuild an ISO date in the layout the sample used, keeping any suffix. */
  function formatLike(sample, isoDate) {
    const head = String(sample).slice(0, 10);
    const tail = String(sample).slice(10);
    const [year, month, day] = isoDate.split("-");
    const separator = head.includes("-") ? "-" : "/";
    const rebuilt = /^\d{4}/.test(head)
      ? [year, month, day].join(separator)
      : [day, month, year].join(separator);
    return rebuilt + tail;
  }

  function setPath(root, path, value) {
    let node = root;
    for (let i = 0; i < path.length - 1; i += 1) {
      if (!node || typeof node !== "object") return false;
      node = node[path[i]];
    }
    if (!node || typeof node !== "object") return false;
    node[path[path.length - 1]] = value;
    return true;
  }

  NS.shape = {
    keyLike,
    valLike,
    hasKey,
    findArray,
    num,
    normDate,
    pad,
    toISODate,
    uuid,
    stamp,
    clone,
    today,
    firstOfMonth,
    range,
    rangeNames,
    addDays,
    daysBetween,
    halve,
    findDateStrings,
    findDateSlots,
    findPageNumbers,
    isoOf,
    formatLike,
    setPath,
  };
})();
