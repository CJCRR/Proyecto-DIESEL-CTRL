import { apiFetchJson } from './app-api.js';
import { formatNumber } from './format-utils.js';
import { initCustomSelect } from './modules/ui.js';

let cuentas = [];
let cuentaSeleccionada = null;
let tasaBCV = 1;
let registrandoPago = false;
let resumenGlobal = null;
let periodoAnchor = null;
let periodoDesde = null;
let periodoHasta = null;

(async () => {
    if (!window.showToast || !window.escapeHtml) {
        try {
            const m = await import('./app-utils.js');
            window.showToast = window.showToast || m.showToast;
            window.escapeHtml = window.escapeHtml || m.escapeHtml;
        } catch (_) {}
    }
})();

function toast(message, type = 'info') {
    if (window.showToast) {
        window.showToast(message, type);
        return;
    }
    alert(message);
}

function generarPagoIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return `pcom-${window.crypto.randomUUID()}`;
    }
    return `pcom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function badgeEstado(estado) {
    const base = 'px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest';
    if (estado === 'parcial') return `<span class="${base} bg-amber-100 text-amber-700">Parcial</span>`;
    if (estado === 'cancelado') return `<span class="${base} bg-emerald-100 text-emerald-700">Pagado</span>`;
    return `<span class="${base} bg-slate-100 text-slate-600">Pendiente</span>`;
}

function getAuthUsername() {
    try {
        const raw = localStorage.getItem('auth_user');
        if (!raw) return '';
        const user = JSON.parse(raw);
        return user?.nombre_completo || user?.username || '';
    } catch {
        return '';
    }
}

function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseMonthParam(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(raw)) return null;
    const [yearText, monthText] = raw.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    return new Date(year, month - 1, 1);
}

function setPeriodoMes(anchorDate) {
    const base = anchorDate instanceof Date && !Number.isNaN(anchorDate.getTime()) ? anchorDate : new Date();
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    periodoAnchor = start;
    periodoDesde = formatDateInput(start);
    periodoHasta = formatDateInput(end);

    const label = document.getElementById('pag-periodo-label');
    if (label) {
        const text = start.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' });
        label.textContent = text.charAt(0).toUpperCase() + text.slice(1);
    }
}

async function moverPeriodoPagos(direction) {
    if (!periodoAnchor) {
        setPeriodoMes(new Date());
    }
    const next = new Date(periodoAnchor.getFullYear(), periodoAnchor.getMonth() + direction, 1);
    setPeriodoMes(next);
    await cargarResumen();
    await cargarCuentas();
}

function renderResumen(rows = []) {
    const cont = document.getElementById('resumen-cards');
    if (!cont) return;
    cont.innerHTML = '';

    let totalCantPeriodo = 0;
    let totalSaldoPeriodo = 0;
    ['pendiente', 'parcial', 'cancelado'].forEach((estado) => {
        const found = rows.find((row) => row.estado === estado) || { cantidad: 0, saldo_usd: 0 };
        totalCantPeriodo += Number(found.cantidad || 0);
        totalSaldoPeriodo += Number(found.saldo_usd || 0);
        const card = document.createElement('div');
        card.className = 'p-3 border rounded-xl bg-slate-50';
        card.innerHTML = `
            <div class="text-[10px] font-black text-slate-400 uppercase">${estado}</div>
            <div class="text-2xl font-black text-slate-800">${Number(found.cantidad || 0)}</div>
            <div class="text-xs text-slate-500">Saldo $${formatNumber(found.saldo_usd || 0, 2)}</div>
        `;
        cont.appendChild(card);
    });

    const totalesEl = document.getElementById('resumen-totales');
    if (totalesEl) {
        let totalHist = 0;
        if (Array.isArray(resumenGlobal)) {
            resumenGlobal.forEach((row) => {
                totalHist += Number(row.saldo_usd || 0);
            });
        }
        totalesEl.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="font-semibold text-slate-700">Rango actual</span>
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
    const tbody = document.getElementById('tabla-pagos');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!list.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5" class="p-6 text-center text-slate-400">Sin cuentas de comisión generadas para este filtro</td>';
        tbody.appendChild(tr);
        return;
    }

    list.forEach((cuenta) => {
        const selected = cuentaSeleccionada && cuentaSeleccionada.id === cuenta.id;
        const tr = document.createElement('tr');
        tr.className = `cobranzas-row hover:bg-slate-50 cursor-pointer transition-colors ${selected ? 'cobranzas-row--active' : ''}`;
        tr.onclick = () => {
            tbody.querySelectorAll('.cobranzas-row--active').forEach((row) => row.classList.remove('cobranzas-row--active'));
            tr.classList.add('cobranzas-row--active');
            cargarDetalle(cuenta.id);
        };
        tr.innerHTML = `
            <td class="p-3 font-semibold text-slate-800">${escapeHtml(cuenta.vendedor_nombre || cuenta.username || 'Vendedor')}</td>
            <td class="p-3 text-slate-500">${escapeHtml(`${cuenta.periodo_desde || ''} al ${cuenta.periodo_hasta || ''}`)}</td>
            <td class="p-3 text-right font-mono text-slate-600">$${formatNumber(cuenta.total_comision_usd || 0, 2)}</td>
            <td class="p-3 text-right font-mono font-bold text-cyan-700">$${formatNumber(cuenta.saldo_usd || 0, 2)}</td>
            <td class="p-3 text-center">${badgeEstado(cuenta.estado_calc || cuenta.estado)}</td>
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
    pagos.forEach((pago) => {
        const div = document.createElement('div');
        div.className = 'p-2 border rounded-xl bg-slate-50 flex justify-between items-center';
        div.innerHTML = `
            <div class="text-xs text-slate-600">
                <div class="font-bold text-slate-800">$${formatNumber(pago.monto_usd || 0, 2)}${pago.moneda === 'BS' ? ` (Bs ${formatNumber(pago.monto_moneda || 0, 2)})` : ''}</div>
                <div>${new Date(pago.fecha).toLocaleString()}</div>
                ${pago.metodo ? `<div>${escapeHtml(pago.metodo)}${pago.referencia ? ` - ${escapeHtml(pago.referencia)}` : ''}</div>` : ''}
                ${pago.notas ? `<div class="text-slate-500">${escapeHtml(pago.notas)}</div>` : ''}
            </div>
            <div class="text-[10px] uppercase text-slate-400">${escapeHtml(pago.usuario || '')}</div>
        `;
        cont.appendChild(div);
    });
}

function renderDetalle(data) {
    const cuenta = data?.cuenta || null;
    cuentaSeleccionada = cuenta;
    document.getElementById('detalle-vendedor').textContent = cuenta ? (cuenta.vendedor_nombre || cuenta.username || 'Vendedor') : 'Seleccione una cuenta';
    document.getElementById('detalle-estado').innerHTML = cuenta ? badgeEstado(cuenta.estado_calc || cuenta.estado) : '';
    document.getElementById('detalle-total').textContent = cuenta ? `$${formatNumber(cuenta.total_comision_usd || 0, 2)}` : '—';
    document.getElementById('detalle-saldo').textContent = cuenta ? `$${formatNumber(cuenta.saldo_usd || 0, 2)}` : '—';
    document.getElementById('detalle-ventas').textContent = cuenta ? `$${formatNumber(cuenta.total_ventas_usd || 0, 2)}` : '—';
    document.getElementById('detalle-pct').textContent = cuenta ? `${formatNumber(cuenta.comision_pct || 0, 2)}%` : '—';
    document.getElementById('detalle-periodo').textContent = cuenta ? `${cuenta.periodo_desde || ''} al ${cuenta.periodo_hasta || ''}` : '—';
    document.getElementById('detalle-filtros').textContent = cuenta
        ? `Filtros fuente: cliente ${cuenta.filtro_cliente || 'todos'} · método ${cuenta.filtro_metodo || 'todos'}`
        : '—';
    renderPagos(data?.pagos || []);
}

function buildFilterParams() {
    const params = new URLSearchParams();
    const vendedor = document.getElementById('f_vendedor').value.trim();
    const estado = document.getElementById('f_estado').value || '';
    if (periodoDesde) params.set('desde', periodoDesde);
    if (periodoHasta) params.set('hasta', periodoHasta);
    if (vendedor) params.set('vendedor', vendedor);
    if (estado) params.set('estado', estado);
    return params;
}

function renderFiltrosActivos() {
    const el = document.getElementById('pagos-filtros-activos');
    if (!el) return;
    const parts = [];
    const vendedor = document.getElementById('f_vendedor').value.trim();
    if (periodoDesde || periodoHasta) parts.push(`Mes: ${periodoDesde || '—'} a ${periodoHasta || '—'}`);
    if (vendedor) parts.push(`Vendedor: ${vendedor}`);
    el.textContent = parts.length ? parts.join(' · ') : 'Sin filtros adicionales. Usa el mes actual para generar y consultar cuentas de comisión.';
}

async function cargarResumen() {
    const params = new URLSearchParams();
    if (periodoDesde) params.set('desde', periodoDesde);
    if (periodoHasta) params.set('hasta', periodoHasta);
    const url = params.toString() ? `/pagos/resumen?${params.toString()}` : '/pagos/resumen';
    const rows = await apiFetchJson(url);
    renderResumen(rows);
}

async function cargarResumenGlobal() {
    resumenGlobal = await apiFetchJson('/pagos/resumen');
}

async function cargarCuentas() {
    renderFiltrosActivos();
    const params = buildFilterParams();
    const rows = await apiFetchJson(`/pagos/list?${params.toString()}`);
    cuentas = Array.isArray(rows) ? rows : [];
    renderTabla(cuentas);
    if (cuentaSeleccionada) {
        const found = cuentas.find((row) => row.id === cuentaSeleccionada.id);
        if (!found) {
            renderDetalle(null);
        }
    }
}

async function cargarDetalle(id) {
    const data = await apiFetchJson(`/pagos/${id}`);
    renderDetalle(data);
}

async function prefijarTasa() {
    try {
        const data = await apiFetchJson('/admin/ajustes/tasa-bcv');
        tasaBCV = Number(data.tasa_bcv || 1) || 1;
        const input = document.getElementById('p_tasa');
        if (input) input.value = tasaBCV;
    } catch (_) {}
}

async function generarCuentas() {
    if (!periodoDesde || !periodoHasta) {
        toast('No se pudo determinar el mes actual.', 'error');
        return;
    }
    const btn = document.getElementById('btn_generar');
    if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent || 'Generar cuentas';
        btn.textContent = 'Generando...';
    }
    try {
        const payload = Object.fromEntries(buildFilterParams().entries());
        delete payload.estado;
        const data = await apiFetchJson('/pagos/generar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        toast(`Generadas ${data.created || 0} cuentas y actualizadas ${data.updated || 0}.`, 'success');
        await cargarResumenGlobal();
        await cargarResumen();
        await cargarCuentas();
        if (Array.isArray(data.rows) && data.rows.length) {
            await cargarDetalle(data.rows[0].id);
        }
    } catch (err) {
        console.error(err);
        toast(err.message || 'No se pudieron generar las cuentas.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || 'Generar cuentas';
        }
    }
}

async function registrarPago(event) {
    event.preventDefault();
    if (registrandoPago) return;
    if (!cuentaSeleccionada) {
        toast('Selecciona una cuenta de comisión.', 'error');
        return;
    }
    const monto = parseFloat(document.getElementById('p_monto').value || '0');
    const moneda = document.getElementById('p_moneda').value || 'USD';
    const tasa = parseFloat(document.getElementById('p_tasa').value || tasaBCV || '1') || 1;
    const metodo = document.getElementById('p_metodo').value || '';
    const referencia = document.getElementById('p_ref').value || '';
    const notas = document.getElementById('p_notas').value || '';
    if (!monto || monto <= 0) {
        toast('Monto inválido.', 'error');
        return;
    }

    const form = document.getElementById('form-pago');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    const idempotencyKey = form ? (form.dataset.idempotencyKey || generarPagoIdempotencyKey()) : generarPagoIdempotencyKey();
    if (form) form.dataset.idempotencyKey = idempotencyKey;
    registrandoPago = true;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent || 'Guardar pago';
        submitBtn.textContent = 'Guardando...';
    }
    try {
        const data = await apiFetchJson(`/pagos/${cuentaSeleccionada.id}/pago`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                monto,
                moneda,
                tasa_bcv: tasa,
                metodo,
                referencia,
                notas,
                usuario: getAuthUsername(),
                idempotency_key: idempotencyKey,
            }),
        });
        toast('Pago registrado.', 'success');
        form.reset();
        delete form.dataset.idempotencyKey;
        const inputTasa = document.getElementById('p_tasa');
        if (inputTasa) inputTasa.value = tasaBCV;
        renderDetalle(data);
        await cargarResumenGlobal();
        await cargarResumen();
        await cargarCuentas();
    } catch (err) {
        console.error(err);
        toast(err.message || 'No se pudo registrar el pago.', 'error');
    } finally {
        registrandoPago = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtn.dataset.originalText || 'Guardar pago';
        }
    }
}

function applyQueryParams() {
    const params = new URLSearchParams(window.location.search || '');
    const monthFromQuery = parseMonthParam(params.get('mes'));
    if (monthFromQuery) {
        setPeriodoMes(monthFromQuery);
    } else {
        const fromQuery = params.get('desde') || params.get('hasta');
        const fallbackDate = fromQuery ? new Date(fromQuery) : new Date();
        setPeriodoMes(fallbackDate);
    }

    const mappings = [
        ['vendedor', 'f_vendedor'],
    ];
    mappings.forEach(([param, fieldId]) => {
        const value = params.get(param);
        if (value) {
            const field = document.getElementById(fieldId);
            if (field) field.value = value;
        }
    });
}

function setupEventos() {
    document.getElementById('f_refrescar').addEventListener('click', async () => {
        await cargarResumen();
        await cargarCuentas();
    });
    document.getElementById('f_estado').addEventListener('change', cargarCuentas);
    document.getElementById('f_vendedor').addEventListener('input', cargarCuentas);
    const btnPrev = document.getElementById('pag-periodo-prev');
    const btnNext = document.getElementById('pag-periodo-next');
    if (btnPrev) btnPrev.addEventListener('click', () => moverPeriodoPagos(-1));
    if (btnNext) btnNext.addEventListener('click', () => moverPeriodoPagos(1));
    document.getElementById('form-pago').addEventListener('submit', registrarPago);
}

(async function init() {
    applyQueryParams();
    setupEventos();
    await prefijarTasa();
    await cargarResumenGlobal();
    await cargarResumen();
    await cargarCuentas();
    try {
        initCustomSelect('f_estado');
        initCustomSelect('p_moneda');
    } catch (_) {}
})();