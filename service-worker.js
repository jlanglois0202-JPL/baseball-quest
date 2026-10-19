// Network first, so families always get the newest version. The saved copy
// is only a fallback for a weak connection. (The prototype's worker served
// its cached copy forever; changing the cache name and clearing old caches
// below replaces it on phones that installed the prototype.)
const CACHE = 'baseball-quest-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req);
      return hit || caches.match('./');
    }
  })());
});
