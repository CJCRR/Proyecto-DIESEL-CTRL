import { db, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc, setDoc } from '../config/firebase-config.js';
import { apiFetchJson } from './app-api.js';
import { abrirIndexedDB, obtenerVentasPendientes, marcarComoSincronizada } from './db-local.js';

// Eventos de sincronización para UI (app.js escucha y muestra toasts)
function emitSyncEvent(detail) {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('sync-status', { detail }));
    }
}

// Backoff progresivo cuando hay fallos consecutivos
let retryTimer = null;
let retryDelayMs = 5_000;
const MAX_RETRY_DELAY = 5 * 60 * 1_000; // 5 minutos

async function apiPostJson(url, body) {
    return await apiFetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function scheduleRetry(reason) {
    if (retryTimer) return;
    emitSyncEvent({ type: 'warn', message: `Reintentando sync en ${Math.round(retryDelayMs / 1000)}s (${reason || 'error'})` });
    retryTimer = setTimeout(() => {
        retryTimer = null;
        sincronizarVentasPendientes({ isRetry: true }).catch(() => {});
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY);
}
function resetRetry() {
    retryDelayMs = 5_000;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

// Helper para añadir empresa a los documentos de Firebase
function getEmpresaScope() {
    try {
        const raw = localStorage.getItem('auth_user');
        if (!raw) return {};
        const u = JSON.parse(raw);
        if (!u || !u.empresa_codigo) return {};
        return { empresa_codigo: u.empresa_codigo };
    } catch {
        return {};
    }
}

// Helper: obtener referencia a una subcolección bajo empresas/{empresa_codigo}
function getEmpresaSubcollection(nombreSubcoleccion) {
    const scope = getEmpresaScope();
    if (!scope.empresa_codigo) {
        throw new Error('No hay empresa_codigo en auth_user para Firebase');
    }
    const ref = collection(db, 'empresas', scope.empresa_codigo, nombreSubcoleccion);
    return { ref, scope };
}

// --- EMPRESAS (METADATOS) ---
// Crear o actualizar el documento empresas/{codigo} con datos básicos
async function upsertEmpresaFirebase(empresa) {
    try {
        const codigo = (empresa && empresa.codigo ? String(empresa.codigo) : '').trim().toUpperCase();
        if (!codigo) {
            throw new Error('Código de empresa vacío');
        }

        const ref = doc(db, 'empresas', codigo);
        const nowIso = new Date().toISOString();

        const payload = {
            nombre: empresa.nombre || null,
            codigo,
            estado: empresa.estado || 'activa',
            plan: empresa.plan || null,
            monto_mensual: empresa.monto_mensual ?? null,
            fecha_alta: empresa.fecha_alta || null,
            fecha_corte: empresa.fecha_corte ?? null,
            dias_gracia: empresa.dias_gracia ?? null,
            rif: empresa.rif || null,
            telefono: empresa.telefono || null,
            direccion: empresa.direccion || null,
            actualizado_en: nowIso
        };

        // Si viene fecha_alta vacío, asumimos alta ahora
        if (!payload.fecha_alta) {
            payload.fecha_alta = nowIso;
        }

        await setDoc(ref, payload, { merge: true });
        console.log('✅ Empresa registrada/actualizada en Firebase:', codigo);
        return codigo;
    } catch (err) {
        console.error('❌ Error guardando empresa en Firebase:', err);
        throw err;
    }
}

// --- USUARIOS (PERFIL LIGERO) ---
// Guardar un perfil mínimo de usuario bajo empresas/{empresa_codigo}/usuarios/{usuarioId}
// No se guardan contraseñas ni datos sensibles, solo info básica para futuras integraciones nube.
async function upsertUsuarioFirebase(usuario) {
    try {
        if (!usuario || (!usuario.id && !usuario.usuario_id)) {
            throw new Error('Usuario sin id para Firebase');
        }

        const { scope } = getEmpresaSubcollection('usuarios');
        const usuarioId = String(usuario.id || usuario.usuario_id);
        const ref = doc(db, 'empresas', scope.empresa_codigo, 'usuarios', usuarioId);
        const nowIso = new Date().toISOString();

        const payload = {
            usuario_id: Number(usuarioId),
            username: usuario.username || null,
            nombre_completo: usuario.nombre_completo || null,
            rol: usuario.rol || null,
            activo: usuario.activo != null ? !!usuario.activo : true,
            creado_en: usuario.creado_en || null,
            ultimo_login: usuario.ultimo_login || null,
            actualizado_en: nowIso,
            ...scope
        };

        await setDoc(ref, payload, { merge: true });
        console.log('✅ Usuario perfil upsert en Firebase:', scope.empresa_codigo, usuarioId);
        return usuarioId;
    } catch (err) {
        // Este sync es "best-effort": si falla (por ejemplo, permisos de Firebase),
        // no debe romper el flujo normal de la app ni mostrar errores rojos fuertes.
        console.warn('⚠️ No se pudo guardar perfil de usuario en Firebase (se ignora):', err);
        return null;
    }
}

async function deleteUsuarioFirebase(usuarioId) {
    try {
        if (!usuarioId) return;
        const { scope } = getEmpresaSubcollection('usuarios');
        const ref = doc(db, 'empresas', scope.empresa_codigo, 'usuarios', String(usuarioId));
        await deleteDoc(ref);
        console.log('✅ Perfil de usuario eliminado en Firebase:', scope.empresa_codigo, usuarioId);
    } catch (err) {
        console.error('❌ Error eliminando perfil de usuario en Firebase:', err);
        // No relanzamos: la eliminación en SQLite ya se hizo; esto es mejor-esfuerzo.
    }
}

// --- CLIENTES ---
async function upsertClienteFirebase(cliente) {
    try {
        const { ref, scope } = getEmpresaSubcollection('clientes');
        const cedula = (cliente.cedula || '').trim();
        const { id, ...clienteData } = cliente || {};
        let targetId = null;

        if (cedula) {
            const qRef = query(ref, where('cedula', '==', cedula));
            const snap = await getDocs(qRef);
            if (!snap.empty) {
                targetId = snap.docs[0].id;
            }
        }

        if (targetId) {
            await updateDoc(doc(db, 'empresas', scope.empresa_codigo, 'clientes', targetId), {
                ...clienteData,
                ...scope,
                actualizado_en: new Date().toISOString()
            });
            console.log('✅ Cliente actualizado en Firebase:', targetId);
            return targetId;
        }

        const docRef = await addDoc(ref, {
            ...clienteData,
            ...scope,
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
        const { ref } = getEmpresaSubcollection('clientes');
        const snapshot = await getDocs(ref);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error('❌ Error obteniendo clientes de Firebase:', err);
        return [];
    }
}

async function eliminarClienteFirebasePorCedula(cedula) {
    try {
        const { ref, scope } = getEmpresaSubcollection('clientes');
        const qRef = query(ref, where('cedula', '==', cedula));
        const snap = await getDocs(qRef);
        const promises = snap.docs.map(d => deleteDoc(doc(db, 'empresas', scope.empresa_codigo, 'clientes', d.id)));
        await Promise.all(promises);
        console.log(`✅ Cliente(s) eliminados para cédula ${cedula}`);
        return snap.docs.map(d => d.id);
    } catch (err) {
        console.error('❌ Error eliminando cliente en Firebase:', err);
        throw err;
    }
}

// Eliminar cliente usando directamente el ID del documento en Firebase.
// Útil para clientes que no tienen cédula registrada.
async function eliminarClienteFirebasePorId(id) {
    try {
        if (!id) return;
        const { scope } = getEmpresaSubcollection('clientes');
        const ref = doc(db, 'empresas', scope.empresa_codigo, 'clientes', String(id));
        await deleteDoc(ref);
        console.log('✅ Cliente eliminado por ID en Firebase:', scope.empresa_codigo, id);
    } catch (err) {
        console.error('❌ Error eliminando cliente por ID en Firebase:', err);
        throw err;
    }
}

async function borrarColeccionFirebase(nombre) {
    const { ref, scope } = getEmpresaSubcollection(nombre);
    const snapshot = await getDocs(ref);
    const promises = snapshot.docs.map(d => deleteDoc(doc(db, 'empresas', scope.empresa_codigo, nombre, d.id)));
    await Promise.all(promises);
    return snapshot.size || snapshot.docs.length || 0;
}

async function borrarClientesFirebaseTodos() {
    return borrarColeccionFirebase('clientes');
}

async function borrarVentasFirebaseTodas() {
    return borrarColeccionFirebase('ventas');
}

async function borrarProductosFirebaseTodos() {
    return borrarColeccionFirebase('productos');
}

// --- PRODUCTOS ---
async function upsertProductoFirebase(producto) {
    try {
        const { ref, scope } = getEmpresaSubcollection('productos');
        const { id, original_codigo, ...productoData } = producto || {};
        const codigo = (producto.codigo || '').trim().toUpperCase();
        const originalCodigo = (original_codigo || '').trim().toUpperCase();

        if (!codigo) {
            throw new Error('Código de producto vacío');
        }

        // 1) Intentar localizar por el código actual
        let targetId = null;
        let snap = null;

        const qRef = query(ref, where('codigo', '==', codigo));
        snap = await getDocs(qRef);

        if (!snap.empty) {
            targetId = snap.docs[0].id;
        }

        // 2) Si no existe por el código nuevo y tenemos un código original distinto,
        //    intentamos actualizar ese documento para evitar duplicados en cambios de código.
        if (!targetId && originalCodigo && originalCodigo !== codigo) {
            const qRefOld = query(ref, where('codigo', '==', originalCodigo));
            const snapOld = await getDocs(qRefOld);
            if (!snapOld.empty) {
                targetId = snapOld.docs[0].id;
            }
        }

        if (targetId) {
            await updateDoc(doc(db, 'empresas', scope.empresa_codigo, 'productos', targetId), {
                ...productoData,
                codigo,
                ...scope,
                actualizado_en: new Date().toISOString()
            });
            console.log('✅ Producto actualizado en Firebase:', targetId);
            return targetId;
        }

        // 3) Si no existe ni por código nuevo ni por original, creamos un nuevo documento
        const docRef = await addDoc(ref, {
            ...productoData,
            codigo,
            ...scope,
            creado_en: new Date().toISOString()
        });
        console.log('✅ Producto creado en Firebase:', docRef.id);
        return docRef.id;
    } catch (err) {
        console.error('❌ Error guardando producto en Firebase:', err);
        throw err;
    }
}

async function obtenerProductosFirebase() {
    try {
        const { ref } = getEmpresaSubcollection('productos');
        const snapshot = await getDocs(ref);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error('❌ Error obteniendo productos de Firebase:', err);
        return [];
    }
}

async function eliminarProductoFirebasePorCodigo(codigo) {
    try {
        const cod = (codigo || '').trim().toUpperCase();
        if (!cod) throw new Error('Código de producto vacío');

        const { ref, scope } = getEmpresaSubcollection('productos');
        const qRef = query(ref, where('codigo', '==', cod));
        const snap = await getDocs(qRef);
        if (snap.empty) {
            return [];
        }
        const promises = snap.docs.map(d => deleteDoc(doc(db, 'empresas', scope.empresa_codigo, 'productos', d.id)));
        await Promise.all(promises);
        console.log(`✅ Producto(s) eliminados en Firebase para código ${cod}`);
        return snap.docs.map(d => d.id);
    } catch (err) {
        console.error('❌ Error eliminando producto en Firebase:', err);
        throw err;
    }
}

// Enviar una venta a Firebase
async function enviarVentaAFirebase(venta) {
    try {
        const { ref: ventasRef, scope } = getEmpresaSubcollection('ventas');
        const docRef = await addDoc(ventasRef, {
            ...venta,
            ...scope,
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
        const { ref: ventasRef } = getEmpresaSubcollection('ventas');
        const snapshot = await getDocs(ventasRef);
        return snapshot.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() }));
    } catch (err) {
        console.error('❌ Error obteniendo ventas de Firebase:', err);
        return [];
    }
}

// Sincronizar todas las ventas pendientes de IndexedDB a Firebase
async function sincronizarVentasPendientes({ isRetry = false } = {}) {
    try {
        const indexedDB_obj = await abrirIndexedDB();
        const ventasPendientes = await obtenerVentasPendientes(indexedDB_obj);

        console.log(`📤 Sincronizando ${ventasPendientes.length} ventas pendientes...`);
        if (!ventasPendientes.length) {
            resetRetry();
            emitSyncEvent({ type: 'success', message: 'Sincronización al día' });
            return;
        }

        let errores = 0;
        for (const venta of ventasPendientes) {
            let synced = false;

            // 1) Servidor local
            try {
                // Respetar siempre el usuario_id original de la venta (vendedor seleccionado).
                // Solo usar el usuario logueado como fallback si la venta no trae usuario_id.
                let usuarioId = venta && venta.usuario_id != null ? venta.usuario_id : null;
                if (usuarioId == null) {
                    try {
                        if (typeof window !== 'undefined') {
                            if (window.Auth && typeof window.Auth.getUser === 'function') {
                                const u = window.Auth.getUser();
                                if (u && u.id) usuarioId = u.id;
                            }
                            if (usuarioId == null) {
                                const raw = localStorage.getItem('auth_user');
                                if (raw) {
                                    const u = JSON.parse(raw);
                                    if (u && u.id) usuarioId = u.id;
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('No se pudo determinar usuario para sync de venta', e);
                    }
                }

                const payload = usuarioId != null ? { ...venta, usuario_id: usuarioId } : venta;

                const data = await apiPostJson('/api/ventas', payload);
                console.log(`✅ Venta enviada al servidor: ${venta.id_global} -> ${data.ventaId || data.id || 'OK'}`);

                // Notificar al frontend (POS) que la venta se registró en el backend,
                // incluyendo el NRO correlativo calculado (por ejemplo, "VENTA-18").
                try {
                    if (typeof window !== 'undefined' && window.dispatchEvent) {
                        window.dispatchEvent(new CustomEvent('venta-registrada-backend', {
                            detail: {
                                id_global_local: venta.id_global,
                                ventaId: data.ventaId || data.id || null,
                                nro_nota: data.idGlobal || null,
                            }
                        }));
                    }
                } catch (evtErr) {
                    console.warn('No se pudo emitir evento venta-registrada-backend', evtErr);
                }

                // Tras registrar la venta en el backend, actualizar en Firebase
                // el stock de los productos afectados (best-effort, no bloqueante).
                try {
                    const codigos = Array.isArray(venta.items)
                        ? [...new Set(venta.items.map(it => (it && it.codigo ? String(it.codigo).trim() : '')).filter(Boolean))]
                        : [];
                    for (const codigo of codigos) {
                        try {
                            const prod = await apiFetchJson(`/api/productos/${encodeURIComponent(codigo)}`);
                            if (!prod || prod.error) continue;
                            await upsertProductoFirebase({
                                codigo: prod.codigo,
                                descripcion: prod.descripcion,
                                precio_usd: prod.precio_usd,
                                costo_usd: prod.costo_usd,
                                stock: prod.stock,
                                categoria: prod.categoria,
                                marca: prod.marca,
                                deposito_id: prod.deposito_id || null,
                            });
                        } catch (errProd) {
                            console.warn('No se pudo sincronizar producto a Firebase tras venta', codigo, errProd);
                        }
                    }
                } catch (errSyncProdList) {
                    console.warn('No se pudo sincronizar productos a Firebase tras venta', errSyncProdList);
                }
                synced = true;
            } catch (err) {
                console.warn(`⚠️ Error enviando al servidor ${venta.id_global}:`, err.message || err);
            }

            // 2) Firebase (respaldo)
            try {
                await enviarVentaAFirebase(venta);
                console.log(`✅ Venta enviada a Firebase: ${venta.id_global}`);
                synced = true;
            } catch (err) {
                console.error(`❌ Error enviando a Firebase ${venta.id_global}:`, err);
            }

            if (synced) {
                try {
                    await marcarComoSincronizada(indexedDB_obj, venta.id_global);
                    console.log(`✅ Marcada como sincronizada: ${venta.id_global}`);
                } catch (err) {
                    console.error(`❌ No se pudo marcar como sincronizada ${venta.id_global}:`, err);
                }
            } else {
                errores += 1;
                emitSyncEvent({ type: 'error', message: `No se pudo sincronizar ${venta.id_global}` });
            }
        }

        if (errores > 0) {
            scheduleRetry(`${errores} fallos`);
        } else {
            resetRetry();
            emitSyncEvent({ type: 'success', message: 'Ventas sincronizadas (local + Firebase)' });
        }
    } catch (err) {
        console.error('❌ Error en sincronización:', err);
        emitSyncEvent({ type: 'error', message: 'Error general en sync' });
        scheduleRetry('error general');
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
export { borrarClientesFirebaseTodos, borrarVentasFirebaseTodas, borrarProductosFirebaseTodos };

// API de clientes y productos
export { upsertClienteFirebase, obtenerClientesFirebase, eliminarClienteFirebasePorCedula, eliminarClienteFirebasePorId };
export { upsertProductoFirebase, obtenerProductosFirebase, eliminarProductoFirebasePorCodigo };
export { upsertEmpresaFirebase, upsertUsuarioFirebase, deleteUsuarioFirebase };

// También exponer en el scope global para que `app.js` (no-module or simple calls)
// pueda invocarlo sin hacer `import` (compatibilidad)
if (typeof window !== 'undefined') {
    window.sincronizarVentasPendientes = sincronizarVentasPendientes;
    window.enviarVentaAFirebase = enviarVentaAFirebase;
    window.upsertClienteFirebase = upsertClienteFirebase;
    window.eliminarClienteFirebasePorCedula = eliminarClienteFirebasePorCedula;
    window.eliminarClienteFirebasePorId = eliminarClienteFirebasePorId;
    window.obtenerClientesFirebase = obtenerClientesFirebase;
    window.upsertProductoFirebase = upsertProductoFirebase;
    window.obtenerProductosFirebase = obtenerProductosFirebase;
    window.eliminarProductoFirebasePorCodigo = eliminarProductoFirebasePorCodigo;
    window.borrarClientesFirebaseTodos = borrarClientesFirebaseTodos;
    window.borrarVentasFirebaseTodas = borrarVentasFirebaseTodas;
    window.borrarProductosFirebaseTodos = borrarProductosFirebaseTodos;
    window.upsertEmpresaFirebase = upsertEmpresaFirebase;
    window.upsertUsuarioFirebase = upsertUsuarioFirebase;
    window.deleteUsuarioFirebase = deleteUsuarioFirebase;
}