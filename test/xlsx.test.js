'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../src/xlsx.js');
const V = globalThis.Voile;
const FIXTURE = process.env.XLSX_FIXTURE;

test('lecture d’un classeur réel (openpyxl) : textes, nombres, dates, entités XML, multi-feuilles', { skip: !FIXTURE }, async () => {
  const t = await V.xlsx.read(fs.readFileSync(FIXTURE));
  assert.deepEqual(t.header, ['Nom', 'Prénom', 'Email', 'Date de naissance', 'Montant', 'Commentaire']);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[0][3], '1985-05-17');
  assert.equal(t.rows[1][3], '1990-01-02 13:30:00');
  assert.equal(t.rows[0][4], '120.5');
  assert.equal(t.rows[0][5], 'Rappeler au 06 12 34 56 78 & vérifier <urgent>');
  assert.equal(t.rows[2][5], 'multi\nligne');
  assert.equal(t.rows[2][1], '');
  assert.match(t.notice, /première feuille/);
});

test('écriture puis relecture : identique, nombres typés, zéros de tête conservés', async () => {
  const table = {
    header: ['Nom', 'Tel', 'Montant', 'Note'],
    rows: [
      ['Dupont & Fils', '0612345678', '120.5', ' espace '],
      ['<b>x</b>', '', '0', 'ligne1\nligne2'],
      ['é€😀', '12345678901234567890', '-3', 'a"b'],
    ],
  };
  const bytes = await V.xlsx.write(table);
  const back = await V.xlsx.read(bytes);
  assert.deepEqual(back.header, table.header);
  assert.deepEqual(back.rows, table.rows);
});

test('fichier invalide ou tronqué : erreur claire, pas de plantage', async () => {
  await assert.rejects(() => V.xlsx.read(new Uint8Array([1, 2, 3, 4])), /Excel/);
  const ok = await V.xlsx.write({ header: ['a'], rows: [['b']] });
  await assert.rejects(() => V.xlsx.read(ok.subarray(0, ok.length - 30)), /Excel|corrompue/);
});
