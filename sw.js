// sw.js — offline app shell + opportunistic DEM caching.
//
// The app shell (HTML/CSS/JS) is precached so the app launches with no network.
// DEM tiles are separately persisted in IndexedDB by dem.js; here we also
// runtime-cache the WMS responses so a hard reload after a flight still has them.

const SHELL = 'synthvis-shell-v13';
const TILES = 'synthvis-wms-v2';
const APP = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './js/main.js', './js/geo.js', './js/dem.js', './js/mesh.js',
  './js/render.js', './js/hud.js', './js/nav.js', './js/summits.js', './js/airports.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.hostname === 'data.geopf.fr') {
    // Cache-first: elevation never changes, and offline is the whole point.
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
