const { t, locale } = globalThis.ClatriI18n;
document.documentElement.lang = locale();
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.textContent);
const byId = id => document.getElementById(id);
const messages = {
  oauth_cancelled: t("Sign-in was closed. You can try again."),
  oauth_failed: t("We couldn’t complete sign-in. Please try again."),
  oauth_unavailable: t("The provider is unavailable. Please try again later."),
  invalid_callback: t("We couldn’t verify this sign-in. Please start again."),
  auth_busy: t("Sign-in is already in progress. Complete or close that window."),
  invalid_mfa: t("Check the code and try again."),
  mfa_unavailable: t("No supported authenticator is available. Manage verification in Clatri."),
  auth_unavailable: t("We couldn’t check your session. Check your connection and try again."),
};
function notify(message = '', error = false) {
  byId('message').textContent = message; byId('message').hidden = !message;
  byId('message').classList.toggle('error', error);
}
function render(result) {
  byId('loading').hidden = true;
  byId('login').hidden = result.status !== 'signed_out';
  byId('account').hidden = result.status !== 'signed_in';
  byId('mfa').hidden = result.status !== 'mfa_required';
  byId('email').textContent = result.user?.email || t("Your Clatri account");
  byId('code').value = '';
  globalThis.ClatriTransfer?.authChanged(result.status === 'signed_in');
  if(result.status==='signed_in') chrome.runtime.sendMessage({type:'usage.active'}).catch(()=>{});
  if (result.status === 'mfa_required') byId('code').focus();
  if (result.revocation_pending) notify(t("Signed out of this extension. Without a connection, we couldn’t confirm revocation on the server."));
}
let running = false;
async function request(type, data = {}) {
  if (running) return;
  running = true; notify(); byId('retry').hidden = true;
  document.querySelectorAll('button').forEach(button => { if (!button.closest('.transfer')) button.disabled = true; });
  try {
    const response = await chrome.runtime.sendMessage({ type, ...data });
    if (!response?.ok) throw new Error(response?.error || 'auth_unavailable');
    render(response.result);
  } catch (error) {
    byId('loading').hidden = true;
    notify(messages[error.message] || messages.auth_unavailable, true);
    byId('retry').hidden = false;
  } finally {
    running = false;
    document.querySelectorAll('button').forEach(button => { if (!button.closest('.transfer')) button.disabled = false; });
  }
}
for (const provider of ['google', 'apple']) byId(provider).addEventListener('click', () => request('auth.signIn', { provider }));
for (const id of ['logout', 'mfa-logout']) byId(id).addEventListener('click', () => request('auth.signOut'));
byId('mfa-form').addEventListener('submit', event => { event.preventDefault(); request('auth.verifyMfa', { code: byId('code').value }); });
byId('retry').addEventListener('click', () => request('auth.status'));
request('auth.status');

// Only extension runtime carries layout messages; no profile or destinations
// are posted into the bank's window messaging channel.
if (document.body?.classList.contains('bank-view')) {
  let lastHeight=0;
  new ResizeObserver(()=>{
    const height=Math.min(900,Math.max(200,Math.ceil(document.body.scrollHeight)));
    if(height===lastHeight)return;lastHeight=height;
    chrome.runtime.sendMessage({type:'frame.resize',height}).catch(()=>{});
  }).observe(document.body);
}
