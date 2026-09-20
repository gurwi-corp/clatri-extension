import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createAuthController } from '../src/auth/controller.js';
import { createTrustedStorage } from '../src/auth/storage.js';

function infrastructure() {
  const values = {}; const calls = []; let trusted = false;
  const storageApi = {
    setAccessLevel: async () => { trusted = true; },
    get: async key => { assert.ok(trusted); return key ? { [key]: values[key] } : { ...values }; },
    set: async data => { assert.ok(trusted); Object.assign(values, data); },
    remove: async keys => { for (const key of [].concat(keys)) delete values[key]; },
  };
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'ana@example.test', factors: [], app_metadata: { provider: 'google' }, user_metadata: {} };
  const session = () => ({ access_token: ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, aal: 'aal1', amr: [], role: 'authenticated' })).toString('base64url'), 'c2lnbmF0dXJl'].join('.'), refresh_token: 'synthetic-refresh', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer', user, provider_token: 'unused-google-token' });
  const fetch = async (input, options = {}) => {
    const url = new URL(input); calls.push({ path: url.pathname, grant: url.searchParams.get('grant_type'), body: options.body ? JSON.parse(options.body) : null });
    if (url.pathname === '/auth/v1/token') return new Response(JSON.stringify(session()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    throw new Error('Unexpected auth network path');
  };
  return { values, calls, user, session, fetch, chrome: { storage: { local: storageApi } } };
}
function client(storage, fetch) {
  return createClient('https://auth.example.test', 'sb_publishable_synthetic', {
    global: { fetch }, auth: { storage, storageKey: 'clatri-auth', flowType: 'pkce', persistSession: true, detectSessionInUrl: false, autoRefreshToken: false },
  });
}

test('real Supabase SDK persists PKCE, exchanges the matching verifier and removes provider credentials', async () => {
  const f = infrastructure(); const storage = await createTrustedStorage(f.chrome); const sdk = client(storage, f.fetch);
  const identity = {
    getRedirectURL: path => `https://extension.chromiumapp.org/${path}`,
    launchWebAuthFlow: async ({ url }) => {
      const authorize = new URL(url);
      assert.equal(authorize.searchParams.get('code_challenge_method'), 's256');
      assert.ok(f.values['clatri-auth-code-verifier']);
      const callback = new URL(authorize.searchParams.get('redirect_to'));
      callback.searchParams.set('code', 'synthetic-code'); return callback.href;
    },
  };
  const controller = createAuthController({ auth: sdk.auth, identity, storage, authOrigin: 'https://auth.example.test' });
  const result = await controller.signIn('google');
  assert.equal(result.user.email, 'ana@example.test');
  const exchange = f.calls.find(c => c.grant === 'pkce');
  assert.equal(exchange.body.auth_code, 'synthetic-code');
  assert.ok(exchange.body.code_verifier);
  assert.equal('clatri-auth-code-verifier' in f.values, false);
  assert.equal(JSON.parse(f.values['clatri-auth']).provider_token, undefined);
  assert.equal(JSON.stringify(result).includes('synthetic-refresh'), false);
  await controller.signOut(); assert.equal('clatri-auth' in f.values, false);
});

test('worker restart refreshes an expired persisted session exactly once for concurrent status reads', async () => {
  const f = infrastructure(); const storage = await createTrustedStorage(f.chrome);
  const expired = f.session(); expired.expires_at = Math.floor(Date.now()/1000)-20;
  await storage.setItem('clatri-auth', JSON.stringify(expired));
  const sdk = client(storage, f.fetch);
  const controller = createAuthController({ auth: sdk.auth, storage, identity: {}, authOrigin: 'https://auth.example.test' });
  const results = await Promise.all([controller.status(), controller.status()]);
  assert.ok(results.every(r => r.status === 'signed_in'));
  assert.equal(f.calls.filter(c => c.grant === 'refresh_token').length, 1);
  assert.ok(JSON.parse(f.values['clatri-auth']).expires_at > Date.now()/1000);
});
