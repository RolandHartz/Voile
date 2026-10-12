'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/csv.js');
require('../src/patterns.js');
require('../src/detect.js');
require('../src/vault.js');
require('../src/crypto.js');
const V = globalThis.Voile;

// --- générateurs de valeurs valides ---
function withLuhn(base) {
  for (let d = 0; d < 10; d++) if (V.patterns.luhn(base + d)) return base + d;
}
function makeNir(first13) {
  const key = 97 - Number(BigInt(first13) % 97n);
  return first13 + String(key).padStart(2, '0');
}
const SIRET = withLuhn('1234567890001'); // 14 chiffres
const NIR = makeNir('1850575123456');
const IBAN = 'FR7630006000011234567890189';

test('csv: guillemets, séparateur, retours à la ligne, aller-retour', () => {
  const src = 'Nom;Note\r\n"Dupont; Jean";"ligne1\nligne2"\r\nMartin;"il a dit ""oui"""\r\n';
  const t = V.csv.parse(src);
  assert.equal(t.delimiter, ';');
  assert.deepEqual(t.header, ['Nom', 'Note']);
  assert.equal(t.rows[0][0], 'Dupont; Jean');
  assert.equal(t.rows[0][1], 'ligne1\nligne2');
  assert.equal(t.rows[1][1], 'il a dit "oui"');
  const again = V.csv.parse(V.csv.serialize(t, { bom: false }));
  assert.deepEqual(again.rows, t.rows);
});

test('csv: décodage Windows-1252 quand ce n’est pas de l’UTF-8', () => {
  const bytes = Uint8Array.from([0x4d, 0xe9, 0x6c, 0x61, 0x6e, 0x69, 0x65]); // "Mélanie" en cp1252
  const r = V.csv.decodeBytes(bytes);
  assert.equal(r.encoding, 'windows-1252');
  assert.equal(r.text, 'Mélanie');
});

test('patterns: valides détectés, invalides rejetés', () => {
  const f = (s) => V.patterns.findAll(s).map((x) => x.label);
  assert.deepEqual(f('écrire à jean.dupont@exemple.fr svp'), ['EMAIL']);
  assert.deepEqual(f('appelez le 06 12 34 56 78'), ['TEL']);
  assert.deepEqual(f('+33 6 12 34 56 78'), ['TEL']);
  assert.deepEqual(f('tel 01.23.45.67.89'), ['TEL']);
  assert.deepEqual(f('IBAN ' + IBAN), ['IBAN']);
  assert.deepEqual(f('IBAN FR7630006000011234567890188'), []); // clé fausse
  assert.deepEqual(f('NIR ' + NIR), ['NIR']);
  assert.deepEqual(f('NIR ' + NIR.slice(0, 14) + (NIR[14] === '0' ? '1' : '0')), []);
  assert.deepEqual(f('SIRET ' + SIRET), ['SIRET']);
  assert.deepEqual(f('carte 4111 1111 1111 1111'), ['CB']);
  assert.deepEqual(f('ip 192.168.1.10 et 999.1.1.1'), ['IP']);
  assert.deepEqual(f('commande 20260412 de 1500 euros'), []);
});

test('détection des colonnes par nom', () => {
  const m = (n) => (V.detect.matchByName(n) || {}).label;
  assert.equal(m('Nom'), 'NOM');
  assert.equal(m('Prénom'), 'PRENOM');
  assert.equal(m('E-mail'), 'EMAIL');
  assert.equal(m('Adresse mail'), 'EMAIL');
  assert.equal(m('Téléphone portable'), 'TEL');
  assert.equal(m('Numéro client'), 'ID');
  assert.equal(m('Nom société'), 'SOCIETE');
  assert.equal(m('firstName'), 'PRENOM');
  assert.equal(m('DateNaissance'), 'NAISSANCE');
  assert.equal(m('Commentaire'), 'TEXTE');
  assert.equal(m('Montant HT'), undefined);
  assert.equal(m('Vidéo'), undefined); // « id » ne doit pas matcher en sous-chaîne
});

test('détection par contenu sur colonne mal nommée + texte libre', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push([`col${i}@acme.fr`, `Bonjour, rappeler le 06 12 34 56 ${String(10 + i)} svp, merci pour votre retour rapide`, String(i * 7)]);
  const cols = V.detect.detectColumns({ header: ['col3', 'Interlocuteur_x', 'montant'], rows });
  assert.equal(cols[0].label, 'EMAIL');
  assert.equal(cols[0].checked, true);
  assert.equal(cols[1].mode, 'scan'); // contient des téléphones
  assert.equal(cols[2].checked, false);
});

function sample() {
  const header = ['Nom', 'Prénom', 'Email', 'Commentaire', 'Montant'];
  const rows = [
    ['Dupont', 'Jean', 'jean.dupont@acme.fr', 'Jean Dupont a rappelé, joindre au 06 12 34 56 78', '120'],
    ['Martin', 'Claire', 'claire.martin@acme.fr', 'RAS. Mme Martin est satisfaite', '80'],
    ['Dupont', 'Paul', 'paul.dupont@acme.fr', 'Frère de Jean. IBAN ' + IBAN, '45'],
    ['DUPONT', 'Léa', 'lea@acme.fr', 'dupont (majuscules) à vérifier', '10'],
  ];
  return { header, rows, delimiter: ';', eol: '\r\n' };
}
const CFG = {
  columns: [
    { mode: 'token', label: 'NOM' },
    { mode: 'token', label: 'PRENOM' },
    { mode: 'token', label: 'EMAIL' },
    { mode: 'scan', label: 'TEXTE' },
    { mode: 'keep' },
  ],
};

test('pseudonymisation: cohérence, absence de fuite, aller-retour exact', () => {
  const t = sample();
  const r = V.pseudonymize(t, CFG);
  // cohérence : même valeur -> même jeton ; valeurs distinctes -> jetons distincts
  assert.equal(r.rows[0][0], r.rows[2][0]); // Dupont = Dupont
  assert.notEqual(r.rows[0][0], r.rows[1][0]);
  assert.notEqual(r.rows[0][0], r.rows[3][0]); // DUPONT distinct en mode exact (fidélité)
  // aucune valeur d'origine ne subsiste
  const flat = JSON.stringify([r.header, r.rows]);
  for (const leak of ['Dupont', 'Jean', 'Claire', 'acme.fr', '06 12 34 56 78', IBAN, 'Martin']) {
    assert.ok(!flat.includes(leak), 'fuite : ' + leak);
  }
  assert.equal(r.rows[0][4], '120'); // colonne non masquée intacte
  // aller-retour exact sur le tableau
  const back = V.restoreTable({ header: r.header, rows: r.rows }, r.vault);
  assert.deepEqual(back.rows.map((x) => x.slice(0, 3).concat(x[4])), t.rows.map((x) => x.slice(0, 3).concat(x[4])));
  // texte libre : restitué (la casse du texte reprend celle de la valeur rencontrée)
  assert.equal(back.rows[0][3], t.rows[0][3]);
  assert.equal(back.rows[2][3], t.rows[2][3]);
  assert.equal(back.rows[3][3], t.rows[3][3]);
  assert.equal(back.report.unknown.length, 0);
});

test('le nom d’une colonne se propage dans les textes libres', () => {
  const r = V.pseudonymize(sample(), CFG);
  assert.ok(!/Martin/.test(r.rows[1][3]));
  assert.match(r.rows[1][3], /NOM_\d{3}/);
});

test('contrôle résiduel : une donnée oubliée dans une colonne laissée en clair est signalée', () => {
  const t = { header: ['Nom', 'Autre'], rows: [['Durand', 'contact: x.y@zz.fr'], ['Petit', 'rien']], delimiter: ';', eol: '\n' };
  const r = V.pseudonymize(t, { columns: [{ mode: 'token', label: 'NOM' }, { mode: 'keep' }] });
  assert.equal(r.report.residual.length, 1);
  assert.equal(r.report.residual[0].label, 'EMAIL');
  assert.equal(r.report.residual[0].name, 'Autre');
});

test('restitution: PERSONNE_001 / PERSONNE_010, casse modifiée, jetons inventés, absents', () => {
  const rows = [];
  for (let i = 1; i <= 12; i++) rows.push(['Personne' + i]);
  const r = V.pseudonymize({ header: ['Nom'], rows, delimiter: ';', eol: '\n' }, { columns: [{ mode: 'token', label: 'PERSONNE' }] });
  const back = V.restoreFullText('A: PERSONNE_001, B: PERSONNE_010, C: personne_012, D: PERSONNE_099.', r.vault);
  assert.equal(back.text, 'A: Personne1, B: Personne10, C: Personne12, D: PERSONNE_099.');
  assert.deepEqual(back.report.unknown, ['PERSONNE_099']);
  assert.equal(back.report.missing, 9);
});

test('mode « regrouper les variantes » : Dupont et DUPONT partagent un jeton', () => {
  const t = { header: ['Nom'], rows: [['Dupont'], ['DUPONT'], ['dupont']], delimiter: ';', eol: '\n' };
  const r = V.pseudonymize(t, { columns: [{ mode: 'token', label: 'NOM' }], loose: true });
  assert.equal(new Set(r.rows.map((x) => x[0])).size, 1);
});

test('clé chiffrée : aller-retour, mauvaise phrase, fichier trafiqué, phrase trop courte', async () => {
  const r = V.pseudonymize(sample(), CFG);
  const file = await V.keyfile.encryptVault(r.vault, 'correct horse battery');
  assert.ok(!file.includes('Dupont'));
  const v2 = await V.keyfile.decryptVault(file, 'correct horse battery');
  assert.equal(v2.size, r.vault.size);
  assert.equal(v2.tokenToOriginal.get(r.rows[0][0]), 'Dupont');
  await assert.rejects(() => V.keyfile.decryptVault(file, 'mauvaise phrase de passe'), /incorrecte/);
  const tampered = JSON.parse(file);
  tampered.iter = 600001;
  await assert.rejects(() => V.keyfile.decryptVault(JSON.stringify(tampered), 'correct horse battery'), /incorrecte|altéré/);
  const dos = JSON.parse(file);
  dos.iter = 4000000000;
  await assert.rejects(() => V.keyfile.decryptVault(JSON.stringify(dos), 'x'), /invalides/);
  await assert.rejects(() => V.keyfile.encryptVault(r.vault, 'court'), /trop courte/);
  assert.match(V.keyfile.generatePassphrase(), /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
});

test('performance : 50 000 lignes', () => {
  const header = ['Nom', 'Prénom', 'Email', 'Téléphone', 'Commentaire', 'Montant'];
  const rows = [];
  for (let i = 0; i < 50000; i++) {
    const n = 'Nom' + (i % 8000);
    rows.push([n, 'Prenom' + (i % 3000), `u${i}@acme.fr`, '06 12 34 ' + String(10000 + (i % 9000)).slice(1, 3) + ' ' + String(i % 100).padStart(2, '0'), `Le client ${n} a écrit, voir u${i}@acme.fr pour la suite du dossier`, String(i)]);
  }
  const t0 = Date.now();
  const r = V.pseudonymize(
    { header, rows, delimiter: ';', eol: '\n' },
    { columns: [{ mode: 'token', label: 'NOM' }, { mode: 'token', label: 'PRENOM' }, { mode: 'token', label: 'EMAIL' }, { mode: 'token', label: 'TEL' }, { mode: 'scan' }, { mode: 'keep' }] }
  );
  const ms = Date.now() - t0;
  console.log('   50 000 lignes pseudonymisées en ' + ms + ' ms, ' + r.vault.size + ' jetons');
  assert.ok(ms < 20000, 'trop lent : ' + ms + ' ms');
  assert.ok(!r.rows[10][4].includes('Nom10'));
});
