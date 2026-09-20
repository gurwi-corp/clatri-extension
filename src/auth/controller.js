export class AuthError extends Error {
  constructor(code) { super(code); this.name = 'AuthError'; this.code = code; }
}

/** Single worker owns refresh, PKCE and logout; callers receive no tokens. */
export function createAuthController({ auth, identity, storage, authOrigin, randomId = () => crypto.randomUUID() }) {
  let busy = false;
  let generation = 0;

  async function status() {
    const ownGeneration = generation;
    const { data, error } = await auth.getSession();
    if (error) throw new AuthError('auth_unavailable');
    if (!data.session) return { status: 'signed_out' };
    const verified = await auth.getUser();
    if (verified.error || !verified.data.user) {
      if ([401, 403].includes(verified.error?.status)) {
        await storage.clear();
        return { status: 'signed_out' };
      }
      throw new AuthError('auth_unavailable');
    }
    const assurance = await auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || !assurance.data) throw new AuthError('auth_unavailable');
    if (ownGeneration !== generation) return { status: 'signed_out' };
    const enrolled = verified.data.user.factors?.some(factor => factor.status === 'verified');
    return {
      status: (enrolled || assurance.data.nextLevel === 'aal2') && assurance.data.currentLevel !== 'aal2' ? 'mfa_required' : 'signed_in',
      user: { id: verified.data.user.id, email: verified.data.user.email ?? null },
    };
  }

  async function signOut() {
    generation += 1;
    let revoked = false;
    try { revoked = !(await auth.signOut({ scope: 'local' })).error; }
    catch { /* Local removal still happens offline. */ }
    finally { await storage.clear(); }
    return { status: 'signed_out', revocation_pending: !revoked };
  }

  async function signIn(provider) {
    if (!['google', 'apple'].includes(provider)) throw new AuthError('unsupported_provider');
    if (busy) throw new AuthError('auth_busy');
    busy = true;
    const ownGeneration = generation;
    const ensureCurrent = () => { if (ownGeneration !== generation) throw new AuthError('oauth_cancelled'); };
    try {
      const redirect = new URL(identity.getRedirectURL('auth/callback'));
      const attempt = randomId();
      redirect.searchParams.set('attempt', attempt);
      const { data, error } = await auth.signInWithOAuth({ provider, options: {
        redirectTo: redirect.href, skipBrowserRedirect: true,
      } });
      if (error || !data?.url) throw new AuthError('oauth_unavailable');
      const authorize = new URL(data.url);
      if (authorize.username || authorize.password || authorize.origin !== authOrigin || authorize.pathname !== '/auth/v1/authorize') throw new AuthError('invalid_callback');
      ensureCurrent();
      let response;
      try { response = await identity.launchWebAuthFlow({ url: authorize.href, interactive: true }); }
      catch { throw new AuthError('oauth_cancelled'); }
      ensureCurrent();
      const callback = new URL(response);
      const codes = callback.searchParams.getAll('code');
      if (callback.username || callback.password || callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.hash ||
          callback.searchParams.getAll('attempt').length !== 1 || callback.searchParams.get('attempt') !== attempt ||
          callback.searchParams.has('error') || codes.length !== 1 || !codes[0] || codes[0].length > 2048 ||
          callback.searchParams.has('access_token') || callback.searchParams.has('refresh_token')) {
        throw new AuthError('invalid_callback');
      }
      const exchanged = await auth.exchangeCodeForSession(codes[0]);
      // Logout may have happened while the network exchange was in flight.
      if (ownGeneration !== generation) { await signOut(); throw new AuthError('oauth_cancelled'); }
      if (exchanged.error || !exchanged.data?.session) throw new AuthError('oauth_failed');
      return await status();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('oauth_failed');
    } finally {
      try { await storage.removeItem?.('clatri-auth-code-verifier'); }
      finally { busy = false; }
    }
  }

  async function verifyMfa(code) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new AuthError('invalid_mfa');
    if (busy) throw new AuthError('auth_busy');
    busy = true;
    const ownGeneration = generation;
    try {
      const factors = await auth.mfa.listFactors();
      const factor = factors.data?.totp?.find(f => f.status === 'verified');
      if (factors.error || !factor) throw new AuthError('mfa_unavailable');
      if (ownGeneration !== generation) throw new AuthError('oauth_cancelled');
      const result = await auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (ownGeneration !== generation) { await signOut(); throw new AuthError('oauth_cancelled'); }
      if (result.error) throw new AuthError('invalid_mfa');
      return await status();
    } finally { busy = false; }
  }

  return { status, signIn, signOut, verifyMfa };
}
