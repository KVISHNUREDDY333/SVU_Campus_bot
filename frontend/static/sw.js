const CACHE_NAME = 'svu-campus-bot-v1';
const ASSETS = [
    '/',
    '/static/style.css',
    '/static/script.js',
    '/static/images/svu_logo_final_v2.jpg',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    e.respondWith(
        caches.match(e.request).then((response) => {
            // Return cached if found, otherwise fetch network
            return response || fetch(e.request).catch(() => {
                // Fallback or "You are offline" message logic could go here
            });
        })
    );
});
