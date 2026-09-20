const byId = id => document.getElementById(id);
const messages = {
  oauth_cancelled: 'Se cerró el acceso. Puedes volver a intentarlo.',
  oauth_failed: 'No se pudo completar el acceso. Comprueba la URL de retorno en Supabase e inténtalo de nuevo.',
  oauth_unavailable: 'El proveedor no está disponible. Inténtalo de nuevo más tarde.',
  invalid_callback: 'El retorno de acceso no es válido. Comprueba la configuración de esta instalación.',
  auth_busy: 'Ya hay un acceso en curso. Completa o cierra esa ventana.',
  invalid_mfa: 'Comprueba el código e inténtalo de nuevo.',
  mfa_unavailable: 'No hay un autenticador compatible disponible. Gestiona la verificación desde Clatri.',
  auth_unavailable: 'No pudimos comprobar tu sesión. Revisa tu conexión e inténtalo de nuevo.',
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
  byId('email').textContent = result.user?.email || 'Tu cuenta de Clatri';
  byId('code').value = '';
  if (result.status === 'mfa_required') byId('code').focus();
  if (result.revocation_pending) notify('Sesión eliminada de esta extensión. Sin conexión no pudimos confirmar su revocación en el servidor.');
}
let running = false;
async function request(type, data = {}) {
  if (running) return;
  running = true; notify(); byId('retry').hidden = true;
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
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
    document.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}
for (const provider of ['google', 'apple']) byId(provider).addEventListener('click', () => request('auth.signIn', { provider }));
for (const id of ['logout', 'mfa-logout']) byId(id).addEventListener('click', () => request('auth.signOut'));
byId('mfa-form').addEventListener('submit', event => { event.preventDefault(); request('auth.verifyMfa', { code: byId('code').value }); });
byId('retry').addEventListener('click', () => request('auth.status'));
chrome.runtime.sendMessage({ type: 'auth.configuration' }).then(response => {
  if (response?.ok && byId('redirect')) byId('redirect').textContent = response.result.redirectUrl;
}).catch(() => {});
request('auth.status');
