/* Voile — écran « Restituer la réponse » : remet les vraies valeurs à la place des codes. */
(function (root) {
  'use strict';
  const V = root.Voile;
  const { $, el, clear, show, showError, readFile, download, bindDrop, truncate } = V.ui;

  const R = { keyText: null, vault: null };

  function wipe() {
    R.keyText = null;
    R.vault = null;
    $('#r-pass').value = '';
    $('#r-paste').value = '';
    clear($('#r1-msg'));
    clear($('#r3-body'));
    show($('#r2'), false);
    show($('#r3'), false);
    showError($('#r2-error'), '');
  }

  async function loadKey(file) {
    wipe();
    try {
      const f = await readFile(file);
      R.keyText = new TextDecoder().decode(f.bytes);
      $('#r1-msg').append(el('p', { class: 'muted', text: 'Fichier chargé : ' + file.name + '. Saisissez la phrase de passe, puis ouvrez la clé.' }));
    } catch (e) {
      $('#r1-msg').append(el('div', { class: 'alerte', text: e.message || String(e) }));
    }
  }

  async function unlock() {
    const msg = $('#r1-msg');
    clear(msg);
    if (!R.keyText) return msg.append(el('div', { class: 'alerte', text: 'Choisissez d’abord votre fichier clé (.voile).' }));
    const pass = $('#r-pass').value.trim();
    if (!pass) return msg.append(el('div', { class: 'alerte', text: 'Saisissez la phrase de passe.' }));
    const btn = $('#r-unlock');
    btn.disabled = true;
    btn.textContent = 'Ouverture…';
    try {
      R.vault = await V.keyfile.decryptVault(R.keyText, pass);
      const d = new Date(R.vault.createdAt);
      const when = isNaN(d) ? '' : ', créée le ' + d.toLocaleDateString('fr-FR');
      msg.append(el('div', { class: 'info', text: 'Clé ouverte : ' + R.vault.size + ' correspondances' + when + '.' }));
      show($('#r2'), true);
    } catch (e) {
      R.vault = null;
      show($('#r2'), false);
      msg.append(el('div', { class: 'alerte', text: e.message || String(e) }));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ouvrir la clé';
    }
  }

  function reportBlock(rep) {
    const box = el('div');
    if (rep.replaced === 0) {
      box.append(el('div', { class: 'alerte' }, el('strong', { text: 'Aucun code reconnu.' }),
        el('p', { text: 'Ce n’est peut-être pas la bonne clé pour ce fichier, ou l’IA a modifié les codes (par exemple en les traduisant ou en retirant le tiret bas).' })));
    } else {
      box.append(el('div', { class: 'info', text: rep.replaced + ' code' + (rep.replaced > 1 ? 's' : '') + ' remplacé' + (rep.replaced > 1 ? 's' : '') + ' par les vraies valeurs (' + rep.distinctRestored + ' distinct' + (rep.distinctRestored > 1 ? 's' : '') + ').' }));
    }
    if (rep.unknown.length) {
      const shown = rep.unknown.slice(0, 15).join(', ') + (rep.unknown.length > 15 ? '…' : '');
      box.append(el('div', { class: 'alerte' }, el('strong', { text: rep.unknown.length + ' code' + (rep.unknown.length > 1 ? 's' : '') + ' absent' + (rep.unknown.length > 1 ? 's' : '') + ' de votre clé' }),
        el('p', { text: 'L’IA les a peut-être inventés ou déformés. Ils sont laissés tels quels : ' + shown })));
    }
    if (rep.missing > 0 && rep.replaced > 0) {
      box.append(el('p', { class: 'muted', text: rep.missing + ' code' + (rep.missing > 1 ? 's' : '') + ' de la clé n’apparaissent pas dans ce fichier : c’est normal si l’IA a filtré, résumé ou regroupé les données.' }));
    }
    return box;
  }

  function finish(rep, content) {
    const body = $('#r3-body');
    clear(body);
    body.append(reportBlock(rep));
    body.append(content);
    body.append(el('div', { class: 'row' }, el('button', { class: 'btn second', text: 'Tout effacer', on: { click: wipe } })));
    show($('#r3'), true);
    $('#r3').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function textResult(text, name, type) {
    const area = el('textarea', { attrs: { readonly: '', 'aria-label': 'Texte restitué' } });
    area.value = text;
    const copy = el('button', { class: 'btn second', text: 'Copier le texte' });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copié'; }
      catch (e) { area.select(); copy.textContent = 'Sélectionné : faites Ctrl+C'; }
    });
    const dl = el('button', { class: 'btn', text: 'Télécharger le fichier restitué' });
    dl.addEventListener('click', () => download(name, text, type));
    return el('div', {}, area, el('div', { class: 'row' }, dl, copy));
  }

  async function restoreFile(file) {
    showError($('#r2-error'), '');
    if (!R.vault) return showError($('#r2-error'), 'Ouvrez d’abord la clé.');
    try {
      const f = await readFile(file);
      if (f.ext === 'xlsx') {
        if (!V.xlsx) throw new Error('La lecture des fichiers Excel n’est pas disponible dans cette version.');
        const out = V.restoreTable(await V.xlsx.read(f.bytes), R.vault);
        const bytes = await V.xlsx.write({ header: out.header, rows: out.rows });
        const dl = el('button', { class: 'btn', text: 'Télécharger le fichier restitué' });
        dl.addEventListener('click', () => download('fichier-restitue.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
        finish(out.report, el('div', { class: 'row' }, dl));
        return;
      }
      const d = V.csv.decodeBytes(f.bytes);
      if (f.ext === 'csv' || f.ext === 'tsv') {
        // Par cellule : une valeur d'origine contenant « ; » ou un retour à la ligne ne doit pas casser le CSV.
        const out = V.restoreTable(V.csv.parse(d.text, f.ext === 'tsv' ? '\t' : undefined), R.vault);
        const csv = V.csv.serialize(out, { bom: true });
        const dl = el('button', { class: 'btn', text: 'Télécharger le fichier restitué' });
        dl.addEventListener('click', () => download('fichier-restitue.' + f.ext, csv, 'text/csv;charset=utf-8'));
        finish(out.report, el('div', { class: 'row' }, dl));
      } else {
        const out = V.restoreFullText(d.text, R.vault);
        finish(out.report, textResult(out.text, 'fichier-restitue.' + (f.ext || 'txt'), 'text/plain;charset=utf-8'));
      }
    } catch (e) {
      showError($('#r2-error'), e.message || String(e));
    }
  }

  function restorePaste() {
    showError($('#r2-error'), '');
    if (!R.vault) return showError($('#r2-error'), 'Ouvrez d’abord la clé.');
    const text = $('#r-paste').value;
    if (!text.trim()) return showError($('#r2-error'), 'Collez d’abord la réponse de l’IA.');
    const out = V.restoreFullText(text, R.vault);
    finish(out.report, textResult(out.text, 'texte-restitue.txt', 'text/plain;charset=utf-8'));
  }

  function init() {
    bindDrop($('#r-key-drop'), $('#r-key'), loadKey);
    bindDrop($('#r-drop'), $('#r-file'), restoreFile);
    $('#r-unlock').addEventListener('click', unlock);
    $('#r-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
    $('#r-paste-go').addEventListener('click', restorePaste);
  }

  V.appRestore = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
