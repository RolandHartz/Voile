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
