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
