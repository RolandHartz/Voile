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
