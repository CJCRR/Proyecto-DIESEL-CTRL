import { sincronizarVentasPendientes } from './firebase-sync.js';
import { authFetch, apiFetchJson } from './app-api.js';
import { escapeHtml, showToast } from './app-utils.js';
import { guardarProductoLocal } from './db-local.js';

import {
    carrito, productoSeleccionado, modoDevolucion, actualizarTabla, setModoDevolucion,
    toggleDevolucion, prepararParaAgregar, agregarAlCarrito, eliminarDelCarrito,
    limpiarSeleccion, getVentaSeleccionada, setVentaSeleccionada, recalcularPreciosPorNivel
} from './modules/cart.js';

import {
    registrarVenta, registrarDevolucion, renderVentaSeleccionada,
    cargarHistorialDevoluciones, actualizarSyncPendientes, intentarSincronizar
} from './modules/sales.js';

import { setupSearchModule } from './modules/search.js';
import { initClientesUI, initOfflineUI, initSyncBackupUI } from './modules/ui.js';

let vendiendo = false;
let TASA_BCV_POS = 1;
let TASA_BCV_UPDATED_POS = null;
let ventasRecientesCache = [];
let configGeneral = { empresa: {}, descuentos_volumen: [], devolucion: {}, nota: {} };
let lastAutoDescuentoVolumen = null;
let historialModo = 'ventas';
let vendedoresPOS = [];

const tablaCuerpo = document.getElementById('venta-items-cuerpo');
const btnVender = document.getElementById('btnVender');
// Toast container

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        // Evitar interferir con combinaciones del navegador o inputs cuando no aplica
        const tag = (e.target && e.target.tagName) || '';
        const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || (e.target && e.target.isContentEditable);

        // F2: enfocar búsqueda de producto
        if (e.key === 'F2') {
            e.preventDefault();
            const buscar = document.getElementById('buscar');
            if (buscar) buscar.focus();
            return;
        }

        // F3: enfocar nombre de cliente
        if (e.key === 'F3') {
            e.preventDefault();
            const cli = document.getElementById('v_cliente');
            if (cli) cli.focus();
            return;
        }

        // F9: registrar venta rápida (solo si no hay otro modificador)
        if (e.key === 'F9' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            try {
                if (typeof registrarVenta === 'function') {
                    registrarVenta();
                } else if (window.registrarVenta) {
                    window.registrarVenta();
                }
            } catch (err) {
                console.warn('Error ejecutando atajo F9 registrarVenta', err);
            }
            return;
        }

        // Ctrl+Enter: registrar venta incluso escribiendo en inputs de pago/cliente
        if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            try {
                if (typeof registrarVenta === 'function') {
                    registrarVenta();
                } else if (window.registrarVenta) {
                    window.registrarVenta();
                }
            } catch (err) {
                console.warn('Error ejecutando atajo Ctrl+Enter registrarVenta', err);
            }
        }
    });
}

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

// Precarga de catálogo de productos en IndexedDB para búsqueda offline
async function precargarCatalogoProductos() {
    try {
        // Traer hasta ~5000 productos; el backend aplica límite
        const productos = await apiFetchJson('/productos?limit=5000');
        if (Array.isArray(productos) && productos.length) {
            for (const p of productos) {
                if (!p || !p.codigo) continue;
                try {
                    await guardarProductoLocal({
                        codigo: p.codigo,
                        descripcion: p.descripcion,
                        precio_usd: p.precio_usd,
                        stock: p.stock
                    });
                } catch (e) {
                    console.warn('No se pudo cachear producto al precargar', p.codigo, e);
                }
            }
            console.log('✅ Catálogo de productos precargado en IndexedDB:', productos.length);
        }
    } catch (err) {
        console.warn('No se pudo precargar catálogo de productos', err);
    }
}

async function cargarConfigGeneral() {
    try {
        const data = await apiFetchJson('/admin/ajustes/config');
        configGeneral = {
            empresa: data.empresa || {},
            descuentos_volumen: data.descuentos_volumen || [],
            devolucion: data.devolucion || {},
            nota: data.nota || {}
        };
        try { window.configGeneral = configGeneral; } catch {}
        aplicarTemaEmpresa();
        aplicarEstrategiaPreciosUI();
    } catch (err) {
        console.warn('Config general no cargada', err.message);
    }
}

async function cargarVendedoresPOS() {
    const sel = document.getElementById('v_vendedor');
    try {
        const data = await apiFetchJson('/admin/usuarios/vendedores-list');
        vendedoresPOS = Array.isArray(data) ? data : [];
        if (!sel) return;

        const opciones = ['<option value="">Seleccionar vendedor</option>'];
        vendedoresPOS.forEach((u) => {
            const nombre = (u.nombre_completo || u.username || '').trim();
            const texto = nombre ? `${escapeHtml(nombre)}` : escapeHtml(u.username || '');
            opciones.push(`<option value="${u.id}">${texto}</option>`);
        });
        sel.innerHTML = opciones.join('');

        const authUser = window.Auth ? window.Auth.getUser() : null;
        if (authUser && authUser.id) {
            const existe = vendedoresPOS.find(u => u.id === authUser.id);
            if (existe) {
                sel.value = String(authUser.id);
            }
        }
    } catch (err) {
        console.warn('No se pudieron cargar vendedores para POS', err);
        if (sel) {
            sel.innerHTML = '<option value="">(Sin vendedores configurados)</option>';
        }
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

function aplicarEstrategiaPreciosUI() {
    if (!configGeneral || !configGeneral.empresa) return;

    const empresa = configGeneral.empresa;
    const rawLevels = [
        { key: '1', nombre: empresa.precio1_nombre, pct: empresa.precio1_pct },
        { key: '2', nombre: empresa.precio2_nombre, pct: empresa.precio2_pct },
        { key: '3', nombre: empresa.precio3_nombre, pct: empresa.precio3_pct },
    ];

    const levels = rawLevels
        .map(l => ({
            key: l.key,
            nombre: (l.nombre || '').toString().slice(0, 60),
            pct: Number(l.pct) || 0,
        }))
        .filter(l => l.pct > 0);

    try { window.priceLevelsConfig = levels; } catch {}

    const wrapper = document.getElementById('pv-price-level-wrapper');
    const sel = document.getElementById('pv_nivel_precio');
    const info = document.getElementById('pv_nivel_precio_info');
    if (!wrapper || !sel) return;

    if (!levels.length) {
        wrapper.classList.add('hidden');
        if (info) info.textContent = '';
        try { window.currentPriceLevelKey = 'base'; } catch {}
        return;
    }

    wrapper.classList.remove('hidden');

    const options = ['<option value="base">Base (lista)</option>'];
    levels.forEach(l => {
        const label = l.nombre || `Precio ${l.key}`;
        options.push(`<option value="${l.key}">${escapeHtml(label)} (+${l.pct}% )</option>`);
    });
    sel.innerHTML = options.join('');
    sel.value = 'base';

    const updateInfo = () => {
        const val = sel.value || 'base';
        try { window.currentPriceLevelKey = val; } catch {}
        if (!info) return;
        if (val === 'base') {
            info.textContent = 'Usando precio de lista.';
        } else {
            const lvl = levels.find(l => l.key === val);
            if (lvl) {
                info.textContent = `+${lvl.pct}% sobre precio base`;
            } else {
                info.textContent = '';
            }
        }

        // Recalcular precios de los items ya agregados al carrito
        try {
            recalcularPreciosPorNivel();
        } catch (e) {
            console.warn('No se pudo recalcular precios por nivel', e);
        }
    };

    sel.onchange = updateInfo;
    updateInfo();
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
        const baseUsd = v.tasa_bcv ? (v.total_bs / v.tasa_bcv) : 0;
        const totalUsd = (v.total_usd_iva != null) ? v.total_usd_iva : baseUsd;
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

        // Limpiar cola legacy de ventas en localStorage (migrado a IndexedDB)
        try { localStorage.removeItem('ventas_pendientes'); } catch {}
    
    initOfflineUI();
    cargarConfigGeneral();
    cargarVendedoresPOS();
    actualizarHistorial();
    actualizarSyncPendientes();
    precargarTasaCache();
    cargarTasaPV();
    // Precargar catálogo de productos para búsqueda offline
    precargarCatalogoProductos();

    const presId = new URLSearchParams(window.location.search).get('presupuesto');
    if (presId) cargarPresupuestoEnPOS(presId);
    
    // Fallback de sincronización periódica SOLO si no hay Background Sync
    if (navigator.onLine && !('SyncManager' in window)) {
        sincronizarVentasPendientes();
        setInterval(() => {
            if (navigator.onLine) sincronizarVentasPendientes();
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

    initClientesUI();

    initSyncBackupUI();

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

    // Atajos de teclado del POS (F2 búsqueda, F3 cliente, F9 / Ctrl+Enter vender)
    setupKeyboardShortcuts();
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
            const rawBs = (!isDev && !isPres && mov.total_bs_iva != null)
                ? Number(mov.total_bs_iva)
                : baseBs;
            const rawUsd = (!isDev && !isPres && mov.total_usd_iva != null)
                ? Number(mov.total_usd_iva)
                : baseUsd && tasa ? (baseBs / tasa) : baseUsd;
            const totalBs = isDev ? -Math.abs(rawBs) : rawBs;
            const totalUsd = isDev ? -Math.abs(rawUsd) : rawUsd;
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