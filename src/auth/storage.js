/** Only the service worker creates this adapter. Never expose it to MAIN. */
export async function createTrustedStorage(chrome) {
  const local = chrome.storage.local;
  await local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const owned = key => key === 'clatri-auth' || key.startsWith('clatri-auth-');
  return {
    async getItem(key) { return (await local.get(key))[key] ?? null; },
    async setItem(key, value) {
      // We need Supabase credentials, never the provider's Google/Apple tokens.
      if (key === 'clatri-auth') {
        const session = JSON.parse(value);
        delete session.provider_token;
        delete session.provider_refresh_token;
        value = JSON.stringify(session);
      }
      await local.set({ [key]: value });
    },
    async removeItem(key) { await local.remove(key); },
    async clear() {
      const values = await local.get(null);
      await local.remove(Object.keys(values).filter(owned));
    },
  };
}
