// Reporte de ventas independiente

// Intentar cargar utilidades centralizadas en páginas que no cargan módulos
(async () => {
    if (!window.escapeHtml || !window.showToast) {
        try {
            const m = await import('./app-utils.js');
            window.escapeHtml = window.escapeHtml || m.escapeHtml;
            window.showToast = window.showToast || m.showToast;
        } catch (e) { /* ignore */ }
    }
})();
console.log('reportes.js v2.0 cargado - con autenticación');
import { apiFetchJson } from './app-api.js';
let MONEDA = 'USD';
let cacheRows = [];
const detallesCache = new Map();
let abiertoId = null;
let cacheDev = [];
let cachePres = [];
let clienteTimer = null;
let cacheRentCat = [];
let cacheRentProv = [];
let resumenRent = null;
const escapeHtml = (window.escapeHtml) ? window.escapeHtml : (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function setPreset(rango) {
    const hoy = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    if (rango === 'hoy') {
        document.getElementById('rpt-desde').value = fmt(hoy);
        document.getElementById('rpt-hasta').value = fmt(hoy);
    } else if (rango === 'semana') {
        const inicio = new Date(hoy);
        inicio.setDate(hoy.getDate() - 6);
        document.getElementById('rpt-desde').value = fmt(inicio);
        document.getElementById('rpt-hasta').value = fmt(hoy);
    } else if (rango === 'mes') {
        const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        document.getElementById('rpt-desde').value = fmt(inicio);
        document.getElementById('rpt-hasta').value = fmt(hoy);
    }
}

function renderReporte() {
    const tbody = document.getElementById('rpt-tabla');
    tbody.innerHTML = '';
    let total = 0;
    let margen = 0;
    cacheRows.forEach((r) => {
        const t = MONEDA === 'USD'
            ? (r.total_usd_iva != null ? r.total_usd_iva : (r.total_usd || 0))
            : (r.total_bs_iva != null ? r.total_bs_iva : (r.total_bs || 0));
        const m = MONEDA === 'USD' ? r.margen_usd || 0 : r.margen_bs || 0;
        total += Number(t);
        margen += Number(m);
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 cursor-pointer';
        tr.dataset.id = String(r.id);
                tr.innerHTML = `
            <td class="p-2 whitespace-nowrap"><i id="venta-toggle-icon-${r.id}" class="fas fa-chevron-down mr-2 text-slate-500"></i>${new Date(r.fecha).toLocaleString()}</td>
      <td class="p-2">${r.cliente || ''}</td>
      <td class="p-2">${r.vendedor || ''}</td>
      <td class="p-2">${r.metodo_pago || ''}</td>
      <td class="p-2 text-slate-600 text-xs">${r.referencia || '—'}</td>
      <td class="p-2 text-right font-semibold">${Number(t).toFixed(2)}</td>
      <td class="p-2 text-right text-blue-700 font-semibold">${Number(m).toFixed(2)}</td>
    `;
        tbody.appendChild(tr);

        const detRow = document.createElement('tr');
        detRow.className = 'hidden';
        detRow.id = `venta-det-${r.id}`;
        detRow.innerHTML = `<td colspan="7" class="p-2 bg-slate-50">
            <div class="flex items-center justify-between">
              <div class="text-[10px] uppercase text-slate-400 font-black">Detalles de la venta</div>
              <a href="/nota/${r.id}" target="_blank" class="text-xs px-2 py-1 bg-slate-200 rounded">Ver nota</a>
            </div>
            <div class="text-xs text-slate-700 space-y-1" id="venta-det-list-${r.id}">Cargando...</div>
        </td>`;
        tbody.appendChild(detRow);

        tr.addEventListener('click', async () => {
            // cerrar el que esté abierto
            if (abiertoId && abiertoId !== r.id) {
                const prevRow = document.getElementById(`venta-det-${abiertoId}`);
                if (prevRow) prevRow.classList.add('hidden');
                const prevIcon = document.getElementById(`venta-toggle-icon-${abiertoId}`);
                if (prevIcon) { prevIcon.classList.remove('fa-chevron-up'); prevIcon.classList.add('fa-chevron-down'); }
                abiertoId = null;
            }
            const row = document.getElementById(`venta-det-${r.id}`);
            if (!row) return;
            const isHidden = row.classList.contains('hidden');
            // toggle
            row.classList.toggle('hidden');
            const iconEl = document.getElementById(`venta-toggle-icon-${r.id}`);
            if (iconEl) {
                if (isHidden) { iconEl.classList.remove('fa-chevron-down'); iconEl.classList.add('fa-chevron-up'); }
                else { iconEl.classList.remove('fa-chevron-up'); iconEl.classList.add('fa-chevron-down'); }
            }
            if (isHidden) {
                // load if not cached
                const cont = document.getElementById(`venta-det-list-${r.id}`);
                if (!detallesCache.has(r.id)) {
                    cont.textContent = 'Cargando...';
                    try {
                        const j = await apiFetchJson(`/reportes/ventas/${r.id}`);
                        detallesCache.set(r.id, j);
                    } catch (err) {
                        console.error('Error detalle venta', err);
                        cont.textContent = 'Error cargando detalle';
                        return;
                    }
                }
                const { venta, detalles } = detallesCache.get(r.id) || { venta: {}, detalles: [] };
                if (!detalles || !detalles.length) {
                    cont.innerHTML = '<div class="text-slate-400">Sin detalles</div>';
                    return;
                }
                const tasa = Number(venta?.tasa_bcv || r.tasa_bcv || 0) || 0;
                const fmt = (v) => Number(v || 0).toFixed(2);
                cont.innerHTML = detalles.map(d => {
                    const codigo = d.codigo || d.producto_codigo || d.codigo_producto || d.producto || d.producto_id || '';
                    const montoUsd = Number(d.precio_usd || 0) * Number(d.cantidad || 0);
                    const montoBs = d.subtotal_bs != null ? Number(d.subtotal_bs || 0) : (montoUsd * (tasa || 1));
                    const monto = MONEDA === 'USD' ? fmt(montoUsd) + ' USD' : fmt(montoBs) + ' Bs';
                    const codePart = codigo ? `<span class=\"font-semibold\">${codigo}</span> — ` : '';
                    return `<div class="flex items-center justify-between border-b pb-1">
                        <div class="truncate">${codePart}<span class="text-slate-600">${d.descripcion || ''}</span></div>
                        <div class="text-right min-w-[160px]"><span class="text-xs text-slate-500">Cant ${d.cantidad}</span> • <span class="font-semibold">${monto}</span></div>
                    </div>`;
                }).join('');
                abiertoId = r.id;
            } else {
                abiertoId = null;
            }
        });
    });
    document.getElementById('rpt-resumen').innerText = `Ventas: ${cacheRows.length} | Total ${MONEDA}: ${total.toFixed(2)} | Margen ${MONEDA}: ${margen.toFixed(2)}`;
    document.getElementById('th-total-moneda').innerText = `Total ${MONEDA}`;
    document.getElementById('th-margen-moneda').innerText = `Margen ${MONEDA}`;
}

function renderClienteSugerencias(items) {
    const list = document.getElementById('rpt-clientes-list');
    if (!list) return;
    const uniques = new Map();
    (items || []).forEach((c) => {
        const nombre = c.cliente || '';
        if (!nombre || uniques.has(nombre)) return;
        const labelParts = [nombre];
        if (c.cedula) labelParts.push(`CI: ${c.cedula}`);
        if (c.telefono) labelParts.push(`Tel: ${c.telefono}`);
        uniques.set(nombre, labelParts.join(' · '));
    });
    list.innerHTML = Array.from(uniques.entries()).map(([val, label]) => `<option value="${val}">${label}</option>`).join('');
}

function renderPresupuestos() {
        const cont = document.getElementById('rpt-pres');
        if (!cont) return;
        if (!cachePres.length) {
                cont.innerHTML = '<div class="text-slate-400">Sin presupuestos</div>';
                return;
        }
        cont.innerHTML = cachePres.slice(0, 10).map(p => {
                return `
                <div class="p-2 border rounded flex items-center justify-between">
                    <div>
                        <div class="font-semibold">${escapeHtml(p.cliente || '')}</div>
                        <div class="text-[10px] text-slate-500">#${escapeHtml(p.id)} • ${escapeHtml(new Date(p.fecha).toLocaleString())}</div>
                    </div>
                    <div class="text-right">
                        <div class="font-black text-blue-600">$${Number(p.total_usd || 0).toFixed(2)}</div>
                        <button class="mt-1 px-2 py-1 text-[10px] bg-blue-600 text-white rounded" data-pres="${p.id}">Usar en POS</button>
                    </div>
                </div>`;
        }).join('');

        cont.querySelectorAll('[data-pres]').forEach(btn => {
                btn.addEventListener('click', () => {
                        const id = btn.dataset.pres;
                        window.location.href = `/pages/index.html?presupuesto=${encodeURIComponent(id)}`;
                });
        });
}

async function sugerirClientes(q) {
    const list = document.getElementById('rpt-clientes-list');
    if (!list) return;
    if (!q || q.length < 2) {
        list.innerHTML = '';
        return;
    }
    try {
        const data = await apiFetchJson(`/reportes/historial-cliente?q=${encodeURIComponent(q)}&limit=8`);
        renderClienteSugerencias(data || []);
    } catch (err) {
        console.error('Error sugiriendo clientes', err);
    }
}

function renderRentabilidad() {
    const catCont = document.getElementById('renta-cat');
    const provCont = document.getElementById('renta-prov');
    const resumenEl = document.getElementById('renta-resumen');
    if (!catCont || !provCont || !resumenEl) return;

    const fmt = (v) => Number(v || 0).toFixed(2);

    if (resumenRent) {
        const mPct = resumenRent.margen_pct != null ? (resumenRent.margen_pct * 100).toFixed(1) + '%' : '—';
        resumenEl.textContent = `Ingresos: $${fmt(resumenRent.ingresos_usd)} / Bs ${fmt(resumenRent.ingresos_bs)} · Costos: $${fmt(resumenRent.costos_usd)} / Bs ${fmt(resumenRent.costos_bs)} · Margen: $${fmt(resumenRent.margen_usd)} / Bs ${fmt(resumenRent.margen_bs)} (${mPct})`;
    } else {
        resumenEl.textContent = 'Sin datos de rentabilidad para el rango seleccionado.';
    }

    if (!cacheRentCat.length) {
        catCont.innerHTML = '<div class="p-2 text-[11px] text-slate-400">Sin ventas en el rango.</div>';
    } else {
        catCont.innerHTML = `<table class="w-full text-[11px]"><thead class="bg-slate-100 text-slate-500"><tr>
            <th class="p-1 text-left">Categoría</th>
            <th class="p-1 text-right">Unid.</th>
            <th class="p-1 text-right">Ingresos $</th>
            <th class="p-1 text-right">Costos $</th>
            <th class="p-1 text-right">Margen $</th>
            <th class="p-1 text-right">Margen %</th>
        </tr></thead><tbody class="divide-y">
        ${cacheRentCat.map(r => {
            const mPct = r.margen_pct != null ? (r.margen_pct * 100).toFixed(1) + '%' : '—';
            return `<tr>
                <td class="p-1">${escapeHtml(r.categoria || 'Sin categoría')}</td>
                <td class="p-1 text-right">${Number(r.total_qty || 0)}</td>
                <td class="p-1 text-right">${fmt(r.ingresos_usd)}</td>
                <td class="p-1 text-right">${fmt(r.costos_usd)}</td>
                <td class="p-1 text-right">${fmt(r.margen_usd)}</td>
                <td class="p-1 text-right">${mPct}</td>
            </tr>`;
        }).join('')}
        </tbody></table>`;
    }

    if (!cacheRentProv.length) {
        provCont.innerHTML = '<div class="p-2 text-[11px] text-slate-400">Sin ventas en el rango.</div>';
    } else {
        provCont.innerHTML = `<table class="w-full text-[11px]"><thead class="bg-slate-100 text-slate-500"><tr>
            <th class="p-1 text-left">Proveedor</th>
            <th class="p-1 text-right">Unid.</th>
            <th class="p-1 text-right">Ingresos $</th>
            <th class="p-1 text-right">Costos $</th>
            <th class="p-1 text-right">Margen $</th>
            <th class="p-1 text-right">Margen %</th>
        </tr></thead><tbody class="divide-y">
        ${cacheRentProv.map(r => {
            const mPct = r.margen_pct != null ? (r.margen_pct * 100).toFixed(1) + '%' : '—';
            return `<tr>
                <td class="p-1">${escapeHtml(r.proveedor || 'Sin proveedor')}</td>
                <td class="p-1 text-right">${Number(r.total_qty || 0)}</td>
                <td class="p-1 text-right">${fmt(r.ingresos_usd)}</td>
                <td class="p-1 text-right">${fmt(r.costos_usd)}</td>
                <td class="p-1 text-right">${fmt(r.margen_usd)}</td>
                <td class="p-1 text-right">${mPct}</td>
            </tr>`;
        }).join('')}
        </tbody></table>`;
    }
}

async function cargarRentabilidad() {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    try {
        cacheRentCat = await apiFetchJson(`/reportes/rentabilidad/categorias?${params.toString()}`);
        cacheRentProv = await apiFetchJson(`/reportes/rentabilidad/proveedores?${params.toString()}`);
        resumenRent = await apiFetchJson(`/reportes/resumen-financiero?${params.toString()}`);
        renderRentabilidad();
    } catch (err) {
        console.error('Error cargando rentabilidad:', err);
		if (window.showToast) {
			window.showToast('Error cargando los reportes de rentabilidad.', 'error');
		} else {
			alert('Error cargando los reportes de rentabilidad.');
		}
    }
}

async function cargarReporte() {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const cliente = document.getElementById('rpt-cliente') ? document.getElementById('rpt-cliente').value.trim() : '';
    const vendedor = document.getElementById('rpt-vendedor').value.trim();
    const metodo = document.getElementById('rpt-metodo').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    if (cliente) params.set('cliente', cliente);
    if (vendedor) params.set('vendedor', vendedor);
    if (metodo) params.set('metodo', metodo);

    try {
        cacheRows = await apiFetchJson(`/reportes/ventas-rango?${params.toString()}`);
    } catch (err) {
        console.error('Error cargando reporte:', err);
		if (window.showToast) {
			window.showToast('Error cargando el reporte. Por favor refresca la página.', 'error');
		} else {
			alert('Error cargando el reporte. Por favor refresca la página.');
		}
        return;
    }
    console.log('Ventas cargadas:', cacheRows.length);
    renderReporte();

    // Cargar devoluciones
    try {
        cacheDev = await apiFetchJson(`/devoluciones/historial?${params.toString()}`);
        renderDevoluciones();
    } catch (err) {
        console.error('Error devoluciones', err);
    }

    try {
        cachePres = await apiFetchJson('/presupuestos?limit=50');
        renderPresupuestos();
    } catch (err) {
        console.error('Error presupuestos', err);
    }
}

// Eventos
const monedaSel = document.getElementById('moneda-toggle');
monedaSel.addEventListener('change', (e) => {
    MONEDA = e.target.value;
    renderReporte();
});

document.getElementById('rpt-filtrar').addEventListener('click', cargarReporte);

const clienteInput = document.getElementById('rpt-cliente');
if (clienteInput) {
    clienteInput.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        clearTimeout(clienteTimer);
        clienteTimer = setTimeout(() => sugerirClientes(q), 200);
    });
}

document.getElementById('rpt-export').addEventListener('click', () => {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const cliente = document.getElementById('rpt-cliente') ? document.getElementById('rpt-cliente').value.trim() : '';
    const vendedor = document.getElementById('rpt-vendedor').value.trim();
    const metodo = document.getElementById('rpt-metodo').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    if (cliente) params.set('cliente', cliente);
    if (vendedor) params.set('vendedor', vendedor);
    if (metodo) params.set('metodo', metodo);
    window.open(`/reportes/ventas/export/csv?${params.toString()}`, '_blank');
});

// Acordeones: ventas y presupuestos
const ventasToggle = document.getElementById('ventas-toggle');
if (ventasToggle) {
    ventasToggle.addEventListener('click', () => {
        const panel = document.getElementById('ventas-panel');
        if (!panel) return;
        const isHidden = panel.classList.toggle('hidden');
        const icon = ventasToggle.querySelector('i');
        const label = ventasToggle.querySelector('span');
        if (isHidden) {
            if (icon) { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down'); }
            if (label) label.textContent = 'Mostrar';
        } else {
            if (icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); }
            if (label) label.textContent = 'Ocultar';
        }
    });
}

const btnRenta = document.getElementById('renta-cargar');
if (btnRenta) {
    btnRenta.addEventListener('click', cargarRentabilidad);
}

const btnRentaCat = document.getElementById('renta-export-cat');
if (btnRentaCat) {
    btnRentaCat.addEventListener('click', () => {
        const desde = document.getElementById('rpt-desde').value;
        const hasta = document.getElementById('rpt-hasta').value;
        const params = new URLSearchParams();
        if (desde) params.set('desde', desde);
        if (hasta) params.set('hasta', hasta);
        window.open(`/reportes/rentabilidad/categorias/export/csv?${params.toString()}`, '_blank');
    });
}

const btnRentaProv = document.getElementById('renta-export-prov');
if (btnRentaProv) {
    btnRentaProv.addEventListener('click', () => {
        const desde = document.getElementById('rpt-desde').value;
        const hasta = document.getElementById('rpt-hasta').value;
        const params = new URLSearchParams();
        if (desde) params.set('desde', desde);
        if (hasta) params.set('hasta', hasta);
        window.open(`/reportes/rentabilidad/proveedores/export/csv?${params.toString()}`, '_blank');
    });
}

const presToggle = document.getElementById('pres-toggle');
if (presToggle) {
    presToggle.addEventListener('click', () => {
        const panel = document.getElementById('pres-panel');
        if (!panel) return;
        const isHidden = panel.classList.toggle('hidden');
        const icon = presToggle.querySelector('i');
        const label = presToggle.querySelector('span');
        if (isHidden) {
            if (icon) { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down'); }
            if (label) label.textContent = 'Mostrar';
        } else {
            if (icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); }
            if (label) label.textContent = 'Ocultar';
        }
    });
}

const devToggle = document.getElementById('dev-toggle');
if (devToggle) {
    devToggle.addEventListener('click', () => {
        const panel = document.getElementById('dev-panel');
        if (!panel) return;
        const isHidden = panel.classList.toggle('hidden');
        const icon = devToggle.querySelector('i');
        const label = devToggle.querySelector('span');
        if (isHidden) {
            if (icon) { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down'); }
            if (label) label.textContent = 'Mostrar';
        } else {
            if (icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); }
            if (label) label.textContent = 'Ocultar';
        }
    });
}

function renderDevoluciones() {
    const cont = document.getElementById('rpt-dev');
    if (!cont) return;
    if (!cacheDev.length) {
        cont.innerHTML = '<div class="text-xs text-slate-400">Sin devoluciones en el rango.</div>';
        return;
    }
    cont.innerHTML = cacheDev.map(d => {
        const total = MONEDA === 'USD' ? (d.total_usd || 0) : (d.total_bs || 0);
        return `<div class="p-2 border-b flex items-center justify-between text-xs">
            <div>
                <div class="font-semibold text-slate-700">${d.cliente || ''}</div>
                <div class="text-[11px] text-slate-500">#${d.id} • ${new Date(d.fecha).toLocaleString()}${d.referencia ? ' • Ref: ' + d.referencia : ''}</div>
                ${d.motivo ? `<div class="text-[11px] text-slate-500">${d.motivo}</div>` : ''}
            </div>
            <div class="text-right font-black text-rose-600">${Number(total).toFixed(2)} ${MONEDA}</div>
        </div>`;
    }).join('');
}

document.getElementById('preset-hoy').addEventListener('click', () => { setPreset('hoy'); cargarReporte(); });
document.getElementById('preset-semana').addEventListener('click', () => { setPreset('semana'); cargarReporte(); });
document.getElementById('preset-mes').addEventListener('click', () => { setPreset('mes'); cargarReporte(); });

// Inicial - cargar cuando se cargue la página
document.addEventListener('DOMContentLoaded', () => {
    setPreset('hoy');
    // Dar tiempo para que auth-guard configure el token
    setTimeout(() => {
        cargarReporte();
    }, 100);
});
