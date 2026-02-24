let cuentas = [];
let cuentaSeleccionada = null;
let tasaBCV = 1;
import { apiFetchJson } from './app-api.js';

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
    const estados = ['pendiente', 'parcial', 'vencido', 'cancelado'];
    estados.forEach(e => {
        const found = rows.find(r => r.estado === e) || { cantidad: 0, saldo_usd: 0 };
        const card = document.createElement('div');
        card.className = 'p-3 border rounded-xl bg-slate-50';
        card.innerHTML = `
            <div class="text-[10px] font-black text-slate-400 uppercase">${e}</div>
            <div class="text-2xl font-black text-slate-800">${Number(found.cantidad || 0)}</div>
            <div class="text-xs text-slate-500">Saldo $${Number(found.saldo_usd || 0).toFixed(2)}</div>
        `;
        cont.appendChild(card);
    });
}

function renderTabla(list = []) {
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
            <td class="p-3 text-slate-500">${c.cliente_doc || ''}</td>
                        <td class="p-3 text-center text-sm">
                            ${c.fecha_vencimiento || ''}
                            ${estado === 'vencido' && diasMora > 0 ? `<div class="text-[10px] text-rose-600">${diasMora} días de mora</div>` : ''}
                        </td>
            <td class="p-3 text-right font-mono text-slate-500">$${Number(c.total_usd || 0).toFixed(2)}</td>
            <td class="p-3 text-right font-mono font-bold text-blue-600">$${Number(c.saldo_usd || 0).toFixed(2)}</td>
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
                <div class="font-bold text-slate-800">$${Number(p.monto_usd || 0).toFixed(2)}${p.moneda === 'BS' ? ` (Bs ${Number(p.monto_moneda || 0).toFixed(2)})` : ''}</div>
                <div>${new Date(p.fecha).toLocaleString()}</div>
                ${p.metodo ? `<div>${p.metodo}${p.referencia ? ' - ' + p.referencia : ''}</div>` : ''}
                ${p.notas ? `<div class="text-slate-500">${p.notas}</div>` : ''}
            </div>
            <div class="text-[10px] uppercase text-slate-400">${p.usuario || ''}</div>
        `;
        cont.appendChild(div);
    });
}

function renderDetalle(data) {
    const cuenta = data?.cuenta;
    const pagos = data?.pagos || [];
    cuentaSeleccionada = cuenta;
    document.getElementById('detalle-cliente').textContent = cuenta ? (cuenta.cliente_nombre || 'Cliente') : 'Seleccione una cuenta';
    document.getElementById('detalle-estado').innerHTML = cuenta ? badgeEstado(cuenta.estado_calc || cuenta.estado) : '';
    document.getElementById('detalle-total').textContent = cuenta ? `$${Number(cuenta.total_usd || 0).toFixed(2)}` : '—';
    document.getElementById('detalle-saldo').textContent = cuenta ? `$${Number(cuenta.saldo_usd || 0).toFixed(2)}` : '—';
    document.getElementById('detalle-emision').textContent = cuenta ? (cuenta.fecha_emision || '') : '—';
    document.getElementById('detalle-venc').textContent = cuenta ? (cuenta.fecha_vencimiento || '') : '—';
    document.getElementById('detalle-notas').textContent = cuenta?.notas || '—';
    renderPagos(pagos);
}

async function cargarResumen() {
    try {
        const j = await apiFetchJson('/cobranzas/resumen');
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
        const j = await apiFetchJson(`/cobranzas?${params.toString()}`);
        cuentas = j;
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

async function cargarDetalle(id) {
    try {
        const j = await apiFetchJson(`/cobranzas/${id}`);
        renderDetalle(j);
    } catch (err) {
        console.error(err);
        showToast('Error cargando detalle', 'error');
    }
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
}

(async function init() {
    setupEventos();
    await prefijarTasa();
    await cargarResumen();
    await cargarCuentas();
})();
