import { db, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc } from './firebase-config.js';

// --- CLIENTES ---
async function upsertClienteFirebase(cliente) {
    try {
        const ref = collection(db, 'clientes');
        const cedula = (cliente.cedula || '').trim();
        const { id, ...clienteData } = cliente || {};
        let targetId = null;

        if (cedula) {
            const q = query(ref, where('cedula', '==', cedula));
            const snap = await getDocs(q);
            if (!snap.empty) {
                targetId = snap.docs[0].id;
            }
        }

        if (targetId) {
            await updateDoc(doc(db, 'clientes', targetId), {
                ...clienteData,
                actualizado_en: new Date().toISOString()
            });
            console.log('✅ Cliente actualizado en Firebase:', targetId);
            return targetId;
        }

        const docRef = await addDoc(ref, {
            ...clienteData,
            creado_en: new Date().toISOString()
        });
        console.log('✅ Cliente creado en Firebase:', docRef.id);
        return docRef.id;
    } catch (err) {
        console.error('❌ Error guardando cliente en Firebase:', err);
        throw err;
    }
}

async function obtenerClientesFirebase() {
    try {
        const ref = collection(db, 'clientes');
        const snapshot = await getDocs(ref);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error('❌ Error obteniendo clientes de Firebase:', err);
        return [];
    }
}

async function eliminarClienteFirebasePorCedula(cedula) {
    try {
        const ref = collection(db, 'clientes');
        const q = query(ref, where('cedula', '==', cedula));
        const snap = await getDocs(q);
        const promises = snap.docs.map(d => deleteDoc(doc(db, 'clientes', d.id)));
        await Promise.all(promises);
        console.log(`✅ Cliente(s) eliminados para cédula ${cedula}`);
        return snap.docs.map(d => d.id);
    } catch (err) {
        console.error('❌ Error eliminando cliente en Firebase:', err);
        throw err;
    }
}

// Enviar una venta a Firebase
async function enviarVentaAFirebase(venta) {
    try {
        const ventasRef = collection(db, 'ventas');
        const docRef = await addDoc(ventasRef, {
            ...venta,
            sincronizado_en: new Date().toISOString()
        });
        console.log('✅ Venta sincronizada a Firebase:', docRef.id);
        return docRef.id;
    } catch (err) {
        console.error('❌ Error enviando a Firebase:', err);
        throw err;
    }
}

// Obtener todas las ventas de Firebase
async function obtenerVentasDeFirebase() {
    try {
        const ventasRef = collection(db, 'ventas');
        const snapshot = await getDocs(ventasRef);
        return snapshot.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() }));
    } catch (err) {
        console.error('❌ Error obteniendo ventas de Firebase:', err);
        return [];
    }
}

// Sincronizar todas las ventas pendientes de IndexedDB a Firebase
async function sincronizarVentasPendientes() {
    try {
        const indexedDB_obj = await abrirIndexedDB();
        const ventasPendientes = await obtenerVentasPendientes(indexedDB_obj);

        console.log(`📤 Sincronizando ${ventasPendientes.length} ventas pendientes...`);

        for (const venta of ventasPendientes) {
            let synced = false;
            // 1) Intentar enviar al servidor local (/ventas)
            try {
                const res = await fetch('/ventas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(venta)
                });
                if (res.ok) {
                    const data = await res.json();
                    console.log(`✅ Venta enviada al servidor: ${venta.id_global} -> ${data.ventaId || data.id || 'OK'}`);
                    synced = true;
                } else {
                    console.warn(`⚠️ Servidor respondió con estado ${res.status} para ${venta.id_global}`);
                }
            } catch (err) {
                console.warn(`⚠️ Error enviando al servidor ${venta.id_global}:`, err);
            }

            // 2) Intentar enviar a Firebase (si falla servidor, aún intentamos mantener respaldo remoto)
            try {
                await enviarVentaAFirebase(venta);
                console.log(`✅ Venta enviada a Firebase: ${venta.id_global}`);
                synced = true;
            } catch (err) {
                console.error(`❌ Error enviando a Firebase ${venta.id_global}:`, err);
            }

            // 3) Marcar como sincronizada si al menos uno tuvo éxito
            if (synced) {
                try {
                    await marcarComoSincronizada(indexedDB_obj, venta.id_global);
                    console.log(`✅ Marcada como sincronizada: ${venta.id_global}`);
                } catch (err) {
                    console.error(`❌ No se pudo marcar como sincronizada ${venta.id_global}:`, err);
                }
            } else {
                console.warn(`❌ No se pudo sincronizar ${venta.id_global} en ninguna plataforma`);
            }
        }

        console.log('✅ Sincronización completada');
    } catch (err) {
        console.error('❌ Error en sincronización:', err);
    }
}

// Descargar ventas de Firebase a IndexedDB (para backup)
async function descargarVentasDeFirebase() {
    try {
        const ventasFirebase = await obtenerVentasDeFirebase();
        const indexedDB_obj = await abrirIndexedDB();

        for (const venta of ventasFirebase) {
            const transaction = indexedDB_obj.transaction(['ventas_sincronizadas'], 'readwrite');
            const store = transaction.objectStore('ventas_sincronizadas');
            store.put({
                id_global: venta.id_global,
                ...venta,
                descargado_en: new Date().toISOString()
            });
        }

        console.log(`✅ ${ventasFirebase.length} ventas descargadas de Firebase`);
    } catch (err) {
        console.error('❌ Error descargando de Firebase:', err);
    }
}

export { enviarVentaAFirebase, obtenerVentasDeFirebase, sincronizarVentasPendientes, descargarVentasDeFirebase };

// API de clientes
export { upsertClienteFirebase, obtenerClientesFirebase, eliminarClienteFirebasePorCedula };

// También exponer en el scope global para que `app.js` (no-module or simple calls)
// pueda invocarlo sin hacer `import` (compatibilidad)
if (typeof window !== 'undefined') {
    window.sincronizarVentasPendientes = sincronizarVentasPendientes;
    window.enviarVentaAFirebase = enviarVentaAFirebase;
    window.upsertClienteFirebase = upsertClienteFirebase;
    window.eliminarClienteFirebasePorCedula = eliminarClienteFirebasePorCedula;
    window.obtenerClientesFirebase = obtenerClientesFirebase;
}