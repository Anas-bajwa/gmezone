/*
 * GameZone service worker — cache-first PWA strategy.
 * Core shell (hub + solo games) is precached, so Snake and Memory Match
 * work fully offline. Multiplayer needs the live server by design.
 */
const CACHE = 'gamezone-v1';
const CORE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/client.js',
  '/sound.js',
  '/manifest.json',
  '/favicon.svg',
  '/games/snake.html',
  '/games/memory.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // don't cache third-party

  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        // only cache good, same-origin responses
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => {
        // offline fallback: navigation requests get the hub shell
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        return caches.match(e.request);
      });
    })
  );
});
