/* Voile — service worker : permet d'utiliser le site sans connexion après la première visite.
 * Réseau d'abord (pour recevoir tout correctif de sécurité), cache en secours.
 * Il ne voit jamais vos fichiers : ils ne passent pas par le réseau. */
const CACHE = 'voile-2778dd49ca';
const SHELL = ['./', 'index.html', 'style.css', 'voile.js', 'favicon.svg', 'voile-hors-ligne.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
