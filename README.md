<p align="center">
  <img src="icons/icon-128.png" width="104" height="104" alt="Clatri">
</p>

<h1 align="center">Clatri Extension</h1>

<p align="center">
  Export your bank transactions to CSV, straight from your bank's own website.<br>
  The browser companion to <a href="https://clatri.com">Clatri</a>, the personal AI assistant for money, health and time.
</p>

<p align="center">
  <a href="https://apps.apple.com/app/id6755964865"><img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" height="40" align="middle"></a>
  <a href="https://play.google.com/store/apps/details?id=com.clatri"><img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" height="58" align="middle"></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/clatri/ieblkidehbbodoahabmfbcgbmbafokhc"><img src="https://img.shields.io/chrome-web-store/v/ieblkidehbbodoahabmfbcgbmbafokhc?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white" alt="Chrome Web Store"></a>
  <img src="https://img.shields.io/badge/manifest-v3-1a1a1a" alt="Manifest V3">
  <img src="https://img.shields.io/badge/permissions-none-17803d" alt="No permissions">
  <img src="https://img.shields.io/badge/tests-170%20passing-17803d" alt="170 tests passing">
  <img src="https://img.shields.io/badge/license-GPL--3.0-6b7076" alt="GPL-3.0">
</p>

---

## Why this exists

Open banking is a solved problem in some countries and a promise in most others.
Where it has not landed, your own transaction history sits behind a portal built
for reading, not for taking your data with you.

Colombia is a clear case. Bancolombia issues account statements **once every
three months**, which is a strange thing to accept when the data is right there
on the screen. Anyone keeping their own books, feeding a budgeting app, or just
trying to answer "where did the money go in April" ends up copying rows by hand.

This extension closes that gap the honest way. It does not log in for you and it
never asks for your credentials. You sign in to your bank as you always do, and
it reads the data your browser has **already** loaded, then hands it to you as a
CSV.

Colombia and Bancolombia are only where it starts. The architecture is a country
and bank registry. If yours is missing, take that as an invitation.

## Install

Install it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/clatri/ieblkidehbbodoahabmfbcgbmbafokhc).
That listing works in Chrome, Brave, Edge, Opera, Arc, Vivaldi, and other
Chromium browsers.

> **Pin it.** Click the puzzle piece in the toolbar and pin Clatri so you can see
> it is loaded. It only ever wakes up on your bank's domain.

## Use

1. Sign in to your bank the way you normally do
2. A small **Clatri** pill appears in the bottom right. Its dot turns green once
   your session is detected
3. Click it, pick an account and a date range, press **Download CSV**

That is the whole thing. `JSON` and `Copy` give you the same result in another
form without asking the bank again.

It works from anywhere in the portal, including the home screen. Opening the
account's transactions tab first is slightly better, because the extension can
then copy the exact request your bank just made instead of rebuilding one.

## Supported banks

| Country | Bank | Accounts | Transactions |
|---|---|:--:|:--:|
| 🇨🇴 Colombia | Bancolombia | ✅ | ✅ |

The country and bank pickers are already in the interface, waiting. Yours could
be the next row.

## Add your bank

The step-by-step, including how to capture a session safely and hand it to an
AI, is in [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

You do not need to touch the engine, the interface, or anything else. Write one
adapter and register it:

```js
registry.register({
  id: "yourbank",
  country: "CO",
  name: "Your Bank",
  currency: "COP",

  matchesHost: (host) => /(^|\.)yourbank\.com$/i.test(host),
  isApiRequest: (url) => /yourbank\.com/i.test(url),

  parseAccounts,             // response -> [{ number, name, type, currency, balance }]
  parseTransactions,         // response -> [{ date, description, amount, reference }]
  buildTransactionsRequest,  // { account, from, to, page } -> { url, method, body }
});
```

Then add the file and your bank's domains to `manifest.json`. If the country is
new, add it to `COUNTRIES` in `src/core/registry.js`.

The helpers in `src/core/shape.js` do most of the work. They find the right list
inside a response without knowing its path, read a field whatever it happens to
be called, and parse dates and amounts in whichever local format the bank uses.
Adapters end up short and readable.

```
src/
  core/
    shape.js       Reading loosely specified JSON, and date ranges
    registry.js    Country and bank catalog
    engine.js      Network capture and paged fetching
    export.js      CSV and JSON
  banks/
    co-bancolombia.js
  ui/
    panel.js       The floating panel
```

There is a test harness that runs the whole pipeline against mocked responses,
no browser involved:

```bash
node test/run.mjs
```

170 checks across two suites. `logic.test.mjs` covers parsing, replaying a
request whose fields are named in another language, keeping each date's original
format, pagination, and CSV escaping. `panel.test.mjs` loads every content script
into a DOM stub and checks the panel actually appears and responds, because once
it did not: a helper moved into a temporal dead zone, the script threw on load,
and the extension vanished from the page without a word. Please keep both green.

Pull requests welcome. One bank at a time, this becomes useful to a lot of
people.

## How it works

At page load the extension wraps `fetch` and `XMLHttpRequest` so it can watch the
calls your bank's own web app makes. From those it keeps your account list and
the shape of the transactions request. When you press download it repeats that
request with your dates, walking through pages until the list runs out.

Nothing is guessed. Values are located by what they look like rather than by what
they are named, and written back in the exact format the bank used, so a portal
redesign does not quietly break it.

Banks cap how much one query will hand back, sometimes without returning an
error. Bancolombia ranges are therefore requested in windows of at most seven
days and each window is paged independently. A window that does error is cut in
half again, down to a single day if necessary. Clatri does not create a file
when any window remains partial or when the selected dates could not be applied
to the bank request. Bancolombia's `400` response saying that a product has no
movements is treated as a normal empty page, which is how that API marks the end
of a result set. Its generic failure after a non-full transactions page is also
treated as the end; a full page still triggers a narrower retry so a real cap is
never accepted silently.

### On privacy

The goal is that there is nothing to leak.

- **No credentials.** It cannot log in and never sees your password or PIN
- **No storage.** Everything lives in memory and is gone when you close the tab
- **No servers.** Nothing is sent anywhere. The only host it talks to is your
  bank, from your bank's own page
- **No permissions.** No `host_permissions`, no background worker, no analytics.
  It cannot read any site other than your bank's
- **Read only.** There is no code path that moves money. It repeats the same read
  request the page already made

The source is here, it is small, and it is worth a look before you trust it with
anything financial.

## What is next

- More banks and more countries, starting wherever contributors are
- Credit cards and savings pockets, not just accounts
- Sending transactions **straight into Clatri**, so the CSV round trip becomes
  optional

## Two things to know

The `bank_type` column is kept exactly as the bank sent it. Labels like `DEBITO`
and `CREDITO` do not line up with the sign of the amount in an obvious way, so
`direction` is derived from the sign, where negative is money going out, and the
bank's own label is preserved beside it. Check a few rows against your statement
before importing in bulk.

Automating a bank site is not something banks endorse, even when all you do is
repeat a request your own session already made from your own browser. It is
milder than a headless login by a wide margin, but it is still your call.

## License

[GPL-3.0](LICENSE). Copyright (C) 2026 Gurwi LLC.

You may copy, modify and share this extension under the GNU General Public
License v3. A closed commercial product may not include this code. There is no
warranty.

Clatri, Gurwi and the extension icons are trademarks of Gurwi LLC. The license
covers the code, not those marks.

Contributions are assigned to Gurwi LLC under the [CLA](CLA.md). Built
alongside [Clatri](https://clatri.com).
