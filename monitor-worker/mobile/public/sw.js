const CACHE = 'gs-status-shell-v1';
const CORE = ['/', '/manifest.webmanifest', '/assets/brand-sigil.png', '/assets/hero-galaxy.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, clone)));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/'))),
  );
});
