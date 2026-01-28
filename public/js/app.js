import { sincronizarVentasPendientes, upsertClienteFirebase, obtenerClientesFirebase } from './firebase-sync.js';

let carrito = [];
let productoSeleccionado = null;
let vendiendo = false;
let clientesFrecuentesCache = [];
let TASA_BCV_POS = 1;
let TASA_BCV_UPDATED_POS = null;
let modoDevolucion = false;
let ventaSeleccionada = null;
let ventasRecientesCache = [];
let configGeneral = { empresa: {}, descuentos_volumen: [], devolucion: {} };
let lastAutoDescuentoVolumen = null;

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

const authFetch = (url, options = {}) => fetch(url, { ...options, credentials: 'same-origin' });

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
        const r = await authFetch('/admin/ajustes/tasa-bcv');
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

async function cargarConfigGeneral() {
    try {
        const res = await authFetch('/admin/ajustes/config');
        if (!res.ok) throw new Error('No se pudo obtener configuración');
        const data = await res.json();
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

async function actualizarTasaPV() {
    const val = parseFloat(document.getElementById('v_tasa')?.value || '');

    // Si hay un valor válido en el input, guardar manualmente; si no, actualizar automático
    if (!Number.isNaN(val) && val > 0) {
        try {
            const r = await authFetch('/admin/ajustes/tasa-bcv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        const r = await authFetch('/admin/ajustes/tasa-bcv/actualizar', { method: 'POST' });
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

    authFetch(`/buscar?q=${encodeURIComponent(q)}`)
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
    if (modoDevolucion) { showToast('En modo devolución no puedes agregar productos manualmente. Selecciona una venta.', 'error'); return; }
    productoSeleccionado = p;
    buscarInput.value = `${p.codigo} - ${p.descripcion}`;
    resultadosUL.classList.add('hidden');
    document.getElementById('v_cantidad').focus();
}

// --- GESTIÓN DEL CARRITO ---
function agregarAlCarrito() {
    if (modoDevolucion) { showToast('Usa la selección de venta para devolver.', 'error'); return; }
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
    let descuento = parseFloat(document.getElementById('v_desc') ? document.getElementById('v_desc').value : 0) || 0;

    carrito.forEach((item, index) => {
        const subtotalUSD = item.cantidad * item.precio_usd;
        totalUSD += subtotalUSD;
        
        const tr = document.createElement('tr');
        tr.className = "border-b text-sm hover:bg-slate-50 transition-colors";
        const qtyCell = modoDevolucion
            ? `<input type="number" min="0" max="${item.maxCantidad || item.cantidad}" value="${item.cantidad}" class="w-16 text-center border rounded" data-idx="${index}" data-role="dev-qty">`
            : `${item.cantidad}`;
        tr.innerHTML = `
            <td class="p-4 font-bold text-slate-600">${item.codigo}</td>
            <td class="p-4 text-slate-500">${item.descripcion}</td>
            <td class="p-4 text-center font-bold">${qtyCell}</td>
            <td class="p-4 text-right text-slate-400 font-mono">$${item.precio_usd.toFixed(2)}</td>
            <td class="p-4 text-right font-black ${modoDevolucion ? 'text-rose-600' : 'text-blue-600'} font-mono">$${subtotalUSD.toFixed(2)}</td>
            <td class="p-4 text-center">
                <button onclick="eliminarDelCarrito(${index})" class="w-8 h-8 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        tablaCuerpo.appendChild(tr);
    });

    if (modoDevolucion) {
        tablaCuerpo.querySelectorAll('input[data-role="dev-qty"]').forEach(inp => {
            inp.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.idx, 10);
                let val = parseInt(e.target.value, 10) || 0;
                const max = carrito[idx]?.maxCantidad || carrito[idx]?.cantidad || 0;
                if (val < 0) val = 0;
                if (val > max) val = max;
                carrito[idx].cantidad = val;
                actualizarTabla();
            });
        });
    }

    // Descuento automático por volumen (solo en ventas)
    if (!modoDevolucion && Array.isArray(configGeneral?.descuentos_volumen) && configGeneral.descuentos_volumen.length) {
        const qtyTotal = carrito.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
        const tier = [...configGeneral.descuentos_volumen]
            .sort((a, b) => b.min_qty - a.min_qty)
            .find(t => qtyTotal >= Number(t.min_qty || 0));
        if (tier && Number(tier.descuento_pct) > 0) {
            const autoDesc = Number(tier.descuento_pct);
            if (autoDesc !== descuento) {
                const inputDesc = document.getElementById('v_desc');
                if (inputDesc) inputDesc.value = String(autoDesc);
                descuento = autoDesc;
                if (lastAutoDescuentoVolumen !== autoDesc) {
                    showToast(`Descuento ${autoDesc}% aplicado por volumen (≥ ${tier.min_qty})`, 'info');
                }
                lastAutoDescuentoVolumen = autoDesc;
            }
        } else if (lastAutoDescuentoVolumen !== null && descuento === lastAutoDescuentoVolumen) {
            const inputDesc = document.getElementById('v_desc');
            if (inputDesc) inputDesc.value = '0';
            descuento = 0;
            lastAutoDescuentoVolumen = null;
        }
    }

    const totalAfterDiscount = totalUSD * (1 - Math.max(0, Math.min(100, descuento)) / 100);
    const sign = modoDevolucion ? -1 : 1;
    document.getElementById('total-usd').innerText = (totalAfterDiscount * sign).toFixed(2);
    document.getElementById('total-bs').innerText = (totalAfterDiscount * tasa * sign).toLocaleString('es-VE', {minimumFractionDigits: 2});
}

function setModoDevolucion(active) {
    modoDevolucion = !!active;
    const label = document.getElementById('pv-modo-label');
    const btnVenta = document.getElementById('btn-tab-venta');
    const btnDev = document.getElementById('btn-tab-devolucion');
    const panelDev = document.getElementById('panel-devolucion');
    const panelCredito = document.getElementById('panel-credito');
    const panelVentaControls = document.querySelectorAll('[data-panel-venta]');
    if (label) label.textContent = modoDevolucion ? 'Devolución' : 'Venta';
    if (btnVenta && btnDev) {
        btnVenta.classList.toggle('active-tab', !modoDevolucion);
        btnVenta.classList.toggle('text-slate-500', modoDevolucion);
        btnDev.classList.toggle('active-tab', modoDevolucion);
        btnDev.classList.toggle('text-slate-500', !modoDevolucion);
    }
    if (panelDev) panelDev.classList.toggle('hidden', !modoDevolucion);
    if (panelVentaControls && panelVentaControls.length) {
        panelVentaControls.forEach(el => {
            el.classList.toggle('hidden', modoDevolucion);
            // No forzar mostrar el panel de crédito en modo venta; dejar que syncCreditoUI lo controle
            if (!modoDevolucion && el === panelCredito) {
                el.classList.add('hidden');
            }
        });
    }
    if (btnVender) {
        btnVender.textContent = modoDevolucion ? 'Registrar devolución' : 'Registrar venta';
        btnVender.classList.toggle('bg-blue-500', !modoDevolucion);
        btnVender.classList.toggle('bg-rose-500', modoDevolucion);
    }
    // Deshabilitar búsqueda manual en modo devolución
    if (buscarInput) buscarInput.disabled = modoDevolucion;
    const qtyInput = document.getElementById('v_cantidad');
    if (qtyInput) qtyInput.disabled = modoDevolucion;
    const btnAgregar = document.querySelector('button[onclick="agregarAlCarrito()"]');
    if (btnAgregar) btnAgregar.disabled = modoDevolucion;
    if (modoDevolucion) {
        carrito = [];
        ventaSeleccionada = null;
        renderVentaSeleccionada();
    }
    actualizarTabla();
    if (window.syncCreditoUI) window.syncCreditoUI();
}

function toggleDevolucion() {
    setModoDevolucion(!modoDevolucion);
}

async function cargarVentasRecientes() {
    try {
        const res = await authFetch('/reportes/ventas');
        if (!res.ok) throw new Error('Error cargando ventas');
        ventasRecientesCache = await res.json();
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
                <div class="font-semibold text-slate-700">${v.cliente || 'Sin nombre'}</div>
                <div class="text-[11px] text-slate-500">#${v.id} • ${new Date(v.fecha).toLocaleString()}</div>
                <div class="text-[11px] text-slate-500">Ref: ${v.referencia || '—'} • ${v.metodo_pago || ''}</div>
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
        const res = await authFetch(`/reportes/ventas/${id}`);
        if (!res.ok) throw new Error('Venta no encontrada');
        const { venta, detalles } = await res.json();
        ventaSeleccionada = venta;
        carrito = (detalles || []).map(d => ({
            codigo: d.codigo,
            descripcion: d.descripcion,
            precio_usd: d.precio_usd || 0,
            cantidad: d.cantidad,
            maxCantidad: d.cantidad,
            subtotal_bs: d.subtotal_bs || 0
        }));
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

function renderVentaSeleccionada() {
    const info = document.getElementById('dev-venta-info');
    const detalle = document.getElementById('dev-venta-detalle');
    if (!info || !detalle) return;
    if (!ventaSeleccionada) {
        info.classList.add('hidden');
        detalle.classList.add('hidden');
        return;
    }
    info.classList.remove('hidden');
    const totalUsd = ventaSeleccionada.tasa_bcv ? (ventaSeleccionada.total_bs / ventaSeleccionada.tasa_bcv) : 0;
    info.innerHTML = `<div class="flex justify-between">
        <div>
            <div class="font-semibold text-slate-700">${ventaSeleccionada.cliente || ''}</div>
            <div class="text-[11px] text-slate-500">#${ventaSeleccionada.id} • ${new Date(ventaSeleccionada.fecha).toLocaleString()}</div>
            <div class="text-[11px] text-slate-500">Ref: ${ventaSeleccionada.referencia || '—'}</div>
        </div>
        <div class="text-right text-sm font-black text-rose-600">$${Number(totalUsd || 0).toFixed(2)}</div>
    </div>`;

    detalle.classList.remove('hidden');
    detalle.innerHTML = carrito.map((d, idx) => `<div class="flex items-center justify-between border-b pb-1">
        <div class="text-slate-700">${d.codigo} — ${d.descripcion}</div>
        <div class="text-xs text-slate-500">Vendidos: ${d.maxCantidad}</div>
    </div>`).join('');
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
    await ensureNotaTemplateLoaded();
    const html = await window.NotaTemplate.buildNotaHTML({ venta });
    const ventana = window.open('', '_blank');
    ventana.document.write(html);
    ventana.document.close();
}

// --- PROCESAR VENTA FINAL ---
async function registrarVenta() {
    if (modoDevolucion) {
        await registrarDevolucion();
        return;
    }
    if (vendiendo || carrito.length === 0) return;
    
    const cliente = document.getElementById('v_cliente').value.trim();
    const vendedor = document.getElementById('v_vendedor') ? document.getElementById('v_vendedor').value.trim() : '';
    const cedula = document.getElementById('v_cedula') ? document.getElementById('v_cedula').value.trim() : '';
    const telefono = document.getElementById('v_telefono') ? document.getElementById('v_telefono').value.trim() : '';
    const tasa = parseFloat(document.getElementById('v_tasa').value);

    const selMetodo = document.getElementById('v_metodo');
    const isCredito = (selMetodo?.value === 'credito');
    const diasVenc = parseInt(document.getElementById('v_dias')?.value, 10) || 21;
    const fechaVenc = document.getElementById('v_fecha_venc')?.value || null;

    

    // validations
    const metodo = selMetodo ? selMetodo.value : '';
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
        btnVender.textContent = 'Registrar venta';
    }
    actualizarHistorial()
}

async function registrarDevolucion() {
    if (vendiendo || carrito.length === 0) return;

    const cliente = document.getElementById('v_cliente').value.trim();
    const cedula = document.getElementById('v_cedula') ? document.getElementById('v_cedula').value.trim() : '';
    const telefono = document.getElementById('v_telefono') ? document.getElementById('v_telefono').value.trim() : '';
    const tasa = parseFloat(document.getElementById('v_tasa').value);
    const motivo = document.getElementById('dev-motivo') ? document.getElementById('dev-motivo').value.trim() : '';
    const ventaOriginalId = ventaSeleccionada ? ventaSeleccionada.id : null;

    if (!cliente) { showToast('Ingrese el nombre del cliente', 'error'); return; }
    if (!tasa || isNaN(tasa) || tasa <= 0) { showToast('Ingrese una tasa de cambio válida (> 0)', 'error'); return; }

    if (!ventaOriginalId) { showToast('Selecciona una venta a devolver', 'error'); return; }

    const policyError = validarPoliticaDevolucionLocal(ventaSeleccionada);
    if (policyError) { showToast(policyError, 'error'); return; }

    const items = carrito
        .filter(item => Number(item.cantidad) > 0)
        .map(item => ({ codigo: item.codigo, cantidad: item.cantidad }));
    if (!items.length) { showToast('Coloca cantidades a devolver', 'error'); return; }

    vendiendo = true;
    btnVender.disabled = true;
    btnVender.textContent = 'Procesando...';

    try {
        const usuario = window.Auth ? window.Auth.getUser() : null;
        const refDev = ventaSeleccionada?.referencia || `DEV-${ventaOriginalId}`;
        const res = await authFetch('/devoluciones', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                items,
                cliente,
                cedula,
                telefono,
                tasa_bcv: tasa,
                referencia: refDev,
                motivo,
                venta_original_id: ventaOriginalId,
                usuario_id: usuario ? usuario.id : null
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error al registrar devolución');
        }

        await res.json();
        finalizarVentaUI();
        setModoDevolucion(false);
        showToast('Devolución registrada', 'success');
        cargarHistorialDevoluciones(cliente, cedula);
    } catch (err) {
        console.error(err);
        showToast('❌ Error: ' + err.message, 'error');
    } finally {
        vendiendo = false;
        btnVender.disabled = false;
        btnVender.textContent = 'Registrar venta';
    }
}

function renderHistorialDevoluciones(list = []) {
    const cont = document.getElementById('dev-historial');
    if (!cont) return;
    if (!list.length) {
        cont.classList.remove('hidden');
        cont.innerHTML = '<div class="text-slate-400 text-xs">Sin devoluciones previas para este cliente.</div>';
        return;
    }
    cont.classList.remove('hidden');
    cont.innerHTML = list.slice(0, 5).map(d => {
        const fecha = new Date(d.fecha).toLocaleString();
        return `<div class="p-3 border rounded-xl bg-slate-50 flex items-center justify-between">
            <div>
                <div class="font-semibold text-slate-700">${d.cliente || ''}</div>
                <div class="text-[11px] text-slate-500">${fecha}${d.motivo ? ' • ' + d.motivo : ''}</div>
                ${d.referencia ? `<div class="text-[11px] text-slate-500">Ref: ${d.referencia}</div>` : ''}
            </div>
            <div class="text-right text-[11px]">
                <div class="font-black text-rose-600">$${Number(d.total_usd || 0).toFixed(2)}</div>
                <div class="text-slate-500">${Number(d.total_bs || 0).toFixed(2)} Bs</div>
            </div>
        </div>`;
    }).join('');
}

function aplicarDescuentoDevolucion(list = []) {
    if (!list.length) return;
    const inputDesc = document.getElementById('v_desc');
    if (!inputDesc) return;
    const actual = parseFloat(inputDesc.value || '0') || 0;
    if (actual > 0) return;
    inputDesc.value = '5';
    showToast('Descuento 5% aplicado por devolución previa del cliente', 'info');
    actualizarTabla();
}

async function cargarHistorialDevoluciones(cliente, cedula) {
    const cont = document.getElementById('dev-historial');
    if (!cont) return;
    if (!cliente && !cedula) { cont.innerHTML = '<div class="text-slate-400 text-xs">Sin cliente seleccionado.</div>'; return; }
    cont.innerHTML = '<div class="text-slate-400 text-xs">Cargando devoluciones...</div>';
    try {
        const params = new URLSearchParams();
        if (cliente) params.set('cliente', cliente);
        if (cedula) params.set('cedula', cedula);
        const res = await authFetch(`/devoluciones/historial?${params.toString()}`);
        if (!res.ok) throw new Error('Error cargando historial');
        const data = await res.json();
        renderHistorialDevoluciones(data || []);
        aplicarDescuentoDevolucion(data || []);
    } catch (err) {
        console.error(err);
        cont.innerHTML = '<div class="text-rose-600 text-xs">Error cargando historial de devoluciones.</div>';
    }
}

// --- INTENTAR SINCRONIZACIÓN CADA 30 SEGUNDOS ---
document.addEventListener('DOMContentLoaded', () => {
    setupOfflineUI();
    cargarConfigGeneral();
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
    if (btnToggleDev) btnToggleDev.addEventListener('click', toggleDevolucion);

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
                    <div class="font-semibold text-slate-700">${nombre || '(sin nombre)'}${cedula ? ` • ${cedula}` : ''}</div>
                    ${telefono ? `<div class="text-[11px] text-slate-500">${telefono}</div>` : ''}
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
                const r = await authFetch('/backup/create', { 
                    method: 'POST',
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
            const r = await authFetch('/admin/ajustes/tasa-bcv');
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

    setModoDevolucion(false);
    cargarVentasRecientes();
});

function finalizarVentaUI() {
    carrito = [];
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
    ventaSeleccionada = null;
    renderVentaSeleccionada();
    setModoDevolucion(false);
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
    
    const res = await authFetch('/ventas', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
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

    authFetch('/admin/productos', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
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

    authFetch('/admin/ajustes', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
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
async function actualizarHistorial() {
    const cont = document.getElementById('historial');
    if (!cont) return;
    cont.innerHTML = '<div class="text-slate-400 text-xs">Cargando movimientos...</div>';
    try {
        const [ventasRes, devRes] = await Promise.all([
            authFetch('/reportes/ventas'),
            authFetch('/devoluciones/historial?limit=20')
        ]);
        const ventas = ventasRes.ok ? await ventasRes.json() : [];
        const devoluciones = devRes.ok ? await devRes.json() : [];

        const movimientos = [
            ...(ventas || []).map(v => ({ tipo: 'VENTA', ...v })),
            ...(devoluciones || []).map(d => ({ tipo: 'DEV', ...d }))
        ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 3);

        cont.innerHTML = '';
        if (!movimientos.length) {
            cont.innerHTML = '<div class="text-slate-400 text-xs">Sin movimientos.</div>';
            return;
        }

        movimientos.forEach(mov => {
            const isDev = mov.tipo === 'DEV';
            const fechaTxt = new Date(mov.fecha).toLocaleString();
            const tasa = Number(mov.tasa_bcv || mov.tasa || 0) || null;
            const baseBs = Number(mov.total_bs || 0);
            const baseUsd = mov.total_usd != null
                ? Number(mov.total_usd)
                : (tasa ? baseBs / tasa : 0);
            const totalBs = isDev ? -Math.abs(baseBs) : baseBs;
            const totalUsd = isDev ? -Math.abs(baseUsd) : baseUsd;
            const cliente = mov.cliente || 'Sin nombre';
            const cedula = mov.cedula || mov.cliente_doc || '';
            const telefono = mov.telefono || '';
            const referencia = mov.referencia || '';
            const vendedor = mov.vendedor || '';
            const metodo = mov.metodo_pago || (isDev ? 'DEVOLUCIÓN' : '');
            const badge = `<span class="px-2 py-1 rounded-full text-[10px] font-bold ${isDev ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}">${isDev ? 'Devolución' : 'Venta'}</span>`;
            const div = document.createElement('div');
            const clickable = !isDev && mov.id;
            div.className = `group p-3 border rounded-xl flex justify-between items-center text-xs ${clickable ? 'hover:border-blue-200 hover:bg-blue-50 cursor-pointer' : 'cursor-default bg-white'}`;
            if (clickable) div.onclick = () => window.open(`/nota/${mov.id}`, '_blank');
            div.innerHTML = `
                <div class="flex flex-col">
                    <div class="flex items-center gap-2">
                        ${badge}
                        <span class="font-black text-slate-700 uppercase">${cliente}</span>
                    </div>
                    ${(cedula || telefono) ? `<span class="text-[9px] text-slate-400 font-mono">${cedula ? `ID: ${cedula}` : ''}${cedula && telefono ? ' | ' : ''}${telefono ? `Tel: ${telefono}` : ''}</span>` : ''}
                    <span class="text-[9px] text-slate-400 font-mono">${fechaTxt}</span>
                    ${vendedor ? `<span class="text-[9px] text-slate-400 font-mono">Vend: ${vendedor}</span>` : ''}
                    <span class="text-[9px] text-slate-400 font-mono mt-1">${isDev ? '' : `Tasa: ${Number(tasa || 0).toFixed(2)} | `}Método: ${metodo}${referencia ? ` | Ref: ${referencia}` : ''}</span>
                </div>
                <div class="text-right">
                    <span class="font-black ${isDev ? 'text-rose-600' : 'text-blue-600'} block">${totalUsd < 0 ? '-' : ''}$${Math.abs(totalUsd).toFixed(2)}</span>
                    <span class="text-[10px] text-slate-500 block">${totalBs < 0 ? '-' : ''}${Math.abs(totalBs).toFixed(2)} Bs</span>
                    <span class="text-[8px] text-slate-400 font-bold uppercase">${isDev ? 'Devolución registrada' : 'Ver Nota'}${!isDev ? ' <i class="fas fa-external-link-alt ml-1"></i>' : ''}</span>
                </div>
            `;
            cont.appendChild(div);
        });
    } catch (err) {
        console.error(err);
        cont.innerHTML = '<div class="text-rose-600 text-xs">No se pudo cargar historial.</div>';
    }
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