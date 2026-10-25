'use strict';

const PREFIX = `sjtu-checkin-${new URL(self.registration.scope).pathname}-`;
const CACHE = `${PREFIX}v5`;
const FILES = [
  './', './index.html', './styles.css', './app.js', './study-time.js', './storage.js', './export-image.js',
  './manifest.webmanifest', './data/library.json', './assets/sjtu-emblem.png',
  './assets/sjtu-emblem.ico', './assets/app-icon-192.png', './assets/app-icon-512.png',
  './assets/study-backdrop.svg', './assets/paper-texture.svg'
];
const allowed = new Set(FILES.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...allowed])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  url.search = '';
  url.hash = '';
  if (!allowed.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(url.href, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(url.href);
      if (cached) return cached;
      throw error;
    }
  })());
});
