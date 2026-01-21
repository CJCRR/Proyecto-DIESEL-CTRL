const CACHE_NAME = 'diesel-ctrl-v2';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/dashboard.html',
    '/dashboard.js',
    '/clientes.html',
    '/clientes.js',
    '/db-local.js',
    '/firebase-config.js',
    '/firebase-sync.js',
    '/shared/nota-template.js'
];

// Utilidades mínimas de IndexedDB dentro del SW (evitar importScripts)
const SW_DB_NAME = 'DieselCtrlDB';
const SW_DB_VERSION = 2;
const SW_STORE_VENTAS = 'ventas_pendientes';

function swAbrirIndexedDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SW_DB_NAME, SW_DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (ev) => {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains(SW_STORE_VENTAS)) {
                const s = db.createObjectStore(SW_STORE_VENTAS, { keyPath: 'id_global' });
                s.createIndex('sync', 'sync', { unique: false });
            }
        };
    });
}

function swObtenerVentasPendientes(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([SW_STORE_VENTAS], 'readonly');
        const st = tx.objectStore(SW_STORE_VENTAS);
        const rq = st.getAll();
        rq.onerror = () => reject(rq.error);
        rq.onsuccess = () => {
            const all = rq.result || [];
            resolve(all.filter(v => !v.sync));
        };
    });
}

function swMarcarComoSincronizada(db, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([SW_STORE_VENTAS], 'readwrite');
        const st = tx.objectStore(SW_STORE_VENTAS);
        const get = st.get(id);
        get.onsuccess = () => {
            const venta = get.result;
            if (!venta) return resolve();
            venta.sync = true;
            const put = st.put(venta);
            put.onsuccess = () => resolve();
            put.onerror = () => reject(put.error);
        };
        get.onerror = () => reject(get.error);
    });
}

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
    if (event.request.method !== 'GET') return; // dejar pasar POST/PUT/etc.
    const url = new URL(event.request.url);
    // No interceptar recursos de terceros (Firebase, Google, CDNs, etc.)
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        try {
            const networkResponse = await fetch(event.request);
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
        } catch (err) {
            const cached = await caches.match(event.request);
            if (cached) return cached;
            const fallback = await caches.match('/index.html');
            return fallback || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
    })());
});

// Background Sync para sincronizar ventas
self.addEventListener('sync', event => {
    if (event.tag === 'sync-ventas') {
        event.waitUntil(sincronizarVentas());
    }
});

async function sincronizarVentas() {
    const db = await swAbrirIndexedDB();
    const ventasPendientes = await swObtenerVentasPendientes(db);

    for (const venta of ventasPendientes) {
        try {
            await fetch('/ventas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(venta)
            });
            await swMarcarComoSincronizada(db, venta.id_global);
        } catch (err) {
            console.error('Error sincronizando desde SW:', err);
        }
    }
}