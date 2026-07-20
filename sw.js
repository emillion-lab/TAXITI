// Minimal service worker - required for PWA installability
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', e => {
  // Simple pass-through network fetch, no caching complexity
  e.respondWith(fetch(e.request));
});
