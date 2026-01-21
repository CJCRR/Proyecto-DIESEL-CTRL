// Lógica del dashboard separada de la plantilla HTML
let MONEDA = 'USD';
let cacheTop = [];
let cacheVend = [];

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
        
        const kpisRes = await fetch('/reportes/kpis', { headers });
        if (kpisRes.ok) {
            const kpis = await kpisRes.json();
            document.getElementById('ventas-hoy').innerText = kpis.ventasHoy;
            document.getElementById('ventas-semana').innerText = kpis.ventasSemana;
            const principal = MONEDA === 'USD' ? `${Number(kpis.totalUsd || 0).toFixed(2)} USD` : `${Number(kpis.totalBs || 0).toFixed(2)} Bs`;
            const secundario = MONEDA === 'USD' ? `${Number(kpis.totalBs || 0).toFixed(2)} Bs` : `${Number(kpis.totalUsd || 0).toFixed(2)} USD`;
            document.getElementById('total-bs').innerText = principal;
            document.getElementById('total-usd').innerText = secundario;
        }

        const tasaRes = await fetch('/admin/ajustes/tasa-bcv', { headers });
        if (tasaRes.ok) {
            const { tasa_bcv } = await tasaRes.json();
            document.getElementById('kpi-tasa').innerText = Number(tasa_bcv || 0).toFixed(2);
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
                    .map((i) => `<div class="flex justify-between py-1 border-b"><span class="font-semibold">${i.codigo}</span><span class="text-slate-500">${i.stock}</span></div>`)
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
            const invEl = document.getElementById('inventario-list');
            document.getElementById('inv-total-usd').innerText = `${Number(inv.totals.totalUsd || 0).toFixed(2)} USD`;
            document.getElementById('inv-total-bs').innerText = `${Number(inv.totals.totalBs || 0).toFixed(2)} Bs`;
            document.getElementById('inv-tasa').innerText = Number(inv.totals.tasa || 1).toFixed(2);
            invEl.innerHTML = '';
            (inv.items || []).slice(0, 10).forEach((p) => {
                const el = document.createElement('div');
                el.className = 'flex justify-between items-center p-2 border-b';
                el.innerHTML = `<div><div class="font-bold">${p.codigo}</div><div class="text-xs text-slate-400">${p.descripcion}</div></div><div class="text-right"><div class="text-sm font-black">${p.stock}</div><div class="text-xs text-slate-400">${Number(p.total_usd || 0).toFixed(2)} USD</div></div>`;
                invEl.appendChild(el);
            });
        }

        const topRes = await fetch('/reportes/top-productos?limit=10', { headers });
        if (topRes.ok) {
            cacheTop = await topRes.json();
            renderTopProductos();
        }
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
            document.getElementById('kpi-tasa').innerText = tasa.toFixed(2);
            try {
                localStorage.setItem('tasa_bcv', String(tasa));
                localStorage.setItem('tasa_bcv_updated', String(tasa));
            } catch (err) {
                console.warn('No se pudo escribir en localStorage', err);
            }
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
        document.getElementById('kpi-tasa').innerText = val.toFixed(2);
        try {
            localStorage.setItem('tasa_bcv', String(val));
            localStorage.setItem('tasa_bcv_updated', String(val));
        } catch (err) {
            console.warn('No se pudo escribir en localStorage', err);
        }
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

cargarDashboard();
cargarVendedores();
