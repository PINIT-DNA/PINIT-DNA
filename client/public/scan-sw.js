const SHELL = [
  '/scan',
  '/scan-manifest.webmanifest',
  '/scan-icon-192.png',
  '/scan-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('pinit-scan-shell-v1').then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(
    caches.open('pinit-scan-shell-v1').then(async (cache) => {
      const hit = await cache.match(event.request);
      const fresh = fetch(event.request).then((res) => {
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    }),
  );
});
