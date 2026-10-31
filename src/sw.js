// Service worker: makes Lark work offline and serves library exports as streamed downloads.
// It only ever manages its own caches — the library (IndexedDB + OPFS) is never touched by updates.
const VERSION = __VERSION__;
const ASSETS = __ASSETS__;
const CACHE = `lark-app-${VERSION}`;
const exportsById = new Map();

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lark-app-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'skipWaiting') self.skipWaiting();
  if (d.type === 'export') { exportsById.set(d.id, d); e.ports[0]?.postMessage('ok'); }
  if (d.type === 'ping') e.waitUntil(new Promise((r) => setTimeout(r, 1000)));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const m = url.pathname.match(/\/__export\/([\w-]+)$/);
  if (m) {
    const x = exportsById.get(m[1]);
    if (!x) return e.respondWith(new Response('Export expired', { status: 404 }));
    exportsById.delete(m[1]);
    return e.respondWith(new Response(x.stream, { headers: {
      'Content-Type': 'application/zip', 'Content-Length': String(x.size),
      'Content-Disposition': `attachment; filename="${x.name}"`,
    } }));
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (e.request.mode === 'navigate') return (await cache.match('./')) || fetch(e.request);
    return (await cache.match(e.request, { ignoreSearch: true })) || fetch(e.request);
  })());
});
