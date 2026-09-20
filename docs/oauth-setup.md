# Clatri extension: Google and Apple access

Implementation date: 2026-09-20. This is a local development increment, not a
published extension release. Direct financial import is still disabled.

## What is actually used

The extension calls Supabase `signInWithOAuth`, opens its URL with
`chrome.identity.launchWebAuthFlow`, and exchanges the returned code using PKCE.
Google/Apple return to **Supabase**, which then returns to the extension.
There is no `chrome.identity.getAuthToken`, manifest `oauth2` client, or client
secret in the extension. Use Clatri's existing provider configuration rather
than copying Gurwi's credentials.

Read-only checks against Clatri Auth on 2026-09-20 found:

| Setting | Observed value |
| --- | --- |
| Auth domain | `https://db.clatri.com` |
| Supabase project | `ysbirgboyljjhkmvlyog` (Clatri) |
| Google and Apple providers | Both enabled in `/auth/v1/settings` |
| Google public OAuth client | `378115252129-9vffsa4uu20tfut3u69j49a9jd4qstp8.apps.googleusercontent.com` |
| Apple Services ID | `com.clatri.auth` |
| Callback sent to both providers | `https://db.clatri.com/auth/v1/callback` |

Provider initiation returned HTTP 302 to Google and Apple. This verifies the
configured public client and callback; it does **not** prove the provider secret
is current, that the extension redirect is allow-listed, or that user sign-in
has completed. No provider settings were changed and no real user login ran.

## Required return allow-list

In **Clatri** Supabase → Authentication → URL Configuration → Redirect URLs,
check/add the following patterns. Do not change the Site URL or remove the
existing Flutter/web entries.

Development build (`npm run build`):

```text
https://ohgojbhjdmgnpkomonfcmbefmmbhkpjl.chromiumapp.org/auth/callback\?attempt=*
```

Existing Chrome Web Store listing (`npm run build -- --store`):

```text
https://ieblkidehbbodoahabmfbcgbmbafokhc.chromiumapp.org/auth/callback\?attempt=*
```

These are **Supabase glob patterns**, not URLs to open. The backslash makes `?`
a literal query separator; `*` allows the random attempt identifier. Each host
belongs to one extension ID. The worker separately verifies the exact origin,
path, attempt and PKCE code, rejecting fragment tokens and stale callbacks.
The dev panel shows its own pattern for copying. Do not add a wildcard for all
`chromiumapp.org` subdomains. These patterns have been documented, not remotely
applied or tested through a real login.

## Google Cloud

Open the **web** OAuth client configured in Clatri Supabase Google settings. Its
Authorized redirect URIs must include:

```text
https://db.clatri.com/auth/v1/callback
```

No Chrome-extension-type Google client is needed for this brokered flow. A
separate unused client named “Gurwi Chrome Extension” therefore does not, by
itself, indicate a broken login. Gurwi's inspected code also uses Supabase's
OAuth flow; this does not establish which other deployments use that client.
Do not delete existing Google credentials based only on the warning.

## Apple Developer

Use the existing `com.clatri.auth` Services ID, associated with Clatri's primary
App ID. Its Sign in with Apple web configuration must allow `db.clatri.com` and
return URL `https://db.clatri.com/auth/v1/callback`.

Keep Apple's signing key and generated client secret exclusively in server-side
configuration. Check the OAuth client secret expiry in Supabase; Apple web
secrets expire after at most six months and require renewal. The extension
cannot check that secret's expiry from public settings. It does not need a new
Apple Services ID just because it is a Chrome extension.

## Load and verify

1. Use Node 22+, run `npm ci`, `npm test`, then `npm run build`.
2. In Chrome's extension developer mode, load **dist/**. Its public development
   key keeps the unpacked ID stable across rebuilds/machines. Never load the
   repository root: that worker contains build-time imports.
3. Pin Clatri and open its side panel. Try Google and Apple with the user's own
   account. Complete any provider consent/MFA interactively; never share a
   password, code, token or browser trace.
4. Verify email, closing/reopening the panel, MFA if enrolled, cancellation,
   expiry/refresh and logout. The SDK refreshes a persisted session on demand;
   a single service worker owns it. Other Clatri sessions are not signed out.
5. If redirected to the website instead of Chrome, check the allow-list against
   the exact ID and query pattern shown in the dev panel. If the provider says
   `redirect_uri_mismatch`/`invalid_client`, check its web callback/client secret.

The side panel renders only verified profile fields. Tokens never appear in
messages to the panel or in the bank page. Storage is limited to trusted
contexts before it is accessed; provider Google/Apple tokens are not persisted.
Logout clears local credentials even if network revocation fails, and reports
that distinction. Storage restriction is not encryption against device malware.

## Next implementation stages

The API has initial closed observation contracts, conservative identity helpers,
and a separate Supabase user-JWT dependency in the Clatri worktree. They are not
yet exposed as financial import endpoints. Durable jobs, bindings, atomic
materialization, LLM categorization, historical FX, capture-to-API transport,
Flutter/web account detail integration and Gurwi Analytics remain pending.
Do not turn on a send-transactions button before those stages are validated.

## References

- [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Apple OAuth](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Supabase redirect URL globs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
