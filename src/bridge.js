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

  }, true);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if(event.data?.channel==='clatri-clear-transfer') {
      document.getElementById('clatri-root')?.shadowRoot?.getElementById('transfer-frame')?.remove();
      chrome.runtime.sendMessage({type:'bank.clear'}).catch(()=>{});return;
    }
    if(Date.now() > captureAllowedUntil) return;
    if(event.data?.channel==='clatri-csv-generated') {
      captureAllowedUntil=0;
      chrome.runtime.sendMessage({type:'bank.event',product:event.data.product}).catch(()=>{});return;
    }
    if (event.data?.channel === 'clatri-stage-transfer') {
      captureAllowedUntil = 0;
      chrome.runtime.sendMessage({type:'bank.stage',capture:event.data.capture}).then(response => {
        if(response?.ok && response.url) {
          const slot=document.getElementById('clatri-root')?.shadowRoot?.getElementById('transfer-slot');
          if(slot) {
            slot.replaceChildren();
            const frame=document.createElement('iframe');frame.id='transfer-frame';frame.src=response.url;
            frame.title=chrome.i18n?.getUILanguage?.().startsWith('es') ? 'Enviar a Clatri' : 'Send to Clatri';
            frame.style.cssText='width:100%;height:510px;border:0;display:block;border-radius:12px';
            slot.append(frame);slot.scrollIntoView({block:'nearest',behavior:'smooth'});
          }
        }
        window.postMessage({channel:'clatri-transfer-staged',ok:response?.ok === true},location.origin);
      }).catch(()=>window.postMessage({channel:'clatri-transfer-staged',ok:false},location.origin));
    }
  });
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id!==chrome.runtime.id || message?.type!=='frame.resize' || !Number.isInteger(message.height))return;
    const frame=document.getElementById('clatri-root')?.shadowRoot?.getElementById('transfer-frame');
    if(frame)frame.style.height=Math.max(200,Math.min(900,message.height))+'px';
  });
  try {
    document.documentElement.dataset.clatriLocale = chrome.i18n?.getUILanguage?.() || navigator.language || "en";
    document.documentElement.dataset.clatriLogo = chrome.runtime.getURL("icons/icon-128.png");
  } catch {}
})();
