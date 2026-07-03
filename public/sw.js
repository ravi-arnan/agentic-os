// Minimal service worker: required for installability. The app is a live
// dashboard reading local data, so we DON'T cache API responses (they must be
// fresh). We only satisfy the PWA fetch-handler requirement and let the
// browser serve the app shell normally.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  // Never intercept API calls or the SSE stream — always hit the network.
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  // Network-first, no offline cache: keeps the shell simple and always current.
  event.respondWith(fetch(event.request).catch(() => new Response('offline', { status: 503 })));
});
