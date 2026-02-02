import { sincronizarVentasPendientes, upsertClienteFirebase, obtenerClientesFirebase } from './firebase-sync.js';
import { authFetch, apiFetchJson } from './app-api.js';
import { escapeHtml, showToast } from './app-utils.js';

import {
    carrito, productoSeleccionado, modoDevolucion, actualizarTabla, setModoDevolucion,
    toggleDevolucion, prepararParaAgregar, agregarAlCarrito, eliminarDelCarrito,
    limpiarSeleccion, getVentaSeleccionada, setVentaSeleccionada
} from './modules/cart.js';

import {
    registrarVenta, registrarDevolucion, renderVentaSeleccionada,
    cargarHistorialDevoluciones, actualizarSyncPendientes, intentarSincronizar
} from './modules/sales.js';

import { setupSearchModule } from './modules/search.js';

let vendiendo = false;
let clientesFrecuentesCache = [];
let TASA_BCV_POS = 1;
let TASA_BCV_UPDATED_POS = null;
let ventasRecientesCache = [];
let configGeneral = { empresa: {}, descuentos_volumen: [], devolucion: {} };
let lastAutoDescuentoVolumen = null;
let historialModo = 'ventas';

// Variables para PWA y Sincronización
let isOnline = navigator.onLine;

const tablaCuerpo = document.getElementById('venta-items-cuerpo');
const btnVender = document.getElementById('btnVender');
const statusIndicator = document.createElement('div');
// Toast container
// utilidades y API importadas desde app-utils.js y app-api.js

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
        const j = await apiFetchJson('/admin/ajustes/tasa-bcv');
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

async function cargarConfigGeneral() {
    try {
        const data = await apiFetchJson('/admin/ajustes/config');
        configGeneral = {
            empresa: data.empresa || {},
            descuentos_volumen: data.descuentos_volumen || [],
            devolucion: data.devolucion || {}
        };
        aplicarTemaEmpresa();
    } catch (err) {
        console.warn('Config general no cargada', err.message);
    }
}

function aplicarTemaEmpresa() {
    if (!configGeneral || !configGeneral.empresa) return;
    const root = document.documentElement;
    const { color_primario, color_secundario, color_acento } = configGeneral.empresa;
    if (color_primario) root.style.setProperty('--brand-primary', color_primario);
    if (color_secundario) root.style.setProperty('--brand-secondary', color_secundario);
    if (color_acento) root.style.setProperty('--brand-accent', color_acento);
}

function validarPoliticaDevolucionLocal(venta) {
    const policy = configGeneral?.devolucion || {};
    if (policy.habilitado === false) return 'Las devoluciones están deshabilitadas.';
    if (!venta || !venta.fecha) return null;
    const diasMax = parseInt(policy.dias_max, 10) || 0;
    if (diasMax > 0) {
        const diffDias = (Date.now() - new Date(venta.fecha).getTime()) / 86400000;
        if (diffDias > diasMax) return `La devolución supera el límite de ${diasMax} días.`;
    }
    return null;
}

async function cargarPresupuestoEnPOS(presupuestoId) {
    try {
        const data = await apiFetchJson(`/presupuestos/${encodeURIComponent(presupuestoId)}`);
        const { presupuesto, detalles } = data || {};
        if (!presupuesto) throw new Error('Presupuesto no encontrado');

        const cli = document.getElementById('v_cliente');
        const ced = document.getElementById('v_cedula');
        const tel = document.getElementById('v_telefono');
        const tasaInput = document.getElementById('v_tasa');
        const descInput = document.getElementById('v_desc');
        const refInput = document.getElementById('v_ref');

        if (cli) cli.value = presupuesto.cliente || '';
        if (ced) ced.value = presupuesto.cliente_doc || '';
        if (tel) tel.value = presupuesto.telefono || '';
        if (tasaInput) tasaInput.value = Number(presupuesto.tasa_bcv || 1).toFixed(2);
        if (descInput) descInput.value = String(presupuesto.descuento || 0);
        if (refInput) refInput.value = `PRES-${presupuesto.id}`;

        carrito.length = 0;
        (detalles || []).forEach(d => {
            carrito.push({
                codigo: d.codigo,
                descripcion: d.descripcion,
                precio_usd: Number(d.precio_usd || 0),
                cantidad: Number(d.cantidad || 0)
            });
        });

        setModoDevolucion(false);
        setVentaSeleccionada(null);
        actualizarTabla();
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('presupuesto');
            window.history.replaceState({}, '', url.toString());
        } catch {}
        showToast('Presupuesto cargado en POS', 'success');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'No se pudo cargar presupuesto', 'error');
    }
}

async function actualizarTasaPV() {
    const val = parseFloat(document.getElementById('v_tasa')?.value || '');

    // Si hay un valor válido en el input, guardar manualmente; si no, actualizar automático
    if (!Number.isNaN(val) && val > 0) {
        try {
            const j = await apiFetchJson('/admin/ajustes/tasa-bcv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tasa_bcv: val }),
            });
            setTasaUI(j.tasa_bcv ?? val, j.actualizado_en || new Date().toISOString());
            showToast('Tasa guardada', 'success');
        } catch (err) {
            showToast('Error guardando tasa', 'error');
        }
        return;
    }

    // Modo auto-actualizar
    try {
        const j = await apiFetchJson('/admin/ajustes/tasa-bcv/actualizar', { method: 'POST' });
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

// showToast moved to app-utils.js

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
        showToast('¡Conexión restablecida! Intentando sincronizar pendientes...', 'success', 4000);
        try { if (typeof window.sincronizarVentasPendientes === 'function') window.sincronizarVentasPendientes(); } catch (err) { console.warn('No se pudo disparar sync al reconectar', err); }
        intentarSincronizar();
        actualizarSyncPendientes();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        statusIndicator.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold bg-red-500 text-white shadow-lg';
        statusIndicator.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i> MODO OFFLINE';
        showToast('Estás en modo offline. Las ventas se guardarán localmente y se sincronizarán al reconectar.', 'info', 6000);
        actualizarSyncPendientes();
    });
}

// (La búsqueda de productos ahora se maneja desde modules/search.js)

async function cargarVentasRecientes() {
    try {
        ventasRecientesCache = await apiFetchJson('/reportes/ventas');
        renderVentasRecientes();
    } catch (err) {
        console.error(err);
        showToast('No se pudieron cargar ventas recientes', 'error');
    }
}

function renderVentasRecientes(filter = '') {
    const cont = document.getElementById('dev-ventas-list');
    if (!cont) return;
    const val = (filter || '').toLowerCase();
    const list = (ventasRecientesCache || []).filter(v => {
        if (!val) return true;
        return (v.cliente || '').toLowerCase().includes(val)
            || (v.referencia || '').toLowerCase().includes(val)
            || String(v.id).includes(val);
    }).slice(0, 20);
    if (!list.length) {
        cont.innerHTML = '<div class="text-slate-400">Sin coincidencias</div>';
        return;
    }
    cont.innerHTML = list.map(v => {
        const totalUsd = v.tasa_bcv ? (v.total_bs / v.tasa_bcv) : 0;
        return `<div class="p-3 border rounded-xl bg-white flex items-center justify-between">
            <div>
                <div class="font-semibold text-slate-700">${escapeHtml(v.cliente || 'Sin nombre')}</div>
                <div class="text-[11px] text-slate-500">#${escapeHtml(v.id)} • ${escapeHtml(new Date(v.fecha).toLocaleString())}</div>
                <div class="text-[11px] text-slate-500">Ref: ${escapeHtml(v.referencia || '—')} • ${escapeHtml(v.metodo_pago || '')}</div>
            </div>
            <div class="text-right">
                <div class="font-black text-blue-600">$${Number(totalUsd || 0).toFixed(2)}</div>
                <button class="mt-1 px-2 py-1 text-xs bg-rose-500 text-white rounded" data-dev-sel="${v.id}">Seleccionar</button>
            </div>
        </div>`;
    }).join('');
    cont.querySelectorAll('[data-dev-sel]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.devSel, 10);
            if (!Number.isInteger(id)) return;
            cargarVentaParaDevolucion(id);
        });
    });
}

async function cargarVentaParaDevolucion(id) {
    try {
        const { venta, detalles } = await apiFetchJson(`/reportes/ventas/${id}`);
        setVentaSeleccionada(venta);
        carrito.length = 0;
        (detalles || []).forEach(d => {
            carrito.push({
                codigo: d.codigo,
                descripcion: d.descripcion,
                precio_usd: d.precio_usd || 0,
                cantidad: d.cantidad,
                maxCantidad: d.cantidad,
                subtotal_bs: d.subtotal_bs || 0
            });
        });
        // Prellenar datos de cabecera con la venta original
        const cli = document.getElementById('v_cliente');
        const ced = document.getElementById('v_cedula');
        const tel = document.getElementById('v_telefono');
        const vend = document.getElementById('v_vendedor');
        if (cli) cli.value = venta?.cliente || '';
        if (ced) ced.value = venta?.cedula || '';
        if (tel) tel.value = venta?.telefono || '';
        if (vend) vend.value = venta?.vendedor || '';
        cargarHistorialDevoluciones(venta?.cliente || '', venta?.cedula || '');
        renderVentaSeleccionada();
        actualizarTabla();
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Error cargando venta', 'error');
    }
}

async function registrarPresupuesto() {
    if (vendiendo || carrito.length === 0) return;
    const cliente = document.getElementById('v_cliente').value.trim();
    const cedula = document.getElementById('v_cedula') ? document.getElementById('v_cedula').value.trim() : '';
    const telefono = document.getElementById('v_telefono') ? document.getElementById('v_telefono').value.trim() : '';
    const tasa = parseFloat(document.getElementById('v_tasa').value);
    const descuento = parseFloat(document.getElementById('v_desc') ? document.getElementById('v_desc').value : 0) || 0;
    const notas = document.getElementById('v_ref') ? document.getElementById('v_ref').value.trim() : '';

    if (!cliente) { showToast('Ingrese el nombre del cliente', 'error'); return; }
    if (!tasa || isNaN(tasa) || tasa <= 0) { showToast('Ingrese una tasa válida', 'error'); return; }

    const items = carrito.map(item => ({ codigo: item.codigo, cantidad: item.cantidad }));

    // Abrir ventana de nota inmediatamente para mantener el gesto del usuario
    try {
        const notaVentana = window.open('', '_blank');
        if (notaVentana) {
            imprimirNotaLocal._ventana = notaVentana;
            try { notaVentana.document.write('<p style="font-family: sans-serif; padding: 1rem;">Generando nota...</p>'); notaVentana.document.close(); } catch(e){}
        }
    } catch (e) {
        // ignore
    }

    vendiendo = true;
    try {
        const res = await apiFetchJson('/presupuestos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, cliente, cedula, telefono, tasa_bcv: tasa, descuento, notas })
        });
        showToast('Presupuesto guardado', 'success');
        finalizarVentaUI();
        if (window.limpiarBackup) window.limpiarBackup();
        if (res && res.presupuestoId) {
            const notaUrl = `/presupuestos/nota/${encodeURIComponent(res.presupuestoId)}`;
            // Si abrimos una ventana al inicio para evitar popup blockers, reutilizarla
            const win = (imprimirNotaLocal._ventana && !imprimirNotaLocal._ventana.closed) ? imprimirNotaLocal._ventana : null;
            if (win) {
                try { win.location.href = notaUrl; } catch (e) { window.open(notaUrl, '_blank'); }
            } else {
                window.open(notaUrl, '_blank');
            }
        }
    } catch (err) {
        showToast(err.message || 'Error guardando presupuesto', 'error');
    } finally {
        vendiendo = false;
    }
}

// --- FUNCIÓN DE IMPRESIÓN OFFLINE (GENERACIÓN LOCAL) ---
async function ensureNotaTemplateLoaded() {
    // Detectar layout desde config local
    let layout = 'compact';
    try {
        const cached = localStorage.getItem('nota_config');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.layout) layout = parsed.layout;
        }
    } catch {}
    const targetId = layout === 'standard' ? 'nota-template-lib-std' : 'nota-template-lib-compact';
    const targetSrc = layout === 'standard' ? '/shared/nota-template.js' : '/shared/nota-template-compact.js';
    if (window.NotaTemplate && window.NotaTemplate.layout === layout && typeof window.NotaTemplate.buildNotaHTML === 'function') return;
    await new Promise((resolve, reject) => {
        const existing = document.getElementById(targetId);
        if (existing) { existing.onload = resolve; existing.onerror = reject; return; }
        const s = document.createElement('script');
        s.id = targetId;
        s.src = targetSrc;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function imprimirNotaLocal(venta) {
    // Si se pasa una ventana ya abierta, escribir en ella; si no, abrir nueva.
    await ensureNotaTemplateLoaded();
    const html = await window.NotaTemplate.buildNotaHTML({ venta });
    const ventana = (imprimirNotaLocal._ventana && !imprimirNotaLocal._ventana.closed) ? imprimirNotaLocal._ventana : window.open('', '_blank');
    if (!ventana) throw new Error('No se pudo abrir ventana para la nota (popup bloqueado)');
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
}

// Exponer impresión y validación de política para que sales.js las reutilice
window.imprimirNotaLocal = imprimirNotaLocal;
window.validarPoliticaDevolucionLocal = validarPoliticaDevolucionLocal;

// registrarVenta, registrarDevolucion, cargarHistorialDevoluciones e intentarSincronizar
// ahora se implementan en modules/sales.js y se importan arriba.

// --- INTENTAR SINCRONIZACIÓN CADA 30 SEGUNDOS ---
document.addEventListener('DOMContentLoaded', () => {
        // --- Restaurar estado de carrito y formulario si existe backup local ---
        try {
            const backup = JSON.parse(localStorage.getItem('carrito_backup_v2') || '{}');
            if (backup && Array.isArray(backup.carrito) && backup.carrito.length > 0) {
                carrito.length = 0;
                backup.carrito.forEach(item => carrito.push(item));
                actualizarTabla();
            }
            if (backup.form) {
                if (backup.form.v_cliente) document.getElementById('v_cliente').value = backup.form.v_cliente;
                if (backup.form.v_cedula && document.getElementById('v_cedula')) document.getElementById('v_cedula').value = backup.form.v_cedula;
                if (backup.form.v_telefono && document.getElementById('v_telefono')) document.getElementById('v_telefono').value = backup.form.v_telefono;
                if (backup.form.v_desc && document.getElementById('v_desc')) document.getElementById('v_desc').value = backup.form.v_desc;
                if (backup.form.v_ref && document.getElementById('v_ref')) document.getElementById('v_ref').value = backup.form.v_ref;
            }
        } catch {}

        // Guardar automáticamente el estado antes de recargar/cerrar
        window.addEventListener('beforeunload', () => {
            try {
                const form = {
                    v_cliente: document.getElementById('v_cliente')?.value || '',
                    v_cedula: document.getElementById('v_cedula')?.value || '',
                    v_telefono: document.getElementById('v_telefono')?.value || '',
                    v_desc: document.getElementById('v_desc')?.value || '',
                    v_ref: document.getElementById('v_ref')?.value || ''
                };
                localStorage.setItem('carrito_backup_v2', JSON.stringify({ carrito, form }));
            } catch {}
        });

        // Limpiar backup al finalizar venta o presupuesto
        const limpiarBackup = () => { try { localStorage.removeItem('carrito_backup_v2'); } catch {} };
        window.limpiarBackup = limpiarBackup;
    setupOfflineUI();
    cargarConfigGeneral();
    actualizarHistorial();
    actualizarSyncPendientes();
    precargarTasaCache();
    cargarTasaPV();

    const presId = new URLSearchParams(window.location.search).get('presupuesto');
    if (presId) cargarPresupuestoEnPOS(presId);
    
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

    const btnTabVenta = document.getElementById('btn-tab-venta');
    const btnTabDev = document.getElementById('btn-tab-devolucion');
    if (btnTabVenta) btnTabVenta.addEventListener('click', () => setModoDevolucion(false));
    if (btnTabDev) btnTabDev.addEventListener('click', () => setModoDevolucion(true));
    const btnDevBuscar = document.getElementById('btn-dev-buscar');
    const inpDevBuscar = document.getElementById('dev-buscar-id');
    if (btnDevBuscar && inpDevBuscar) {
        btnDevBuscar.addEventListener('click', () => renderVentasRecientes(inpDevBuscar.value));
        inpDevBuscar.addEventListener('keyup', (e) => { if (e.key === 'Enter') renderVentasRecientes(inpDevBuscar.value); });
    }
    const btnDevRecientes = document.getElementById('btn-dev-recientes');
    if (btnDevRecientes) btnDevRecientes.addEventListener('click', () => cargarVentasRecientes());

    const btnToggleDev = document.getElementById('btn-toggle-devolucion');
    if (btnToggleDev) btnToggleDev.addEventListener('click', () => toggleDevolucion());

    // Registrar service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(() => console.log('✅ Service Worker activo'))
            .catch(err => console.error('❌ Error SW:', err));
    }

    // Toggle UI para ventas a crédito (acordeón por método o checkbox)
    const selMetodo = document.getElementById('v_metodo');
    const inputRef = document.getElementById('v_ref');
    const panelCredito = document.getElementById('panel-credito');
    const syncCreditoUI = () => {
        const active = (selMetodo?.value === 'credito');
        if (inputRef) {
            inputRef.disabled = !!active;
            if (active) inputRef.value = '';
        }
        if (panelCredito) {
            panelCredito.classList.toggle('hidden', !active);
        }
    };
    if (selMetodo) selMetodo.addEventListener('change', syncCreditoUI);
    syncCreditoUI();
    window.syncCreditoUI = syncCreditoUI;

    // Wire additional UI controls

    const btnGuardarCliente = document.getElementById('btnGuardarCliente');
    const inputNombreCliente = document.getElementById('v_cliente');
    const ulSugerenciasClientes = document.getElementById('v_sugerencias_clientes');

    const getFormCliente = () => ({
        nombre: (document.getElementById('v_cliente')?.value || '').trim(),
        cedula: (document.getElementById('v_cedula')?.value || '').trim(),
        telefono: (document.getElementById('v_telefono')?.value || '').trim()
    });

    function renderSugerenciasClientes(list = []) {
        if (!ulSugerenciasClientes) return;
        ulSugerenciasClientes.innerHTML = '';
        if (!list.length) { ulSugerenciasClientes.classList.add('hidden'); return; }
        list.slice(0, 8).forEach(c => {
            const li = document.createElement('li');
            li.className = 'p-3 border-b hover:bg-slate-50 cursor-pointer flex justify-between items-center text-sm';
            const nombre = c.nombre || c.cliente || '';
            const cedula = c.cedula || '';
            const telefono = c.telefono || c.telefono_cliente || '';
            li.innerHTML = `
                <div>
                    <div class="font-semibold text-slate-700">${escapeHtml(nombre || '(sin nombre)')}${cedula ? ` • ${escapeHtml(cedula)}` : ''}</div>
                    ${telefono ? `<div class="text-[11px] text-slate-500">${escapeHtml(telefono)}</div>` : ''}
                </div>
            `;
            li.addEventListener('click', () => {
                if (inputNombreCliente) inputNombreCliente.value = nombre;
                const ced = document.getElementById('v_cedula');
                const tel = document.getElementById('v_telefono');
                if (ced) ced.value = cedula;
                if (tel) tel.value = telefono;
                // aplicar descuento/notas si existen
                try {
                    const desc = parseFloat(c.descuento);
                    if (!Number.isNaN(desc) && document.getElementById('v_desc')) {
                        document.getElementById('v_desc').value = String(desc);
                        showToast(`Descuento ${desc}% aplicado por cliente`, 'info');
                    }
                    if (c.notas) showToast(`Nota cliente: ${c.notas}`, 'info', 4500);
                } catch {}
                cargarHistorialDevoluciones(nombre, cedula);
                ulSugerenciasClientes.classList.add('hidden');
            });
            ulSugerenciasClientes.appendChild(li);
        });
        ulSugerenciasClientes.classList.remove('hidden');
    }

    async function loadClientes() {
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
    }

    loadClientes();

    // Autocompletar de clientes por nombre/cédula
    if (inputNombreCliente) {
        inputNombreCliente.addEventListener('input', (e) => {
            const q = (e.target.value || '').toLowerCase().trim();
            if (!q || q.length < 1) { if (ulSugerenciasClientes) ulSugerenciasClientes.classList.add('hidden'); return; }
            const list = (clientesFrecuentesCache || []).filter(c => {
                const nombre = (c.nombre || c.cliente || '').toLowerCase();
                const cedula = (c.cedula || '').toLowerCase();
                return nombre.includes(q) || (cedula && cedula.includes(q));
            });
            renderSugerenciasClientes(list);
        });
        inputNombreCliente.addEventListener('focus', () => {
            const val = inputNombreCliente.value.trim().toLowerCase();
            if (!val) {
                renderSugerenciasClientes((clientesFrecuentesCache || []).slice(0, 8));
            }
        });
        inputNombreCliente.addEventListener('blur', () => {
            const nombre = inputNombreCliente.value.trim();
            const ced = document.getElementById('v_cedula') ? document.getElementById('v_cedula').value.trim() : '';
            if (nombre) cargarHistorialDevoluciones(nombre, ced);
        });
        document.addEventListener('click', (ev) => {
            if (!ulSugerenciasClientes) return;
            const within = ulSugerenciasClientes.contains(ev.target) || inputNombreCliente.contains(ev.target);
            if (!within) ulSugerenciasClientes.classList.add('hidden');
        });
    }

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
                await apiFetchJson('/backup/create', { 
                    method: 'POST',
                });
                showToast('Backup creado', 'success');
            } catch (err) {
                console.error(err);
                showToast('Error de backup', 'error');
            }
        });
    }

    // Prefill tasa desde backend/config o localStorage
    (async () => {
        try {
            const j = await apiFetchJson('/admin/ajustes/tasa-bcv');
            const input = document.getElementById('v_tasa');
            if (input && j && j.tasa_bcv) input.value = Number(j.tasa_bcv).toFixed(2);
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
            // actualizar cache ya se hizo arriba; no hay select que renderizar
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
            showToast('Guardado local (sin Firebase)', 'info');
        }
    }

    if (btnGuardarCliente) btnGuardarCliente.addEventListener('click', upsertClienteDesdeFormulario);
    // fin autocompletar clientes

    // Inicializar módulo de búsqueda de productos (modules/search.js)
    const buscarInput = document.getElementById('buscar');
    const resultadosUL = document.getElementById('resultados');
    if (buscarInput && resultadosUL) {
        setupSearchModule({
            buscarInput,
            resultadosUL,
            prepararParaAgregar,
            apiFetchJson,
            showToast,
            escapeHtml
        });
    }

    setModoDevolucion(false);
    cargarVentasRecientes();

    document.querySelectorAll('.hist-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            historialModo = btn.dataset.hist || 'ventas';
            document.querySelectorAll('.hist-btn').forEach(b => {
                b.classList.remove('active-tab');
                b.classList.add('text-slate-500');
            });
            btn.classList.add('active-tab');
            btn.classList.remove('text-slate-500');
            actualizarHistorial();
        });
    });
    const btnDefault = document.querySelector('.hist-btn[data-hist="ventas"]');
    if (btnDefault) btnDefault.click();
});

function finalizarVentaUI() {
    carrito.length = 0;
    actualizarTabla();
    document.getElementById('v_cliente').value = '';
    if (document.getElementById('v_vendedor')) document.getElementById('v_vendedor').value = '';
    if (document.getElementById('v_cedula')) document.getElementById('v_cedula').value = '';
    if (document.getElementById('v_telefono')) document.getElementById('v_telefono').value = '';
    if (document.getElementById('v_ref')) document.getElementById('v_ref').value = '';
    if (document.getElementById('v_dias')) document.getElementById('v_dias').value = '21';
    if (document.getElementById('v_fecha_venc')) document.getElementById('v_fecha_venc').value = '';
    const devRef = document.getElementById('dev-venta-ref');
    const devMot = document.getElementById('dev-motivo');
    if (devRef) devRef.value = '';
    if (devMot) devMot.value = '';
    setVentaSeleccionada(null);
    renderVentaSeleccionada();
    setModoDevolucion(false);
    if (window.syncCreditoUI) window.syncCreditoUI();
    vendiendo = false;
    btnVender.disabled = false;
    actualizarHistorial();
    if (window.limpiarBackup) window.limpiarBackup();
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
            showToast('Complete todos los campos del producto.', 'error');
            return;
    }

    apiFetchJson('/admin/productos', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })
    .then(d => {
        if(d.error) throw new Error(d.error);
        showToast('✅ Producto registrado', 'success');
        document.getElementById('i_codigo').value = '';
        document.getElementById('i_desc').value = '';
        document.getElementById('i_precio').value = '';
        if (document.getElementById('i_costo')) document.getElementById('i_costo').value = '';
        document.getElementById('i_stock').value = '';
    })
    .catch(err => showToast('Error: ' + err.message, 'error'));
}

function ajustarStock() {
    const body = {
        codigo: document.getElementById('a_codigo').value.trim(),
        diferencia: parseInt(document.getElementById('a_diff').value),
        motivo: document.getElementById('a_motivo').value
    };

    if (!body.codigo || isNaN(body.diferencia)) {
            showToast('Ingrese el código y la cantidad a ajustar.', 'error');
            return;
    }

    apiFetchJson('/admin/ajustes', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })
    .then(d => {
        if(d.error) throw new Error(d.error);
        showToast('✅ Stock actualizado', 'success');
        document.getElementById('a_codigo').value = '';
        document.getElementById('a_diff').value = '';
    })
    .catch(err => showToast('Error: ' + err.message, 'error'));
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
async function actualizarHistorial() {
    const cont = document.getElementById('historial');
    if (!cont) return;
    cont.innerHTML = '<div class="text-slate-400 text-xs">Cargando movimientos...</div>';
    try {
        const [ventasRes, devRes, presRes] = await Promise.allSettled([
            apiFetchJson('/reportes/ventas'),
            apiFetchJson('/devoluciones/historial?limit=20'),
            apiFetchJson('/presupuestos?limit=20')
        ]);
        const ventas = ventasRes.status === 'fulfilled' ? ventasRes.value : [];
        const devoluciones = devRes.status === 'fulfilled' ? devRes.value : [];
        const presupuestos = presRes.status === 'fulfilled' ? presRes.value : [];

        let movimientos = [];
        if (historialModo === 'ventas') {
            movimientos = [
                ...(ventas || []).map(v => ({ tipo: 'VENTA', ...v })),
                ...(devoluciones || []).map(d => ({ tipo: 'DEV', ...d }))
            ];
            movimientos = movimientos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5);
        }
        if (historialModo === 'presupuestos') {
            movimientos = (presupuestos || []).map(p => ({ tipo: 'PRES', ...p }));
            movimientos = movimientos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5);
        }

        cont.innerHTML = '';
        if (!movimientos.length) {
            cont.innerHTML = '<div class="text-slate-400 text-xs">Sin movimientos.</div>';
            return;
        }

        movimientos.forEach(mov => {
            const isDev = mov.tipo === 'DEV';
            const isPres = mov.tipo === 'PRES';
            const fechaTxt = new Date(mov.fecha).toLocaleString();
            const tasa = Number(mov.tasa_bcv || mov.tasa || 0) || null;
            const baseBs = Number(mov.total_bs || 0);
            const baseUsd = mov.total_usd != null
                ? Number(mov.total_usd)
                : (tasa ? baseBs / tasa : 0);
            const totalBs = isDev ? -Math.abs(baseBs) : baseBs;
            const totalUsd = isDev ? -Math.abs(baseUsd) : baseUsd;
            const cliente = escapeHtml(mov.cliente || mov.cliente_nombre || 'Sin nombre');
            const cedula = escapeHtml(mov.cedula || mov.cliente_doc || '');
            const telefono = escapeHtml(mov.telefono || '');
            const referencia = escapeHtml(mov.referencia || '');
            const vendedor = escapeHtml(mov.vendedor || '');
            const metodo = escapeHtml(mov.metodo_pago || (isDev ? 'DEVOLUCIÓN' : isPres ? 'PRESUPUESTO' : ''));
            const badge = isPres
                ? '<span class="px-2 py-1 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700">Presupuesto</span>'
                : `<span class="px-2 py-1 rounded-full text-[10px] font-bold ${isDev ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}">${isDev ? 'Devolución' : 'Venta'}</span>`;
            const div = document.createElement('div');
            const clickable = (isPres || (!isDev && mov.id));
            div.className = `group p-3 border rounded-xl flex justify-between items-center text-xs ${clickable ? 'hover:border-blue-200 hover:bg-blue-50 cursor-pointer' : 'cursor-default bg-white'}`;
            if (clickable && isPres) div.onclick = () => window.location.href = `/pages/index.html?presupuesto=${mov.id}`;
            if (clickable && !isPres && !isDev) div.onclick = () => window.open(`/nota/${mov.id}`, '_blank');
            div.innerHTML = `
                <div class="flex flex-col">
                    <div class="flex items-center gap-2">
                        ${badge}
                        <span class="font-black text-slate-700 uppercase">${cliente}</span>
                    </div>
                    ${(cedula || telefono) ? `<span class="text-[9px] text-slate-400 font-mono">${cedula ? `ID: ${cedula}` : ''}${cedula && telefono ? ' | ' : ''}${telefono ? `Tel: ${telefono}` : ''}</span>` : ''}
                    <span class="text-[9px] text-slate-400 font-mono">${fechaTxt}</span>
                    ${vendedor ? `<span class="text-[9px] text-slate-400 font-mono">Vend: ${vendedor}</span>` : ''}
                    <span class="text-[9px] text-slate-400 font-mono mt-1">${isDev ? '' : isPres ? '' : `Tasa: ${Number(tasa || 0).toFixed(2)} | `}Método: ${metodo}${referencia ? ` | Ref: ${referencia}` : ''}</span>
                </div>
                <div class="text-right">
                    <span class="font-black ${isDev ? 'text-rose-600' : 'text-blue-600'} block">${totalUsd < 0 ? '-' : ''}$${Math.abs(totalUsd).toFixed(2)}</span>
                    <span class="text-[10px] text-slate-500 block">${totalBs < 0 ? '-' : ''}${Math.abs(totalBs).toFixed(2)} Bs</span>
                    <span class="text-[8px] text-slate-400 font-bold uppercase">${isPres ? 'Usar en POS' : isDev ? 'Devolución registrada' : 'Ver Nota'}${!isDev && !isPres ? ' <i class="fas fa-external-link-alt ml-1"></i>' : ''}</span>
                </div>
            `;
            cont.appendChild(div);
        });
    } catch (err) {
        console.error(err);
        cont.innerHTML = '<div class="text-rose-600 text-xs">No se pudo cargar historial.</div>';
    }
}

// intentarSincronizar se implementa ahora en modules/sales.js

// (Inicialización manejada más arriba en el archivo.)

// Exponer funciones al scope global para que los atributos inline onclick funcionen
// (cuando se carga `app.js` como módulo, las funciones no quedan en `window` automáticamente).
window.registrarVenta = registrarVenta;
window.registrarPresupuesto = registrarPresupuesto;
window.switchAdminTab = switchAdminTab;
window.crearProducto = crearProducto;
window.ajustarStock = ajustarStock;
window.finalizarVentaUI = finalizarVentaUI;
window.actualizarHistorial = actualizarHistorial;
window.cargarVentasRecientes = cargarVentasRecientes;
// Funciones de carrito ya se exponen desde modules/cart.js