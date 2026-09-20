export function isTrustedPanel(sender, runtime) {
  return sender?.id === runtime.id && !sender.tab && sender.url === runtime.getURL('sidepanel.html');
}

export async function handleAuthMessage(message, controller) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('invalid_message');
  const fields = { 'auth.status': ['type'], 'auth.signIn': ['type', 'provider'],
    'auth.signOut': ['type'], 'auth.verifyMfa': ['type', 'code'] }[message.type];
  if (!fields || Object.keys(message).some(k => !fields.includes(k))) throw new Error('invalid_message');
  switch (message.type) {
    case 'auth.status': return controller.status();
    case 'auth.signIn': return controller.signIn(message.provider);
    case 'auth.signOut': return controller.signOut();
    case 'auth.verifyMfa': return controller.verifyMfa(message.code);
  }
}
