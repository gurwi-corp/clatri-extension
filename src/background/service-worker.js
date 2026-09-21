import { createClient } from '@supabase/supabase-js';
import config from '../../config/public.json';
import { createTrustedStorage } from '../auth/storage.js';
import { createAuthController, AuthError } from '../auth/controller.js';
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

// Register synchronously so Chrome can wake a suspended worker for a message.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (isBankSender(sender, chrome.runtime)) {
    if (message?.type === 'bank.open') { chrome.sidePanel.open({tabId:sender.tab.id}).catch(()=>{}); reply({ok:true}); return false; }
    if (message?.type === 'bank.stage') { transfer.stage(message.capture,sender.tab.id).then(()=>reply({ok:true}),()=>reply({ok:false})); return true; }
    return false;
  }
  if (!isTrustedPanel(sender, chrome.runtime)) return false;
  (async () => {
    try { reply({ ok: true, result: message?.type?.startsWith('transfer.') ? await transfer.handle(message) : await handleAuthMessage(message, await getController()) }); }
    catch (error) { reply({ ok: false, error: error instanceof AuthError ? error.code : ['sign_in_required','capture_changed','invalid_destination','destination_conflict','import_busy','import_unavailable'].includes(error.message) ? error.message : 'auth_unavailable' }); }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId,change) => { if(change.status === 'loading') chrome.storage.session.remove('capture:' + tabId).catch(()=>{}); });
chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove('capture:' + tabId).catch(()=>{}); });
