// A page can stage bank evidence, but only a scoped extension-origin frame
// may access Clatri destinations. Tokens never cross this runtime boundary.
export function createBankFrames(chrome) {
  const key=id=>'bank-frame:'+id;
  return {
    async grant(tabId) {
      const token=crypto.randomUUID();
      await chrome.storage.session.set({[key(tabId)]:{token,expires:Date.now()+600000}});
      return chrome.runtime.getURL('bank-transfer.html')+'?token='+token;
    },
    async accepts(sender) {
      if(sender?.id!==chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !(sender.frameId>0)) return false;
      const grant=(await chrome.storage.session.get(key(sender.tab.id)))[key(sender.tab.id)];
      return !!grant && grant.expires>Date.now() && sender.url===chrome.runtime.getURL('bank-transfer.html')+'?token='+grant.token;
    },
    async clear(tabId) {await chrome.storage.session.remove([key(tabId),'capture:'+tabId]);},
  };
}
