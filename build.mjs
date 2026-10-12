// Voile — construction du site. Aucune dépendance : Node uniquement.
// Produit dans site/ : voile.js (non minifié, lisible pour l'audit), sw.js, voile-hors-ligne.html, SHA256SUMS.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const sha256 = (s, enc = 'hex') => createHash('sha256').update(s).digest(enc);

const ORDER = ['csv', 'patterns', 'detect', 'vault', 'crypto', 'xlsx', 'ui', 'app-mask', 'app-restore', 'main'];
const parts = ORDER.filter((n) => existsSync(join(root, 'src', n + '.js'))).map((n) => `/* ---- src/${n}.js ---- */\n` + read(`src/${n}.js`));
const bundle = '/* Voile — code source complet et lisible. Licence MIT. */\n' + parts.join('\n');
writeFileSync(join(root, 'site/voile.js'), bundle);

const css = read('site/style.css');
let html = read('site/index.html');

// Service worker versionné par le contenu.
const version = sha256(bundle + css + html).slice(0, 10);
writeFileSync(join(root, 'site/sw.js'), read('src/sw.js').replace('__VERSION__', version));

// Version autonome : un seul fichier, CSP par empreintes, aucune ressource externe.
const cspHash = (s) => `'sha256-${sha256(s, 'base64')}'`;
let solo = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspHash(bundle)}; style-src ${cspHash(css)}; base-uri 'none'; form-action 'none'">`)
  .replace('<link rel="icon" href="favicon.svg" type="image/svg+xml">\n', '')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`)
  .replace('<script src="voile.js" defer></script>', () => `<script>${bundle}</script>`);
if (solo.includes('style.css') || solo.includes('src="voile.js"')) throw new Error('Inlining failed');
writeFileSync(join(root, 'site/voile-hors-ligne.html'), solo);

// En-têtes HTTP (Netlify) : la CSP de la version autonome reprend les mêmes empreintes que le fichier.
const soloCsp = solo.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1];
writeFileSync(join(root, 'site/_headers'), read('src/_headers.tpl').replace('__SOLO_CSP__', soloCsp));

const sums = ['voile.js', 'style.css', 'index.html', 'voile-hors-ligne.html', 'sw.js', '_headers']
  .map((f) => `${sha256(readFileSync(join(root, 'site', f)))}  ${f}`)
  .join('\n') + '\n';
writeFileSync(join(root, 'site/SHA256SUMS'), sums);

console.log(`Build ${version} : voile.js ${(bundle.length / 1024).toFixed(1)} Ko, hors-ligne ${(solo.length / 1024).toFixed(1)} Ko`);
