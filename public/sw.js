const CACHE = 'operation-shell-v1';
const BASE = new URL('./', self.location.href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(new URL('index.html', BASE), { cache: 'reload' });
    if (!response.ok) throw new Error('Shell unavailable');
    const html = await response.clone().text();
    const assetPaths = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|svg))"/g)].map(m => new URL(m[1], BASE));
    await cache.addAll([new URL('manifest.webmanifest', BASE).href, ...assetPaths.map(u => u.href)]);
    await cache.put(new URL('index.html', BASE), response);
    // Wait for existing tabs to close; never activate a new bundle mid-operation.
  })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('operation-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // No API, authentication, signed files, or runtime user data enter CacheStorage.
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname) || url.search) return;
  if (event.request.mode === 'navigate') {
    // Serve one complete release until the next worker activates. A newer network
    // index may reference assets absent from this worker's offline cache.
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(new URL('index.html', BASE))) || fetch(event.request)));
  } else if (/\.(?:js|css|svg|webmanifest)$/.test(url.pathname)) {
    // Vite/static hosts may send Vary: Origin. Module requests include an Origin
    // header unlike precache requests; these public same-origin files are identical.
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request)));
  }
});
