/* Voile — code source complet et lisible. Licence MIT. */
/* ---- src/csv.js ---- */
/*
 * Voile — lecture/écriture CSV, sans dépendance.
 * Fonctionne dans le navigateur et sous Node (tests).
 */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});

  // Décode des octets en texte : UTF-8 strict, sinon Windows-1252 (Excel FR).
  function decodeBytes(bytes) {
    let bom = false;
    let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      bom = true;
      u8 = u8.subarray(3);
    }
    let text, encoding;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
      encoding = 'utf-8';
    } catch (e) {
      text = new TextDecoder('windows-1252').decode(u8);
      encoding = 'windows-1252';
    }
    return { text, encoding, bom };
  }

  // Devine le séparateur à partir des premières lignes (hors guillemets).
  function detectDelimiter(text) {
    const candidates = [';', ',', '\t', '|'];
    const counts = candidates.map(() => []);
    let line = 0;
    let inQ = false;
    const cur = candidates.map(() => 0);
    const limit = Math.min(text.length, 20000);
    for (let i = 0; i < limit && line < 6; i++) {
      const c = text[i];
      if (c === '"') inQ = !inQ;
      else if (!inQ) {
        if (c === '\n') {
          candidates.forEach((_, k) => {
            counts[k].push(cur[k]);
            cur[k] = 0;
          });
          line++;
        } else {
          const k = candidates.indexOf(c);
          if (k >= 0) cur[k]++;
        }
      }
    }
    let best = ',';
    let bestScore = 0;
    candidates.forEach((d, k) => {
      const arr = counts[k].filter((n) => n > 0);
      if (!arr.length) return;
      const consistent = arr.every((n) => n === arr[0]);
      const score = arr[0] * (consistent ? 2 : 1) * (arr.length === counts[k].length ? 1.5 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    });
    return best;
  }

  // Analyse RFC 4180 : guillemets, "" échappés, CRLF/LF/CR.
  function parse(text, delimiter) {
    const delim = delimiter || detectDelimiter(text);
    const eol = text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : text.includes('\r') ? '\r' : '\n';
    const rows = [];
    let row = [];
    let field = '';
    let inQ = false;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"' && field === '') {
        inQ = true;
        i++;
      } else if (c === delim) {
        row.push(field);
        field = '';
        i++;
      } else if (c === '\r' || c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        if (c === '\r' && text[i + 1] === '\n') i++;
        i++;
      } else {
        field += c;
        i++;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    const header = rows.length ? rows[0] : [];
    const body = rows.slice(1);
    // Normalise la largeur des lignes sur celle de l'en-tête.
    const width = Math.max(header.length, ...body.map((r) => r.length), 0);
    while (header.length < width) header.push('Colonne ' + (header.length + 1));
    for (const r of body) while (r.length < width) r.push('');
    return { header, rows: body, delimiter: delim, eol };
  }

  function quote(value, delim) {
    if (value === '' || value == null) return '';
    const s = String(value);
    if (s.includes('"') || s.includes(delim) || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function serialize(table, opts) {
    const o = Object.assign({ delimiter: table.delimiter || ';', eol: table.eol || '\r\n', bom: true }, opts || {});
    const lines = [table.header, ...table.rows].map((r) => r.map((v) => quote(v, o.delimiter)).join(o.delimiter));
    return (o.bom ? '﻿' : '') + lines.join(o.eol) + o.eol;
  }

  V.csv = { decodeBytes, detectDelimiter, parse, serialize };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.csv;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ---- src/patterns.js ---- */
/*
 * Voile — motifs de données personnelles repérables par leur forme
 * (e-mail, téléphone, IBAN, SIRET, NIR, carte bancaire, IP, URL),
 * avec validation (clés de contrôle) pour limiter les faux positifs.
 */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});

  const digits = (s) => s.replace(/\D/g, '');

  function luhn(num) {
    let sum = 0;
    let alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = num.charCodeAt(i) - 48;
      if (alt) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function ibanValid(raw) {
    const s = raw.replace(/\s/g, '').toUpperCase();
    if (s.length < 15 || s.length > 34) return false;
    const r = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of r) {
      const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
    }
    return rem === 1;
  }

  // NIR : 13 chiffres + clé de contrôle (97 - n mod 97). Corse : 2A -> 19, 2B -> 18.
  function nirValid(raw) {
    const s = raw.replace(/\s/g, '').toUpperCase();
    if (!/^[12]\d{4}(\d{2}|2[AB])\d{6}\d{2}$/.test(s)) return false;
    const body = s.slice(0, 13).replace('2A', '19').replace('2B', '18');
    const key = parseInt(s.slice(13), 10);
    const n = BigInt(body);
    return 97 - Number(n % 97n) === key;
  }

  function ipValid(s) {
    const p = s.split('.');
    return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && +x <= 255);
  }

  // Ordre = priorité en cas de chevauchement.
  const PATTERNS = [
    {
      label: 'EMAIL',
      title: 'adresses e-mail',
      re: /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}/gu,
      valid: () => true,
    },
    {
      label: 'URL',
      title: 'adresses web',
      re: /\bhttps?:\/\/[^\s<>"')\]]+/gi,
      valid: () => true,
    },
    {
      label: 'IBAN',
      title: 'IBAN',
      re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g,
      valid: ibanValid,
    },
    {
      label: 'NIR',
      title: 'numéros de sécurité sociale',
      re: /\b[12][ .]?\d{2}[ .]?(?:0[1-9]|1[0-2]|[2-9]\d)[ .]?(?:\d{2}|2[AB])[ .]?\d{3}[ .]?\d{3}[ .]?\d{2}\b/g,
      valid: nirValid,
    },
    {
      label: 'SIRET',
      title: 'numéros SIRET',
      re: /\b\d{3}[ .]?\d{3}[ .]?\d{3}[ .]?\d{5}\b/g,
      valid: (s) => luhn(digits(s)),
    },
    {
      label: 'CB',
      title: 'numéros de carte bancaire',
      re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/g,
      valid: (s) => {
        const d = digits(s);
        return d.length >= 13 && d.length <= 19 && luhn(d);
      },
    },
    {
      label: 'TEL',
      title: 'numéros de téléphone',
      re: /(?<![\d.])(?:(?:\+|00)\d{1,3}[ .\-]?\(?0?\)?[ .\-]?[1-9](?:[ .\-]?\d{2}){4}|0[1-9](?:[ .\-]?\d{2}){4})(?![\d])/g,
      valid: (s) => {
        const n = digits(s).length;
        return n >= 10 && n <= 14;
      },
    },
    {
      label: 'IP',
      title: 'adresses IP',
      re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      valid: ipValid,
    },
  ];

  // Trouve toutes les occurrences validées, sans chevauchement (priorité à l'ordre de PATTERNS).
  function findAll(text) {
    const spans = [];
    const overlaps = (a, b) => spans.some((s) => a < s.end && b > s.start);
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      for (const m of text.matchAll(p.re)) {
        const start = m.index;
        const end = start + m[0].length;
        if (!p.valid(m[0]) || overlaps(start, end)) continue;
        spans.push({ start, end, label: p.label, text: m[0] });
      }
    }
    return spans.sort((a, b) => a.start - b.start);
  }

  // La valeur entière d'une cellule correspond-elle à un motif ? Renvoie le label ou null.
  function wholeMatch(value) {
    const v = value.trim();
    if (!v) return null;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      const m = p.re.exec(v);
      if (m && m.index === 0 && m[0].length === v.length && p.valid(v)) return p.label;
    }
    return null;
  }

  V.patterns = { PATTERNS, findAll, wholeMatch, luhn, ibanValid, nirValid };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.patterns;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ---- src/detect.js ---- */
/*
 * Voile — repérage automatique des colonnes à pseudonymiser.
 * Double détection : par nom de colonne ET par contenu.
 * Le résultat n'est qu'une proposition : l'utilisateur valide toujours.
 */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});

  // level : direct (identifie une personne), quasi (réidentifie par croisement), libre (texte libre à balayer)
  // Ordre = priorité : les règles spécifiques passent avant les génériques (« nom société » avant « nom »).
  const RULES = [
    { label: 'IBAN', level: 'direct', words: ['iban', 'rib', 'bic', 'swift'] },
    { label: 'NIR', level: 'direct', words: ['nir', 'secu', 'securite sociale', 'ssn', 'numero secu'] },
    { label: 'SIRET', level: 'direct', words: ['siret', 'siren', 'tva intracommunautaire', 'numero tva'] },
    { label: 'EMAIL', level: 'direct', words: ['email', 'e mail', 'mail', 'courriel', 'adresse mail', 'adresse email'] },
    { label: 'TEL', level: 'direct', words: ['tel', 'telephone', 'tél', 'mobile', 'portable', 'phone', 'fax', 'gsm'] },
    { label: 'SOCIETE', level: 'direct', words: ['societe', 'entreprise', 'company', 'raison sociale', 'organisation', 'organisme', 'fournisseur', 'enseigne', 'etablissement', 'employeur'] },
    { label: 'PRENOM', level: 'direct', words: ['prenom', 'prenoms', 'firstname', 'first name', 'given name', 'forename'] },
    { label: 'NOM', level: 'direct', words: ['nom', 'noms', 'nom de famille', 'nom usuel', 'nom naissance', 'lastname', 'last name', 'surname', 'family name', 'name'] },
    {
      label: 'PERSONNE',
      level: 'direct',
      words: ['nom complet', 'nom prenom', 'prenom nom', 'fullname', 'full name', 'client', 'contact', 'interlocuteur', 'salarie', 'employe', 'patient', 'beneficiaire', 'personne', 'auteur', 'responsable', 'commercial', 'vendeur', 'manager', 'destinataire', 'expediteur', 'titulaire', 'candidat', 'etudiant', 'eleve', 'stagiaire', 'collaborateur', 'utilisateur', 'user', 'customer', 'employee', 'owner', 'proprietaire', 'locataire', 'assure', 'adherent', 'membre', 'signataire', 'representant', 'gerant', 'dirigeant', 'conseiller', 'referent'],
    },
    { label: 'ADRESSE', level: 'direct', words: ['adresse', 'address', 'rue', 'voie', 'domicile', 'adresse postale', 'adresse complete', 'street', 'lieu dit'] },
    { label: 'IP', level: 'direct', words: ['ip', 'adresse ip', 'ip address'] },
    { label: 'ID', level: 'direct', words: ['id', 'identifiant', 'matricule', 'numero client', 'num client', 'code client', 'ref client', 'reference client', 'numero dossier', 'num dossier', 'numero contrat', 'num contrat', 'numero adherent', 'login', 'username', 'pseudo', 'uuid', 'numero salarie', 'numero patient', 'reference', 'ref', 'numero', 'num'] },
    { label: 'NAISSANCE', level: 'quasi', words: ['date naissance', 'date de naissance', 'naissance', 'birth', 'birthdate', 'dob', 'ne le', 'age'] },
    { label: 'CP', level: 'quasi', words: ['code postal', 'cp', 'zip', 'postal', 'zipcode', 'postcode'] },
    { label: 'VILLE', level: 'quasi', words: ['ville', 'city', 'commune', 'localite'] },
    { label: 'SALAIRE', level: 'quasi', words: ['salaire', 'remuneration', 'salary', 'revenu', 'revenus', 'brut annuel', 'net mensuel', 'paie', 'traitement'] },
    { label: 'TEXTE', level: 'libre', words: ['commentaire', 'commentaires', 'comment', 'comments', 'notes', 'note', 'remarque', 'remarques', 'observation', 'observations', 'description', 'message', 'objet', 'libelle', 'detail', 'details', 'memo', 'texte', 'text', 'motif', 'resume', 'contenu', 'body', 'verbatim', 'reponse', 'avis', 'historique', 'echange', 'compte rendu', 'cr'] },
  ];

  const EXPLAIN = {
    NIR: 'numéro de sécurité sociale',
    IBAN: 'coordonnées bancaires',
    SIRET: 'numéro d’entreprise (SIREN/SIRET)',
    EMAIL: 'adresse e-mail',
    TEL: 'numéro de téléphone',
    SOCIETE: 'nom d’organisation',
    PRENOM: 'prénom',
    NOM: 'nom de famille',
    PERSONNE: 'nom de personne',
    ADRESSE: 'adresse postale',
    IP: 'adresse IP',
    ID: 'identifiant',
    NAISSANCE: 'date de naissance / âge (quasi-identifiant)',
    CP: 'code postal (quasi-identifiant)',
    VILLE: 'ville (quasi-identifiant)',
    SALAIRE: 'donnée de rémunération (sensible)',
    TEXTE: 'texte libre (peut contenir des noms, e-mails, téléphones…)',
    URL: 'adresse web',
    CB: 'carte bancaire',
  };

  // "Date de Naissance", "dateNaissance", "NOM_client" -> "date de naissance", "date naissance", "nom client"
  function normalizeName(s) {
    return String(s)
      .replace(/([a-zà-ÿ\d])([A-ZÀ-Ý])/g, '$1 $2')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function matchByName(name) {
    const norm = normalizeName(name);
    if (!norm) return null;
    const tokens = norm.split(' ');
    const padded = ' ' + norm + ' ';
    // Passe 1 : expressions de plusieurs mots (« numéro client » doit l'emporter sur « client »).
    // Passe 2 : mots isolés, dans l'ordre de priorité des règles.
    // Jamais de sous-chaîne : « id » ne doit pas matcher « vidéo ».
    for (const multi of [true, false]) {
      for (const rule of RULES) {
        for (const w of rule.words) {
          const nw = normalizeName(w);
          if (!nw || nw.includes(' ') !== multi) continue;
          if (multi ? padded.includes(' ' + nw + ' ') : tokens.includes(nw)) {
            return { label: rule.label, level: rule.level, word: w };
          }
        }
      }
    }
    return null;
  }

  const NAME_LIKE = /^\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){1,3}$/u;

  function sample(values, max) {
    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== '');
    if (nonEmpty.length <= max) return nonEmpty;
    const step = nonEmpty.length / max;
    const out = [];
    for (let i = 0; i < max; i++) out.push(nonEmpty[Math.floor(i * step)]);
    return out;
  }

  function matchByContent(values) {
    const s = sample(values, 300);
    if (s.length < 3) return null;
    const P = V.patterns;
    const counts = {};
    let anywhere = 0;
    let totalLen = 0;
    let nameLike = 0;
    const seen = new Set();
    for (const raw of s) {
      const v = String(raw);
      totalLen += v.length;
      seen.add(v);
      const whole = P.wholeMatch(v);
      if (whole) counts[whole] = (counts[whole] || 0) + 1;
      if (P.findAll(v).length) anywhere++;
      if (NAME_LIKE.test(v.trim())) nameLike++;
    }
    const n = s.length;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] / n >= 0.6) return { label: best[0], level: 'direct', strength: 'forte', ratio: best[1] / n };
    const avg = totalLen / n;
    if (anywhere / n >= 0.05 && avg > 25) return { label: 'TEXTE', level: 'libre', strength: 'forte', ratio: anywhere / n, foundInside: true };
    if (avg > 80) return { label: 'TEXTE', level: 'libre', strength: 'moyenne', ratio: 1 };
    if (nameLike / n >= 0.7 && seen.size / n > 0.3) return { label: 'PERSONNE', level: 'direct', strength: 'faible', ratio: nameLike / n };
    return null;
  }

  /**
   * table : { header: string[], rows: string[][] }
   * Renvoie un descripteur par colonne.
   * mode : 'token' (remplacer chaque valeur par un jeton), 'scan' (texte libre : balayer), 'keep'
   */
  function detectColumns(table) {
    return table.header.map((name, index) => {
      const col = table.rows.map((r) => r[index]);
      const byName = matchByName(name);
      const byContent = matchByContent(col);
      const reasons = [];
      let label = null;
      let level = 'none';
      let confidence = 'aucune';

      if (byName && byContent) {
        if (byName.label === byContent.label || (byContent.label === 'TEXTE' && byName.level === 'libre')) {
          label = byName.label;
          level = byName.level;
          confidence = 'haute';
          reasons.push('le nom de colonne et le contenu concordent');
        } else if (byContent.strength === 'forte') {
          label = byContent.label;
          level = byContent.level;
          confidence = 'haute';
          reasons.push('le contenu ressemble à ' + EXPLAIN[byContent.label]);
        } else {
          label = byName.label;
          level = byName.level;
          confidence = 'moyenne';
          reasons.push('nom de colonne « ' + byName.word + ' »');
        }
      } else if (byName) {
        label = byName.label;
        level = byName.level;
        confidence = 'moyenne';
        reasons.push('nom de colonne « ' + byName.word + ' »');
      } else if (byContent) {
        label = byContent.label;
        level = byContent.level;
        confidence = byContent.strength === 'forte' ? 'haute' : byContent.strength === 'moyenne' ? 'moyenne' : 'faible';
        reasons.push(
          byContent.foundInside
            ? 'le texte contient des données personnelles (e-mails, téléphones…)'
            : byContent.label === 'TEXTE'
            ? 'cellules longues, probablement du texte libre'
            : byContent.label === 'PERSONNE'
            ? 'les valeurs ressemblent à des noms de personnes'
            : 'les valeurs ressemblent à ' + EXPLAIN[byContent.label]
        );
      }

      // Une colonne d'identifiants numériques 1..n sans lien avec une personne reste à la main de l'utilisateur,
      // mais on la propose (un identifiant client est une donnée personnelle indirecte).
      let mode = 'keep';
      if (level === 'direct') mode = 'token';
      else if (level === 'libre') mode = 'scan';
      const checked = (level === 'direct' || level === 'libre') && confidence !== 'faible';
      if (level === 'quasi') reasons.push('à anonymiser seulement si le croisement avec d’autres colonnes peut identifier quelqu’un');
      if (!checked && level === 'none') mode = 'keep';

      return {
        index,
        name,
        label: label || '',
        level,
        confidence,
        reasons,
        explain: label ? EXPLAIN[label] : '',
        mode: checked ? mode : 'keep',
        suggestedMode: mode,
        checked,
      };
    });
  }

  V.detect = { RULES, EXPLAIN, normalizeName, matchByName, matchByContent, detectColumns };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.detect;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ---- src/vault.js ---- */
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

/* ---- src/crypto.js ---- */
/*
 * Voile — fichier clé chiffré.
 * PBKDF2-SHA256 (600 000 itérations) -> AES-256-GCM, avec l'en-tête lié au chiffrement (AAD).
 * Tout passe par WebCrypto : aucune bibliothèque tierce.
 */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});

  const FORMAT = 'voile-cle';
  const VERSION = 1;
  const ITERATIONS = 600000;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  async function deriveKey(passphrase, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  const aad = (h) => enc.encode([h.format, h.v, h.kdf, h.hash, h.iter, h.salt, h.iv].join('|'));

  async function encryptVault(vault, passphrase) {
    if (!passphrase || passphrase.length < 8) throw new Error('Phrase de passe trop courte (8 caractères minimum, 16 recommandés).');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const header = { format: FORMAT, v: VERSION, kdf: 'PBKDF2', hash: 'SHA-256', iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv) };
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const plain = enc.encode(JSON.stringify(vault.toJSON()));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header) }, key, plain));
    return JSON.stringify(Object.assign({}, header, { ct: toB64(ct) }));
  }

  async function decryptVault(fileText, passphrase) {
    let h;
    try {
      h = JSON.parse(fileText);
    } catch (e) {
      throw new Error('Ce fichier n’est pas une clé Voile.');
    }
    if (!h || h.format !== FORMAT || h.v !== VERSION || h.kdf !== 'PBKDF2' || h.hash !== 'SHA-256') throw new Error('Format de clé non reconnu.');
    // Garde-fou : on refuse les paramètres anormaux d'un fichier trafiqué (déni de service par itérations).
    if (!Number.isInteger(h.iter) || h.iter < 100000 || h.iter > 5000000) throw new Error('Paramètres de clé invalides.');
    const key = await deriveKey(passphrase, fromB64(h.salt), h.iter);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(h.iv), additionalData: aad(h) }, key, fromB64(h.ct));
    } catch (e) {
      throw new Error('Phrase de passe incorrecte, ou fichier clé altéré.');
    }
    return V.Vault.fromJSON(JSON.parse(dec.decode(plain)));
  }

  // Phrase de passe aléatoire : 5 groupes de 4 caractères d'un alphabet sans ambiguïté (~ 100 bits).
  function generatePassphrase() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symboles = 5 bits chacun
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    let s = '';
    for (let i = 0; i < 20; i++) {
      s += alphabet[bytes[i] & 31];
      if (i % 4 === 3 && i < 19) s += '-';
    }
    return s;
  }

  V.keyfile = { encryptVault, decryptVault, generatePassphrase, ITERATIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.keyfile;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ---- src/xlsx.js ---- */
/*
 * Voile — lecture et écriture de classeurs .xlsx, sans dépendance.
 * Lecture : première feuille uniquement, valeurs (pas de formules), dates converties en texte ISO.
 * Écriture : classeur simple (une feuille, en-tête en gras et figé).
 * ZIP via CompressionStream / DecompressionStream ('deflate-raw'), disponibles dans les navigateurs récents et Node 18+.
 */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});

  const MAX_ENTRY = 120 * 1024 * 1024; // garde-fou contre les « bombes » de décompression
  const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const utf8 = new TextDecoder('utf-8');
  const enc = new TextEncoder();

  // ---------- ZIP : lecture ----------
  async function inflateRaw(data, limit) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(data).catch(() => {});
    w.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Error('Fichier Excel anormalement volumineux une fois décompressé.');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  function zipEntries(u8) {
    const d = dv(u8);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Ce fichier n’est pas un classeur Excel valide.');
    const count = d.getUint16(eocd + 10, true);
    let p = d.getUint32(eocd + 16, true);
    const map = new Map();
    for (let n = 0; n < count; n++) {
      if (d.getUint32(p, true) !== 0x02014b50) throw new Error('Archive Excel corrompue.');
      const flags = d.getUint16(p + 8, true);
      const method = d.getUint16(p + 10, true);
      const csize = d.getUint32(p + 20, true);
      const usize = d.getUint32(p + 24, true);
      const nlen = d.getUint16(p + 28, true);
      const xlen = d.getUint16(p + 30, true);
      const clen = d.getUint16(p + 32, true);
      const off = d.getUint32(p + 42, true);
      const name = utf8.decode(u8.subarray(p + 46, p + 46 + nlen));
      map.set(name, { flags, method, csize, usize, off });
      p += 46 + nlen + xlen + clen;
    }
    return map;
  }

  async function zipRead(u8, map, name) {
    const e = map.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new Error('Ce classeur est protégé par mot de passe : enregistrez-en une copie sans protection.');
    if (e.usize > MAX_ENTRY) throw new Error('Fichier Excel anormalement volumineux.');
    const d = dv(u8);
    if (d.getUint32(e.off, true) !== 0x04034b50) throw new Error('Archive Excel corrompue.');
    const start = e.off + 30 + d.getUint16(e.off + 26, true) + d.getUint16(e.off + 28, true);
    const raw = u8.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateRaw(raw, MAX_ENTRY);
    throw new Error('Méthode de compression Excel non prise en charge.');
  }

  // ---------- XML (motifs limités et connus) ----------
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unesc = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
    }
    return ENT[e];
  });
  const attr = (s, name) => {
    const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(s);
    return m ? unesc(m[1]) : null;
  };
  const textOf = (xml) => {
    // concatène les <t> d'un <si>/<is>, en ignorant les annotations phonétiques
    const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let out = '';
    for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += m[1] ? unesc(m[1]) : '';
    return out;
  };

  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref);
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function dateStyles(stylesXml) {
    const flags = [];
    if (!stylesXml) return flags;
    const custom = new Map();
    for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) custom.set(+attr(m[1], 'numFmtId'), attr(m[1], 'formatCode') || '');
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    if (!xfs) return flags;
    for (const m of xfs[1].matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
      const id = +attr(m[1], 'numFmtId');
      const code = (custom.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
      flags.push(BUILTIN_DATE.has(id) || (custom.has(id) && /[dmyhs]/i.test(code) && !/^general$/i.test(code)));
    }
    return flags;
  }

  function serialToText(serial) {
    const ms = Math.round((serial - (serial >= 61 ? 25569 : 25568)) * 86400000);
    const d = new Date(ms);
    if (isNaN(d)) return String(serial);
    const iso = d.toISOString();
    return Number.isInteger(serial) ? iso.slice(0, 10) : iso.slice(0, 10) + ' ' + iso.slice(11, 19);
  }

  async function read(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const map = zipEntries(u8);
    const getText = async (n) => { const b = await zipRead(u8, map, n); return b ? utf8.decode(b) : null; };
    const wb = await getText('xl/workbook.xml');
    if (!wb) throw new Error('Ce fichier n’est pas un classeur Excel (.xlsx) valide.');
    const sheets = [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({ name: attr(m[1], 'name'), rid: attr(m[1], 'r:id') }));
    if (!sheets.length) throw new Error('Le classeur ne contient aucune feuille.');
    const rels = (await getText('xl/_rels/workbook.xml.rels')) || '';
    let target = null;
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) if (attr(m[1], 'Id') === sheets[0].rid) target = attr(m[1], 'Target');
    if (!target) throw new Error('Feuille introuvable dans le classeur.');
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.?\//, '');
    const sheetXml = await getText(path);
    if (!sheetXml) throw new Error('Feuille introuvable dans le classeur.');

    const sst = [];
    const sstXml = await getText('xl/sharedStrings.xml');
    if (sstXml) for (const m of sstXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) sst.push(m[1] ? textOf(m[1]) : '');
    const isDate = dateStyles(await getText('xl/styles.xml'));

    const rows = [];
    for (const rm of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rIdx = attr(rm[1], 'r') ? +attr(rm[1], 'r') - 1 : rows.length;
      if (rIdx > 1100000) throw new Error('Feuille Excel invalide.');
      const row = rows[rIdx] || (rows[rIdx] = []);
      let next = 0;
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r');
        const ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        if (ci > 16384) continue;
        const t = attr(cm[1], 't');
        const inner = cm[2] || '';
        const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        const v = vm ? unesc(vm[1]) : '';
        let val = '';
        if (t === 's') val = sst[+v] != null ? sst[+v] : '';
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'b') val = v === '1' ? 'VRAI' : 'FAUX';
        else if (t === 'e') val = v;
        else if (t === 'str') val = v;
        else if (v !== '') {
          const s = attr(cm[1], 's');
          const n = Number(v);
          val = s != null && isDate[+s] && isFinite(n) ? serialToText(n) : v;
        }
        row[ci] = val;
      }
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    // retire les lignes vides de fin
    while (rows.length && rows[rows.length - 1].every((c) => c == null || c === '')) rows.pop();
    const width = Math.max(0, ...rows.map((r) => r.length));
    const grid = rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] == null ? '' : r[i])));
    if (!grid.length) throw new Error('La première feuille est vide.');
    const header = grid[0].map((h, i) => (String(h).trim() ? String(h) : 'Colonne ' + (i + 1)));
    const table = { header, rows: grid.slice(1), delimiter: ';', eol: '\n', sheetName: sheets[0].name };
    if (sheets.length > 1) table.notice = 'Seule la première feuille (« ' + sheets[0].name + ' ») est traitée ; les ' + (sheets.length - 1) + ' autre(s) ne sont pas incluses.';
    return table;
  }

  // ---------- ZIP : écriture ----------
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function deflateRaw(u8) {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(u8).catch(() => {});
    w.close().catch(() => {});
    const reader = cs.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }
  async function zipWrite(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, data] of files) {
      const nameB = enc.encode(name);
      const comp = await deflateRaw(data);
      const crc = crc32(data);
      const lh = new Uint8Array(30 + nameB.length);
      const l = dv(lh);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 8, true);
      l.setUint16(10, 0, true); l.setUint16(12, 0x21, true); // 1980-01-01
      l.setUint32(14, crc, true); l.setUint32(18, comp.length, true); l.setUint32(22, data.length, true);
      l.setUint16(26, nameB.length, true); lh.set(nameB, 30);
      parts.push(lh, comp);
      const ch = new Uint8Array(46 + nameB.length);
      const c = dv(ch);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 8, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, nameB.length, true); c.setUint32(42, offset, true); ch.set(nameB, 46);
      central.push(ch);
      offset += lh.length + comp.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const eocd = new Uint8Array(22);
    const e = dv(eocd);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const all = [...parts, ...central, eocd];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const b of all) { out.set(b, p); p += b.length; }
    return out;
  }

  // ---------- XLSX : écriture ----------
  const xmlEsc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function colName(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }
  const isPlainNumber = (s) => /^-?(0|[1-9]\d{0,14})(\.\d{1,10})?$/.test(s) && s !== '-0';

  async function write(table) {
    const sst = new Map();
    const sstList = [];
    const sIdx = (s) => {
      let i = sst.get(s);
      if (i === undefined) { i = sstList.length; sst.set(s, i); sstList.push(s); }
      return i;
    };
    const lines = [];
    const all = [table.header, ...table.rows];
    all.forEach((row, r) => {
      const cells = [];
      row.forEach((val, c) => {
        const s = val == null ? '' : String(val);
        if (s === '') return;
        const ref = colName(c) + (r + 1);
        const style = r === 0 ? ' s="1"' : '';
        if (r > 0 && isPlainNumber(s)) cells.push(`<c r="${ref}"><v>${s}</v></c>`);
        else cells.push(`<c r="${ref}"${style} t="s"><v>${sIdx(s)}</v></c>`);
      });
      lines.push(`<row r="${r + 1}">${cells.join('')}</row>`);
    });
    const width = Math.max(1, table.header.length);
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="${width}" width="22" customWidth="1"/></cols><sheetData>${lines.join('')}</sheetData></worksheet>`;
    const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${ns}" count="${sstList.length}" uniqueCount="${sstList.length}">${sstList.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const files = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${R}"><sheets><sheet name="Données" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/></Relationships>`],
      ['xl/worksheets/sheet1.xml', sheet],
      ['xl/sharedStrings.xml', sstXml],
      ['xl/styles.xml', styles],
    ].map(([n, x]) => [n, enc.encode(x)]);
    return zipWrite(files);
  }

  V.xlsx = { read, write };
  if (typeof module !== 'undefined' && module.exports) module.exports = V.xlsx;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ---- src/ui.js ---- */
/* Voile — petites aides d'interface (aucun innerHTML : tout le contenu est inséré en textContent). */
(function (root) {
  'use strict';
  const V = (root.Voile = root.Voile || {});
  const MAX_BYTES = 25 * 1024 * 1024;

  const $ = (sel, scope) => (scope || document).querySelector(sel);

  // el('div', { class: 'x', text: '...', on: { click: fn }, attrs: { role: 'alert' } }, child1, child2)
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    const p = props || {};
    if (p.class) n.className = p.class;
    if (p.text != null) n.textContent = p.text;
    if (p.attrs) for (const [k, v] of Object.entries(p.attrs)) n.setAttribute(k, v);
    if (p.on) for (const [k, fn] of Object.entries(p.on)) n.addEventListener(k, fn);
    for (const k of kids) if (k != null) n.append(k);
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function show(node, visible) {
    node.hidden = !visible;
  }

  function showError(node, msg) {
    node.textContent = msg || '';
    node.hidden = !msg;
  }

  // Lit un fichier choisi ou déposé. Renvoie { name, ext, bytes }.
  async function readFile(file) {
    if (file.size > MAX_BYTES) throw new Error('Fichier trop volumineux (' + Math.round(file.size / 1048576) + ' Mo). Limite : 25 Mo.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const m = /\.([A-Za-z0-9]+)$/.exec(file.name);
    return { name: file.name, ext: m ? m[1].toLowerCase() : '', base: file.name.replace(/\.[^.]+$/, ''), bytes };
  }

  function download(name, data, type) {
    const blob = new Blob([data], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { attrs: { href: url, download: name } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Branche glisser-déposer + sélection sur une zone .drop.
  function bindDrop(zone, input, onFile) {
    const run = (f) => f && onFile(f);
    input.addEventListener('change', () => {
      run(input.files[0]);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove('over');
      })
    );
    zone.addEventListener('drop', (e) => run(e.dataTransfer.files[0]));
  }

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function truncate(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // Affiche un texte en surlignant les jetons (PERSONNE_001…).
  function withTokens(text, container) {
    const re = /(?<![A-Za-z0-9])[A-Z]{2,12}_\d{3,}(?!\d)/g;
    let pos = 0;
    for (const m of String(text).matchAll(re)) {
      if (m.index > pos) container.append(text.slice(pos, m.index));
      container.append(el('span', { class: 'tok', text: m[0] }));
      pos = m.index + m[0].length;
    }
    if (pos < text.length) container.append(text.slice(pos));
    return container;
  }

  V.ui = { $, el, clear, show, showError, readFile, download, bindDrop, stamp, truncate, withTokens };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* ---- src/app-mask.js ---- */
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

/* ---- src/app-restore.js ---- */
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

/* ---- src/main.js ---- */
/* Voile — démarrage : onglets, démonstration d'accueil, service worker (hors ligne). */
(function (root) {
  'use strict';
  const V = root.Voile;
  const { $ } = V.ui;

  function initTabs() {
    const tabs = [$('#tab-masquer'), $('#tab-restituer')];
    const panels = [$('#panel-masquer'), $('#panel-restituer')];
    const select = (i, focus) => {
      tabs.forEach((t, k) => {
        t.setAttribute('aria-selected', String(k === i));
        t.tabIndex = k === i ? 0 : -1;
        panels[k].hidden = k !== i;
      });
      if (focus) tabs[i].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') select((i + 1) % tabs.length, true);
        if (e.key === 'ArrowLeft') select((i + tabs.length - 1) % tabs.length, true);
      });
    });
  }

  // Un seul moment animé : les barres couvrent les données, puis les codes apparaissent.
  function initDemo() {
    const demo = $('#demo');
    const btns = [...demo.querySelectorAll('.seg button')];
    let timers = [];
    const set = (etat) => {
      demo.dataset.etat = etat;
      btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.etat === (etat === 'barre' ? 'jeton' : etat))));
    };
    const stop = () => { timers.forEach(clearTimeout); timers = []; };
    btns.forEach((b) => b.addEventListener('click', () => { stop(); set(b.dataset.etat); }));
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return set('jeton');
    timers.push(setTimeout(() => set('barre'), 900), setTimeout(() => set('jeton'), 1800));
  }

  function init() {
    initTabs();
    initDemo();
    V.appMask.init();
    V.appRestore.init();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
