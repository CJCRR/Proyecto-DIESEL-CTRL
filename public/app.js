import { sincronizarVentasPendientes, upsertClienteFirebase, obtenerClientesFirebase } from './firebase-sync.js';

let carrito = [];
let productoSeleccionado = null;
let vendiendo = false;
let clientesFrecuentesCache = [];
let TASA_BCV_POS = 1;
let TASA_BCV_UPDATED_POS = null;

// Variables para PWA y Sincronización
let isOnline = navigator.onLine;

const buscarInput = document.getElementById('buscar');
const resultadosUL = document.getElementById('resultados');
const tablaCuerpo = document.getElementById('venta-items-cuerpo');
const btnVender = document.getElementById('btnVender');
const statusIndicator = document.createElement('div');
// Toast container
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
toastContainer.style.position = 'fixed';
toastContainer.style.right = '1rem';
toastContainer.style.bottom = '1rem';
toastContainer.style.display = 'flex';
toastContainer.style.flexDirection = 'column';
toastContainer.style.gap = '0.5rem';
toastContainer.style.zIndex = '60';
document.body.appendChild(toastContainer);

function setTasaUI(tasa, actualizadoEn) {
    TASA_BCV_POS = Number(tasa || 1) || 1;
    if (actualizadoEn) TASA_BCV_UPDATED_POS = actualizadoEn;
    try {
        localStorage.setItem('tasa_bcv', String(TASA_BCV_POS));
        if (TASA_BCV_UPDATED_POS) localStorage.setItem('tasa_bcv_updated', TASA_BCV_UPDATED_POS);
    } catch {}
    const input = document.getElementById('v_tasa');
    if (input) {
        input.value = TASA_BCV_POS.toFixed(2);
        actualizarTabla();
    }
    const kpi = document.getElementById('pv-kpi-tasa');
    if (kpi) kpi.textContent = TASA_BCV_POS.toFixed(2);
    const alertEl = document.getElementById('pv-tasa-alert');
    if (alertEl) {
        const diffHrs = TASA_BCV_UPDATED_POS ? (Date.now() - new Date(TASA_BCV_UPDATED_POS).getTime()) / 36e5 : null;
        const show = diffHrs !== null && diffHrs > 8;
        alertEl.classList.toggle('hidden', !show);
        if (show) alertEl.textContent = `Tasa sin actualizar hace ${diffHrs.toFixed(1)}h`;
    }
}

async function cargarTasaPV() {
    try {
        const token = localStorage.getItem('auth_token');
        const r = await fetch('/admin/ajustes/tasa-bcv', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!r.ok) return;
        const j = await r.json();
        setTasaUI(j.tasa_bcv, j.actualizado_en);
    } catch (err) {
        console.warn('No se pudo cargar tasa BCV', err);
    }
}

function precargarTasaCache() {
    try {
        const cached = localStorage.getItem('tasa_bcv');
        const cachedUpdated = localStorage.getItem('tasa_bcv_updated');
        if (cached) setTasaUI(Number(cached), cachedUpdated || null);
    } catch {}
}

async function actualizarTasaPV() {
    const val = parseFloat(document.getElementById('v_tasa')?.value || '');
    const token = localStorage.getItem('auth_token');
    const headers = { 'Authorization': `Bearer ${token}` };

    // Si hay un valor válido en el input, guardar manualmente; si no, actualizar automático
    if (!Number.isNaN(val) && val > 0) {
        try {
            const r = await fetch('/admin/ajustes/tasa-bcv', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ tasa_bcv: val }),
            });
            if (!r.ok) throw new Error('No se pudo guardar la tasa');
            const j = await r.json();
            setTasaUI(j.tasa_bcv ?? val, j.actualizado_en || new Date().toISOString());
            showToast('Tasa guardada', 'success');
        } catch (err) {
            showToast('Error guardando tasa', 'error');
        }
        return;
    }

    // Modo auto-actualizar
    try {
        const r = await fetch('/admin/ajustes/tasa-bcv/actualizar', { method: 'POST', headers });
        if (!r.ok) throw new Error('No se pudo actualizar');
        const j = await r.json();
        const tasa = Number(j.tasa_bcv || 0);
        if (tasa > 0) {
            setTasaUI(tasa, j.actualizado_en || new Date().toISOString());
            showToast('Tasa actualizada', 'success');
        }
    } catch (err) {
        showToast('Error actualizando tasa', 'error');
    }
}

// Escuchar eventos de sincronización provenientes de firebase-sync.js
window.addEventListener('sync-status', (evt) => {
    const detail = evt.detail || {};
    const type = detail.type === 'error' ? 'error' : detail.type === 'warn' ? 'info' : 'success';
    if (detail.message) showToast(detail.message, type, 5000);
    const estadoEl = document.getElementById('sync-estado');
    if (estadoEl && detail.message) estadoEl.textContent = detail.message;
    actualizarSyncPendientes();
});

function showToast(text, type = 'info', ms = 3500) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.style.minWidth = '200px';
    t.style.padding = '0.6rem 1rem';
    t.style.borderRadius = '0.5rem';
    t.style.color = 'white';
    t.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    t.style.transform = 'translateY(10px)';
    t.style.opacity = '0';
    t.style.transition = 'transform .18s ease, opacity .18s ease';
    t.style.background = type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#0369a1';
    t.innerText = text;
    toastContainer.appendChild(t);
    requestAnimationFrame(() => { t.style.transform = 'translateY(0)'; t.style.opacity = '1'; });
    const remover = () => { t.style.transform = 'translateY(10px)'; t.style.opacity = '0'; setTimeout(() => t.remove(), 200); };
    setTimeout(remover, ms);
    t.addEventListener('click', remover);
}

// --- INICIALIZACIÓN DE INTERFAZ OFFLINE ---
function setupOfflineUI() {
    statusIndicator.id = 'status-indicator';
    statusIndicator.className = `fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold transition-all shadow-lg ${isOnline ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`;
    statusIndicator.innerHTML = isOnline ? '<i class="fas fa-wifi mr-2"></i> EN LÍNEA' : '<i class="fas fa-wifi-slash mr-2"></i> MODO OFFLINE';
    document.body.appendChild(statusIndicator);

    window.addEventListener('online', () => {
        isOnline = true;
        statusIndicator.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold bg-green-500 text-white shadow-lg';
        statusIndicator.innerHTML = '<i class="fas fa-wifi mr-2"></i> EN LÍNEA';
            try { if (typeof window.sincronizarVentasPendientes === 'function') window.sincronizarVentasPendientes(); } catch (err) { console.warn('No se pudo disparar sync al reconectar', err); }
        intentarSincronizar();
        actualizarSyncPendientes();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        statusIndicator.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold bg-red-500 text-white shadow-lg';
        statusIndicator.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i> MODO OFFLINE';
        actualizarSyncPendientes();
    });
}

// --- GENERADOR DE ID GLOBAL (VEN-YYYY-MM-DD-UUID) ---
function generarIDVenta() {
    const fecha = new Date().toISOString().split('T')[0];
    const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `VEN-${fecha}-${randomPart}`;
}

// --- BÚSQUEDA Y SELECCIÓN ---
buscarInput.addEventListener('input', () => {
    const q = buscarInput.value.trim();
    if (q.length < 2) {
        resultadosUL.innerHTML = '';
        resultadosUL.classList.add('hidden');
        return;
    }

    const token = localStorage.getItem('auth_token');
    fetch(`/buscar?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(res => res.json())
        .then(data => {
            resultadosUL.innerHTML = '';
            if (data.length > 0) {
                resultadosUL.classList.remove('hidden');
                data.forEach(p => {
                    const li = document.createElement('li');
                    li.className = "p-3 border-b hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors";
                    li.innerHTML = `
                        <div class="flex flex-col">
                            <span class="font-bold text-slate-700">${p.codigo}</span>
                            <span class="text-xs text-slate-400">${p.descripcion}</span>
                        </div>
                        <div class="text-right">
                            <span class="block text-blue-600 font-black">$${p.precio_usd}</span>
                            <span class="block text-[9px] font-bold text-slate-400 uppercase">Stock: ${p.stock}</span>
                        </div>
                    `;
                    li.onclick = () => prepararParaAgregar(p);
                    resultadosUL.appendChild(li);
                });
            } else {
                resultadosUL.classList.add('hidden');
            }
        });
});

function prepararParaAgregar(p) {
    productoSeleccionado = p;
    buscarInput.value = `${p.codigo} - ${p.descripcion}`;
    resultadosUL.classList.add('hidden');
    document.getElementById('v_cantidad').focus();
}

// --- GESTIÓN DEL CARRITO ---
function agregarAlCarrito() {
    const cantidadInput = document.getElementById('v_cantidad');
    const cantidad = parseInt(cantidadInput.value);
    
    

    // Replace alerts with toasts
    if (!productoSeleccionado) { showToast('Por favor, busque y seleccione un producto.', 'error'); return; }
    if (isNaN(cantidad) || cantidad <= 0) { showToast('Ingrese una cantidad válida.', 'error'); return; }
    if (cantidad > productoSeleccionado.stock) { showToast('No hay suficiente stock disponible.', 'error'); return; }

    // Verificar si ya existe en el carrito para sumar o agregar nuevo
    const index = carrito.findIndex(item => item.codigo === productoSeleccionado.codigo);
    if (index !== -1) {
        if ((carrito[index].cantidad + cantidad) > productoSeleccionado.stock) {
            showToast('La cantidad total en el carrito supera el stock físico.', 'error'); return;
        }
        carrito[index].cantidad += cantidad;
    } else {
        carrito.push({
            codigo: productoSeleccionado.codigo,
            descripcion: productoSeleccionado.descripcion,
            precio_usd: productoSeleccionado.precio_usd,
            cantidad: cantidad
        });
    }

    actualizarTabla();
    limpiarSeleccion();
}

function actualizarTabla() {
    if (!tablaCuerpo) return;
    tablaCuerpo.innerHTML = '';
    
    const vacioMsg = document.getElementById('vacio-msg');
    const countLabel = document.getElementById('items-count');
    
    if (carrito.length === 0) {
        if (vacioMsg) vacioMsg.classList.remove('hidden');
        if (countLabel) countLabel.innerText = "0 ITEMS";
    } else {
        if (vacioMsg) vacioMsg.classList.add('hidden');
        if (countLabel) countLabel.innerText = `${carrito.length} ITEM${carrito.length > 1 ? 'S' : ''}`;
    }

    let totalUSD = 0;
    const tasa = parseFloat(document.getElementById('v_tasa').value) || 1;
    const descuento = parseFloat(document.getElementById('v_desc') ? document.getElementById('v_desc').value : 0) || 0;

    carrito.forEach((item, index) => {
        const subtotalUSD = item.cantidad * item.precio_usd;
        totalUSD += subtotalUSD;
        
        const tr = document.createElement('tr');
        tr.className = "border-b text-sm hover:bg-slate-50 transition-colors";
        tr.innerHTML = `
            <td class="p-4 font-bold text-slate-600">${item.codigo}</td>
            <td class="p-4 text-slate-500">${item.descripcion}</td>
            <td class="p-4 text-center font-bold">${item.cantidad}</td>
            <td class="p-4 text-right text-slate-400 font-mono">$${item.precio_usd.toFixed(2)}</td>
            <td class="p-4 text-right font-black text-blue-600 font-mono">$${subtotalUSD.toFixed(2)}</td>
            <td class="p-4 text-center">
                <button onclick="eliminarDelCarrito(${index})" class="w-8 h-8 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        tablaCuerpo.appendChild(tr);
    });

    document.getElementById('total-usd').innerText = totalUSD.toFixed(2);
    const totalAfterDiscount = totalUSD * (1 - Math.max(0, Math.min(100, descuento)) / 100);
    document.getElementById('total-bs').innerText = (totalAfterDiscount * tasa).toLocaleString('es-VE', {minimumFractionDigits: 2});
}

function eliminarDelCarrito(index) {
    carrito.splice(index, 1);
    actualizarTabla();
}

function limpiarSeleccion() {
    productoSeleccionado = null;
    buscarInput.value = '';
    document.getElementById('v_cantidad').value = 1;
    buscarInput.focus();
}

// --- PANEL DE SINCRONIZACIÓN ---
async function actualizarSyncPendientes() {
    try {
        const cont = document.getElementById('sync-pendientes');
        if (!cont) return;
        let pendientes = 0;
        if (typeof abrirIndexedDB === 'function' && typeof obtenerVentasPendientes === 'function') {
            const db = await abrirIndexedDB();
            const arr = await obtenerVentasPendientes(db);
            pendientes = (arr || []).length;
        } else {
            const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
            pendientes = historico.filter(v => !v.sync).length;
        }
        cont.textContent = String(pendientes);
    } catch (err) {
        console.warn('No se pudo calcular pendientes', err);
    }
}

// --- FUNCIÓN DE IMPRESIÓN OFFLINE (GENERACIÓN LOCAL) ---
async function ensureNotaTemplateLoaded() {
    if (window.NotaTemplate && typeof window.NotaTemplate.buildNotaHTML === 'function') return;
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/shared/nota-template.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function imprimirNotaLocal(venta) {
    await ensureNotaTemplateLoaded();
    const html = window.NotaTemplate.buildNotaHTML({ venta });
    const ventana = window.open('', '_blank');
    ventana.document.write(html);
    ventana.document.close();
}

// --- PROCESAR VENTA FINAL ---
async function registrarVenta() {
    if (vendiendo || carrito.length === 0) return;
    
    const cliente = document.getElementById('v_cliente').value.trim();
    const vendedor = document.getElementById('v_vendedor') ? document.getElementById('v_vendedor').value.trim() : '';
    const cedula = document.getElementById('v_cedula') ? document.getElementById('v_cedula').value.trim() : '';
    const telefono = document.getElementById('v_telefono') ? document.getElementById('v_telefono').value.trim() : '';
    const tasa = parseFloat(document.getElementById('v_tasa').value);

    const isCredito = document.getElementById('v_credito')?.checked || false;
    const diasVenc = parseInt(document.getElementById('v_dias')?.value, 10) || 21;
    const fechaVenc = document.getElementById('v_fecha_venc')?.value || null;

    

    // validations
    const metodo = document.getElementById('v_metodo').value;
    if (!isCredito && !metodo) { showToast('Seleccione un método de pago', 'error'); return; }
    if (!cliente) { showToast('Ingrese el nombre del cliente', 'error'); return; }
    if (!tasa || isNaN(tasa) || tasa <= 0) { showToast('Ingrese una tasa de cambio válida (> 0)', 'error'); return; }

    const descuento = parseFloat(document.getElementById('v_desc') ? document.getElementById('v_desc').value : 0) || 0;
    const referencia = (document.getElementById('v_ref') && document.getElementById('v_ref').value)
        ? document.getElementById('v_ref').value.trim()
        : '';

    const metodoFinal = isCredito ? 'CREDITO' : metodo;

    const ventaData = {
        id_global: generarIDVenta(),
        items: [...carrito],
        cliente,
        vendedor,
        cedula,
        telefono,
        tasa_bcv: tasa,
        descuento,
        metodo_pago: metodoFinal,
        referencia,
        cliente_doc: cedula,
        credito: isCredito,
        dias_vencimiento: diasVenc,
        fecha_vencimiento: fechaVenc,
        fecha: new Date().toISOString(),
        sync: false
    };

    vendiendo = true;
    btnVender.disabled = true;
    btnVender.innerText = 'Procesando...';

    try {
        // 1. GUARDAR EN IndexedDB (SIEMPRE) - usar función de db-local.js
        await guardarVentaLocal(ventaData);
        await actualizarSyncPendientes();

        // 1b. Si estamos offline, registrar background sync para que corra al volver la conexión
        if (!isOnline) {
            try {
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    const reg = await navigator.serviceWorker.ready;
                    await reg.sync.register('sync-ventas');
                }
            } catch (err) {
                console.warn('No se pudo registrar background sync', err);
            }
        }

        // 2. SI ESTÁ ONLINE, INTENTAR SINCRONIZAR PENDIENTES
        if (isOnline && typeof window.sincronizarVentasPendientes === 'function') {
            await window.sincronizarVentasPendientes();
        }

        // Actualizar UI antes de abrir la nota para evitar que la impresión "corte"
        finalizarVentaUI();
        // Abrir nota primero, luego mostrar toast
        await imprimirNotaLocal(ventaData);
        setTimeout(() => showToast('✅ Venta registrada exitosamente', 'success'), 300);
    } catch (err) {
        console.error(err);
        showToast('❌ Error: ' + err.message, 'error');
    } finally {
        vendiendo = false;
        btnVender.disabled = false;
        btnVender.innerText = 'Vender';
    }
    actualizarHistorial()
}

// --- INTENTAR SINCRONIZACIÓN CADA 30 SEGUNDOS ---
document.addEventListener('DOMContentLoaded', () => {
    setupOfflineUI();
    actualizarHistorial();
    actualizarSyncPendientes();
    precargarTasaCache();
    cargarTasaPV();
    
    if (isOnline) {
        sincronizarVentasPendientes();
        setInterval(() => {
            if (isOnline) sincronizarVentasPendientes();
        }, 30000);
    }
    const vendFiltrar = document.getElementById('vend-filtrar');
    if (vendFiltrar) vendFiltrar.addEventListener('click', cargarVendedores);

    const btnPvActualizar = document.getElementById('btn-pv-actualizar-tasa');
    if (btnPvActualizar) {
        btnPvActualizar.addEventListener('click', actualizarTasaPV);
    }

    // Registrar service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(() => console.log('✅ Service Worker activo'))
            .catch(err => console.error('❌ Error SW:', err));
    }

    // Toggle UI para ventas a crédito
    const chkCredito = document.getElementById('v_credito');
    const selMetodo = document.getElementById('v_metodo');
    const inputRef = document.getElementById('v_ref');
    const syncCreditoUI = () => {
        const active = chkCredito?.checked;
        if (selMetodo) {
            selMetodo.disabled = !!active;
            if (active) selMetodo.value = 'credito';
        }
        if (inputRef) {
            inputRef.disabled = !!active;
            if (active) inputRef.value = '';
        }
    };
    if (chkCredito) {
        chkCredito.addEventListener('change', syncCreditoUI);
        syncCreditoUI();
    }
    window.syncCreditoUI = syncCreditoUI;

    // Wire additional UI controls

    const btnGuardarCliente = document.getElementById('btnGuardarCliente');
    const selectClientes = document.getElementById('v_clientes_frecuentes');

    const getFormCliente = () => ({
        nombre: (document.getElementById('v_cliente')?.value || '').trim(),
        cedula: (document.getElementById('v_cedula')?.value || '').trim(),
        telefono: (document.getElementById('v_telefono')?.value || '').trim()
    });

    const renderClientes = () => {
        if (!selectClientes) return;
        selectClientes.innerHTML = '<option value="">- frecuentes -</option>' + clientesFrecuentesCache.map((c, idx) => {
            const nombre = c.nombre || c.cliente || '';
            const cedula = c.cedula || '';
            const telefono = c.telefono || c.telefono_cliente || '';
            const id = c.id || '';
            return `<option value="${idx}" data-id="${id}" data-nombre="${nombre}" data-cedula="${cedula}" data-telefono="${telefono}">${nombre || 'Cliente sin nombre'}</option>`;
        }).join('');
    };

    async function loadClientes() {
        if (!selectClientes) return;
        let list = [];
        try {
            list = await obtenerClientesFirebase();
            if (list && list.length) {
                localStorage.setItem('clientes_frecuentes_v2', JSON.stringify(list));
            }
        } catch (err) {
            console.error('No se pudieron obtener clientes de Firebase, usando cache local', err);
        }
        if (!list || !list.length) {
            list = JSON.parse(localStorage.getItem('clientes_frecuentes_v2') || '[]');
        }
        clientesFrecuentesCache = list || [];
        renderClientes();
    }

    loadClientes();

    // Acciones de sync/backup manual
    const btnSyncNow = document.getElementById('btnSyncNow');
    if (btnSyncNow) {
        btnSyncNow.addEventListener('click', async () => {
            try {
                if (typeof window.sincronizarVentasPendientes === 'function') {
                    await window.sincronizarVentasPendientes();
                    actualizarSyncPendientes();
                    showToast('Sync ejecutado', 'success');
                }
            } catch (err) {
                console.error(err);
                showToast('Error al sincronizar', 'error');
            }
        });
    }
    const btnBackupNow = document.getElementById('btnBackupNow');
    if (btnBackupNow) {
        btnBackupNow.addEventListener('click', async () => {
            try {
                const token = localStorage.getItem('auth_token');
                const r = await fetch('/backup/create', { 
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (r.ok) showToast('Backup creado', 'success'); else showToast('No se pudo crear backup', 'error');
            } catch (err) {
                console.error(err);
                showToast('Error de backup', 'error');
            }
        });
    }

    // Prefill tasa desde backend/config o localStorage
    (async () => {
        try {
            const token = localStorage.getItem('auth_token');
            const r = await fetch('/admin/ajustes/tasa-bcv', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (r.ok) {
                const j = await r.json();
                const input = document.getElementById('v_tasa');
                if (input && j && j.tasa_bcv) input.value = Number(j.tasa_bcv).toFixed(2);
            }
        } catch {}
        try {
            const ls = localStorage.getItem('tasa_bcv');
            if (ls) {
                const input = document.getElementById('v_tasa');
                if (input) input.value = Number(ls).toFixed(2);
            }
        } catch {}
    })();

    // Escuchar cambios desde el dashboard (otra pestaña)
    window.addEventListener('storage', (e) => {
        if (e.key === 'tasa_bcv_updated') {
            const val = parseFloat(e.newValue);
            if (!isNaN(val) && val > 0) {
                const input = document.getElementById('v_tasa');
                if (input) { input.value = val.toFixed(2); actualizarTabla(); }
            }
        }
    });

    async function upsertClienteDesdeFormulario() {
        const cliente = getFormCliente();
        if (!cliente.nombre) { showToast('Ingrese nombre de cliente', 'error'); return; }

        const existente = cliente.cedula
            ? clientesFrecuentesCache.find(c => (c.cedula || '').toLowerCase() === cliente.cedula.toLowerCase())
            : clientesFrecuentesCache.find(c => (c.nombre || c.cliente) === cliente.nombre);

        try {
            const id = await upsertClienteFirebase({ ...cliente, id: existente?.id });
            const actualizado = { ...cliente, id: id || existente?.id };
            if (existente) {
                clientesFrecuentesCache = clientesFrecuentesCache.map(c => {
                    const mismaCedula = cliente.cedula && (c.cedula || '').toLowerCase() === cliente.cedula.toLowerCase();
                    const mismoNombre = !cliente.cedula && (c.nombre || c.cliente) === cliente.nombre;
                    return (mismaCedula || mismoNombre) ? { ...c, ...actualizado } : c;
                });
            } else {
                clientesFrecuentesCache = [actualizado, ...clientesFrecuentesCache].slice(0, 50);
            }
            localStorage.setItem('clientes_frecuentes_v2', JSON.stringify(clientesFrecuentesCache));
            renderClientes();
            showToast(existente ? 'Cliente actualizado' : 'Cliente guardado', 'success');
        } catch (err) {
            console.error('No se pudo guardar/actualizar en Firebase, se mantiene en cache local', err);
            // Mantener cache local sin abortar
            const fallback = { ...cliente, id: existente?.id };
            if (existente) {
                clientesFrecuentesCache = clientesFrecuentesCache.map(c => {
                    const mismaCedula = cliente.cedula && (c.cedula || '').toLowerCase() === cliente.cedula.toLowerCase();
                    const mismoNombre = !cliente.cedula && (c.nombre || c.cliente) === cliente.nombre;
                    return (mismaCedula || mismoNombre) ? { ...c, ...fallback } : c;
                });
            } else {
                clientesFrecuentesCache = [fallback, ...clientesFrecuentesCache].slice(0, 50);
            }
            localStorage.setItem('clientes_frecuentes_v2', JSON.stringify(clientesFrecuentesCache));
            renderClientes();
            showToast('Guardado local (sin Firebase)', 'info');
        }
    }

    if (btnGuardarCliente) btnGuardarCliente.addEventListener('click', upsertClienteDesdeFormulario);

    if (selectClientes) selectClientes.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        if (!opt || !opt.dataset) return;
        if (opt.value === '') return;
        const nombre = opt.dataset.nombre || '';
        const cedula = opt.dataset.cedula || '';
        const telefono = opt.dataset.telefono || '';
        if (document.getElementById('v_cliente')) document.getElementById('v_cliente').value = nombre;
        if (document.getElementById('v_cedula')) document.getElementById('v_cedula').value = cedula;
        if (document.getElementById('v_telefono')) document.getElementById('v_telefono').value = telefono;
        // Aplicar descuento/notas si vienen
        try {
            const cliente = clientesFrecuentesCache.find(c => (c.cedula || '') === cedula) || clientesFrecuentesCache.find(c => (c.nombre || c.cliente) === nombre) || {};
            const desc = parseFloat(cliente.descuento);
            if (!isNaN(desc) && document.getElementById('v_desc')) {
                document.getElementById('v_desc').value = String(desc);
                showToast(`Descuento ${desc}% aplicado por cliente`, 'info');
            }
            if (cliente.notas) {
                showToast(`Nota cliente: ${cliente.notas}`, 'info', 4500);
            }
        } catch {}
    });
});

function finalizarVentaUI() {
    carrito = [];
    actualizarTabla();
    document.getElementById('v_cliente').value = '';
    if (document.getElementById('v_vendedor')) document.getElementById('v_vendedor').value = '';
    if (document.getElementById('v_cedula')) document.getElementById('v_cedula').value = '';
    if (document.getElementById('v_telefono')) document.getElementById('v_telefono').value = '';
    if (document.getElementById('v_ref')) document.getElementById('v_ref').value = '';
    if (document.getElementById('v_credito')) document.getElementById('v_credito').checked = false;
    if (document.getElementById('v_dias')) document.getElementById('v_dias').value = '21';
    if (document.getElementById('v_fecha_venc')) document.getElementById('v_fecha_venc').value = '';
    if (window.syncCreditoUI) window.syncCreditoUI();
    vendiendo = false;
    btnVender.disabled = false;
    actualizarHistorial();
}

async function enviarVentaAlServidor(venta) {
    // Obtener usuario actual para auditoría
    const user = window.Auth ? window.Auth.getUser() : null;
    const ventaConUsuario = {
        ...venta,
        usuario_id: user ? user.id : null
    };
    
    const token = localStorage.getItem('auth_token');
    const res = await fetch('/ventas', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(ventaConUsuario)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    marcarVentaComoSincronizada(venta.id_global);
    return data; // Contiene el ID generado por el servidor
}

function guardarVentaLocal(venta) {
    // DEPRECATED: localStorage fallback removed. Use IndexedDB implementation in db-local.js
    // If db-local.js is loaded, call that implementation instead.
    if (typeof window.guardarVentaLocal === 'function' && window.guardarVentaLocal !== guardarVentaLocal) {
        // db-local.js provides guardarVentaLocal; call it
        return window.guardarVentaLocal(venta);
    }
    // Fallback: keep localStorage for compatibility
    const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
    historico.push(venta);
    localStorage.setItem('ventas_pendientes', JSON.stringify(historico));
}

function marcarVentaComoSincronizada(idGlobal) {
    // Preferir IndexedDB implementation si existe
    if (typeof window.abrirIndexedDB === 'function' && typeof window.marcarComoSincronizada === 'function') {
        return abrirIndexedDB().then(db => marcarComoSincronizada(db, idGlobal));
    }
    const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
    const nuevo = historico.map(v => v.id_global === idGlobal ? { ...v, sync: true } : v);
    localStorage.setItem('ventas_pendientes', JSON.stringify(nuevo));
}

// --- ADMINISTRACIÓN DE PRODUCTOS ---
function crearProducto() {
    const body = {
        codigo: document.getElementById('i_codigo').value.trim(),
        descripcion: document.getElementById('i_desc').value.trim(),
        precio_usd: parseFloat(document.getElementById('i_precio').value),
        costo_usd: parseFloat(document.getElementById('i_costo').value) || 0,
        stock: parseInt(document.getElementById('i_stock').value) || 0
    };

    if (!body.codigo || !body.descripcion || isNaN(body.precio_usd)) {
        return alert('Complete todos los campos del producto.');
    }

    const token = localStorage.getItem('auth_token');
    fetch('/admin/productos', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
    })
    .then(r => r.json())
    .then(d => {
        if(d.error) throw new Error(d.error);
        alert('✅ Producto registrado');
        document.getElementById('i_codigo').value = '';
        document.getElementById('i_desc').value = '';
        document.getElementById('i_precio').value = '';
        if (document.getElementById('i_costo')) document.getElementById('i_costo').value = '';
        document.getElementById('i_stock').value = '';
    })
    .catch(err => alert('Error: ' + err.message));
}

function ajustarStock() {
    const body = {
        codigo: document.getElementById('a_codigo').value.trim(),
        diferencia: parseInt(document.getElementById('a_diff').value),
        motivo: document.getElementById('a_motivo').value
    };

    if (!body.codigo || isNaN(body.diferencia)) {
        return alert('Ingrese el código y la cantidad a ajustar.');
    }

    const token = localStorage.getItem('auth_token');
    fetch('/admin/ajustes', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
    })
    .then(r => r.json())
    .then(d => {
        if(d.error) throw new Error(d.error);
        alert('✅ Stock actualizado');
        document.getElementById('a_codigo').value = '';
        document.getElementById('a_diff').value = '';
    })
    .catch(err => alert('Error: ' + err.message));
}

function switchAdminTab(tab) {
    const pCrear = document.getElementById('panel-crear');
    const pAjuste = document.getElementById('panel-ajuste');
    const bCrear = document.getElementById('btn-tab-crear');
    const bAjuste = document.getElementById('btn-tab-ajuste');

    if(tab === 'crear') {
        pCrear.classList.remove('hidden'); pAjuste.classList.add('hidden');
        bCrear.classList.add('active-tab'); bAjuste.classList.remove('active-tab'); bAjuste.classList.add('text-slate-400');
    } else {
        pCrear.classList.add('hidden'); pAjuste.classList.remove('hidden');
        bAjuste.classList.add('active-tab'); bCrear.classList.remove('active-tab'); bCrear.classList.add('text-slate-400');
    }
}

// --- REPORTES ---
function actualizarHistorial() {
    const token = localStorage.getItem('auth_token');
    fetch('/reportes/ventas', {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(res => res.json())
        .then(data => {
            const cont = document.getElementById('historial');
            if (!cont) return;
            cont.innerHTML = '';
            data.slice(0, 3).forEach(v => {
                const totalUsd = v.tasa_bcv ? (v.total_bs / v.tasa_bcv) : 0;
                const div = document.createElement('div');
                div.className = "group p-3 border rounded-xl flex justify-between items-center text-xs hover:border-blue-200 hover:bg-blue-50 transition-all cursor-pointer";
                div.onclick = () => window.open(`/nota/${v.id}`, '_blank');
                div.innerHTML = `
                    <div class="flex flex-col">
                        <span class="font-black text-slate-700 uppercase">${v.cliente}</span>
                        ${ (v.cedula || v.telefono) ? `<span class="text-[9px] text-slate-400 font-mono">${v.cedula ? `ID: ${v.cedula}` : ''}${v.cedula && v.telefono ? ' | ' : ''}${v.telefono ? `Tel: ${v.telefono}` : ''}</span>` : '' }
                        <span class="text-[9px] text-slate-400 font-mono">${new Date(v.fecha).toLocaleString()}</span>
                        ${v.vendedor ? `<span class="text-[9px] text-slate-400 font-mono">Vend: ${v.vendedor}</span>` : ''}
                        <span class="text-[9px] text-slate-400 font-mono mt-1">Tasa: ${Number(v.tasa_bcv || 0).toFixed(2)} | Método: ${v.metodo_pago || ''}${v.referencia ? ` | Ref: ${v.referencia}` : ''}</span>
                    </div>
                    <div class="text-right">
                        <span class="font-black text-blue-600 block">$${totalUsd.toFixed(2)}</span>
                        <span class="text-[10px] text-slate-500 block">${v.total_bs.toFixed(2)} Bs</span>
                        <span class="text-[8px] text-slate-400 font-bold uppercase">Ver Nota <i class="fas fa-external-link-alt ml-1"></i></span>
                    </div>
                `;
                cont.appendChild(div);
            });
        });
}

function intentarSincronizar() {
    const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
    const pendientes = historico.filter(v => !v.sync);
    if (pendientes.length === 0) return;

    pendientes.reduce(async (promise, venta) => {
        await promise;
        return enviarVentaAlServidor(venta).catch(e => console.error(e));
    }, Promise.resolve()).then(() => actualizarHistorial());
}

// (Inicialización manejada más arriba en el archivo.)

// Exponer funciones al scope global para que los atributos inline onclick funcionen
// (cuando se carga `app.js` como módulo, las funciones no quedan en `window` automáticamente).
window.agregarAlCarrito = agregarAlCarrito;
window.registrarVenta = registrarVenta;
window.switchAdminTab = switchAdminTab;
window.crearProducto = crearProducto;
window.ajustarStock = ajustarStock;
window.eliminarDelCarrito = eliminarDelCarrito;
window.prepararParaAgregar = prepararParaAgregar;
window.actualizarTabla = actualizarTabla;
// undoLastLine removed