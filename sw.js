/*
  Baccarat Gladiator — Service Worker
  Strategy: Cache-first for static assets, network-first for API calls.
  On install: pre-cache core shell. On activate: purge old caches.
*/

const CACHE_VERSION = 'bg-v71';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Core shell — cached on install so the game works offline
const SHELL_ASSETS = [
  '/baccarat-scoreboard.html',
  '/manifest.json',
  '/bg-card.png',
  '/baccarat-gladiator-logo.svg',
  '/baccarat-link-preview.png',
];

// ── INSTALL: pre-cache shell ─────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// ── ACTIVATE: delete stale caches ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('bg-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
     .then(() => {
        // Tell all controlled tabs to reload — they were rendered with the previous
        // SW's cached HTML and won't see the new build until they reload.
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(c => { try { c.postMessage({ type: 'sw-updated', version: CACHE_VERSION }); } catch (e) {} });
        });
      })
  );
});

// ── FETCH: cache-first for assets, network-first for API ────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and cross-origin API requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !url.hostname.endsWith('fonts.googleapis.com') && !url.hostname.endsWith('fonts.gstatic.com')) return;

  // Network-first for API (Cognito / Lambda)
  if (url.hostname.includes('amazonaws.com') || url.hostname.includes('amazoncognito.com') || url.hostname.includes('firebase')) {
    event.respondWith(fetch(request));
    return;
  }

  // Network-first for the active build pages and their JS module — these are the
  // pages users actively reload and we never want them stuck on a stale build.
  // Cache acts as offline fallback only.
  const isActiveBuild = url.pathname === '/' ||
                        url.pathname === '/index.html' ||
                        url.pathname === '/road-to-nine.html' ||
                        url.pathname === '/road-to-lv.html' ||
                        url.pathname === '/road-to-mc.html' ||
                        url.pathname === '/baccarat-scoreboard.html' ||
                        url.pathname === '/three.module.js';
  if (isActiveBuild) {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for everything else (images, fonts, smaller assets)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'error') return response;
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => {
        if (request.destination === 'document') {
          return caches.match('/baccarat-scoreboard.html');
        }
      });
    })
  );
});

// ── PUSH NOTIFICATIONS ───────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Baccarat Gladiator';
  const options = {
    body:    data.body    || 'Your daily bonus is ready!',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-72.png',
    tag:     data.tag     || 'bg-notification',
    data:    { url: data.url || '/baccarat-scoreboard.html' },
    actions: [{ action: 'play', title: '♠ Play Now' }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/baccarat-scoreboard.html';
  event.waitUntil(clients.openWindow(url));
});
