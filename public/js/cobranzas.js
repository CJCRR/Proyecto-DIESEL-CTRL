let cuentas = [];
let cuentaSeleccionada = null;
let tasaBCV = 1;
let periodoAnchor = null; // inicio del mes actual mostrado
let periodoDesde = null;  // YYYY-MM-DD
let periodoHasta = null;  // YYYY-MM-DD
let resumenGlobal = null; // resumen histórico sin filtro de período
import { apiFetchJson } from './app-api.js';
import { formatNumber } from './format-utils.js';
import { initCustomSelect } from './modules/ui.js';

// Intentar cargar utilidades centralizadas para páginas que no usan módulos
(async () => {
    if (!window.showToast || !window.escapeHtml) {
        try {
            const m = await import('./app-utils.js');
            window.showToast = window.showToast || m.showToast;
            window.escapeHtml = window.escapeHtml || m.escapeHtml;
        } catch (e) {
            // fallback mínimo si no se pudo importar
            const toastEl = document.getElementById('toast');
            if (!window.showToast) {
                window.showToast = function (msg, type = 'info') {
                    if (!toastEl) return alert(msg);
                    toastEl.textContent = msg;
                    toastEl.className = 'fixed bottom-4 right-4 px-4 py-3 rounded-xl shadow-lg text-white text-sm';
                    toastEl.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#0369a1';
                    toastEl.classList.remove('hidden');
                    setTimeout(() => toastEl.classList.add('hidden'), 2500);
                };
            }
            if (!window.escapeHtml) {
                window.escapeHtml = (v) => String(v ?? '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }
        }
    }
})();

function badgeEstado(estado) {
    const base = 'px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest';
    if (estado === 'vencido') return `<span class="${base} bg-rose-100 text-rose-700">Vencido</span>`;
    if (estado === 'parcial') return `<span class="${base} bg-amber-100 text-amber-700">Parcial</span>`;
    if (estado === 'cancelado') return `<span class="${base} bg-emerald-100 text-emerald-700">Cancelado</span>`;
    return `<span class="${base} bg-slate-100 text-slate-600">Pendiente</span>`;
}

function renderResumen(rows = []) {
    const cont = document.getElementById('resumen-cards');
    if (!cont) return;
    cont.innerHTML = '';
    let totalCantPeriodo = 0;
    let totalSaldoPeriodo = 0;
    const estados = ['pendiente', 'parcial', 'vencido', 'cancelado'];
    estados.forEach(e => {
        const found = rows.find(r => r.estado === e) || { cantidad: 0, saldo_usd: 0 };
        totalCantPeriodo += Number(found.cantidad || 0);
        totalSaldoPeriodo += Number(found.saldo_usd || 0);
        const card = document.createElement('div');
        card.className = 'p-3 border rounded-xl bg-slate-50';
        card.innerHTML = `
            <div class="text-[10px] font-black text-slate-400 uppercase">${e}</div>
            <div class="text-2xl font-black text-slate-800">${Number(found.cantidad || 0)}</div>
            <div class="text-xs text-slate-500">Saldo $${formatNumber(found.saldo_usd || 0, 2)}</div>
        `;
        cont.appendChild(card);
    });

    const totalesEl = document.getElementById('resumen-totales');
    if (totalesEl) {
        let totalHist = 0;
        if (Array.isArray(resumenGlobal)) {
            resumenGlobal.forEach(r => {
                totalHist += Number(r.saldo_usd || 0);
            });
        }
        totalesEl.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="font-semibold text-slate-700">Período actual</span>
                <span class="font-mono text-[11px] text-slate-700">${totalCantPeriodo} cuentas · $${formatNumber(totalSaldoPeriodo, 2)}</span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500">
                <span>Histórico pendiente</span>
                <span class="font-mono">$${formatNumber(totalHist, 2)}</span>
            </div>
        `;
    }
}

function renderTabla(list = []) {
    // Asegurarse de que siempre trabajamos con un arreglo
    if (!Array.isArray(list)) {
        console.warn('renderTabla esperaba un array, se recibió:', list);
        list = [];
    }
    const tbody = document.getElementById('tabla-cuentas');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!list.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" class="p-6 text-center text-slate-400">Sin resultados</td>';
        tbody.appendChild(tr);
        return;
    }
    list.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 cursor-pointer';
        tr.onclick = () => cargarDetalle(c.id);
        const estado = c.estado_calc || c.estado;
        const diasMora = typeof c.dias_mora === 'number' ? c.dias_mora : 0;
        tr.innerHTML = `
            <td class="p-3 font-semibold text-slate-800">${c.cliente_nombre || 'Cliente'}</td>
            <td class="p-3 text-slate-500">${c.nro_nota ? ` ${c.nro_nota}` : (c.cliente_doc || '')}</td>
            <td class="p-3 text-center text-sm">
                ${c.fecha_vencimiento || ''}
                ${estado === 'vencido' && diasMora > 0 ? `<div class="text-[10px] text-rose-600">${diasMora} días de mora</div>` : ''}
            </td>
            <td class="p-3 text-right font-mono text-slate-500">$${formatNumber(c.total_usd || 0, 2)}</td>
            <td class="p-3 text-right font-mono font-bold text-blue-600">$${formatNumber(c.saldo_usd || 0, 2)}</td>
            <td class="p-3 text-center">${badgeEstado(estado)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPagos(pagos = []) {
    const cont = document.getElementById('detalle-pagos');
    if (!cont) return;
    cont.innerHTML = '';
    if (!pagos.length) {
        cont.innerHTML = '<div class="text-xs text-slate-400">Sin pagos registrados</div>';
        return;
    }
    pagos.forEach(p => {
        const div = document.createElement('div');
        div.className = 'p-2 border rounded-xl bg-slate-50 flex justify-between items-center';
        div.innerHTML = `
            <div class="text-xs text-slate-600">
                <div class="font-bold text-slate-800">$${formatNumber(p.monto_usd || 0, 2)}${p.moneda === 'BS' ? ` (Bs ${formatNumber(p.monto_moneda || 0, 2)})` : ''}</div>
                <div>${new Date(p.fecha).toLocaleString()}</div>
                ${p.metodo ? `<div>${p.metodo}${p.referencia ? ' - ' + p.referencia : ''}</div>` : ''}
                ${p.notas ? `<div class="text-slate-500">${p.notas}</div>` : ''}
            </div>
            <div class="text-[10px] uppercase text-slate-400">${p.usuario || ''}</div>
        `;
        cont.appendChild(div);
    });
}

function renderItems(items = []) {
    const cont = document.getElementById('detalle-items');
    const toggle = document.getElementById('detalle-items-toggle');
    if (!cont || !toggle) return;
    cont.innerHTML = '';

    if (!items.length) {
        cont.innerHTML = '<div class="text-xs text-slate-400">Sin detalle de productos</div>';
        toggle.disabled = true;
        toggle.classList.add('opacity-50', 'cursor-default');
    } else {
        toggle.disabled = false;
        toggle.classList.remove('opacity-50', 'cursor-default');
        items.forEach(it => {
            const div = document.createElement('div');
            div.className = 'flex justify-between items-start gap-2';
            const desc = (window.escapeHtml ? window.escapeHtml(it.descripcion || it.codigo || '') : (it.descripcion || it.codigo || ''));
            div.innerHTML = `
                <div class="text-xs text-slate-600">
                    <div class="font-semibold">${it.cantidad || 0} x ${desc}</div>
                    ${it.codigo ? `<div class="text-[11px] text-slate-400">${it.codigo}</div>` : ''}
                </div>
                <div class="text-xs text-slate-600 text-right">
                    <div class="font-mono">$${formatNumber(it.precio_usd || 0, 2)}</div>
                </div>
            `;
            cont.appendChild(div);
        });
    }

    // Al cargar una cuenta, mostrar el acordeón abierto
    cont.classList.remove('hidden');
}

function renderDetalle(data) {
    const cuenta = data?.cuenta;
    const pagos = data?.pagos || [];
    const items = data?.items || [];
    cuentaSeleccionada = cuenta;
    document.getElementById('detalle-cliente').textContent = cuenta ? (cuenta.cliente_nombre || 'Cliente') : 'Seleccione una cuenta';
    document.getElementById('detalle-estado').innerHTML = cuenta ? badgeEstado(cuenta.estado_calc || cuenta.estado) : '';
    document.getElementById('detalle-total').textContent = cuenta ? `$${formatNumber(cuenta.total_usd || 0, 2)}` : '—';
    document.getElementById('detalle-saldo').textContent = cuenta ? `$${formatNumber(cuenta.saldo_usd || 0, 2)}` : '—';
    document.getElementById('detalle-emision').textContent = cuenta ? (cuenta.fecha_emision || '') : '—';
    document.getElementById('detalle-venc').textContent = cuenta ? (cuenta.fecha_vencimiento || '') : '—';
    document.getElementById('detalle-notas').textContent = cuenta?.notas || '—';
    renderItems(items);
    renderPagos(pagos);
}

async function cargarResumen() {
    try {
        const params = new URLSearchParams();
        if (periodoDesde) params.append('desde_venc', periodoDesde);
        if (periodoHasta) params.append('hasta_venc', periodoHasta);
        const url = params.toString() ? `/cobranzas/resumen?${params.toString()}` : '/cobranzas/resumen';
        const j = await apiFetchJson(url);
        renderResumen(j);
    } catch (err) {
        console.error(err);
    }
}

async function cargarCuentas() {
    try {
        const q = document.getElementById('f_buscar').value || '';
        const est = document.getElementById('f_estado').value || '';
        const mora = document.getElementById('f_mora') ? document.getElementById('f_mora').value || '' : '';
        const params = new URLSearchParams();
        if (q) params.append('cliente', q);
        if (est) params.append('estado', est);
        if (mora) params.append('mora_min', mora);
        if (periodoDesde) params.append('desde_venc', periodoDesde);
        if (periodoHasta) params.append('hasta_venc', periodoHasta);
        const j = await apiFetchJson(`/cobranzas/list?${params.toString()}`);
        // Normalizar la respuesta en caso de que el backend devuelva un objeto envolviendo las filas
        if (Array.isArray(j)) {
            cuentas = j;
        } else if (j && Array.isArray(j.rows)) {
            cuentas = j.rows;
        } else {
            console.warn('Respuesta inesperada de /cobranzas:', j);
            cuentas = [];
        }
        renderTabla(cuentas);
        if (cuentaSeleccionada) {
            const found = cuentas.find(c => c.id === cuentaSeleccionada.id);
            if (!found) renderDetalle(null);
        }
    } catch (err) {
        console.error(err);
        showToast('Error cargando cuentas', 'error');
    }
}

async function cargarResumenGlobal() {
    try {
        resumenGlobal = await apiFetchJson('/cobranzas/resumen');
    } catch (err) {
        console.error('Error cargando resumen histórico de cobranzas', err);
        resumenGlobal = null;
    }
}

async function cargarDetalle(id) {
    try {
        const j = await apiFetchJson(`/cobranzas/${id}`);
        renderDetalle(j);
    } catch (err) {
        console.error(err);
        showToast('Error cargando detalle', 'error');
    }
}

function formatDateInput(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function setPeriodoMes(anchorDate) {
    if (!(anchorDate instanceof Date) || Number.isNaN(anchorDate.getTime())) {
        anchorDate = new Date();
    }
    const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
    periodoAnchor = start;
    periodoDesde = formatDateInput(start);
    periodoHasta = formatDateInput(end);

    const label = document.getElementById('cob-periodo-label');
    if (label) {
        const opts = { month: 'long', year: 'numeric' };
        const texto = start.toLocaleDateString('es-VE', opts);
        // Capitalizar primera letra por estética
        label.textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
    }
}

function moverPeriodoCobranza(direccion) {
    if (!periodoAnchor) {
        setPeriodoMes(new Date());
    }
    const next = new Date(periodoAnchor.getFullYear(), periodoAnchor.getMonth() + direccion, 1);
    setPeriodoMes(next);
    cargarCuentas();
    cargarResumen();
}

async function prefijarTasa() {
    try {
        try {
            const j = await apiFetchJson('/admin/ajustes/tasa-bcv');
            const input = document.getElementById('p_tasa');
            tasaBCV = Number(j.tasa_bcv || 1) || 1;
            if (input) input.value = tasaBCV;
        } catch (err) {
            // ignore
        }
    } catch (err) {
        console.warn('No se pudo cargar tasa BCV', err);
    }
}

async function registrarPago(evt) {
    evt.preventDefault();
    if (!cuentaSeleccionada) { showToast('Seleccione una cuenta', 'error'); return; }
    const monto = parseFloat(document.getElementById('p_monto').value || '0');
    const moneda = document.getElementById('p_moneda').value || 'USD';
    const tasa = parseFloat(document.getElementById('p_tasa').value || tasaBCV || '1') || 1;
    const metodo = document.getElementById('p_metodo').value || '';
    const referencia = document.getElementById('p_ref').value || '';
    const notas = document.getElementById('p_notas').value || '';
    if (!monto || monto <= 0) { showToast('Monto inválido', 'error'); return; }
    try {
        const j = await apiFetchJson(`/cobranzas/${cuentaSeleccionada.id}/pago`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monto, moneda, tasa_bcv: tasa, metodo, referencia, notas })
        });
        showToast('Pago registrado', 'success');
        document.getElementById('form-pago').reset();
        renderDetalle(j);
        await cargarCuentas();
        await cargarResumen();
        await cargarResumenGlobal();
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

function setupEventos() {
    document.getElementById('f_buscar').addEventListener('input', () => cargarCuentas());
    document.getElementById('f_estado').addEventListener('change', () => cargarCuentas());
    const fMora = document.getElementById('f_mora');
    if (fMora) fMora.addEventListener('change', () => cargarCuentas());
    document.getElementById('f_refrescar').addEventListener('click', () => cargarCuentas());
    document.getElementById('form-pago').addEventListener('submit', registrarPago);

    const toggle = document.getElementById('detalle-items-toggle');
    const cont = document.getElementById('detalle-items');
    if (toggle && cont) {
        toggle.addEventListener('click', () => {
            cont.classList.toggle('hidden');
            const icon = toggle.querySelector('i');
            if (icon) icon.classList.toggle('rotate-180');
        });
    }

    const btnPrev = document.getElementById('cob-periodo-prev');
    const btnNext = document.getElementById('cob-periodo-next');
    if (btnPrev) btnPrev.addEventListener('click', () => moverPeriodoCobranza(-1));
    if (btnNext) btnNext.addEventListener('click', () => moverPeriodoCobranza(1));
}

(async function init() {
    setupEventos();
    await cargarResumenGlobal();
    setPeriodoMes(new Date());
    await prefijarTasa();
    await cargarResumen();
    await cargarCuentas();
    try {
        initCustomSelect('f_estado');
        initCustomSelect('f_mora');
        initCustomSelect('p_moneda');
    } catch {}
})();

// Tour guiado de la pantalla de cobranzas
if (window.GuidedTour) {
    const cobranzasTourId = 'cobranzas_v1';

    const cobranzasSteps = [
     //   {
     //       selector: '#cobranzas-header',
     //       title: 'Cobranzas y cuentas por cobrar',
     //       text: 'En esta pantalla ves todas las cuentas por cobrar de tus clientes y registras los pagos que van entrando.',
      //      placement: 'bottom',
      //  },
        {
            selector: '#cobranzas-filtros-bar',
            title: 'Búsqueda y filtros rápidos',
            text: 'Busca por cliente o documento y filtra por estado de la cuenta o días de mora para enfocarte en lo importante.',
            placement: 'bottom',
        },
        {
            selector: '#cob-periodo-controls',
            title: 'Períodos por mes',
            text: 'Con estos botones cambias el mes que estás viendo. El sistema muestra las cuentas que vencen en ese período.',
            placement: 'bottom',
        },
        {
            selector: '#cobranzas-tabla-wrapper',
            title: 'Listado de cuentas por cobrar',
            text: 'Aquí ves cada cliente con su documento, fecha de vencimiento, total y saldo pendiente. Haz clic en una fila para ver el detalle.',
            placement: 'top',
        },
        {
            selector: '#panel-resumen',
            title: 'Resumen del período e histórico',
            text: 'Este cuadro resume cuántas cuentas tienes en cada estado en el mes actual y cuánto tienes pendiente en total en todo el historial.',
            placement: 'left',
        },
        {
            selector: '#panel-detalle',
            title: 'Detalle de la cuenta seleccionada',
            text: 'Al seleccionar una cuenta verás aquí el cliente, montos, fechas y notas. Desde este panel se controla todo lo relacionado a esa deuda.',
            placement: 'left',
            onEnter: () => {
                if (!cuentaSeleccionada && Array.isArray(cuentas) && cuentas.length) {
                    cargarDetalle(cuentas[0].id);
                }
            },
        },
        {
            selector: '#detalle-items',
            title: 'Productos vendidos',
            text: 'En esta lista ves qué productos generaron la cuenta. Puedes desplegar u ocultar el detalle con el botón de "Productos vendidos".',
            placement: 'top',
            onEnter: () => {
                const cont = document.getElementById('detalle-items');
                const toggle = document.getElementById('detalle-items-toggle');
                if (cont) cont.classList.remove('hidden');
                if (toggle) {
                    const icon = toggle.querySelector('i');
                    if (icon) icon.classList.remove('rotate-180');
                }
            },
        },
        {
            selector: '#detalle-pagos',
            title: 'Historial de pagos',
            text: 'Aquí se muestran todos los abonos registrados para esta cuenta: fecha, monto, método, referencia y quién registró el pago.',
            placement: 'top',
        },
        {
            selector: '#cobranzas-form-pago-card',
            title: 'Registrar un nuevo pago',
            text: 'En esta sección registras los abonos: monto, moneda, tasa BCV, método, referencia y notas. Al guardar, la cuenta y el saldo se actualizan automáticamente.',
            placement: 'top',
        },
        {
            selector: '#pago-info',
            title: 'Mensajes e info adicional',
            text: 'Aquí verás avisos importantes que el sistema te muestra sobre esta cuenta o sobre el pago más reciente.',
            placement: 'top',
        },
    ];

    function startCobranzasTour(force = false) {
        if (!window.GuidedTour) return;
        window.GuidedTour.start({
            id: cobranzasTourId,
            steps: cobranzasSteps,
            autoStart: !force,
        });
    }

    const btnCobranzasTour = document.getElementById('btnCobranzasTour');
    if (btnCobranzasTour) {
        btnCobranzasTour.addEventListener('click', () => {
            if (window.GuidedTour.hasSeen && window.GuidedTour.hasSeen(cobranzasTourId)) {
                window.GuidedTour.reset(cobranzasTourId);
            }
            startCobranzasTour(true);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        startCobranzasTour(false);
    });
}
