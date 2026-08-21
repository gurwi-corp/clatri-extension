/**
 * Turning captured transactions into files. Output is bank-neutral so a second
 * adapter needs no changes here.
 */
(() => {
  "use strict";
  const NS = (window.__clatri = window.__clatri || {});
  if (NS.exporter) return;

  const COLUMNS = [
    "date",
    "description",
    "amount",
    "direction",
    "currency",
    "reference",
    "bank_type",
    "account",
    "bank",
    "country",
  ];

  function direction(amount) {
    if (typeof amount !== "number") return "";
    return amount < 0 ? "outflow" : "inflow";
  }

  function toRows(transactions, context) {
    return transactions.map((tx) => ({
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      direction: direction(tx.amount),
      currency: tx.currency || context.currency || "",
      reference: tx.reference || "",
      bank_type: tx.bankType || "",
      account: tx.account || context.account || "",
      bank: context.bank || "",
      country: context.country || "",
    }));
  }

  function escapeCsv(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function toCsv(transactions, context) {
    const rows = toRows(transactions, context);
    const lines = [COLUMNS.join(",")];
    for (const row of rows) {
      lines.push(COLUMNS.map((column) => escapeCsv(row[column])).join(","));
    }
    return lines.join("\r\n");
  }

  function toJson(transactions, context) {
    return JSON.stringify(
      {
        bank: context.bank,
        country: context.country,
        account: context.account,
        currency: context.currency,
        from: context.from,
        to: context.to,
        count: transactions.length,
        transactions: toRows(transactions, context),
      },
      null,
      2
    );
  }

  function filename(context, extension) {
    const slug = String(context.bank || "bank").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const account = String(context.account || "").replace(/[^0-9a-zA-Z]/g, "");
    const tail = account ? `-${account}` : "";
    return `${slug}${tail}-${context.from}_${context.to}.${extension}`;
  }

  function download(content, name, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  NS.exporter = { toCsv, toJson, toRows, filename, download, copy, COLUMNS };
})();
