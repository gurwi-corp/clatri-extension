# Supported institutions

Updated: 2026-09-21.

This list describes support implemented in this repository. The Chrome Web Store
release may differ: publishing code on GitHub does not update the store release.

## Colombia (CO)

| Institution | Product | Download CSV/JSON and copy | Available period | Send to Clatri |
| --- | --- | --- | --- | --- |
| Bancolombia | Savings account | Implemented | Selected date range, when the portal allows it to be applied | Implemented (0.13.0) |
| Bancolombia | Credit card | Implemented | Transactions offered by the bank; no date filter in this connector | Purchases implemented (0.13.0); payments/refunds require identification |
| Bancolombia | Checking account | Type recognized by the adapter; product-specific validation pending | Not confirmed for this product | Pending |

**How to use it:** sign in to Bancolombia’s personal banking portal yourself,
open **Tus productos**, then the account or card and its **Movimientos** screen.
Wait until you can see the transactions. For accounts, set the dates and run the
bank’s search once. Then open Clatri’s floating panel, select the product and
download/copy the available transactions, or choose **Send to Clatri** and select
your Clatri entity and destination account/card in the embedded form. Each adapter supplies its own
instructions in the bank panel.

**Current limitations:**

- Your bank session must be active in the browser. Signing in to Clatri is
  separate and does not connect an institution by itself.
- A response that does not confirm the end is marked as unconfirmed coverage, not automatically incomplete. Known partial exports remain explicitly marked. Sending received rows does not assert that the full period was captured.
- The bank's explicit currency is retained. The backend uses bank billing evidence where provided and its historical FX cache where needed. Missing FX becomes an issue. Card payments/refunds are not imported as ordinary purchases/income.
- At most 500 movements per send. Destination selection is remembered locally and can be changed; there is no permanent server-side bank binding.
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
