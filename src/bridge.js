/**
 * Isolated-world shim. The panel runs in the page's main world so it can see the
 * app's own fetch and XHR, but that world has no access to chrome.* APIs. This
 * script's only job is to hand the packed asset URLs over the DOM.
 */
(() => {
  "use strict";
  let captureAllowedUntil = 0;
  let preparation = Promise.resolve();
  let generation = 0;
  // Reloading or updating the extension orphans this script: chrome.runtime
  // throws from then on. Tell the panel once instead of failing in the console.
  const alive = () => { try { return Boolean(chrome.runtime?.id); } catch { return false; } };
  const allowCapture = event => {
    if (!event.isTrusted || event.target?.id !== 'clatri-root') return;
    // A real click in the bank panel can stage evidence; it cannot submit it.
    captureAllowedUntil = Date.now() + 180000;

  };
  document.addEventListener('click',allowCapture,true);
  document.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))allowCapture(event);},true);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if(!alive()) {
      if(['clatri-prepare-transfer','clatri-stage-transfer'].includes(event.data?.channel)) window.postMessage({channel:'clatri-transfer-staged',ok:false,reason:'updated'},location.origin);
      return;
    }
    if(event.data?.channel==='clatri-clear-transfer') {
      generation++;
      document.getElementById('clatri-root')?.shadowRoot?.getElementById('transfer-frame')?.remove();
      preparation=preparation.then(()=>chrome.runtime.sendMessage({type:'bank.clear'})).catch(()=>{});return;
    }
    if(Date.now() > captureAllowedUntil) {
      if(['clatri-prepare-transfer','clatri-stage-transfer'].includes(event.data?.channel)) window.postMessage({channel:'clatri-transfer-staged',ok:false},location.origin);
      return;
    }
    if(event.data?.channel==='clatri-csv-generated') {
      captureAllowedUntil=0;
      chrome.runtime.sendMessage({type:'bank.event',product:event.data.product}).catch(()=>{});return;
    }
    if (['clatri-prepare-transfer','clatri-stage-transfer'].includes(event.data?.channel)) {
      const version=generation;
      const preparing=event.data.channel==='clatri-prepare-transfer';
      if (!preparing) captureAllowedUntil = 0;
      const request=preparation.then(()=>chrome.runtime.sendMessage({type:preparing?'bank.prepare':'bank.stage',capture:event.data.capture}));
      preparation=request.catch(()=>{});
      request.then(response => {
        if(version!==generation)return;
        if(response?.ok && response.url) {
          const slot=document.getElementById('clatri-root')?.shadowRoot?.getElementById('transfer-slot');
          if(slot) {
            slot.replaceChildren();
            const frame=document.createElement('iframe');frame.id='transfer-frame';frame.src=response.url;
            frame.title=chrome.i18n?.getUILanguage?.().startsWith('es') ? 'Enviar a Clatri' : 'Send to Clatri';
            // Starts at the frame's minimum and eases to whatever height it reports.
            frame.style.cssText='width:calc(100% + 6px);margin:0 -3px;height:96px;border:0;display:block;transition:height .24s cubic-bezier(.2,.7,.2,1)';
            slot.append(frame);
          }
        }
        window.postMessage({channel:'clatri-transfer-staged',ok:response?.ok === true},location.origin);
      }).catch(()=>window.postMessage({channel:'clatri-transfer-staged',ok:false},location.origin));
    }
  });
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id!==chrome.runtime.id || message?.type!=='frame.resize' || !Number.isInteger(message.height))return;
    const frame=document.getElementById('clatri-root')?.shadowRoot?.getElementById('transfer-frame');
    if(frame)frame.style.height=Math.max(96,Math.min(2400,message.height))+'px';
  });
  try {
    document.documentElement.dataset.clatriLocale = chrome.i18n?.getUILanguage?.() || navigator.language || "en";
    document.documentElement.dataset.clatriLogo = chrome.runtime.getURL("icons/icon-128.png");
  } catch {}
})();
