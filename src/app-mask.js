/* Voile — écran « Masquer un fichier ». */
(function (root) {
  'use strict';
  const V = root.Voile;
  const { $, el, clear, show, showError, readFile, download, bindDrop, stamp, truncate, withTokens } = V.ui;

  const TYPES = [
    ['NOM', 'Nom de famille'], ['PRENOM', 'Prénom'], ['PERSONNE', 'Nom complet / personne'], ['SOCIETE', 'Société'],
    ['EMAIL', 'E-mail'], ['TEL', 'Téléphone'], ['ADRESSE', 'Adresse'], ['ID', 'Identifiant'], ['IBAN', 'IBAN / RIB'],
    ['SIRET', 'SIREN / SIRET'], ['NIR', 'N° de sécurité sociale'], ['IP', 'Adresse IP'], ['CP', 'Code postal'],
    ['VILLE', 'Ville'], ['NAISSANCE', 'Date de naissance'], ['SALAIRE', 'Rémunération'], ['DONNEE', 'Autre donnée'],
    ['@scan', 'Texte libre (balayé)'],
  ];
  const PLURAL = { EMAIL: 'e-mails', TEL: 'numéros de téléphone', IBAN: 'IBAN', NIR: 'numéros de sécurité sociale', SIRET: 'numéros SIRET', CB: 'numéros de carte', IP: 'adresses IP', URL: 'adresses web', NOM: 'noms', PRENOM: 'prénoms', PERSONNE: 'noms de personnes', SOCIETE: 'noms de sociétés', TERME: 'mots de votre liste' };
  const plural = (l) => PLURAL[l] || 'valeurs « ' + l + ' »';

  const S = { table: null, src: null, descs: [], result: null, keyDone: false, textOnly: false };

  function reset() {
    S.table = S.src = S.result = null;
    S.descs = [];
    S.keyDone = false;
    S.textOnly = false;
    ['m2', 'm3', 'm4'].forEach((id) => show($('#' + id), false));
    clear($('#m3-body'));
    $('#m-paste').value = '';
    $('#m-terms').value = '';
    $('#m-pass').value = '';
    $('#m-ack').checked = false;
    $('#m4-status').textContent = '';
    showError($('#m-error'), '');
    updateExportButtons();
  }

  async function loadFile(file) {
    reset();
    try {
      const f = await readFile(file);
      let table;
      if (f.ext === 'xlsx') {
        if (!V.xlsx) throw new Error('La lecture des fichiers Excel n’est pas disponible dans cette version.');
        table = await V.xlsx.read(f.bytes);
        S.src = { kind: 'xlsx', ext: 'xlsx' };
      } else {
        const d = V.csv.decodeBytes(f.bytes);
        if (f.ext === 'csv' || f.ext === 'tsv') {
          table = V.csv.parse(d.text, f.ext === 'tsv' ? '\t' : undefined);
          S.src = { kind: 'csv', ext: f.ext };
        } else {
          table = { header: ['Texte'], rows: [[d.text]], delimiter: ';', eol: '\n' };
          S.src = { kind: 'text', ext: f.ext || 'txt' };
        }
      }
      if (!table.header.length || (!table.rows.length && S.src.kind !== 'text')) throw new Error('Le fichier semble vide.');
      begin(table);
    } catch (e) {
      showError($('#m-error'), e.message || String(e));
    }
  }

  function loadPaste() {
    const text = $('#m-paste').value;
    reset();
    $('#m-paste').value = text;
    if (!text.trim()) return showError($('#m-error'), 'Collez d’abord un texte.');
    S.src = { kind: 'text', ext: 'txt' };
    begin({ header: ['Texte'], rows: [[text]], delimiter: ';', eol: '\n' });
  }

  function begin(table) {
    S.table = table;
    S.textOnly = S.src.kind === 'text';
    S.descs = S.textOnly
      ? [{ index: 0, name: 'Texte', label: 'TEXTE', level: 'libre', confidence: 'haute', reasons: [], mode: 'scan', checked: true }]
      : V.detect.detectColumns(table);
    renderColumns();
    if (table.notice) $('#m2-intro').textContent += ' ' + table.notice;
    show($('#m2'), true);
    $('#m2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function defaultType(d) {
    if (d.level === 'libre') return '@scan';
    return TYPES.some((t) => t[0] === d.label) ? d.label : 'DONNEE';
  }

  function applyDesc(d) {
    d.mode = !d.checked ? 'keep' : d.type === '@scan' ? 'scan' : 'token';
  }

  function colRow(d) {
    d.type = d.type || defaultType(d);
    const first = S.table.rows.map((r) => r[d.index]).find((v) => v && String(v).trim());
    const cb = el('input', { attrs: { type: 'checkbox', 'aria-label': 'Masquer la colonne ' + d.name } });
    cb.checked = d.checked;
    cb.addEventListener('change', () => { d.checked = cb.checked; applyDesc(d); });
    const sel = el('select', { attrs: { 'aria-label': 'Type de données de la colonne ' + d.name } });
    for (const [v, t] of TYPES) sel.append(el('option', { text: t, attrs: { value: v } }));
    sel.value = d.type;
    sel.addEventListener('change', () => {
      d.type = sel.value;
      d.label = sel.value === '@scan' ? 'TEXTE' : sel.value;
      applyDesc(d);
    });
    const why = el('div', { class: 'why' });
    if (d.confidence === 'haute') why.append(el('span', { class: 'pill haute', text: 'repéré avec certitude' }), ' ');
    else if (d.confidence === 'moyenne') why.append(el('span', { class: 'pill', text: 'probable' }), ' ');
    else if (d.confidence === 'faible' || d.level === 'quasi') why.append(el('span', { class: 'pill', text: 'à vérifier' }), ' ');
    why.append(d.reasons.join(' ; '));
    applyDesc(d);
    return el('tr', {},
      el('td', {}, cb),
      el('td', {}, el('strong', { text: d.name || '(sans titre)' }), why),
      el('td', {}, sel),
      el('td', { class: 'ex', text: first ? truncate(first, 34) : '(vide)' })
    );
  }

  function colTable(list) {
    const head = el('tr', {}, el('th', { text: 'Masquer' }), el('th', { text: 'Colonne' }), el('th', { text: 'Type de données' }), el('th', { text: 'Exemple' }));
    return el('table', { class: 'cols' }, el('thead', {}, head), el('tbody', {}, ...list.map(colRow)));
  }

  function renderColumns() {
    const main = $('#cols-main');
    const other = $('#cols-other');
    clear(main);
    clear(other);
    if (S.textOnly) {
      $('#m2-intro').textContent = 'Le texte sera balayé : e-mails, téléphones, IBAN, numéros de sécurité sociale, SIRET, cartes bancaires et adresses web sont remplacés automatiquement. Ajoutez ci-dessous les noms que vous voulez aussi masquer.';
      show($('#cols-other-wrap'), false);
      return;
    }
    const found = S.descs.filter((d) => d.label);
    const rest = S.descs.filter((d) => !d.label);
    const on = S.descs.filter((d) => d.checked).length;
    $('#m2-intro').textContent = on + ' colonne' + (on > 1 ? 's' : '') + ' sur ' + S.descs.length + ' proposée' + (on > 1 ? 's' : '') + ' pour être masquée' + (on > 1 ? 's' : '') + '. Décochez ce qui ne doit pas l’être, cochez ce que le repérage automatique a manqué.';
    if (found.length) main.append(colTable(found));
    else main.append(el('p', { class: 'muted', text: 'Aucune colonne repérée automatiquement : cochez celles à masquer ci-dessous.' }));
    show($('#cols-other-wrap'), rest.length > 0);
    if (rest.length) {
      $('#cols-other-title').textContent = rest.length === 1 ? '1 autre colonne — faut-il la masquer aussi ?' : rest.length + ' autres colonnes — y en a-t-il à masquer aussi ?';
      other.append(colTable(rest));
      if (!found.length) $('#cols-other-wrap').open = true;
    }
  }

  function run() {
    showError($('#m-error'), '');
    const terms = $('#m-terms').value.split('\n').map((s) => s.trim()).filter(Boolean).map((text) => ({ text, label: 'TERME' }));
    const cols = S.descs.map((d) => ({ mode: d.mode, label: d.type === '@scan' ? 'TEXTE' : d.type }));
    if (!cols.some((c) => c.mode !== 'keep')) return showError($('#m-error'), 'Cochez au moins une colonne à masquer.');
    const btn = $('#m-run');
    btn.disabled = true;
    btn.textContent = 'Calcul en cours…';
    setTimeout(() => {
      try {
        S.result = V.pseudonymize(S.table, { columns: cols, terms, loose: $('#m-loose').checked });
        S.keyDone = false;
        renderResult(terms);
        show($('#m3'), true);
        show($('#m4'), true);
        $('#m3').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        showError($('#m-error'), 'Erreur pendant le masquage : ' + (e.message || e));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Masquer mes données';
        updateExportButtons();
      }
    }, 30);
  }

  function renderResult(terms) {
    const body = $('#m3-body');
    clear(body);
    const r = S.result;
    const rep = r.report;
    // Alertes : ce qui reste en clair
    const warn = [];
    for (const w of rep.warnings) warn.push(w);
    for (const x of rep.residual) warn.push('La colonne « ' + x.name + ' » n’est pas masquée mais contient des ' + plural(x.label) + '.');
    if (warn.length) {
      const ul = el('ul', {}, ...warn.map((w) => el('li', { text: w })));
      body.append(el('div', { class: 'alerte' }, el('strong', { text: 'À vérifier avant d’envoyer le fichier' }), ul,
        el('p', { class: 'muted', text: 'Modifiez la sélection à l’étape 2, puis relancez le masquage.' })));
    }
    const masked = rep.columns.filter((c) => c.mode === 'token' || c.mode === 'scan');
    const lines = [];
    for (const c of masked) {
      if (c.mode === 'token') lines.push('« ' + c.name + ' » : ' + c.cells + ' cellule' + (c.cells > 1 ? 's' : '') + ', ' + c.distinct + ' valeur' + (c.distinct > 1 ? 's' : '') + ' distincte' + (c.distinct > 1 ? 's' : '') + ' (' + c.label + ').');
      else {
        const parts = Object.entries(c.counts).map(([l, n]) => n + ' ' + plural(l));
        lines.push('« ' + c.name + ' » (texte libre) : ' + (parts.length ? parts.join(', ') + ' remplacés.' : 'rien de repérable.'));
      }
    }
    body.append(el('div', { class: 'info' }, el('strong', { text: rep.tokens + ' codes créés.' }), el('ul', {}, ...lines.map((l) => el('li', { text: l })))));
    if (terms.length && rep.lexiconSize) body.append(el('p', { class: 'muted', text: 'Votre liste de mots et les noms des colonnes masquées ont été cherchés dans les textes libres.' }));
    // Avant / après
    const trs = [];
    for (const c of masked) {
      const idx = [];
      for (let i = 0; i < S.table.rows.length && idx.length < 2; i++) {
        const before = S.table.rows[i][c.index];
        if (before && String(before).trim() && (c.mode === 'token' || before !== r.rows[i][c.index])) idx.push(i);
      }
      for (const i of idx) {
        trs.push(el('tr', {}, el('th', { text: c.name }), el('td', { text: truncate(S.table.rows[i][c.index], 160) }),
          el('td', { class: 'apres' }, withTokens(truncate(r.rows[i][c.index], 200), el('span')))));
      }
    }
    if (trs.length) {
      body.append(el('p', { text: 'Voici quelques lignes avant et après. Relisez-les : c’est ce que recevra l’IA.' }));
      body.append(el('div', { class: 'scroll' }, el('table', { class: 'avap' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Colonne' }), el('th', { text: 'Avant' }), el('th', { text: 'Après' }))), el('tbody', {}, ...trs))));
    }
  }

  // ---- Export -----------------------------------------------------------------------
  const passOk = () => $('#m-pass').value.trim().length >= 12;

  function updateExportButtons() {
    const ready = !!S.result;
    $('#m-dl-key').disabled = !(ready && passOk() && $('#m-ack').checked);
    $('#m-dl-file').disabled = !(ready && S.keyDone);
    const st = $('#m4-status');
    if (!ready) st.textContent = '';
    else if (!passOk()) st.textContent = 'Choisissez une phrase de passe d’au moins 12 caractères, ou cliquez sur Générer.';
    else if (!$('#m-ack').checked) st.textContent = 'Confirmez que vous avez noté la phrase de passe.';
    else if (!S.keyDone) st.textContent = 'Téléchargez d’abord la clé : le fichier masqué ne se débloque qu’après.';
    else st.textContent = 'Clé enregistrée. Vous pouvez télécharger le fichier masqué.';
  }

  async function downloadKey() {
    const btn = $('#m-dl-key');
    btn.disabled = true;
    try {
      const data = await V.keyfile.encryptVault(S.result.vault, $('#m-pass').value.trim());
      download('cle-voile-' + stamp() + '.voile', data, 'application/json');
      S.keyDone = true;
    } catch (e) {
      $('#m4-status').textContent = e.message || String(e);
    }
    updateExportButtons();
  }

  async function downloadMasked() {
    const r = S.result;
    const ext = S.src.ext;
    if (S.src.kind === 'csv') {
      download('fichier-masque.' + ext, V.csv.serialize(r, { bom: true }), 'text/csv;charset=utf-8');
    } else if (S.src.kind === 'xlsx') {
      download('fichier-masque.xlsx', await V.xlsx.write({ header: r.header, rows: r.rows }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      download('texte-masque.' + ext, r.rows[0][0], 'text/plain;charset=utf-8');
    }
  }

  function init() {
    bindDrop($('#m-drop'), $('#m-file'), loadFile);
    $('#m-paste-go').addEventListener('click', loadPaste);
    $('#m-run').addEventListener('click', run);
    $('#m-gen').addEventListener('click', () => { $('#m-pass').value = V.keyfile.generatePassphrase(); updateExportButtons(); });
    $('#m-pass').addEventListener('input', () => { S.keyDone = false; updateExportButtons(); });
    $('#m-ack').addEventListener('change', updateExportButtons);
    $('#m-dl-key').addEventListener('click', downloadKey);
    $('#m-dl-file').addEventListener('click', downloadMasked);
    $('#m-reset').addEventListener('click', reset);
    window.addEventListener('beforeunload', (e) => {
      if (S.result && !S.keyDone) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  V.appMask = { init, state: S };
})(typeof globalThis !== 'undefined' ? globalThis : this);
