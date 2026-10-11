// Keeps the owner app's own screen available offline. It never caches Shopify, Gmail, Supabase data or any other site.
const CACHE = 'cd-owner-v4';
const SHELL = ['owner.html', 'owner.js', 'owner.webmanifest', 'assets/owner.css?v=2', 'assets/owner-icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((p) => new URL(p, self.registration.scope).href)).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('cd-owner-') && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isShell = url.pathname.endsWith('/owner.html') || url.pathname.endsWith('/owner.js') || url.pathname.endsWith('/owner.webmanifest') || url.pathname.includes('/assets/owner');
  if (!isShell) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
