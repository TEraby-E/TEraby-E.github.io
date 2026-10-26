'use strict';

const PREFIX = `sjtu-checkin-${new URL(self.registration.scope).pathname}-`;
const CACHE = `${PREFIX}v22`;
const RELEASE = '20261026-performance-2';
const FILES = [
  './', './index.html', './styles.css', './cards.css', './app.js', './study-time.js', './storage.js', './export-image.js',
  './manifest.webmanifest', './data/library.json', './assets/sjtu-emblem-round.svg', './assets/app-icon-192.png', './assets/app-icon-512.png',
  './assets/study-backdrop.svg', './assets/paper-texture.svg'
];
const allowed = new Set(FILES.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all([...allowed].map(async (key) => {
    const url = new URL(key);
    if (!url.pathname.endsWith('/') && !url.pathname.endsWith('/index.html')) url.searchParams.set('v', RELEASE);
    const response = await fetch(new Request(url.href, { cache: 'reload' }));
    if (!response.ok) throw new Error(`Precache failed: ${url.pathname}`);
    await cache.put(key, response);
  }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const requestedRelease = url.searchParams.get('v');
  url.search = '';
  url.hash = '';
  if (!allowed.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(url.href);
    const isDocument = request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
    // This cache is replaced as a unit when the service worker release changes.
    // Static versioned assets need no network round trip on repeat visits.
    if (cached && !isDocument && (!requestedRelease || requestedRelease === RELEASE)) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(url.href, response.clone());
      return response.ok || !cached ? response : cached;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })());
});
