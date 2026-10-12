'use strict';
// Test de bout en bout de l'interface (jsdom pour le DOM, tout le reste en Node natif : WebCrypto, Blob, streams).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveObjectURL } = require('node:buffer');
const { JSDOM } = require('jsdom');

const site = path.join(__dirname, '..', 'site');
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/, '');
const bundle = fs.readFileSync(path.join(site, 'voile.js'), 'utf8');

const dom = new JSDOM(html, { url: 'https://voile.test/' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.location = { protocol: 'file:' };
window.Element.prototype.scrollIntoView = () => {};
const downloads = [];
window.HTMLAnchorElement.prototype.click = function () {
  downloads.push({ name: this.getAttribute('download'), href: this.getAttribute('href') });
};
vm.runInThisContext(bundle);
if (document.readyState === 'loading') document.dispatchEvent(new window.Event('DOMContentLoaded'));
const V = globalThis.Voile;
const $ = (s) => document.querySelector(s);

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return; await tick(25); }
  assert.fail('délai dépassé : ' + label);
}
async function give(inputSel, name, content) {
  const input = $(inputSel);
  const file = new File([content], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));
}
async function lastDownload(n) {
  await until(() => downloads.length >= n, 'téléchargement #' + n);
  const d = downloads[n - 1];
  const blob = resolveObjectURL(d.href);
  return { name: d.name, bytes: new Uint8Array(await blob.arrayBuffer()) };
}
const text = (u8) => new TextDecoder().decode(u8);

const CSV =
  'Numéro client;Nom;Prénom;Email;Téléphone;Montant;Commentaire\r\n' +
  'C-001;Dupont;Jean;jean.dupont@acme.fr;06 12 34 56 78;120;"Rappeler Jean Dupont; il est d’accord pour le Projet Aurore"\r\n' +
  'C-002;Martin;Claire;claire.martin@acme.fr;01 23 45 67 89;80;RAS\r\n' +
  'C-003;Bernard;Paul;paul.bernard@acme.fr;07 98 76 54 32;45;"Frère de Claire Martin, voir martin@acme.fr"\r\n' +
  'C-004;Petit;Léa;lea.petit@acme.fr;06 11 22 33 44;10;Satisfaite du Projet Aurore\r\n';

test('parcours complet : masquer un CSV, enregistrer la clé, restituer', async () => {
  // 1. dépôt du fichier
  await give('#m-file', 'clients_Dupont.csv', CSV);
  await until(() => !$('#m2').hidden, 'étape 2 visible');
  const rows = [...document.querySelectorAll('#cols-main tbody tr')];
  const state = Object.fromEntries(rows.map((r) => [r.querySelector('strong').textContent, r.querySelector('input').checked]));
  assert.equal(state['Nom'], true);
  assert.equal(state['Email'], true);
  assert.equal(state['Téléphone'], true);
  assert.equal(state['Numéro client'], true);
  assert.equal(state['Commentaire'], true);
  assert.ok($('#cols-other tbody') && /Montant/.test($('#cols-other').textContent), 'Montant est dans « autres colonnes »');
  assert.equal($('#cols-other input[type=checkbox]').checked, false);

  // 2. mot supplémentaire, puis masquage
  $('#m-terms').value = 'Projet Aurore';
  $('#m-run').click();
  await until(() => !$('#m3').hidden && !$('#m4').hidden, 'résultat affiché');
  assert.match($('#m3-body').textContent, /codes créés/);
  assert.equal($('#m3-body .alerte'), null, 'aucune alerte inattendue');
  assert.ok($('#m3-body .avap'), 'tableau avant/après');

  // 3. le fichier masqué ne se débloque qu'après la clé
  assert.equal($('#m-dl-key').disabled, true);
  assert.equal($('#m-dl-file').disabled, true);
  $('#m-gen').click();
  assert.match($('#m-pass').value, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
  assert.equal($('#m-dl-key').disabled, true, 'case de confirmation requise');
  $('#m-ack').click();
  assert.equal($('#m-dl-key').disabled, false);
  assert.equal($('#m-dl-file').disabled, true);
  const pass = $('#m-pass').value;
  $('#m-dl-key').click();
  const key = await lastDownload(1);
  assert.match(key.name, /^cle-voile-\d{4}-\d{2}-\d{2}\.voile$/);
  assert.ok(!text(key.bytes).includes('Dupont'), 'la clé est chiffrée');
  await until(() => !$('#m-dl-file').disabled, 'fichier masqué débloqué');
  $('#m-dl-file').click();
  const masked = await lastDownload(2);
  assert.equal(masked.name, 'fichier-masque.csv', 'le nom du fichier d’origine (client) ne fuite pas');
  const m = text(masked.bytes);
  for (const leak of ['Dupont', 'Martin', 'Bernard', 'Petit', 'Jean', 'Claire', 'acme.fr', '06 12 34 56 78', '01 23 45 67 89', 'C-001', 'Aurore']) {
    assert.ok(!m.includes(leak), 'fuite dans le fichier masqué : ' + leak);
  }
  const mt = V.csv.parse(m.replace(/^﻿/, ''));
  assert.equal(mt.rows[0][5], '120', 'colonne non masquée intacte');
  assert.match(mt.rows[0][6], /NOM_\d{3}|PERSONNE_\d{3}|PRENOM_\d{3}/);

  // 4. restitution du fichier masqué tel quel : retour exact à l'original
  $('#tab-restituer').click();
  assert.equal($('#panel-restituer').hidden, false);
  await give('#r-key', 'cle.voile', key.bytes);
  await until(() => /Fichier chargé/.test($('#r1-msg').textContent), 'clé chargée');
  $('#r-pass').value = 'mauvaise phrase de passe';
  $('#r-unlock').click();
  await until(() => /incorrecte/.test($('#r1-msg').textContent), 'erreur phrase de passe');
  assert.equal($('#r2').hidden, true);
  $('#r-pass').value = pass;
  $('#r-unlock').click();
  await until(() => !$('#r2').hidden, 'clé ouverte');
  assert.match($('#r1-msg').textContent, /correspondances/);
  await give('#r-file', 'reponse.csv', masked.bytes);
  await until(() => !$('#r3').hidden, 'résultat de restitution');
  assert.match($('#r3-body').textContent, /remplacés par les vraies valeurs/);
  $('#r3-body .btn:not(.second)').click();
  const restored = await lastDownload(3);
  assert.equal(restored.name, 'fichier-restitue.csv');
  const original = V.csv.parse(CSV);
  const back = V.csv.parse(text(restored.bytes).replace(/^﻿/, ''));
  assert.deepEqual(back.header, original.header);
  // colonnes à jetons : identiques à l'original ; texte libre : identique (mêmes casses)
  assert.deepEqual(back.rows, original.rows);

  // 5. simulation d'une réponse d'IA : nouveau contenu qui réutilise les codes
  const aiText = 'Synthèse : relancer ' + mt.rows[0][1] + ' (' + mt.rows[0][3] + ') — et PERSONNE_999 inventé.';
  $('#r-paste').value = aiText;
  $('#r-paste-go').click();
  await until(() => /absent/.test($('#r3-body').textContent), 'avertissement code inconnu');
  assert.match($('#r3-body textarea').value, /Dupont/);
  assert.match($('#r3-body').textContent, /PERSONNE_999/);
  assert.ok(!$('#r3-body textarea').value.includes(mt.rows[0][1]), 'le code a bien été remplacé');
});

test('mode texte collé : masquage sans colonnes', async () => {
  $('#m-reset').click();
  $('#tab-masquer').click();
  $('#m-paste').value = 'Bonjour, écrivez à sophie.leroy@exemple.fr ou appelez le 06 55 44 33 22. Cordialement, Sophie Leroy.';
  $('#m-terms').value = 'Sophie Leroy';
  $('#m-paste-go').click();
  assert.equal($('#m2').hidden, false);
  assert.match($('#m2-intro').textContent, /balayé/);
  $('#m-run').click();
  await until(() => !$('#m3').hidden, 'résultat texte');
  assert.match($('#m3-body').textContent, /codes créés/);
});

test('Excel : dépôt d’un .xlsx, masquage, export .xlsx lisible', async () => {
  $('#m-reset').click();
  const x = await V.xlsx.write(V.csv.parse(CSV));
  await give('#m-file', 'classeur.xlsx', x);
  await until(() => !$('#m2').hidden, 'xlsx chargé');
  assert.equal([...document.querySelectorAll('#cols-main tbody input')].filter((i) => i.checked).length >= 5, true);
  $('#m-run').click();
  await until(() => !$('#m4').hidden, 'xlsx masqué');
  $('#m-gen').click();
  $('#m-ack').click();
  const before = downloads.length;
  $('#m-dl-key').click();
  await until(() => downloads.length > before, 'clé xlsx');
  await until(() => !$('#m-dl-file').disabled, 'débloqué');
  $('#m-dl-file').click();
  const out = await lastDownload(before + 2);
  assert.equal(out.name, 'fichier-masque.xlsx');
  const t = await V.xlsx.read(out.bytes);
  assert.ok(!JSON.stringify(t).includes('Dupont'));
  assert.equal(t.rows[1][5], '80');
});

test('garde-fous : fichier vide et trop gros', async () => {
  $('#m-reset').click();
  await give('#m-file', 'vide.csv', '');
  await until(() => !$('#m-error').hidden, 'erreur fichier vide');
  assert.match($('#m-error').textContent, /vide/);
  const big = { name: 'gros.csv', size: 30 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) };
  Object.defineProperty($('#m-file'), 'files', { value: [big], configurable: true });
  $('#m-file').dispatchEvent(new window.Event('change'));
  await until(() => /trop volumineux/.test($('#m-error').textContent), 'erreur taille');
});
