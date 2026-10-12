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
