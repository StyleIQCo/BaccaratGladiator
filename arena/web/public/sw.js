// Arena-scoped service worker. Registered with { scope: '/arena/' } so it NEVER
// touches the classic game. Network-first for the app shell, and it explicitly
// refuses to cache the config files so the kill switch is always live.
const CACHE = 'arena-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('arena-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // NEVER cache config (kill switch / round tuning) or the WS upgrade.
  if (url.pathname.startsWith('/arena/config/') || url.pathname.startsWith('/arena/ws')) return;
  // Network-first; fall back to cache offline.
  event.respondWith(
    fetch(event.request)
      .then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(event.request, c)); return res; })
      .catch(() => caches.match(event.request))
  );
});
