// Builds the static app into dist/. `node build.mjs --serve` also serves it on :5173.
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

// Google sign-in client ID for Drive sync (set LARK_GOOGLE_CLIENT_ID in Render → Environment).
const define = { __GOOGLE_CLIENT_ID__: JSON.stringify((process.env.LARK_GOOGLE_CLIENT_ID || '').trim()) };
const common = { bundle: true, minify: true, format: 'esm', target: 'es2022', legalComments: 'none', loader: { '.svg': 'text' }, define };
await esbuild.build({ ...common, entryPoints: { app: 'src/js/main.js', 'import-worker': 'src/js/import-worker.js' }, outdir: out });
await esbuild.build({ ...common, entryPoints: ['src/styles.css'], outfile: join(out, 'styles.css'), external: ['fonts/*'] });

const fontDir = 'node_modules/@fontsource-variable/figtree/files';
for (const f of ['figtree-latin-wght-normal.woff2', 'figtree-latin-ext-wght-normal.woff2']) cpSync(join(fontDir, f), join(out, 'fonts', f));
cpSync('src/icons', join(out, 'icons'), { recursive: true });
cpSync('src/index.html', join(out, 'index.html'));
for (const f of ['privacy.html', 'terms.html']) cpSync(join('src', f), join(out, f));
cpSync('src/manifest.webmanifest', join(out, 'manifest.webmanifest'));

// Everything in dist/ is precached by the service worker; the version changes whenever any file changes.
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else files.push(relative(out, p).split('\\').join('/'));
  }
})(out);
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest('hex').slice(0, 12);
const assets = ['./', ...files.filter((f) => f !== 'index.html').map((f) => './' + f)];
await esbuild.build({
  ...common, entryPoints: ['src/sw.js'], outfile: join(out, 'sw.js'),
  define: { ...define, __VERSION__: JSON.stringify(version), __ASSETS__: JSON.stringify(assets) },
});
console.log(`built ${files.length + 1} files, version ${version}`);

if (process.argv.includes('--serve')) await import('./scripts/serve.mjs');
