import { createClient } from '@supabase/supabase-js';
import config from '../../config/public.json';
import { createTrustedStorage } from '../auth/storage.js';
import { createAuthController, AuthError } from '../auth/controller.js';
import { createBankFrames } from './bank-frame.js';
import { createTransfer, isBankSender } from './transfer.js';
import { isTrustedPanel, handleAuthMessage } from './messages.js';

let controller;
let authClient;
function getController() {
  if (!controller) controller = (async () => {
    const storage = await createTrustedStorage(chrome);
    const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        storage, storageKey: 'clatri-auth', flowType: 'pkce',
        persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      },
    });
    authClient = client;
    return createAuthController({ auth: client.auth, storage, identity: chrome.identity,
      authOrigin: new URL(config.supabaseUrl).origin });
  })().catch(error => { controller = null; throw error; });
  return controller;
}

const transfer = createTransfer({ chrome, apiBase: config.apiBase, getClient: async () => { await getController(); return authClient; } });

const bankFrames=createBankFrames(chrome);

// Register synchronously so Chrome can wake a suspended worker for a message.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (isBankSender(sender, chrome.runtime)) {
    if (message?.type === 'bank.clear') { bankFrames.clear(sender.tab.id).then(()=>reply({ok:true})); return true; }
    if (message?.type === 'bank.event' && ['card','deposit'].includes(message.product)) {transfer.usage('csv_generated',message.product);reply({ok:true});return false;}
    if (message?.type === 'bank.prepare') {
      (async()=>{try {await transfer.prepare(message.capture,sender.tab.id);const url=await bankFrames.grant(sender.tab.id);reply({ok:true,url});}catch{reply({ok:false});}})();return true;
    }
    if (message?.type === 'bank.stage') {
      (async()=>{try {await transfer.stage(message.capture,sender.tab.id);reply({ok:true});transfer.usage('bank_used',message.capture.product);}catch{reply({ok:false});}})(); return true;
    }
    return false;
  }
  (async () => {
    const bankView=await bankFrames.accepts(sender);
    if(!bankView && !isTrustedPanel(sender,chrome.runtime)) {reply({ok:false});return;}
    try {
      if(bankView && message?.type==='frame.resize' && Number.isInteger(message.height) && message.height>=200 && message.height<=900) {
        await chrome.tabs.sendMessage(sender.tab.id,{type:'frame.resize',height:message.height},{frameId:0});reply({ok:true});return;
      }
      if(message?.type==='usage.active') {await transfer.usage('active');reply({ok:true});return;}
      if(message?.type?.startsWith('transfer.') && !bankView) {reply({ok:false});return;}
      reply({ ok: true, result: message?.type?.startsWith('transfer.') ? await transfer.handle(message,sender.tab.id) : await handleAuthMessage(message, await getController()) }); }
    catch (error) { reply({ ok: false, error: error instanceof AuthError ? error.code : ['sign_in_required','capture_changed','invalid_destination','destination_conflict','import_busy','import_unavailable'].includes(error.message) ? error.message : 'auth_unavailable' }); }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId,change) => { if(change.status === 'loading') bankFrames.clear(tabId).catch(()=>{}); });
chrome.tabs.onRemoved.addListener(tabId => { bankFrames.clear(tabId).catch(()=>{}); });
