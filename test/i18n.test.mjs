import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/core/i18n.js');

for (const [browser, navigatorLanguage, bridge, expected] of [
  ['es-CO', 'en-US', undefined, 'es'], ['es-ES', 'en', undefined, 'es'],
  ['es_419', 'en', undefined, 'es'], ['en-GB', 'es', undefined, 'en'],
  ['fr-FR', 'es', undefined, 'en'], [undefined, 'es-MX', undefined, 'es'],
  [undefined, 'en-US', 'es-CO', 'es'], [undefined, undefined, undefined, 'en'],
]) {
  test(`browser locale ${browser}, bridge ${bridge}, navigator ${navigatorLanguage} selects ${expected}`, () => {
    const context = vm.createContext({ chrome: { i18n: { getUILanguage: () => browser } }, navigator: { language: navigatorLanguage }, document: { documentElement: { dataset: { clatriLocale: bridge } } } });
    vm.runInContext(source, context);
    const { t, locale } = context.ClatriI18n;
    assert.equal(locale(), expected);
    assert.equal(t('Download {format}', { format: 'CSV' }), expected === 'es' ? 'Descargar CSV' : 'Download CSV');
    assert.equal(t('Continue with Google'), expected === 'es' ? 'Continuar con Google' : 'Continue with Google');
    assert.equal(t('CUSTOM BANK LABEL'), 'CUSTOM BANK LABEL');
  });
}

for (const language of ['es-CO', 'en-US']) {
  test(`side panel renders login, MFA and errors in ${language}`, async () => {
    const html = read('sidepanel.html');
    const translated = [...html.matchAll(/<span data-i18n>([^<]*)<\/span>/g)].map(match => ({ textContent: match[1] }));
    const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], { hidden: true, value: '', textContent: '', classList: { toggle() {} }, addEventListener() {}, focus() {} }]));
    let response = { ok: true, result: { status: 'signed_out' } };
    const document = { documentElement: { dataset: {} }, querySelectorAll: selector => selector === '[data-i18n]' ? translated : [], getElementById: id => { assert.ok(nodes[id], `Missing element ${id}`); return nodes[id]; } };
    const context = vm.createContext({ document, chrome: { i18n: { getUILanguage: () => language }, runtime: { sendMessage: async () => response } } });
    vm.runInContext(source, context);
    vm.runInContext(read('src/ui/sidepanel.js'), context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes.login.hidden, false);
    assert.equal(document.documentElement.lang, language.startsWith('es') ? 'es' : 'en');
    assert.ok(translated.some(node => node.textContent === (language.startsWith('es') ? 'Continuar con Google' : 'Continue with Google')));
    response = { ok: true, result: { status: 'mfa_required' } };
    await vm.runInContext('request("auth.status")', context);
    assert.equal(nodes.mfa.hidden, false);
    assert.equal(nodes.login.hidden, true);
    response = { ok: false, error: 'oauth_failed' };
    await vm.runInContext('request("auth.signIn", { provider: "google" })', context);
    assert.match(nodes.message.textContent, language.startsWith('es') ? /No se pudo completar/ : /couldn’t complete/);
    assert.equal(nodes.retry.hidden, false);
    assert.equal(nodes.message.textContent.includes('Supabase'), false);
  });
}
