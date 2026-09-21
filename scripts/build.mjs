import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
const config = JSON.parse(await readFile(resolve(root, 'config/public.json'), 'utf8'));
const origin = new URL(config.supabaseUrl);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || !config.supabasePublishableKey.startsWith('sb_publishable_')) throw new Error('Only a public Supabase HTTPS configuration is allowed');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const path of ['src', 'icons', '_locales', 'sidepanel.html']) await cp(resolve(root, path), resolve(out, path), { recursive: true });
// Build the worker with dependencies bundled locally. Never load remote code.
await build({ entryPoints: [resolve(root, 'src/background/service-worker.js')], outfile: resolve(out, 'src/background/service-worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome116', minify: false });
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
manifest.host_permissions = [`${origin.origin}/*`, `${new URL(config.apiBase).origin}/*`];
if (!process.argv.includes('--store')) {
  const dev = JSON.parse(await readFile(resolve(root, 'config/development-key.json'), 'utf8'));
  manifest.key = dev.publicKey;
}
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const id = manifest.key ? createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16))) : 'ieblkidehbbodoahabmfbcgbmbafokhc';
console.log(`Built dist/ (${process.argv.includes('--store') ? 'store' : 'development'}). Supabase redirect: https://${id}.chromiumapp.org/auth/callback${String.raw`\?attempt=*`}`);
