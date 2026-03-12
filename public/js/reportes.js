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
import { formatNumber } from './format-utils.js';
import { initCustomSelect } from './modules/ui.js';
let MONEDA = 'USD';
let cacheRows = [];
const detallesCache = new Map();
let abiertoId = null;
let cacheDev = [];
const devDetallesCache = new Map();
let cachePres = [];
let clienteTimer = null;
let cacheRentCat = [];
let cacheRentProv = [];
let resumenRent = null;
let cacheComisiones = [];
let vendedoresCache = [];
const escapeHtml = (window.escapeHtml) ? window.escapeHtml : (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function setupReportesTabs() {
    const tabs = document.querySelectorAll('[data-rpt-tab]');
    const sections = document.querySelectorAll('[data-rpt-section]');
    if (!tabs.length || !sections.length) return;

    const activate = (key) => {
        sections.forEach((sec) => {
            const match = sec.dataset.rptSection === key;
            sec.classList.toggle('hidden', !match);
        });
        tabs.forEach((tab) => {
            const isActive = tab.dataset.rptTab === key;
            tab.classList.toggle('text-slate-900', isActive);
            tab.classList.toggle('border-blue-500', isActive);
            tab.classList.toggle('text-slate-500', !isActive);
            tab.classList.toggle('border-transparent', !isActive);
        });
    };

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => activate(tab.dataset.rptTab));
    });

    const initial = document.querySelector('[data-rpt-tab].rpt-tab-default');
    activate(initial ? initial.dataset.rptTab : tabs[0].dataset.rptTab);
}

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
            ? Number(r.total_usd || 0)
            : Number(r.total_bs || 0);
        const m = MONEDA === 'USD' ? Number(r.margen_usd || 0) : Number(r.margen_bs || 0);
        total += Number(t);
        margen += Number(m);
        const badgeDev = r.tiene_devolucion
            ? '<span class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700 uppercase tracking-wide">DEVOLUCIÓN</span>'
            : '';
        const nro = r.nro_nota || '';
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-50 cursor-pointer';
        tr.dataset.id = String(r.id);
                tr.innerHTML = `
            <td class="p-2 whitespace-nowrap"><i id="venta-toggle-icon-${r.id}" class="fas fa-chevron-down mr-2 text-slate-500"></i>${new Date(r.fecha).toLocaleString()}${nro ? ` · <span class="text-[11px] text-slate-500 font-semibold">${nro}</span>` : ''}${badgeDev}</td>
      <td class="p-2">${r.cliente || ''}</td>
            <td class="p-2 hidden sm:table-cell">${r.vendedor || ''}</td>
            <td class="p-2 hidden sm:table-cell">${r.metodo_pago || ''}</td>
            <td class="p-2 text-slate-600 text-xs hidden md:table-cell">${r.referencia || '—'}</td>
    <td class="p-2 text-right font-semibold">${formatNumber(t)}</td>
    <td class="p-2 text-right text-blue-700 font-semibold">${formatNumber(m)}</td>
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
                    const devTag = d.devuelto_total
                        ? '<span class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-rose-100 text-rose-700 uppercase tracking-wide">DEVUELTO</span>'
                        : (d.devuelto_parcial
                            ? `<span class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-100 text-amber-700 uppercase tracking-wide">DEVUELTO ${d.devuelto_cant || ''}</span>`
                            : '');
                    const descUpper = (d.descripcion || '').toString().toUpperCase();
                    return `<div class="flex items-center justify-between border-b pb-1">
                        <div class="truncate">${codePart}<span class="text-slate-600">${descUpper}</span>${devTag}</div>
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
    const input = document.getElementById('rpt-cliente');
    if (!list) return;
    list.innerHTML = '';
    const uniques = new Map();
    (items || []).forEach((c) => {
        const nombre = c.cliente || '';
        if (!nombre || uniques.has(nombre)) return;
        const labelParts = [nombre];
        if (c.cedula) labelParts.push(`CI: ${c.cedula}`);
        if (c.telefono) labelParts.push(`Tel: ${c.telefono}`);
        uniques.set(nombre, { nombre, label: labelParts.join(' · ') });
    });

    const entries = Array.from(uniques.values()).slice(0, 8);
    if (!entries.length) {
        list.classList.add('hidden');
        return;
    }

    entries.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'p-3 border-b last:border-b-0 hover:bg-slate-50 cursor-pointer flex justify-between items-center text-sm';
        li.innerHTML = `<div><div class="font-semibold text-slate-700">${escapeHtml(item.nombre)}</div><div class="text-[11px] text-slate-500">${escapeHtml(item.label)}</div></div>`;
        li.addEventListener('click', () => {
            if (input) input.value = item.nombre;
            list.classList.add('hidden');
        });
        list.appendChild(li);
    });

    list.classList.remove('hidden');
}

function renderVendedorSugerencias(items) {
    const list = document.getElementById('rpt-vendedores-list');
    const input = document.getElementById('rpt-vendedor');
    if (!list) return;
    list.innerHTML = '';

    const uniques = new Map();
    (items || []).forEach((v) => {
        const nombre = (v.nombre_completo || v.username || '').trim();
        if (!nombre || uniques.has(nombre)) return;
        const labelParts = [];
        if (v.rol) labelParts.push(v.rol.toUpperCase());
        if (v.username && v.username !== nombre) labelParts.push(`@${v.username}`);
        uniques.set(nombre, { nombre, label: labelParts.join(' · ') });
    });

    const entries = Array.from(uniques.values()).slice(0, 8);
    if (!entries.length) {
        list.classList.add('hidden');
        return;
    }

    entries.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'p-3 border-b last:border-b-0 hover:bg-slate-50 cursor-pointer flex justify-between items-center text-sm';
        li.innerHTML = `<div><div class="font-semibold text-slate-700">${escapeHtml(item.nombre)}`;
        li.addEventListener('click', () => {
            if (input) input.value = item.nombre;
            list.classList.add('hidden');
        });
        list.appendChild(li);
    });

    list.classList.remove('hidden');
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
                        <div class="mt-1 flex gap-1 justify-end items-center">
                            <button class="px-2 py-1 text-[10px] border border-slate-300 text-slate-700 rounded bg-white hover:bg-slate-50" data-pres-ver="${p.id}">Ver</button>
                            <button class="px-2 py-1 text-[10px] bg-blue-600 text-white rounded" data-pres-pos="${p.id}">Usar en POS</button>
                            <button class="btn-trash" data-pres-del="${p.id}" title="Eliminar presupuesto">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                                    <path fill="currentColor" d="M8.78842 5.03866C8.86656 4.96052 8.97254 4.91663 9.08305 4.91663H11.4164C11.5269 4.91663 11.6329 4.96052 11.711 5.03866C11.7892 5.11681 11.833 5.22279 11.833 5.33329V5.74939H8.66638V5.33329C8.66638 5.22279 8.71028 5.11681 8.78842 5.03866ZM7.16638 5.74939V5.33329C7.16638 4.82496 7.36832 4.33745 7.72776 3.978C8.08721 3.61856 8.57472 3.41663 9.08305 3.41663H11.4164C11.9247 3.41663 12.4122 3.61856 12.7717 3.978C13.1311 4.33745 13.333 4.82496 13.333 5.33329V5.74939H15.5C15.9142 5.74939 16.25 6.08518 16.25 6.49939C16.25 6.9136 15.9142 7.24939 15.5 7.24939H15.0105L14.2492 14.7095C14.2382 15.2023 14.0377 15.6726 13.6883 16.0219C13.3289 16.3814 12.8414 16.5833 12.333 16.5833H8.16638C7.65805 16.5833 7.17054 16.3814 6.81109 16.0219C6.46176 15.6726 6.2612 15.2023 6.25019 14.7095L5.48896 7.24939H5C4.58579 7.24939 4.25 6.9136 4.25 6.49939C4.25 6.08518 4.58579 5.74939 5 5.74939H6.16667H7.16638ZM7.91638 7.24996H12.583H13.5026L12.7536 14.5905C12.751 14.6158 12.7497 14.6412 12.7497 14.6666C12.7497 14.7771 12.7058 14.8831 12.6277 14.9613C12.5495 15.0394 12.4436 15.0833 12.333 15.0833H8.16638C8.05588 15.0833 7.94989 15.0394 7.87175 14.9613C7.79361 14.8831 7.74972 14.7771 7.74972 14.6666C7.74972 14.6412 7.74842 14.6158 7.74584 14.5905L6.99681 7.24996H7.91638Z" clip-rule="evenodd" fill-rule="evenodd"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('');

        // Usar en POS
        cont.querySelectorAll('[data-pres-pos]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.presPos || btn.getAttribute('data-pres-pos');
                if (!id) return;
                window.location.href = `/pos?presupuesto=${encodeURIComponent(id)}`;
            });
        });

        // Ver presupuesto (nota imprimible)
        cont.querySelectorAll('[data-pres-ver]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const id = btn.dataset.presVer || btn.getAttribute('data-pres-ver');
                if (!id) return;
                const url = `/presupuestos/nota/${encodeURIComponent(id)}`;
                window.open(url, '_blank');
            });
        });

        // Eliminar presupuesto
        cont.querySelectorAll('[data-pres-del]').forEach(btn => {
            btn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const id = btn.dataset.presDel || btn.getAttribute('data-pres-del');
                if (!id) return;
                const ok = window.confirm('¿Eliminar este presupuesto? Esta acción no se puede deshacer.');
                if (!ok) return;
                try {
                    await apiFetchJson(`/presupuestos/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    cachePres = cachePres.filter(p => String(p.id) !== String(id));
                    renderPresupuestos();
                    if (window.showToast) {
                        window.showToast('Presupuesto eliminado', 'success');
                    }
                } catch (err) {
                    console.error('Error eliminando presupuesto', err);
                    if (window.showToast) {
                        window.showToast(err.message || 'Error eliminando presupuesto', 'error');
                    }
                }
            });
        });
}

async function sugerirClientes(q) {
    const list = document.getElementById('rpt-clientes-list');
    if (!list) return;
    if (!q || q.length < 2) {
        list.innerHTML = '';
        list.classList.add('hidden');
        return;
    }
    try {
        const data = await apiFetchJson(`/reportes/historial-cliente?q=${encodeURIComponent(q)}&limit=8`);
        renderClienteSugerencias(data || []);
    } catch (err) {
        console.error('Error sugiriendo clientes', err);
    }
}

async function cargarVendedoresFiltro() {
    try {
        const data = await apiFetchJson('/admin/usuarios/vendedores-list');
        vendedoresCache = Array.isArray(data) ? data : [];
    } catch (err) {
        console.warn('No se pudieron cargar vendedores para filtros de reporte', err);
        vendedoresCache = [];
    }
}

function filtrarVendedores(q) {
    if (!vendedoresCache || !vendedoresCache.length) return [];
    const term = (q || '').trim().toLowerCase();
    if (!term) return vendedoresCache;
    return vendedoresCache.filter((v) => {
        const nombre = (v.nombre_completo || v.username || '').toLowerCase();
        return nombre.includes(term);
    });
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

function renderComisiones() {
    const cont = document.getElementById('comisiones-contenedor');
    if (!cont) return;

    if (!cacheComisiones.length) {
        cont.innerHTML = '<div class="p-2 text-[11px] text-slate-400">Sin ventas con comisión en el rango seleccionado.</div>';
        return;
    }

    const fmt = (v) => Number(v || 0).toFixed(2);

    cont.innerHTML = `<table class="w-full text-[11px]"><thead class="bg-slate-100 text-slate-500"><tr>
        <th class="p-1 text-left">Vendedor</th>
        <th class="p-1 text-left">Rol</th>
        <th class="p-1 text-right">Comisión %</th>
        <th class="p-1 text-right">Ventas</th>
        <th class="p-1 text-right">Total USD</th>
        <th class="p-1 text-right">Comisión USD</th>
    </tr></thead><tbody class="divide-y">
    ${cacheComisiones.map(r => {
        const nombre = r.nombre_completo || r.username || '—';
        const pct = r.comision_pct != null ? Number(r.comision_pct).toFixed(2) + '%' : '0%';
        return `<tr>
            <td class="p-1">${escapeHtml(nombre)}</td>
            <td class="p-1">${escapeHtml(r.rol || '')}</td>
            <td class="p-1 text-right">${pct}</td>
            <td class="p-1 text-right">${Number(r.ventas || 0)}</td>
            <td class="p-1 text-right">${fmt(r.total_usd)}</td>
            <td class="p-1 text-right font-semibold text-emerald-700">${fmt(r.comision_usd)}</td>
        </tr>`;
    }).join('')}
    </tbody></table>`;
}

async function cargarComisiones() {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    try {
        cacheComisiones = await apiFetchJson(`/reportes/comisiones-vendedores?${params.toString()}`);
        renderComisiones();
    } catch (err) {
        console.error('Error cargando comisiones', err);

        if (window.showToast) {
            window.showToast('Error cargando el reporte de comisiones.', 'error');
        } else {
            alert('Error cargando el reporte de comisiones.');
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

    // Cerrar sugerencias al hacer clic fuera
    document.addEventListener('click', (ev) => {
        const list = document.getElementById('rpt-clientes-list');
        if (!list) return;
        const dentro = list.contains(ev.target) || clienteInput.contains(ev.target);
        if (!dentro) list.classList.add('hidden');
    });
}

// Sugerencias de vendedores
const vendedorInput = document.getElementById('rpt-vendedor');
let vendedorTimer = null;
if (vendedorInput) {
    cargarVendedoresFiltro();

    vendedorInput.addEventListener('focus', () => {
        const q = vendedorInput.value.trim();
        const items = filtrarVendedores(q);
        renderVendedorSugerencias(items);
    });

    vendedorInput.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        clearTimeout(vendedorTimer);
        vendedorTimer = setTimeout(() => {
            const items = filtrarVendedores(q);
            renderVendedorSugerencias(items);
        }, 150);
    });

    document.addEventListener('click', (ev) => {
        const list = document.getElementById('rpt-vendedores-list');
        if (!list) return;
        const dentro = list.contains(ev.target) || vendedorInput.contains(ev.target);
        if (!dentro) list.classList.add('hidden');
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

const btnComisiones = document.getElementById('comisiones-cargar');
if (btnComisiones) {
    btnComisiones.addEventListener('click', cargarComisiones);
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
    cont.innerHTML = cacheDev.map((d, idx) => {
                const total = MONEDA === 'USD' ? (d.total_usd || 0) : (d.total_bs || 0);
                const nro = idx + 1;
                const fechaTxt = new Date(d.fecha).toLocaleString();
                const ventaInfo = d.venta_original_id
                    ? (d.venta_nro_emp != null ? `Venta #${d.venta_nro_emp}` : `Venta #${d.venta_original_id}`)
                    : 'Sin venta asociada';
        return `
        <div class="border-b">
          <div class="p-2 flex items-center justify-between text-xs cursor-pointer" data-dev-toggle="${d.id}">
            <div>
              <div class="font-semibold text-slate-700">${d.cliente || ''}</div>
              <div class="text-[11px] text-slate-500">DEV-${nro} • ${fechaTxt} • Ref: ${ventaInfo}</div>
              ${d.motivo ? `<div class="text-[11px] text-slate-500">${d.motivo}</div>` : ''}
            </div>
            <div class="text-right">
              <div class="font-black text-rose-600">${Number(total).toFixed(2)} ${MONEDA}</div>
              ${d.venta_original_id ? `<button class="mt-1 px-2 py-1 text-[10px] bg-blue-600 text-white rounded" data-ver-venta="${d.venta_original_id}">Ver venta</button>` : ''}
            </div>
          </div>
          <div id="dev-det-${d.id}" class="hidden bg-slate-50 p-2 text-[11px] text-slate-700">Productos devueltos...</div>
        </div>`;
    }).join('');

    // Toggle y carga de detalles de cada devolución
    cont.querySelectorAll('[data-dev-toggle]').forEach(el => {
        el.addEventListener('click', async () => {
            const devId = el.getAttribute('data-dev-toggle');
            const panel = document.getElementById(`dev-det-${devId}`);
            if (!panel) return;
            const oculto = panel.classList.contains('hidden');
            panel.classList.toggle('hidden');
            if (!oculto) return;

            if (!devDetallesCache.has(devId)) {
                panel.textContent = 'Cargando...';
                try {
                    const j = await apiFetchJson(`/devoluciones/${devId}`);
                    devDetallesCache.set(devId, j);
                } catch (err) {
                    console.error('Error detalle devolución', err);
                    panel.textContent = 'Error cargando detalle de la devolución';
                    return;
                }
            }

            const data = devDetallesCache.get(devId) || {};
            const detalles = data.detalles || [];
            const devolucion = data.devolucion || {};
            const tasa = Number(devolucion.tasa_bcv || 0) || 0;
            const fmt = (v) => Number(v || 0).toFixed(2);

            if (!detalles.length) {
                panel.innerHTML = '<div class="text-slate-400">Sin productos devueltos.</div>';
                return;
            }

            panel.innerHTML = detalles.map(d => {
                const codigo = d.codigo || '';
                const montoUsd = Number(d.precio_usd || 0) * Number(d.cantidad || 0);
                const montoBs = d.subtotal_bs != null ? Number(d.subtotal_bs || 0) : (montoUsd * (tasa || 1));
                const monto = MONEDA === 'USD' ? fmt(montoUsd) + ' USD' : fmt(montoBs) + ' Bs';
                const codePart = codigo ? `<span class="font-semibold">${codigo}</span> — ` : '';
                return `<div class="flex items-center justify-between border-b pb-1">
                    <div class="truncate">${codePart}<span class="text-slate-600">${(d.descripcion || '').toString().toUpperCase()}</span></div>
                    <div class="text-right min-w-[160px]"><span class="text-xs text-slate-500">Cant ${d.cantidad}</span> • <span class="font-semibold">${monto}</span></div>
                </div>`;
            }).join('');
        });
    });

    // Botones para abrir la venta original en el acordeón de ventas
    cont.querySelectorAll('[data-ver-venta]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const ventaId = btn.getAttribute('data-ver-venta');
            if (ventaId) {
                abrirVentaEnReporte(ventaId);
            }
        });
    });
}

function abrirVentaEnReporte(ventaId) {
    try {
        const ventasPanel = document.getElementById('ventas-panel');
        const ventasToggle = document.getElementById('ventas-toggle');
        if (ventasPanel && ventasPanel.classList.contains('hidden')) {
            ventasPanel.classList.remove('hidden');
            if (ventasToggle) {
                const icon = ventasToggle.querySelector('i');
                const label = ventasToggle.querySelector('span');
                if (icon) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); }
                if (label) label.textContent = 'Ocultar';
            }
        }

        const row = document.querySelector(`#rpt-tabla tr[data-id="${ventaId}"]`);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.click();
        } else if (window.showToast) {
            window.showToast('La venta de esta devolución no está dentro del rango filtrado.', 'warning');
        } else {
            alert('La venta de esta devolución no está dentro del rango filtrado.');
        }
    } catch (err) {
        console.error('Error abriendo venta desde devolución', err);
    }
}

document.getElementById('preset-hoy').addEventListener('click', () => { setPreset('hoy'); cargarReporte(); });
document.getElementById('preset-semana').addEventListener('click', () => { setPreset('semana'); cargarReporte(); });
document.getElementById('preset-mes').addEventListener('click', () => { setPreset('mes'); cargarReporte(); });

// Inicial - cargar cuando se cargue la página
document.addEventListener('DOMContentLoaded', () => {
    setupReportesTabs();
    setPreset('hoy');
    try {
        initCustomSelect('moneda-toggle');
        initCustomSelect('rpt-metodo');
    } catch {}
    // Dar tiempo para que auth-guard configure el token
    setTimeout(() => {
        cargarReporte();
    }, 100);
});
