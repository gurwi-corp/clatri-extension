/**
 * Isolated-world shim. The panel runs in the page's main world so it can see the
 * app's own fetch and XHR, but that world has no access to chrome.* APIs. This
 * script's only job is to hand the packed asset URLs over the DOM.
 */
(() => {
  "use strict";
  try {
    document.documentElement.dataset.clatriLogo = chrome.runtime.getURL("icons/icon-128.png");
  } catch {}
})();
