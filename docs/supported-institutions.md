# Supported institutions

Updated: 2026-09-20.

This list describes support implemented in this repository. The Chrome Web Store
release may differ: publishing code on GitHub does not update the store release.

## Colombia (CO)

| Institution | Product | Download CSV/JSON and copy | Available period | Send to Clatri |
| --- | --- | --- | --- | --- |
| Bancolombia | Savings account | Implemented | Selected date range, when the portal allows it to be applied | Pending |
| Bancolombia | Credit card | Implemented | Transactions offered by the bank; no date filter in this connector | Pending |
| Bancolombia | Checking account | Type recognized by the adapter; product-specific validation pending | Not confirmed for this product | Pending |

**How to use it:** sign in to Bancolombia’s personal banking portal yourself,
open **Tus productos**, then the account or card. Open Clatri’s floating panel,
select the product and download or copy the available transactions.

**Current limitations:**

- Your bank session must be active in the browser. Signing in to Clatri is
  separate and does not connect an institution by itself.
- Incomplete captures cancel the export; no misleading partial file is created.
- The connector’s base currency is COP. Explicit transaction currencies from the
  bank are preserved. Historical FX and full original/billed amount reconciliation
  are not implemented yet.
- Sending transactions to Clatri and automatic processing are not enabled yet.
  The “Send to Clatri” column will change when these capabilities are implemented.
- Support depends on the bank portal and may change when it is updated. This list
  does not imply an official integration or affiliation with the institution.

## Other countries and institutions

No other connectors are implemented in this repository yet. Institutions not
listed here do not have confirmed support.

## Contribute

Follow the [contribution guide](../CONTRIBUTING.md) to add institutions and countries.
Include an adapter, the required domains and tests using synthetic data; update
this list with the products and limitations you verified. Never attach passwords,
cookies, tokens or personal transactions.

[GitHub repository](https://github.com/gurwi-corp/clatri-extension) ·
[Report an issue](https://github.com/gurwi-corp/clatri-extension/issues)

---

Implementation references:
[bank catalog](../src/core/registry.js),
[Bancolombia adapter](../src/banks/co-bancolombia.js),
[capture engine](../src/core/engine.js),
[CSV/JSON exporter](../src/core/export.js).
