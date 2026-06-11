// Service worker de la PWA: instala la "shell" y sirve offline lo estático.
// No intercepta socket.io (el multijugador necesita la red).
const CACHE = 'fps-arena-v6';
const ASSETS = [
  '/', '/index.html', '/css/style.css',
  '/js/main.js', '/js/audio.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/socket.io')) return; // dejar pasar el multijugador
  // network-first (siempre la última versión) con respaldo en caché si no hay red
  e.respondWith(
    fetch(e.request).then((res) => {
      if (url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
