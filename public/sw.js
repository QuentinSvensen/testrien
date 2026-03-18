const CACHE_NAME = 'mealscards-v2';
const STATIC_ASSETS = [
  '/',
  '/repas',
  '/aliments',
  '/planning',
  '/courses',
  '/manifest.json',
  '/favicon.ico',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: do not cache Vite dev module requests (prevents stale React chunks)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  const isViteDevRequest =
    url.pathname.startsWith('/@vite') ||
    url.pathname.startsWith('/@id/') ||
    url.pathname.startsWith('/node_modules/.vite/') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.includes('hot-update');

  // Let network handle Vite dev/runtime chunks directly
  if (isViteDevRequest) return;

  // Backend API calls: network-only
  if (url.hostname.includes('supabase')) return;

  // Assets/app shell: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
