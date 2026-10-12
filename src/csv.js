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
