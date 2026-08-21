/**
 * Catalog of supported countries and banks.
 *
 * Adding a bank means: write an adapter that calls `registry.register(...)`,
 * add its file to the manifest's first content script, and add its host to the
 * `matches` list. If the country is new, add it to COUNTRIES below.
 */
(() => {
  "use strict";
  const NS = (window.__clatri = window.__clatri || {});
  if (NS.registry) return;

  const COUNTRIES = [{ code: "CO", name: "Colombia", currency: "COP" }];

  const banks = [];

  function register(adapter) {
    const required = ["id", "country", "name", "matchesHost", "isApiRequest"];
    const missing = required.filter((field) => !adapter || adapter[field] == null);
    if (missing.length) {
      console.warn("[clatri] ignoring bank adapter, missing:", missing.join(", "));
      return;
    }
    if (banks.some((bank) => bank.id === adapter.id)) return;
    banks.push(adapter);
  }

  function byId(id) {
    return banks.find((bank) => bank.id === id) || null;
  }

  function forCountry(code) {
    return banks.filter((bank) => bank.country === code);
  }

  /** The adapter that owns the page we are currently running on, if any. */
  function forHost(host) {
    return banks.find((bank) => bank.matchesHost(host)) || null;
  }

  /** Only countries that actually have at least one adapter loaded. */
  function countries() {
    const covered = new Set(banks.map((bank) => bank.country));
    return COUNTRIES.filter((country) => covered.has(country.code));
  }

  function country(code) {
    return COUNTRIES.find((entry) => entry.code === code) || null;
  }

  NS.registry = { register, byId, forCountry, forHost, countries, country, banks };
})();
