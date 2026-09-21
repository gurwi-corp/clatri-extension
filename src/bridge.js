/**
 * Isolated-world shim. The panel runs in the page's main world so it can see the
 * app's own fetch and XHR, but that world has no access to chrome.* APIs. This
 * script's only job is to hand the packed asset URLs over the DOM.
 */
(() => {
  "use strict";
  let captureAllowedUntil = 0;
  document.addEventListener('click', event => {
    if (!event.isTrusted || event.target?.id !== 'clatri-root') return;
    // A real click in the bank panel can stage evidence; it cannot submit it.
    captureAllowedUntil = Date.now() + 180000;
    if (event.composedPath().some(node => node.id === 'sendClatri')) chrome.runtime.sendMessage({type:'bank.open'}).catch(()=>{});
  }, true);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || Date.now() > captureAllowedUntil) return;
    if (event.data?.channel === 'clatri-stage-transfer') {
      captureAllowedUntil = 0;
      chrome.runtime.sendMessage({type:'bank.stage',capture:event.data.capture}).then(response => {
        window.postMessage({channel:'clatri-transfer-staged',ok:response?.ok === true},location.origin);
      }).catch(()=>window.postMessage({channel:'clatri-transfer-staged',ok:false},location.origin));
    }
  });
  try {
    document.documentElement.dataset.clatriLocale = chrome.i18n?.getUILanguage?.() || navigator.language || "en";
    document.documentElement.dataset.clatriLogo = chrome.runtime.getURL("icons/icon-128.png");
  } catch {}
})();
