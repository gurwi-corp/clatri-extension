import { createClient } from '@supabase/supabase-js';
import config from '../../config/public.json';
import { createTrustedStorage } from '../auth/storage.js';
import { createAuthController, AuthError } from '../auth/controller.js';
import { isTrustedPanel, handleAuthMessage } from './messages.js';

let controller;
function getController() {
  if (!controller) controller = (async () => {
    const storage = await createTrustedStorage(chrome);
    const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        storage, storageKey: 'clatri-auth', flowType: 'pkce',
        persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      },
    });
    return createAuthController({ auth: client.auth, storage, identity: chrome.identity,
      authOrigin: new URL(config.supabaseUrl).origin });
  })().catch(error => { controller = null; throw error; });
  return controller;
}

// Register synchronously so Chrome can wake a suspended worker for a message.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!isTrustedPanel(sender, chrome.runtime)) return false;
  if (message?.type === 'auth.configuration') {
    reply({ ok: true, result: { redirectUrl: chrome.identity.getRedirectURL('auth/callback') + String.raw`\?attempt=*` } });
    return false;
  }
  (async () => {
    try { reply({ ok: true, result: await handleAuthMessage(message, await getController()) }); }
    catch (error) { reply({ ok: false, error: error instanceof AuthError ? error.code : 'auth_unavailable' }); }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
