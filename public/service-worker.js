const CACHE_NAME = 'diesel-ctrl-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/app.js',
    '/styles.css'
];

// Instalación
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('Cache creado');
            return cache.addAll(urlsToCache);
        })
    );
    self.skipWaiting();
});

// Activación
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch - Network First, luego Cache
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                const clonedResponse = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, clonedResponse);
                });
                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});

// Background Sync para sincronizar ventas
self.addEventListener('sync', event => {
    if (event.tag === 'sync-ventas') {
        event.waitUntil(sincronizarVentas());
    }
});

async function sincronizarVentas() {
    const db = await abrirIndexedDB();
    const ventasPendientes = await obtenerVentasPendientes(db);
    
    for (const venta of ventasPendientes) {
        try {
            await fetch('/ventas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(venta)
            });
            await marcarComoSincronizada(db, venta.id_global);
        } catch (err) {
            console.error('Error sincronizando:', err);
        }
    }
}