// Lógica del dashboard separada de la plantilla HTML
let MONEDA = 'USD';
let cacheTop = [];
let cacheVend = [];
let charts = {
    ventas: null,
    clientes: null,
    vendedores: null,
    margen: null,
};
let margenInterval = null;
let TASA_BCV = 1;
let KPI_TOTAL_USD = 0;
let TASA_BCV_UPDATED = null;

// (Se removieron presets de reportes del dashboard)

function renderTopProductos() {
    const topEl = document.getElementById('top-productos');
    topEl.innerHTML = '';
    cacheTop.forEach((t) => {
        const monto = MONEDA === 'USD' ? t.total_usd || 0 : t.total_bs || 0;
        const margen = MONEDA === 'USD' ? t.margen_usd || 0 : t.margen_bs || 0;
        const costo = MONEDA === 'USD' ? t.costo_usd || 0 : t.costo_bs || 0;
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center p-2 border-b';
        row.innerHTML = `<div><div class="font-bold">${t.codigo} — ${t.descripcion || ''}</div><div class="text-xs text-slate-400">Vendidos: ${t.total_qty}</div></div><div class="text-right"><div class="font-black">${Number(monto).toFixed(2)} ${MONEDA}</div><div class="text-xs text-green-700">Margen: ${Number(margen).toFixed(2)} ${MONEDA}</div><div class="text-[11px] text-slate-400">Costo: ${Number(costo).toFixed(2)} ${MONEDA}</div></div>`;
        topEl.appendChild(row);
    });
}

// (Se removió el render del reporte del dashboard)

async function cargarDashboard() {
    try {
        const token = localStorage.getItem('auth_token');
        const headers = { 'Authorization': `Bearer ${token}` };
        
        const tasaRes = await fetch('/admin/ajustes/tasa-bcv', { headers });
        if (tasaRes.ok) {
            const { tasa_bcv, actualizado_en } = await tasaRes.json();
            TASA_BCV = Number(tasa_bcv || 1) || 1;
            TASA_BCV_UPDATED = actualizado_en || null;
            document.getElementById('kpi-tasa').innerText = TASA_BCV.toFixed(2);

            const alertEl = document.getElementById('tasa-alert');
            if (alertEl) {
                const diffHrs = TASA_BCV_UPDATED ? (Date.now() - new Date(TASA_BCV_UPDATED).getTime()) / 36e5 : null;
                const show = diffHrs !== null && diffHrs > 8;
                alertEl.classList.toggle('hidden', !show);
                if (show) alertEl.textContent = `Tasa sin actualizar hace ${diffHrs.toFixed(1)}h`;
            }
        }

        const kpisRes = await fetch('/reportes/kpis', { headers });
        if (kpisRes.ok) {
            const kpis = await kpisRes.json();
            document.getElementById('ventas-hoy').innerText = kpis.ventasHoy;
            document.getElementById('ventas-semana').innerText = kpis.ventasSemana;
            KPI_TOTAL_USD = Number(kpis.totalUsd || 0);
            const displayUsd = KPI_TOTAL_USD;
            const displayBs = KPI_TOTAL_USD * TASA_BCV;
            const principal = MONEDA === 'USD'
                ? `${displayUsd.toFixed(2)} USD`
                : `${displayBs.toFixed(2)} Bs`;
            const secundario = MONEDA === 'USD'
                ? `${displayBs.toFixed(2)} Bs`
                : `${displayUsd.toFixed(2)} USD`;
            document.getElementById('total-bs').innerText = principal;
            document.getElementById('total-usd').innerText = secundario;
        }
        const stockRes = await fetch('/admin/ajustes/stock-minimo', { headers });
        if (stockRes.ok) {
            const { stock_minimo } = await stockRes.json();
            document.getElementById('stock-minimo').value = stock_minimo;
        }
        const bajoRes = await fetch('/reportes/bajo-stock', { headers });
        if (bajoRes.ok) {
            const { items } = await bajoRes.json();
            const cont = document.getElementById('lista-bajo-stock');
            if (!items.length) {
                cont.innerHTML = '<div class="text-slate-400">Sin alertas</div>';
            } else {
                cont.innerHTML = items
                    .map((i) => `<div class="py-1 border-b">
                        <div class="flex justify-between text-sm"><span class="font-semibold">${i.codigo}</span><span class="text-slate-500">${i.stock}</span></div>
                        <div class="text-xs text-slate-500 truncate">${i.descripcion || ''}</div>
                    </div>`)
                    .join('');
            }
        }

        const ventasRes = await fetch('/reportes/ventas', { headers });
        if (!ventasRes.ok) {
            console.error('Error cargando ventas');
            return;
        }
        const ventas = await ventasRes.json();
        const ultimas = ventas.slice(0, 5);
        const ultEl = document.getElementById('ultimas-ventas');
        ultEl.innerHTML = '';
        ultimas.forEach((u) => {
            const d = document.createElement('div');
            d.className = 'p-2 border rounded flex items-center justify-between';
            const left = `<div class="min-w-0"><div class="font-bold truncate">${u.cliente || '—'}</div><div class="text-[10px] text-slate-400">${new Date(u.fecha).toLocaleString()}</div></div>`;
            const montoBs = u.total_bs != null ? `${Number(u.total_bs).toFixed(2)} Bs` : '-- Bs';
            const montoUsd = u.tasa_bcv != null && u.tasa_bcv !== 0 ? `${Number(u.total_bs / u.tasa_bcv).toFixed(2)} USD` : '-- USD';
            const right = `<div class="text-right ml-4 w-36"><div class="text-sm font-black">${montoBs}</div><div class="text-xs text-slate-400">${montoUsd}</div></div>`;
            d.innerHTML = left + right;
            ultEl.appendChild(d);
        });

        const invRes = await fetch('/reportes/inventario', { headers });
        if (invRes.ok) {
            const inv = await invRes.json();
            const invUsdEl = document.getElementById('inv-total-usd');
            const invBsEl = document.getElementById('inv-total-bs');
            const invTasaEl = document.getElementById('inv-tasa');
            if (invUsdEl) invUsdEl.innerText = `${Number(inv.totals.totalUsd || 0).toFixed(2)} USD`;
            if (invBsEl) invBsEl.innerText = `${Number(inv.totals.totalBs || 0).toFixed(2)} Bs`;
            if (invTasaEl) invTasaEl.innerText = Number(inv.totals.tasa || 1).toFixed(2);
        }

        const topRes = await fetch('/reportes/top-productos?limit=10', { headers });
        if (topRes.ok) {
            cacheTop = await topRes.json();
            renderTopProductos();
        }

        // Ventas diarias por defecto
        await renderVentasSeries('diarias');

        // Top clientes
        await renderTopClientes();

        // Margen actual + sparkline
        await renderMargenActual();
    } catch (err) {
        console.error('Error cargando dashboard', err);
    }
}

document.getElementById('sincronizar-manual').addEventListener('click', () => {
    if (typeof window.sincronizarVentasPendientes === 'function') window.sincronizarVentasPendientes();
});


document.getElementById('btn-actualizar-tasa').addEventListener('click', async () => {
    try {
        const token = localStorage.getItem('auth_token');
        const r = await fetch('/admin/ajustes/tasa-bcv/actualizar', { 
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const j = await r.json();
        const tasa = Number(j.tasa_bcv || 0);
        if (!Number.isNaN(tasa) && tasa > 0) {
            TASA_BCV = tasa;
            TASA_BCV_UPDATED = j.actualizado_en || new Date().toISOString();
            document.getElementById('kpi-tasa').innerText = tasa.toFixed(2);
            try {
                localStorage.setItem('tasa_bcv', String(tasa));
                localStorage.setItem('tasa_bcv_updated', String(tasa));
            } catch (err) {
                console.warn('No se pudo escribir en localStorage', err);
            }
            await cargarDashboard();
        }
    } catch (err) {
        console.error('No se pudo actualizar tasa BCV', err);
    }
});

document.getElementById('btn-guardar-tasa').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('input-tasa').value);
    if (!val || Number.isNaN(val) || val <= 0) return;
    const token = localStorage.getItem('auth_token');
    const r = await fetch('/admin/ajustes/tasa-bcv', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tasa_bcv: val }),
    });
    if (r.ok) {
        TASA_BCV = val;
        TASA_BCV_UPDATED = new Date().toISOString();
        document.getElementById('kpi-tasa').innerText = val.toFixed(2);
        try {
            localStorage.setItem('tasa_bcv', String(val));
            localStorage.setItem('tasa_bcv_updated', String(val));
        } catch (err) {
            console.warn('No se pudo escribir en localStorage', err);
        }
        await cargarDashboard();
    }
});

document.getElementById('btn-guardar-stock').addEventListener('click', async () => {
    const n = parseInt(document.getElementById('stock-minimo').value, 10);
    if (Number.isNaN(n) || n < 0) return;
    const token = localStorage.getItem('auth_token');
    await fetch('/admin/ajustes/stock-minimo', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ stock_minimo: n }),
    });
    await cargarDashboard();
});

async function cargarVendedores() {
    const desde = document.getElementById('vend-desde').value;
    const hasta = document.getElementById('vend-hasta').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    const token = localStorage.getItem('auth_token');
    const r = await fetch(`/reportes/vendedores?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return;
    cacheVend = await r.json();
    const tb = document.getElementById('tabla-vendedores');
    tb.innerHTML = '';
    cacheVend.forEach((v) => {
        const total = MONEDA === 'USD' ? v.total_usd : v.total_bs;
        const margen = MONEDA === 'USD' ? v.margen_usd : v.margen_bs;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="p-2">${v.vendedor}</td><td class="p-2 text-right">${v.ventas}</td><td class="p-2 text-right">${Number(total || 0).toFixed(2)}</td><td class="p-2 text-right">${Number(margen || 0).toFixed(2)}</td>`;
        tb.appendChild(tr);
    });

    // Render gráfica comparativa
    const labels = cacheVend.map(v => v.vendedor || '—');
    const data = cacheVend.map(v => Number((MONEDA === 'USD' ? v.total_usd : v.total_bs) || 0));
    const margen = cacheVend.map(v => Number((MONEDA === 'USD' ? v.margen_usd : v.margen_bs) || 0));
    const ctx = document.getElementById('chart-vendedores');
    if (ctx) {
        const cfg = {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: `Total (${MONEDA})`, data, backgroundColor: 'rgba(59,130,246,0.5)' },
                    { label: `Margen (${MONEDA})`, data: margen, backgroundColor: 'rgba(16,185,129,0.5)' }
                ]
            },
            options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
        };
        charts.vendedores?.destroy();
        charts.vendedores = new Chart(ctx, cfg);
    }
}

document.getElementById('vend-filtrar').addEventListener('click', cargarVendedores);

const dashMoneda = document.getElementById('dash-moneda');
if (dashMoneda) {
    dashMoneda.value = MONEDA;
    dashMoneda.addEventListener('change', (e) => {
        MONEDA = e.target.value;
        cargarDashboard();
        cargarVendedores();
    });
}

const iniciarRefrescoMargen = () => {
    if (margenInterval) clearInterval(margenInterval);
    margenInterval = setInterval(() => {
        renderMargenActual();
    }, 30000); // cada 30s
};

cargarDashboard().then(iniciarRefrescoMargen);
cargarVendedores();

// ===== Nuevas funciones de gráficos =====

async function renderVentasSeries(tipo) {
    try {
        const token = localStorage.getItem('auth_token');
        const headers = { 'Authorization': `Bearer ${token}` };
        const endpoint = tipo === 'mensuales' ? '/reportes/series/ventas-mensuales?meses=12' : '/reportes/series/ventas-diarias?dias=30';
        const r = await fetch(endpoint, { headers });
        if (!r.ok) return;
        const rows = await r.json();
        const labels = rows.map(x => (tipo === 'mensuales' ? x.mes : x.dia));
        const total = rows.map(x => Number((MONEDA === 'USD' ? x.total_usd : x.total_bs) || 0));
        const margen = rows.map(x => Number((MONEDA === 'USD' ? x.margen_usd : x.margen_bs) || 0));
        const ctx = document.getElementById('chart-ventas');
        if (!ctx) return;
        const cfg = {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: `Ventas (${MONEDA})`, data: total, borderColor: 'rgba(59,130,246,1)', backgroundColor: 'rgba(59,130,246,0.2)', tension: 0.3 },
                    { label: `Margen (${MONEDA})`, data: margen, borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(16,185,129,0.2)', tension: 0.3 }
                ]
            },
            options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
        };
        charts.ventas?.destroy();
        charts.ventas = new Chart(ctx, cfg);
    } catch (err) {
        console.error('No se pudo renderizar ventas series', err);
    }
}

async function renderTopClientes() {
    try {
        const token = localStorage.getItem('auth_token');
        const headers = { 'Authorization': `Bearer ${token}` };
        const r = await fetch('/reportes/top-clientes?limit=5', { headers });
        if (!r.ok) return;
        const rows = await r.json();
        const labels = rows.map(x => x.cliente);
        const data = rows.map(x => Number((MONEDA === 'USD' ? x.total_usd : x.total_bs) || 0));
        const ctx = document.getElementById('chart-clientes');
        if (!ctx) return;
        const cfg = {
            type: 'bar',
            data: { labels, datasets: [{ label: `Monto (${MONEDA})`, data, backgroundColor: 'rgba(234,179,8,0.6)' }] },
            options: { indexAxis: 'y', responsive: true, scales: { x: { beginAtZero: true } } }
        };
        charts.clientes?.destroy();
        charts.clientes = new Chart(ctx, cfg);
    } catch (err) {
        console.error('No se pudo renderizar top clientes', err);
    }
}

async function renderMargenActual() {
    try {
        const token = localStorage.getItem('auth_token');
        const headers = { 'Authorization': `Bearer ${token}` };
        const r = await fetch('/reportes/margen/actual', { headers });
        if (!r.ok) return;
        const j = await r.json();
        const hoy = MONEDA === 'USD' ? j.hoy.margen_usd : j.hoy.margen_bs;
        const mes = MONEDA === 'USD' ? j.mes.margen_usd : j.mes.margen_bs;
        document.getElementById('margen-hoy').innerText = `${Number(hoy || 0).toFixed(2)} ${MONEDA}`;
        document.getElementById('margen-mes').innerText = `${Number(mes || 0).toFixed(2)} ${MONEDA}`;

        // Sparkline con últimos 30 días de margen
        const r2 = await fetch('/reportes/series/ventas-diarias?dias=30', { headers });
        if (!r2.ok) return;
        const rows = await r2.json();
        const labels = rows.map(x => x.dia);
        const data = rows.map(x => Number((MONEDA === 'USD' ? x.margen_usd : x.margen_bs) || 0));
        const ctx = document.getElementById('chart-margen');
        if (!ctx) return;
        const cfg = {
            type: 'line', data: { labels, datasets: [{ label: `Margen (${MONEDA})`, data, borderColor: 'rgba(244,63,94,1)', backgroundColor: 'rgba(244,63,94,0.15)', tension: 0.3 }] },
            options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        };
        charts.margen?.destroy();
        charts.margen = new Chart(ctx, cfg);

        // Margen de hoy por vendedor
        await renderMargenVendedoresHoy(headers);
    } catch (err) {
        console.error('No se pudo renderizar margen actual', err);
    }
}

async function renderMargenVendedoresHoy(headers) {
    try {
        const hoy = new Date().toISOString().slice(0,10);
        const r = await fetch(`/reportes/vendedores?desde=${hoy}&hasta=${hoy}`, { headers });
        if (!r.ok) return;
        const rows = await r.json();
        const cont = document.getElementById('margen-vendedores');
        if (!cont) return;
        if (!rows.length) {
            cont.innerHTML = '<div class="text-slate-400">Sin ventas hoy</div>';
            return;
        }
        cont.innerHTML = rows
          .map(v => {
            const margen = MONEDA === 'USD' ? v.margen_usd : v.margen_bs;
            const total = MONEDA === 'USD' ? v.total_usd : v.total_bs;
            return `<div class="flex justify-between border-b pb-1"><span>${v.vendedor || '—'}</span><span class="font-semibold">${Number(margen || 0).toFixed(2)} ${MONEDA} <span class="text-xs text-slate-400">(ventas ${Number(total||0).toFixed(2)})</span></span></div>`;
          })
          .join('');
    } catch (err) {
        console.error('No se pudo renderizar margen por vendedor', err);
    }
}

// Botones de periodo ventas
document.getElementById('ventas-diarias-btn')?.addEventListener('click', () => renderVentasSeries('diarias'));
document.getElementById('ventas-mensuales-btn')?.addEventListener('click', () => renderVentasSeries('mensuales'));
