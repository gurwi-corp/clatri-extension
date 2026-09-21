/**
 * Clatri UI kit: one set of design tokens and components for every surface.
 *
 * The floating panel lives in a shadow root on the bank's page and cannot load
 * a stylesheet or import a module, so the kit ships as a plain script, the same
 * way i18n.js does. The panel inlines `css` into its shadow root; the
 * extension's own pages (side panel, transfer frame) load this file in <head>
 * with `data-mount` and it puts the same rules on the document.
 *
 * Add a colour, a control or a motion rule here, never in a surface.
 */
(() => {
  "use strict";
  if (globalThis.ClatriKit) return;

  const css = `
    :host { all: initial; }

    :host, :root {
      color-scheme: light dark;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;

      --c-bg: #fff;
      --c-field: #f5f5f6;
      --c-field-hover: #ecedef;
      --c-raised: #fff;
      --c-thumb: #fff;
      --c-line: rgba(0,0,0,.1);
      --c-line-strong: rgba(0,0,0,.3);
      --c-ink: #1a1a1a;
      --c-ink-2: #5d6268;
      --c-ink-3: #a2a7ac;
      --c-accent: #7431ff;
      --c-ok: #17803d;
      --c-live: #17a34a;
      --c-danger: #c2340f;
      --c-danger-bg: #fff1f0;
      --c-action: #1a1a1a;
      --c-action-hover: #303030;
      --c-on-action: #fff;
      --c-action-off: #dcdee1;
      --c-on-action-off: #fff;

      --shadow-pop: 0 2px 4px rgba(0,0,0,.04), 0 12px 28px rgba(0,0,0,.14);
      --shadow-thumb: 0 1px 2px rgba(0,0,0,.14), 0 0 0 .5px rgba(0,0,0,.05);

      --r-field: 10px;
      --r-inner: 7px;
      --r-pill: 999px;
      --h-field: 36px;
      --h-action: 40px;

      --ease: cubic-bezier(.2,.7,.2,1);
      --t-fast: .14s;
      --t-med: .24s;
    }

    @media (prefers-color-scheme: dark) {
      :host, :root {
        --c-bg: #1b1c1e;
        --c-field: #242527;
        --c-field-hover: #2d2e31;
        --c-raised: #2a2b2e;
        --c-thumb: #3d3e42;
        --c-line: rgba(255,255,255,.12);
        --c-line-strong: rgba(255,255,255,.36);
        --c-ink: #f2f3f4;
        --c-ink-2: #a9aeb4;
        --c-ink-3: #6b7076;
        --c-accent: #a182ff;
        --c-ok: #5fd08a;
        --c-live: #3ecf74;
        --c-danger: #ff8f6b;
        --c-danger-bg: #38201b;
        --c-action: #f2f3f4;
        --c-action-hover: #fff;
        --c-on-action: #17181a;
        --c-action-off: #3a3b3e;
        --c-on-action-off: #7d8288;

        --shadow-pop: 0 12px 28px rgba(0,0,0,.5);
        --shadow-thumb: 0 1px 2px rgba(0,0,0,.4), 0 0 0 .5px rgba(255,255,255,.06);
      }
    }

    *, *::before, *::after { box-sizing: border-box; }
    button, input { font: inherit; }
    [hidden] { display: none !important; }

    :where(button, a, input, [tabindex]):focus-visible {
      outline: 2px solid var(--c-accent); outline-offset: 2px;
    }

    /* Field label. Sentence case; it names the control and nothing else. */
    .label { display: block; margin: 0 0 6px; font-size: 12px; font-weight: 500; line-height: 1.3; color: var(--c-ink-2); }

    .field {
      width: 100%; height: var(--h-field); padding: 0 11px;
      border: 1px solid var(--c-line); border-radius: var(--r-field);
      background: var(--c-field); color: var(--c-ink); font-size: 13px; appearance: none;
      transition: border-color var(--t-fast) var(--ease), background-color var(--t-fast) var(--ease);
    }
    .field:hover:not(:disabled) { background: var(--c-field-hover); }
    .field:focus { outline: none; border-color: var(--c-line-strong); background: var(--c-bg); }
    .field:disabled { color: var(--c-ink-3); cursor: not-allowed; }
    .field:disabled::-webkit-calendar-picker-indicator { opacity: .35; }

    /* Picker. A select we can style and animate inside a shadow root. */
    .picker { position: relative; width: 100%; }
    .picker-btn {
      display: flex; align-items: center; gap: 8px; width: 100%; height: var(--h-field);
      padding: 0 10px 0 11px; border: 1px solid var(--c-line); border-radius: var(--r-field);
      background: var(--c-field); color: var(--c-ink); font-size: 13px; text-align: left; cursor: pointer;
      transition: border-color var(--t-fast) var(--ease), background-color var(--t-fast) var(--ease);
    }
    .picker-btn .text, .picker-option .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .picker-btn .text.placeholder { color: var(--c-ink-3); }
    .picker-btn .hint, .picker-option .hint { flex: none; font-size: 12px; color: var(--c-ink-2); font-variant-numeric: tabular-nums; }
    .picker-btn .hint:empty, .picker-option .hint:empty { display: none; }
    .picker-btn svg { flex: none; color: var(--c-ink-2); transition: transform var(--t-med) var(--ease); }
    .picker-btn:hover:not(:disabled) { background: var(--c-field-hover); }
    .picker-btn:disabled { color: var(--c-ink-3); cursor: not-allowed; }
    .picker-btn:disabled .hint { color: var(--c-ink-3); }
    .picker-btn:disabled svg { opacity: .4; }
    .picker[aria-expanded="true"] .picker-btn { border-color: var(--c-line-strong); background: var(--c-bg); }
    .picker[aria-expanded="true"] .picker-btn svg { transform: rotate(180deg); }

    .picker-menu {
      position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 5;
      margin: 0; padding: 4px; max-height: 220px; overflow-y: auto; overscroll-behavior: contain;
      background: var(--c-raised); border: 1px solid var(--c-line); border-radius: var(--r-field);
      box-shadow: var(--shadow-pop);
      opacity: 0; transform: translateY(-4px) scale(.98); transform-origin: top center;
      transition: opacity var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
    }
    .picker-menu.up { top: auto; bottom: calc(100% + 6px); transform: translateY(4px) scale(.98); transform-origin: bottom center; }
    .picker-menu.open { opacity: 1; transform: none; }
    .picker-option {
      display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 7px 8px 7px 9px;
      border-radius: var(--r-inner); font-size: 13px; line-height: 1.3; color: var(--c-ink); cursor: pointer;
    }
    .picker-option:hover, .picker-option.active { background: var(--c-field-hover); }
    .picker-option svg { flex: none; color: var(--c-ink); visibility: hidden; }
    .picker-option[aria-selected="true"] { font-weight: 600; }
    .picker-option[aria-selected="true"] svg { visibility: visible; }

    /* Segmented control. The thumb slides; the track never changes size. */
    .segmented {
      position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
      padding: 3px; border-radius: 11px; background: var(--c-field); border: 1px solid var(--c-line);
    }
    .segmented-thumb {
      position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / var(--count, 2));
      border-radius: 8px; background: var(--c-thumb); box-shadow: var(--shadow-thumb);
      transition: transform var(--t-med) var(--ease);
    }
    .segmented[data-index="1"] .segmented-thumb { transform: translateX(100%); }
    .segmented[data-index="2"] .segmented-thumb { transform: translateX(200%); }
    .segmented[data-index="3"] .segmented-thumb { transform: translateX(300%); }
    .segmented button {
      position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
      height: 30px; padding: 0 8px; border: 0; border-radius: 8px; background: none;
      color: var(--c-ink-2); font-size: 13px; font-weight: 500; cursor: pointer;
      transition: color var(--t-fast) var(--ease);
    }
    .segmented button:hover { color: var(--c-ink); }
    .segmented button[aria-selected="true"] { color: var(--c-ink); font-weight: 600; }
    .segmented button svg { flex: none; }

    /* Collapse. Height animates through a grid row, so content sets its own size. */
    .collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--t-med) var(--ease); }
    .collapse[data-open="true"] { grid-template-rows: 1fr; }
    .collapse > .collapse-inner {
      min-height: 0; overflow: hidden; visibility: hidden; opacity: 0;
      transition: opacity var(--t-med) var(--ease), visibility 0s linear var(--t-med);
    }
    .collapse[data-open="true"] > .collapse-inner { visibility: visible; opacity: 1; transition: opacity var(--t-med) var(--ease), visibility 0s; }
    /* Once open, stop clipping so a picker menu inside can overflow. */
    .collapse[data-settled="true"] > .collapse-inner { overflow: visible; }

    .disclosure {
      display: inline-flex; align-items: center; gap: 6px; padding: 2px 0; border: 0; background: none;
      color: var(--c-ink-2); font-size: 12px; font-weight: 500; cursor: pointer; border-radius: 4px;
    }
    .disclosure:hover { color: var(--c-ink); }
    .disclosure svg { flex: none; transform: rotate(-90deg); transition: transform var(--t-med) var(--ease); }
    .disclosure[aria-expanded="true"] svg { transform: none; }

    .chip {
      height: 28px; padding: 0 12px; border: 1px solid var(--c-line); border-radius: var(--r-pill);
      background: transparent; color: var(--c-ink-2); font-size: 12px; cursor: pointer;
      transition: background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
    }
    .chip:hover:not(:disabled) { background: var(--c-field-hover); color: var(--c-ink); }
    .chip[aria-pressed="true"] { background: var(--c-action); border-color: var(--c-action); color: var(--c-on-action); }
    .chip:disabled { color: var(--c-ink-3); cursor: not-allowed; }
    .chip:disabled[aria-pressed="true"] { background: var(--c-action-off); border-color: var(--c-action-off); color: var(--c-on-action-off); }

    .primary, .ghost {
      display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
      min-height: var(--h-action); padding: 8px 14px; border-radius: var(--r-field);
      font-size: 13px; font-weight: 600; line-height: 1.25; text-decoration: none; cursor: pointer;
      transition: background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
    }
    .primary { border: 0; background: var(--c-action); color: var(--c-on-action); }
    .primary:hover:not(:disabled) { background: var(--c-action-hover); }
    .primary:disabled { background: var(--c-action-off); color: var(--c-on-action-off); cursor: not-allowed; }
    .ghost { border: 1px solid var(--c-line); background: transparent; color: var(--c-ink); font-weight: 500; }
    .ghost:hover:not(:disabled) { background: var(--c-field-hover); }
    .ghost:disabled { color: var(--c-ink-3); cursor: not-allowed; }
    .primary:active:not(:disabled), .ghost:active:not(:disabled), .icon:active:not(:disabled) { transform: scale(.985); }

    .icon {
      flex: none; display: flex; align-items: center; justify-content: center;
      width: var(--h-action); height: var(--h-action); border: 1px solid var(--c-line); border-radius: var(--r-field);
      background: transparent; color: var(--c-ink-2); cursor: pointer;
      transition: background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
    }
    .icon:hover:not(:disabled) { background: var(--c-field-hover); color: var(--c-ink); }
    .icon:disabled { color: var(--c-ink-3); cursor: not-allowed; }

    /* Secondary actions that must not compete with the primary one. */
    .quiet {
      display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border: 0;
      border-radius: var(--r-inner); background: none; color: var(--c-ink-2); font-size: 12px; cursor: pointer;
      transition: background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
    }
    .quiet:hover:not(:disabled) { background: var(--c-field-hover); color: var(--c-ink); }
    .quiet:disabled { color: var(--c-ink-3); cursor: not-allowed; }
    .quiet svg { flex: none; }

    .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--c-ink-3); transition: background-color var(--t-med) var(--ease), box-shadow var(--t-med) var(--ease); }
    .dot.live { background: var(--c-live); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-live) 18%, transparent); }

    .status {
      display: flex; align-items: center; gap: 9px; padding: 9px 11px; border-radius: var(--r-field);
      background: var(--c-field); color: var(--c-ink-2); font-size: 12px; line-height: 1.4;
    }
    .status .text { flex: 1; min-width: 0; }

    .msg { margin: 0; font-size: 12px; line-height: 1.5; color: var(--c-ink-2); overflow-wrap: anywhere; }
    .msg.error { color: var(--c-danger); }
    .msg.ok { color: var(--c-ok); }
    .msg:empty { display: none; }

    /* Trailing dots for work that is still running; they stand in for the "…". */
    .dots { display: inline-flex; gap: 3px; margin-left: 4px; vertical-align: baseline; }
    .dots i { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: .25; animation: kit-dot 1.2s ease-in-out infinite; }
    .dots i:nth-child(2) { animation-delay: .16s; }
    .dots i:nth-child(3) { animation-delay: .32s; }
    @keyframes kit-dot { 0%, 60%, 100% { opacity: .25; transform: none; } 30% { opacity: 1; transform: translateY(-2px); } }

    .skeleton {
      display: block; height: var(--h-field); border-radius: var(--r-field);
      background: linear-gradient(90deg, var(--c-field) 25%, var(--c-field-hover) 50%, var(--c-field) 75%);
      background-size: 200% 100%; animation: kit-shimmer 1.3s linear infinite;
    }
    .skeleton.short { width: 38%; height: 12px; border-radius: 6px; }
    @keyframes kit-shimmer { to { background-position: -200% 0; } }

    /* Content that has just appeared. Replays whenever the node is unhidden. */
    .enter { animation: kit-enter var(--t-med) var(--ease) both; }
    @keyframes kit-enter { from { opacity: 0; transform: translateY(4px); } }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; animation-iteration-count: 1 !important; }
    }
  `;

  const svg = (size, body) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" ` +
    `stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

  const icons = {
    chevron: svg(12, '<path d="M3.5 6 8 10.5 12.5 6"/>'),
    check: svg(13, '<path d="m3 8.5 3.2 3.2L13 4.8"/>'),
    download: svg(14, '<path d="M8 2.5v7.5m0 0L5 7m3 3 3-3M2.75 12.5h10.5"/>'),
    send: svg(14, '<path d="M8 10V2.5m0 0L5 5.5m3-3 3 3M2.75 12.5h10.5"/>'),
    copy: svg(15, '<rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
    refresh: svg(13, '<path d="M13 8a5 5 0 1 1-1.5-3.57M13 2.5v2.75h-2.75"/>'),
    signOut: svg(13, '<path d="M6.5 2.75h-3v10.5h3M9.5 5.25 12.25 8 9.5 10.75M6 8h6.25"/>'),
    close: svg(14, '<path d="m4 4 8 8m0-8-8 8"/>'),
  };

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
    );
  }

  // --- picker ---------------------------------------------------------------

  const MENU_MAX = 220;
  const CLOSE_MS = 150;
  const GROW_MS = 320;
  const wired = [];

  const isOpen = (node) => node.getAttribute("aria-expanded") === "true";
  const optionsOf = (node) => Array.from(node.querySelectorAll(".picker-option"));

  /** Show `node.value` on the button and in the list without rebuilding either. */
  function reflect(node) {
    const item = (node._items || []).find((entry) => entry.value === node.value) || null;
    const text = node.querySelector(".picker-btn .text");
    const hint = node.querySelector(".picker-btn .hint");
    if (text) {
      text.textContent = item ? item.label : node._placeholder || "";
      text.classList.toggle("placeholder", !item);
    }
    if (hint) hint.textContent = item?.hint || "";
    optionsOf(node).forEach((option) => option.setAttribute("aria-selected", String(option.dataset.value === node.value)));
  }

  /**
   * Render a picker into `node`. It behaves like a select from the outside:
   * `node.value` holds the choice and a "change" event fires when the user
   * picks another. Items are `{ value, label, hint? }`.
   *
   * With `autoSelect` the first item stands in for a missing value; without it
   * the picker shows `placeholder` until the user chooses.
   */
  function fill(node, items, value, { placeholder = "", autoSelect = true, disabled = false, labelledby = "" } = {}) {
    const chosen = items.find((item) => item.value === value) || (autoSelect ? items[0] : null) || null;
    node.value = chosen ? chosen.value : "";
    node.disabled = disabled || !items.length;
    node._items = items;
    node._placeholder = placeholder;

    // Same options as last time: keep the DOM, so an open menu survives a
    // rerender and a closing one gets to finish its transition.
    const shape = JSON.stringify([items, placeholder, node.disabled, labelledby]);
    if (node._shape === shape) {
      reflect(node);
      return;
    }
    node._shape = shape;

    const valueId = node.id ? `${node.id}-value` : "";
    const named = labelledby && valueId ? ` aria-labelledby="${escapeHtml(labelledby)} ${escapeHtml(valueId)}"` : "";
    node.setAttribute("aria-expanded", "false");
    node.innerHTML =
      `<button type="button" class="picker-btn" aria-haspopup="listbox"${named}${node.disabled ? " disabled" : ""}>` +
      `<span class="text${chosen ? "" : " placeholder"}"${valueId ? ` id="${escapeHtml(valueId)}"` : ""}>${escapeHtml(chosen ? chosen.label : placeholder)}</span>` +
      `<span class="hint">${escapeHtml(chosen?.hint || "")}</span>${icons.chevron}</button>` +
      `<div class="picker-menu" role="listbox"${labelledby ? ` aria-labelledby="${escapeHtml(labelledby)}"` : ""} hidden>` +
      items
        .map(
          (item) =>
            `<div class="picker-option" role="option" data-value="${escapeHtml(item.value)}" ` +
            `aria-selected="${item.value === node.value}"><span class="text">${escapeHtml(item.label)}</span>` +
            `<span class="hint">${escapeHtml(item.hint || "")}</span>${icons.check}</div>`
        )
        .join("") +
      `</div>`;
  }

  /** Open downwards when it fits, upwards when it does not, never past the boundary. */
  function place(node, menu) {
    if (!node.getBoundingClientRect || !menu.style) return;
    const box = node.getBoundingClientRect();
    const viewport = globalThis.innerHeight || 0;
    const limit = node._boundary?.getBoundingClientRect ? node._boundary.getBoundingClientRect() : { top: 0, bottom: viewport };
    const below = Math.min(limit.bottom, viewport || limit.bottom) - box.bottom - 12;
    const above = box.top - Math.max(limit.top, 0) - 12;
    const wanted = Math.min(menu.scrollHeight || MENU_MAX, MENU_MAX);
    // Fits on neither side, but this frame sizes itself to its content: make
    // room below, then bring the menu into view once the frame has grown.
    if (node._grow?.style && below < wanted && above < wanted) {
      node._grow.style.minHeight = `${Math.ceil(box.bottom + (globalThis.scrollY || 0) + wanted + 18)}px`;
      menu.classList.remove("up");
      menu.style.maxHeight = `${MENU_MAX}px`;
      clearTimeout(node._revealing);
      node._revealing = setTimeout(() => {
        if (isOpen(node) && menu.scrollIntoView) menu.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, GROW_MS);
      return;
    }
    const up = below < wanted && above > below;
    menu.classList.toggle("up", up);
    menu.style.maxHeight = `${Math.max(96, Math.min(MENU_MAX, up ? above : below))}px`;
  }

  function setOpen(node, open) {
    const menu = node.querySelector(".picker-menu");
    if (!menu || (open && node.disabled)) return;
    if (open) wired.forEach((other) => other !== node && isOpen(other) && setOpen(other, false));
    node.setAttribute("aria-expanded", String(open));
    clearTimeout(node._closing);
    if (open) {
      menu.hidden = false;
      place(node, menu);
      void menu.offsetHeight; // commit the closed style so the transition has a start
      menu.classList.add("open");
      return;
    }
    menu.classList.remove("open");
    node._closing = setTimeout(() => {
      menu.hidden = true;
      if (node._grow?.style) node._grow.style.minHeight = "";
    }, CLOSE_MS);
    optionsOf(node).forEach((option) => option.classList.remove("active"));
  }

  /** A click anywhere else closes whichever picker is open. */
  function closeOutside(event) {
    const path = event?.composedPath ? event.composedPath() : [];
    wired.forEach((node) => {
      if (isOpen(node) && !path.includes(node)) setOpen(node, false);
    });
  }

  let listening = false;
  function listenOnce() {
    if (listening) return;
    listening = true;
    globalThis.document?.addEventListener?.("click", closeOutside);
    // A click in another frame never reaches this document; losing focus does.
    globalThis.addEventListener?.("blur", () => closeOutside());
  }

  /**
   * Clicks and keys for one picker, wired once; the markup inside is rerendered
   * freely. `boundary` is the scrolling box the menu must stay inside; `grow`
   * is an element that may get taller instead, for a frame sized to its content.
   */
  function wire(node, { boundary = null, grow = null } = {}) {
    wired.push(node);
    node._boundary = boundary;
    node._grow = grow;
    listenOnce();

    const choose = (value) => {
      setOpen(node, false);
      if (value === undefined || value === node.value) return;
      node.value = value;
      // Show the choice at once, before whoever listens gets to rerender.
      reflect(node);
      node.dispatchEvent(new Event("change"));
    };
    const activeIndex = () => optionsOf(node).findIndex((option) => option.classList.contains("active"));
    const highlight = (index) => {
      const list = optionsOf(node);
      if (!list.length) return;
      const next = (index + list.length) % list.length;
      list.forEach((option, at) => option.classList.toggle("active", at === next));
      if (list[next].scrollIntoView) list[next].scrollIntoView({ block: "nearest" });
    };

    node.addEventListener("click", (event) => {
      const target = event.target;
      const option = target && target.closest ? target.closest(".picker-option") : null;
      if (option) {
        choose(option.dataset.value);
        return;
      }
      if (target && target.closest && target.closest(".picker-btn")) setOpen(node, !isOpen(node));
    });

    node.addEventListener("keydown", (event) => {
      const open = isOpen(node);
      if (event.key === "Escape" || event.key === "Tab") {
        if (open) setOpen(node, false);
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        if (!open && (event.key === "Home" || event.key === "End")) return;
        event.preventDefault();
        if (!open) {
          setOpen(node, true);
          const current = optionsOf(node).findIndex((option) => option.dataset.value === node.value);
          highlight(current === -1 ? 0 : current);
          return;
        }
        if (event.key === "Home") highlight(0);
        else if (event.key === "End") highlight(-1);
        else highlight(activeIndex() + (event.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && open) {
        event.preventDefault();
        const at = activeIndex();
        choose(at === -1 ? undefined : optionsOf(node)[at].dataset.value);
      }
    });
  }

  /** Lock or unlock a picker without touching its options. */
  function disable(node, flag) {
    node.disabled = Boolean(flag) || !(node._items || []).length;
    const button = node.querySelector(".picker-btn");
    if (button) button.disabled = node.disabled;
    if (node.disabled && isOpen(node)) setOpen(node, false);
    node._shape = null;
  }

  // --- collapse -------------------------------------------------------------

  const SETTLE_MS = 260;

  /** Expand or fold a `.collapse`. Clipping stops once the motion has finished. */
  function collapse(node, open) {
    const next = String(Boolean(open));
    if (node.dataset.open === next) return;
    node.dataset.open = next;
    delete node.dataset.settled;
    clearTimeout(node._settling);
    if (open) {
      node._settling = setTimeout(() => {
        node.dataset.settled = "true";
      }, SETTLE_MS);
    }
  }

  // --- progress text --------------------------------------------------------

  /**
   * Set a message. While `working`, its trailing ellipsis becomes animated dots,
   * so text that stays the same for a while still reads as alive.
   */
  function say(node, text, working = false) {
    const make = node.ownerDocument?.createElement?.bind(node.ownerDocument);
    if (!working || !text || !make || !node.append) {
      node.textContent = text;
      return;
    }
    node.textContent = String(text).replace(/\s*(…|\.\.\.)\s*$/, "");
    const dots = make("span");
    dots.className = "dots";
    dots.setAttribute("aria-hidden", "true");
    dots.innerHTML = "<i></i><i></i><i></i>";
    node.append(dots);
  }

  // --- mount ----------------------------------------------------------------

  /** Extension pages get the rules on the document; the panel inlines `css` itself. */
  function mount(doc = globalThis.document) {
    if (!doc?.head || doc.getElementById?.("clatri-kit")) return;
    const style = doc.createElement("style");
    style.id = "clatri-kit";
    style.textContent = css;
    doc.head.append(style);
  }

  // <script src="src/ui/kit.js" data-mount> in a page's head. A content script
  // has no currentScript, so the bank's document is never touched.
  if (globalThis.document?.currentScript?.dataset?.mount !== undefined) mount();

  globalThis.ClatriKit = Object.freeze({
    css,
    icons,
    escapeHtml,
    mount,
    collapse,
    say,
    picker: Object.freeze({ fill, wire, disable, setOpen, isOpen, closeOutside }),
  });
})();
