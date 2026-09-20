import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthController, AuthError } from '../src/auth/controller.js';
import { createTrustedStorage } from '../src/auth/storage.js';
import { isTrustedPanel } from '../src/background/messages.js';

function fixture(overrides = {}) {
  const redirect = 'https://extension.chromiumapp.org/auth/callback';
  const calls = [];
  let session = null;
  const chrome = {
    identity: { getRedirectURL: () => redirect, launchWebAuthFlow: async ({ url }) => {
      const callback = new URL(new URL(url).searchParams.get('redirect_to'));
      callback.searchParams.set('code', 'one-time-code');
      return callback.href;
    } },
  };
  const user = { id: 'user-a', email: 'ana@example.test', user_metadata: { private: 'not-for-ui' } };
  const auth = {
    signInWithOAuth: async ({ provider, options }) => {
      calls.push(['oauth', provider, options]);
      return { data: { url: `https://auth.example.test/auth/v1/authorize?redirect_to=${encodeURIComponent(options.redirectTo)}` }, error: null };
    },
    exchangeCodeForSession: async (code) => {
      calls.push(['exchange', code]); session = { user, access_token: 'secret', refresh_token: 'refresh-secret' };
      return { data: { session }, error: null };
    },
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    signOut: async () => { session = null; calls.push(['logout']); return { error: null }; },
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }) },
    ...overrides,
  };
  const storage = { clear: async () => { calls.push(['clear']); session = null; } };
  const controller = createAuthController({ auth, identity: chrome.identity, storage, authOrigin: 'https://auth.example.test', randomId: () => 'attempt-123' });
  return { controller, auth, chrome, calls, redirect };
}

test('Google and Apple exchange a PKCE code and expose only a verified profile', async () => {
  for (const provider of ['google', 'apple']) {
    const f = fixture();
    assert.deepEqual(await f.controller.signIn(provider), { status: 'signed_in', user: { id: 'user-a', email: 'ana@example.test' } });
    assert.equal(f.calls[0][2].skipBrowserRedirect, true);
    assert.equal(f.calls[1][1], 'one-time-code');
  }
});

test('invalid, stale and implicit callbacks cannot create a session', async () => {
  for (const callback of [
    'https://evil.test/auth/callback?code=x&attempt=attempt-123',
    'https://extension.chromiumapp.org/other?code=x&attempt=attempt-123',
    'https://extension.chromiumapp.org/auth/callback?code=x&attempt=old',
    'https://extension.chromiumapp.org/auth/callback?attempt=attempt-123#access_token=secret',
    'https://extension.chromiumapp.org/auth/callback?code=x&code=y&attempt=attempt-123',
    'https://extension.chromiumapp.org/auth/callback?code=x&attempt=attempt-123#extra',
  ]) {
    const f = fixture(); f.chrome.identity.launchWebAuthFlow = async () => callback;
    await assert.rejects(f.controller.signIn('google'), AuthError);
    assert.equal(f.calls.some(([type]) => type === 'exchange'), false);
  }
});

test('unsupported providers and an unexpected authorize origin are refused', async () => {
  const f = fixture({ signInWithOAuth: async () => ({ data: { url: 'https://evil.test' } }) });
  await assert.rejects(f.controller.signIn('facebook'), AuthError);
  await assert.rejects(f.controller.signIn('google'), AuthError);
});

test('cancellation is safe to retry and does not leak provider error text', async () => {
  const f = fixture(); const launch = f.chrome.identity.launchWebAuthFlow;
  f.chrome.identity.launchWebAuthFlow = async () => { throw new Error('secret in provider error'); };
  await assert.rejects(f.controller.signIn('google'), e => e.code === 'oauth_cancelled' && !e.message.includes('secret'));
  f.chrome.identity.launchWebAuthFlow = launch;
  assert.equal((await f.controller.signIn('apple')).status, 'signed_in');
});

test('logout during an OAuth window prevents a late callback from signing back in', async () => {
  const f = fixture(); let respond;
  f.chrome.identity.launchWebAuthFlow = () => new Promise(resolve => { respond = resolve; });
  const login = f.controller.signIn('google');
  await new Promise(resolve => setImmediate(resolve));
  await f.controller.signOut();
  respond(`${f.redirect}?attempt=attempt-123&code=late`);
  await assert.rejects(login, e => e.code === 'oauth_cancelled');
  assert.equal(f.calls.some(([type]) => type === 'exchange'), false);
  assert.deepEqual(await f.controller.status(), { status: 'signed_out' });
});

test('concurrent login is rejected before a second verifier is generated', async () => {
  const f = fixture(); let respond;
  f.chrome.identity.launchWebAuthFlow = () => new Promise(resolve => { respond = resolve; });
  const first = f.controller.signIn('google');
  await assert.rejects(f.controller.signIn('apple'), e => e.code === 'auth_busy');
  await new Promise(resolve => setImmediate(resolve));
  respond(`${f.redirect}?attempt=attempt-123&code=ok`); await first;
  assert.equal(f.calls.filter(([type]) => type === 'oauth').length, 1);
});

test('session status validates the user remotely and propagates MFA requirement', async () => {
  const f = fixture(); await f.controller.signIn('google');
  f.auth.mfa.getAuthenticatorAssuranceLevel = async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });
  assert.equal((await f.controller.status()).status, 'mfa_required');
  f.auth.getUser = async () => ({ data: { user: null }, error: { status: 503 } });
  await assert.rejects(f.controller.status(), e => e.code === 'auth_unavailable');
  assert.equal(f.calls.some(([type]) => type === 'clear'), false);
});

test('logout removes local secrets even when server revocation fails', async () => {
  const f = fixture({ signOut: async () => ({ error: new Error('network') }) });
  await f.controller.signIn('google');
  const result = await f.controller.signOut();
  assert.equal(result.revocation_pending, true);
  assert.equal(f.calls.filter(([type]) => type === 'clear').length, 1);
});

test('storage restricts access before reading or writing any credential', async () => {
  const calls = []; const values = { 'clatri-auth-token': 'token', unrelated: 'keep' };
  const chrome = { storage: { local: {
    setAccessLevel: async opts => calls.push(opts.accessLevel),
    get: async key => { calls.push('read'); return key ? { [key]: values[key] } : { ...values }; },
    set: async obj => { calls.push('write'); Object.assign(values, obj); },
    remove: async keys => { for (const key of [].concat(keys)) delete values[key]; },
  } } };
  const storage = await createTrustedStorage(chrome);
  await storage.setItem('clatri-auth-code-verifier', 'verifier');
  await storage.clear();
  assert.equal(calls[0], 'TRUSTED_CONTEXTS');
  assert.deepEqual(values, { unrelated: 'keep' });
});

test('a page or a content script cannot call authentication operations', () => {
  const runtime = { id: 'extension-id', getURL: p => `chrome-extension://extension-id/${p}` };
  assert.equal(isTrustedPanel({ id: runtime.id, url: runtime.getURL('sidepanel.html') }, runtime), true);
  for (const sender of [
    { id: runtime.id, url: 'https://bancolombia.com/' },
    { id: 'other', url: runtime.getURL('sidepanel.html') },
    { id: runtime.id, url: runtime.getURL('sidepanel.html'), tab: { id: 1 } },
    { id: runtime.id, url: runtime.getURL('sidepanel.html') + '?spoof' },
  ]) assert.equal(isTrustedPanel(sender, runtime), false);
});

test('server-enrolled MFA is required even if the persisted session has older factors', async () => {
  const f = fixture(); await f.controller.signIn('google');
  f.auth.getUser = async () => ({ data: { user: { id: 'user-a', email: 'ana@example.test', factors: [{ status: 'verified' }] } }, error: null });
  assert.equal((await f.controller.status()).status, 'mfa_required');
});

test('a failed storage restriction prevents all session access', async () => {
  let reads = 0;
  const chrome = { storage: { local: {
    setAccessLevel: async () => { throw new Error('unavailable'); },
    get: async () => { reads += 1; return {}; },
  } } };
  await assert.rejects(createTrustedStorage(chrome));
  assert.equal(reads, 0);
});
