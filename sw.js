const CACHE_NAME = 'films-famille-v2';

// Assets to pre-cache on install (app shell)
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/easter-eggs.js',
    '/easter-eggs.css',
    '/manifest.json',
    '/assets/poster_placeholder_vertical.svg',
    '/assets/poster_placeholder_small.svg',
    '/assets/poster_placeholder_horizontal.svg',
    '/assets/192x192.png',
];

// External origins to cache with cache-first strategy
const CACHE_FIRST_ORIGINS = [
    'image.tmdb.org',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'unpkg.com',
];

// ─── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
    );
    self.skipWaiting();
});

// ─── Activate: purge old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    clients.claim();
});

// ─── Fetch: route requests to the right strategy ──────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 1. Network-only: API calls (always fresh data)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkOnly(request));
        return;
    }

    // 2. Cache-first: static assets & external CDNs (images, fonts, libraries)
    if (CACHE_FIRST_ORIGINS.some((origin) => url.hostname.includes(origin))) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // 3. Stale-while-revalidate: app shell (HTML, CSS, JS)
    if (
        request.destination === 'document' ||
        request.destination === 'script' ||
        request.destination === 'style'
    ) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // 4. Default: network with cache fallback
    event.respondWith(networkWithCacheFallback(request));
});

// ─── Strategies ───────────────────────────────────────────────────────────────

async function networkOnly(request) {
    try {
        return await fetch(request);
    } catch {
        return new Response(
            JSON.stringify({ error: 'Offline – cette requête nécessite une connexion.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Offline', { status: 503 });
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const networkFetch = fetch(request)
        .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    return cached || (await networkFetch) || new Response('Offline', { status: 503 });
}

async function networkWithCacheFallback(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        return cached || new Response('Offline', { status: 503 });
    }
}
