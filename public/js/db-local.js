const DB_NAME = 'DieselCtrlDB';
const DB_VERSION = 2;
const STORES = {
    VENTAS: 'ventas_pendientes',
    PRODUCTOS: 'productos',
    SINCRONIZADAS: 'ventas_sincronizadas',
    CLIENTES: 'clientes'
};

async function abrirIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Store para ventas pendientes
            if (!db.objectStoreNames.contains(STORES.VENTAS)) {
                const ventasStore = db.createObjectStore(STORES.VENTAS, { keyPath: 'id_global' });
                ventasStore.createIndex('sync', 'sync', { unique: false });
            }

            // Store para productos locales
            if (!db.objectStoreNames.contains(STORES.PRODUCTOS)) {
                db.createObjectStore(STORES.PRODUCTOS, { keyPath: 'codigo' });
            }

            // Store para ventas sincronizadas
            if (!db.objectStoreNames.contains(STORES.SINCRONIZADAS)) {
                db.createObjectStore(STORES.SINCRONIZADAS, { keyPath: 'id_global' });
            }

            // Store para clientes frecuentes
            if (!db.objectStoreNames.contains(STORES.CLIENTES)) {
                const clientesStore = db.createObjectStore(STORES.CLIENTES, { keyPath: 'cedula' });
                clientesStore.createIndex('nombre', 'nombre', { unique: false });
            }
        };
    });
}

async function guardarVentaLocal(venta) {
    const db = await abrirIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.VENTAS], 'readwrite');
        const store = transaction.objectStore(STORES.VENTAS);
        const request = store.add(venta);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            console.log('✅ Venta guardada en IndexedDB:', venta.id_global);
            resolve(request.result);
        };
    });
}

async function obtenerVentasPendientes(db) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.VENTAS], 'readonly');
        const store = transaction.objectStore(STORES.VENTAS);
        // No usar booleanos como clave en IDBIndex (no son tipos de clave válidos en todos
        // los navegadores). Recuperamos todo y filtramos en JS.
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const all = request.result || [];
            const pendientes = all.filter(v => !v.sync);
            resolve(pendientes);
        };
    });
}

async function marcarComoSincronizada(db, idGlobal) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.VENTAS], 'readwrite');
        const store = transaction.objectStore(STORES.VENTAS);
        const getRequest = store.get(idGlobal);

        getRequest.onsuccess = () => {
            const venta = getRequest.result;
            if (venta) {
                venta.sync = true;
                const updateRequest = store.put(venta);
                updateRequest.onsuccess = () => {
                    console.log('✅ Venta marcada como sincronizada:', idGlobal);
                    resolve();
                };
                updateRequest.onerror = () => reject(updateRequest.error);
            }
        };
    });
}

async function obtenerProductosLocales() {
    const db = await abrirIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.PRODUCTOS], 'readonly');
        const store = transaction.objectStore(STORES.PRODUCTOS);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function guardarProductoLocal(producto) {
    const db = await abrirIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.PRODUCTOS], 'readwrite');
        const store = transaction.objectStore(STORES.PRODUCTOS);
        const request = store.put(producto);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

async function guardarClienteLocal(cliente) {
    const db = await abrirIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.CLIENTES], 'readwrite');
        const store = transaction.objectStore(STORES.CLIENTES);
        const request = store.put(cliente);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

async function obtenerClientesLocales() {
    const db = await abrirIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.CLIENTES], 'readonly');
        const store = transaction.objectStore(STORES.CLIENTES);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
    });
}

async function eliminarClienteLocal(cedula) {
    const db = await abrirIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORES.CLIENTES], 'readwrite');
        const store = transaction.objectStore(STORES.CLIENTES);
        const request = store.delete(cedula);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

async function borrarDatosLocales() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Cierre otras pestañas para borrar datos locales'));
    });
}

// Exponer helpers de clientes
if (typeof window !== 'undefined') {
    window.obtenerClientesLocales = obtenerClientesLocales;
    window.guardarClienteLocal = guardarClienteLocal;
    window.eliminarClienteLocal = eliminarClienteLocal;
    window.borrarDatosLocales = borrarDatosLocales;
}