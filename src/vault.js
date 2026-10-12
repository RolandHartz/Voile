/*
 * Voile — table de correspondance (jeton <-> valeur d'origine).
 * Les jetons sont aléatoires par construction (compteur), PAS des hachages :
 * un hash est à sens unique et se retrouve par force brute sur des noms/téléphones.
 * La réversibilité vient uniquement de cette table, que l'utilisateur garde chiffrée.
 */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});

  const TOKEN_SRC = '(?<![A-Za-z0-9])([A-Za-z]{2,12})_(\\d{3,})(?!\\d)';

  const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const looseKey = (s) => stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const fold = (s) => stripAccents(s).toLowerCase();

  function sanitizeLabel(label) {
    const l = String(label || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12);
    return l.length >= 2 ? l : 'DONNEE';
  }

  class Vault {
    constructor(opts) {
      this.loose = !!(opts && opts.loose); // true : « Dupont » et « DUPONT » partagent un jeton (restitue la 1re forme)
      this.counters = {};
      this.keyToToken = new Map();
      this.tokenToOriginal = new Map();
      this.createdAt = new Date().toISOString();
    }
    _key(label, original) {
      return label + '\u0000' + (this.loose ? looseKey(original) : original);
    }
    tokenFor(label, original) {
      const k = this._key(label, original);
      let t = this.keyToToken.get(k);
      if (t) return t;
      const n = (this.counters[label] = (this.counters[label] || 0) + 1);
      t = label + '_' + String(n).padStart(3, '0');
      this.keyToToken.set(k, t);
      this.tokenToOriginal.set(t, original);
      return t;
    }
    get size() {
      return this.tokenToOriginal.size;
    }
    toJSON() {
      return { v: 1, createdAt: this.createdAt, loose: this.loose, entries: [...this.tokenToOriginal] };
    }
    static fromJSON(obj) {
      if (!obj || obj.v !== 1 || !Array.isArray(obj.entries)) throw new Error('Clé illisible ou version inconnue.');
      const v = new Vault({ loose: obj.loose });
      v.createdAt = obj.createdAt || v.createdAt;
      for (const [t, o] of obj.entries) {
        const m = /^([A-Z]{2,12})_(\d{3,})$/.exec(t);
        if (!m || typeof o !== 'string') throw new Error('Clé corrompue.');
        v.counters[m[1]] = Math.max(v.counters[m[1]] || 0, parseInt(m[2], 10));
        v.keyToToken.set(v._key(m[1], o), t);
        v.tokenToOriginal.set(t, o);
      }
      return v;
    }
  }

  // ---- Pseudonymisation -------------------------------------------------------------

  const LEXICON_LABELS = new Set(['NOM', 'PRENOM', 'PERSONNE', 'SOCIETE']);
  const STOP = new Set(['des', 'les', 'van', 'von', 'der', 'den', 'del', 'dos', 'das', 'los', 'las', 'sur', 'sous', 'mme', 'mlle', 'madame', 'monsieur', 'societe', 'sarl', 'sas', 'eurl']);
  const WORD_RE = /[\p{L}\p{N}]+/gu;

  function wordsOf(s) {
    return [...s.matchAll(WORD_RE)].map((m) => ({ w: m[0], f: fold(m[0]), start: m.index, end: m.index + m[0].length }));
  }

  class Lexicon {
    constructor() {
      this.byFirst = new Map(); // premier mot (plié) -> entrées triées par longueur décroissante
      this.seen = new Set();
    }
    add(text, label) {
      const ws = wordsOf(String(text));
      if (!ws.length) return;
      const seq = ws.map((x) => x.f);
      const joined = seq.join(' ');
      if (joined.length < 3 || /^\d+$/.test(joined.replace(/ /g, ''))) return;
      if (seq.length === 1 && STOP.has(seq[0])) return;
      const id = label + '|' + joined;
      if (this.seen.has(id)) return;
      this.seen.add(id);
      const list = this.byFirst.get(seq[0]) || [];
      list.push({ seq, label });
      list.sort((a, b) => b.seq.length - a.seq.length);
      this.byFirst.set(seq[0], list);
    }
    get size() {
      return this.seen.size;
    }
    // Spans [start,end,label] des occurrences dans text, hors zones déjà occupées.
    find(text, occupied) {
      const out = [];
      if (!this.byFirst.size) return out;
      const ws = wordsOf(text);
      const free = (a, b) => !occupied.some((s) => a < s.end && b > s.start);
      for (let i = 0; i < ws.length; ) {
        const cands = this.byFirst.get(ws[i].f);
        let hit = null;
        if (cands) {
          for (const c of cands) {
            const L = c.seq.length;
            if (i + L > ws.length) continue;
            let ok = true;
            for (let k = 1; k < L && ok; k++) {
              if (ws[i + k].f !== c.seq[k]) ok = false;
              else if (!/^[\s\-'’]+$/.test(text.slice(ws[i + k - 1].end, ws[i + k].start))) ok = false;
            }
            if (ok && free(ws[i].start, ws[i + L - 1].end)) {
              hit = { start: ws[i].start, end: ws[i + L - 1].end, label: c.label, len: L };
              break;
            }
          }
        }
        if (hit) {
          hit.text = text.slice(hit.start, hit.end);
          out.push(hit);
          i += hit.len;
        } else i++;
      }
      return out;
    }
  }

  /**
   * config = {
   *   columns: [{ mode: 'token'|'scan'|'keep', label }]   // aligné sur table.header
   *   terms:   [{ text, label? }]                         // termes à masquer dans les textes libres
   *   loose:   bool, splitFullNames: bool (défaut true)
   * }
   */
  function pseudonymize(table, config, existingVault) {
    const vault = existingVault || new Vault({ loose: config.loose });
    const rows = table.rows.map((r) => r.slice());
    const cols = config.columns || [];
    const report = { columns: [], residual: [], warnings: [], lexiconSize: 0, tokens: 0 };
    const lex = new Lexicon();
    const splitNames = config.splitFullNames !== false;
    const P = V.patterns;

    // Avertit si les données contiennent déjà des chaînes qui ressemblent à des jetons.
    const tokenLike = new RegExp(TOKEN_SRC.replace('[A-Za-z]{2,12}', '[A-Z]{2,12}'), 'g');
    let clash = 0;
    for (const r of rows) for (const c of r) if (c && tokenLike.test(c)) { clash++; tokenLike.lastIndex = 0; }
    if (clash) report.warnings.push(clash + ' cellule(s) contiennent déjà un motif de type PERSONNE_001 : la restitution pourrait les confondre avec des jetons.');

    // Passe 1 : colonnes à jetons (on constitue en même temps le lexique des noms).
    cols.forEach((c, idx) => {
      if (!c || c.mode !== 'token') return;
      const label = sanitizeLabel(c.label);
      const distinct = new Set();
      let cells = 0;
      for (const row of rows) {
        const v = row[idx];
        if (v == null || String(v).trim() === '') continue;
        if (LEXICON_LABELS.has(label)) {
          lex.add(v, label);
          if (splitNames && label === 'PERSONNE') for (const p of wordsOf(v)) if (p.w.length >= 3) lex.add(p.w, 'NOM');
        }
        row[idx] = vault.tokenFor(label, v);
        distinct.add(row[idx]);
        cells++;
      }
      report.columns.push({ index: idx, name: table.header[idx], mode: 'token', label, cells, distinct: distinct.size });
    });

    // Termes saisis à la main.
    for (const t of config.terms || []) if (t && t.text && String(t.text).trim()) lex.add(String(t.text).trim(), sanitizeLabel(t.label || 'TERME'));
    report.lexiconSize = lex.size;

    // Passe 2 : colonnes de texte libre.
    cols.forEach((c, idx) => {
      if (!c || c.mode !== 'scan') return;
      const counts = {};
      let touched = 0;
      for (const row of rows) {
        const text = row[idx];
        if (!text || !String(text).trim()) continue;
        const spans = P.findAll(text);
        for (const s of lex.find(text, spans)) spans.push(s);
        if (!spans.length) continue;
        spans.sort((a, b) => a.start - b.start);
        let out = '';
        let pos = 0;
        for (const s of spans) {
          out += text.slice(pos, s.start) + vault.tokenFor(s.label, text.slice(s.start, s.end));
          pos = s.end;
          counts[s.label] = (counts[s.label] || 0) + 1;
        }
        row[idx] = out + text.slice(pos);
        touched++;
      }
      report.columns.push({ index: idx, name: table.header[idx], mode: 'scan', label: 'TEXTE', cells: touched, counts });
    });

    // Contrôle résiduel : les colonnes laissées en clair contiennent-elles encore des données repérables ?
    cols.forEach((c, idx) => {
      if (c && (c.mode === 'token' || c.mode === 'scan')) return;
      const found = {};
      const step = Math.max(1, Math.floor(rows.length / 1000));
      for (let i = 0; i < rows.length; i += step) {
        const v = rows[i][idx];
        if (!v) continue;
        for (const s of P.findAll(v)) found[s.label] = (found[s.label] || 0) + 1;
      }
      for (const [label, count] of Object.entries(found)) report.residual.push({ index: idx, name: table.header[idx], label, count });
    });

    report.tokens = vault.size;
    return { header: table.header.slice(), rows, delimiter: table.delimiter, eol: table.eol, vault, report };
  }

  // ---- Restitution ------------------------------------------------------------------

  function restoreText(text, vault, stats) {
    const re = new RegExp(TOKEN_SRC, 'g');
    const st = stats || { replaced: 0, unknown: new Set(), seen: new Set() };
    const out = String(text).replace(re, (m, label, num) => {
      const token = label.toUpperCase() + '_' + num;
      const orig = vault.tokenToOriginal.get(token);
      if (orig === undefined) {
        st.unknown.add(m);
        return m;
      }
      st.replaced++;
      st.seen.add(token);
      return orig;
    });
    return { text: out, stats: st };
  }

  function restoreTable(table, vault) {
    const stats = { replaced: 0, unknown: new Set(), seen: new Set() };
    const fix = (c) => (c ? restoreText(c, vault, stats).text : c);
    const header = table.header.map(fix);
    const rows = table.rows.map((r) => r.map(fix));
    return { header, rows, delimiter: table.delimiter, eol: table.eol, report: summarize(stats, vault) };
  }

  function summarize(stats, vault) {
    return {
      replaced: stats.replaced,
      unknown: [...stats.unknown],
      missing: vault.size - stats.seen.size, // jetons de la clé absents du fichier revenu
      distinctRestored: stats.seen.size,
    };
  }

  function restoreFullText(text, vault) {
    const r = restoreText(text, vault);
    return { text: r.text, report: summarize(r.stats, vault) };
  }

  V.Vault = Vault;
  V.pseudonymize = pseudonymize;
  V.restoreTable = restoreTable;
  V.restoreFullText = restoreFullText;
  V.sanitizeLabel = sanitizeLabel;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Vault, pseudonymize, restoreTable, restoreFullText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
