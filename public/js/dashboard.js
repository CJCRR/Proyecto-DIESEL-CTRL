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
let TOP_LIMIT = parseInt(localStorage.getItem('top_limit') || '10', 10);
let STOCK_UMBRAL = parseInt(localStorage.getItem('stock_umbral') || '1', 10);
let AL_UMBRAL_TIMER = null;
let FILTRO_MES = null; // 1-12
let FILTRO_ANO = null; // >= 2026
import { apiFetchJson } from './app-api.js';
import { formatNumber } from './format-utils.js';

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
        const descUpper = (t.descripcion || '').toString().toUpperCase();
        row.innerHTML = `<div><div class="font-bold">${t.codigo} — ${descUpper}</div><div class="text-xs text-slate-400">Vendidos: ${t.total_qty}</div></div><div class="text-right"><div class="font-black">${formatNumber(monto, 2)} ${MONEDA}</div><div class="text-xs text-green-700">Margen: ${formatNumber(margen, 2)} ${MONEDA}</div><div class="text-[11px] text-slate-400">Costo: ${formatNumber(costo, 2)} ${MONEDA}</div></div>`;
        topEl.appendChild(row);
    });
}

// (Se removió el render del reporte del dashboard)

function getPeriodoRango() {
    const mes = FILTRO_MES;
    const ano = FILTRO_ANO;
    if (!mes || !ano) return { desde: null, hasta: null };
    const mm = String(mes).padStart(2, '0');
    const desde = `${ano}-${mm}-01`;
    const lastDay = new Date(ano, mes, 0).getDate();
    const dd = String(lastDay).padStart(2, '0');
    const hasta = `${ano}-${mm}-${dd}`;
    return { desde, hasta };
}

function getPeriodoQueryString() {
    const { desde, hasta } = getPeriodoRango();
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    const s = params.toString();
    return s || '';
}

async function loadInventarioDashboard() {
    try {
        const ahora = new Date();
        const currentYear = ahora.getFullYear();
        const currentMonth = ahora.getMonth() + 1;
        const { desde, hasta } = getPeriodoRango();
        const isPeriodoActual = !desde || !hasta || (FILTRO_MES === currentMonth && FILTRO_ANO === currentYear);
        const url = isPeriodoActual
            ? '/api/reportes/inventario'
            : `/api/reportes/inventario?corte=${encodeURIComponent(hasta)}`;
        const inv = await apiFetchJson(url);
        const invUsdEl = document.getElementById('inv-total-usd');
        const invBsEl = document.getElementById('inv-total-bs');
        const invTasaEl = document.getElementById('inv-tasa');
        const invCostoUsdEl = document.getElementById('inv-total-costo-usd');
        const invCostoBsEl = document.getElementById('inv-total-costo-bs');
        if (invUsdEl) invUsdEl.innerText = `${formatNumber(inv.totals.totalUsd || 0, 2)} USD`;
        if (invBsEl) invBsEl.innerText = `${formatNumber(inv.totals.totalBs || 0, 2)} Bs`;
        if (invTasaEl) invTasaEl.innerText = formatNumber(inv.totals.tasa || 1, 2);
        if (invCostoUsdEl) invCostoUsdEl.innerText = `${formatNumber(inv.totals.costoUsd || 0, 2)} USD`;
        if (invCostoBsEl) invCostoBsEl.innerText = `${formatNumber(inv.totals.costoBs || 0, 2)} Bs`;
    } catch (e) { /* ignore */ }
}

async function loadTopProductos() {
    try {
        const periodoQs = getPeriodoQueryString();
        const url = periodoQs
            ? `/api/reportes/top-productos?limit=${encodeURIComponent(TOP_LIMIT)}&${periodoQs}`
            : `/api/reportes/top-productos?limit=${encodeURIComponent(TOP_LIMIT)}`;
        cacheTop = await apiFetchJson(url);
        renderTopProductos();
    } catch (err) {
        console.warn('No se pudo cargar top productos', err);
    }
}

function initPeriodoSelectors() {
    const container = document.getElementById('dash-period-container');
    if (!container) return;

    const ahora = new Date();
    const currentYear = ahora.getFullYear();
    const currentMonth = ahora.getMonth() + 1;
    // Siempre iniciar en el mes y año actuales al recargar el dashboard
    const storedMes = currentMonth;
    const storedAno = currentYear;

    // Construir selects sólo una vez
    if (!container.dataset.built) {
        const selMes = document.createElement('select');
        selMes.id = 'dash-mes';
        selMes.className = 'px-2 py-1 rounded text-[11px] bg-slate-800/80 border border-slate-500/70 focus:outline-none focus:ring-1 focus:ring-blue-400';

        const selAno = document.createElement('select');
        selAno.id = 'dash-ano';
        selAno.className = 'px-2 py-1 rounded text-[11px] bg-slate-800/80 border border-slate-500/70 focus:outline-none focus:ring-1 focus:ring-blue-400';

        const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        nombres.forEach((n, idx) => {
            const opt = document.createElement('option');
            opt.value = String(idx + 1);
            opt.textContent = n;
            selMes.appendChild(opt);
        });

        for (let y = 2026; y <= currentYear; y += 1) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            selAno.appendChild(opt);
        }

        container.appendChild(selMes);
        container.appendChild(selAno);
        container.classList.remove('hidden');
        container.dataset.built = '1';
    }

    const selMes = document.getElementById('dash-mes');
    const selAno = document.getElementById('dash-ano');
    if (!selMes || !selAno) return;

    FILTRO_MES = Math.min(Math.max(storedMes, 1), 12);
    FILTRO_ANO = Math.max(storedAno, 2026);
    selMes.value = String(FILTRO_MES);
    selAno.value = String(FILTRO_ANO);

    const updateMesOptions = () => {
        const selectedYear = parseInt(selAno.value, 10) || currentYear;
        const isCurrentYear = selectedYear === currentYear;
        const maxMes = isCurrentYear ? currentMonth : 12;
        Array.from(selMes.options).forEach((opt) => {
            const m = parseInt(opt.value, 10);
            const disable = Number.isFinite(m) && m > maxMes;
            opt.disabled = disable;
            opt.hidden = disable;
        });
        const currentSel = parseInt(selMes.value, 10) || 1;
        if (currentSel > maxMes) {
            selMes.value = String(maxMes);
            FILTRO_MES = maxMes;
        }
    };

    updateMesOptions();

    const onChange = () => {
        FILTRO_MES = parseInt(selMes.value, 10) || currentMonth;
        FILTRO_ANO = parseInt(selAno.value, 10) || currentYear;
        updateMesOptions();
        aplicarFiltroPeriodo();
    };

    if (!selMes.dataset.bound) {
        selMes.addEventListener('change', onChange);
        selMes.dataset.bound = '1';
    }
    if (!selAno.dataset.bound) {
        selAno.addEventListener('change', onChange);
        selAno.dataset.bound = '1';
    }
}

async function aplicarFiltroPeriodo() {
    // Top productos y top clientes se filtran por mes/año
    await loadTopProductos();
    await renderTopClientes();

    // Ranking de vendedores: sincronizar inputs desde/hasta y recargar
    const { desde, hasta } = getPeriodoRango();
    const vendDesde = document.getElementById('vend-desde');
    const vendHasta = document.getElementById('vend-hasta');
    if (vendDesde && desde) vendDesde.value = desde;
    if (vendHasta && hasta) vendHasta.value = hasta;
    await cargarVendedores();

    // Actualizar también inventario, gráfico diario y margen según el nuevo periodo
    await loadInventarioDashboard();
    await renderVentasSeries('diarias');
    await renderMargenActual();

    // Actualizar KPIs (TOTAL USD) para el nuevo periodo
    await loadKpis();

    // Tendencias mensuales siguen siendo globales (últimos 12 meses)
}

async function cargarDashboard() {
    try {
        // Los selects de periodo se inicializan también en DOMContentLoaded,
        // pero llamamos aquí por si el header ya está listo.
        initPeriodoSelectors();
        const topSel = document.getElementById('top-limit');
        if (topSel) {
            if (![...topSel.options].some(o => o.value === String(TOP_LIMIT))) {
                TOP_LIMIT = 10;
                localStorage.setItem('top_limit', String(TOP_LIMIT));
            }
            topSel.value = String(TOP_LIMIT);
            if (!topSel.dataset.bound) {
                topSel.addEventListener('change', async (e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v) && v > 0) {
                        TOP_LIMIT = v;
                        try { localStorage.setItem('top_limit', String(TOP_LIMIT)); } catch {}
                        await loadTopProductos();
                    }
                });
                topSel.dataset.bound = '1';
            }
        }

        try {
            const tasaJ = await apiFetchJson('/admin/ajustes/tasa-bcv');
            const { tasa_bcv, actualizado_en } = tasaJ || {};
            TASA_BCV = Number(tasa_bcv || 1) || 1;
            TASA_BCV_UPDATED = actualizado_en || null;
            const el = document.getElementById('kpi-tasa'); if (el) el.innerText = formatNumber(TASA_BCV, 2);
            const alertEl = document.getElementById('tasa-alert');
            if (alertEl) {
                const diffHrs = TASA_BCV_UPDATED ? (Date.now() - new Date(TASA_BCV_UPDATED).getTime()) / 36e5 : null;
                const show = diffHrs !== null && diffHrs > 8;
                alertEl.classList.toggle('hidden', !show);
                if (show) alertEl.textContent = `Tasa sin actualizar hace ${diffHrs.toFixed(1)}h`;
            }
        } catch (e) { /* ignore */ }

        await loadKpis();

        try {
            const ventas = await apiFetchJson('/api/reportes/ventas');
            const ultimas = ventas.slice(0, 3);
            const ultEl = document.getElementById('ultimas-ventas');
            ultEl.innerHTML = '';
            ultimas.forEach((u) => {
                const d = document.createElement('div');
                d.className = 'p-2 border rounded flex items-center justify-between';
                const left = `<div class="min-w-0"><div class="font-bold truncate">${u.cliente || '—'}</div><div class="text-[10px] text-slate-400">${new Date(u.fecha).toLocaleString()}</div></div>`;
                const montoBs = u.total_bs != null ? `${formatNumber(u.total_bs, 2)} Bs` : '-- Bs';
                const montoUsd = u.tasa_bcv != null && u.tasa_bcv !== 0 ? `${formatNumber(u.total_bs / u.tasa_bcv, 2)} USD` : '-- USD';
                const right = `<div class="text-right ml-4 w-36"><div class="text-sm font-black">${montoBs}</div><div class="text-xs text-slate-400">${montoUsd}</div></div>`;
                d.innerHTML = left + right;
                ultEl.appendChild(d);
            });
        } catch (e) { /* ignore */ }
            await loadInventarioDashboard();

        await loadTopProductos();
        await renderVentasSeries('diarias');
        await renderTopClientes();
        await renderMargenActual();

        await Promise.all([
            loadTendencias()
        ]);

        await renderAlertasTareas();
    } catch (err) {
        console.error('Error cargando dashboard', err);
    }
}

async function loadKpis() {
    try {
        const { desde, hasta } = getPeriodoRango();
        const params = new URLSearchParams();
        if (desde) params.set('desde', desde);
        if (hasta) params.set('hasta', hasta);
        const qs = params.toString();
        const url = qs ? `/api/reportes/kpis?${qs}` : '/api/reportes/kpis';
        const kpis = await apiFetchJson(url);

        const ventasHoyEl = document.getElementById('ventas-hoy');
        const ventasSemanaEl = document.getElementById('ventas-semana');
        if (ventasHoyEl) ventasHoyEl.innerText = kpis.ventasHoy;
        if (ventasSemanaEl) ventasSemanaEl.innerText = kpis.ventasSemana;

        KPI_TOTAL_USD = Number(kpis.totalUsd || 0);
        const displayUsd = KPI_TOTAL_USD;
        const displayBs = KPI_TOTAL_USD * TASA_BCV;
        const principal = MONEDA === 'USD' ? `${formatNumber(displayUsd, 2)} USD` : `${formatNumber(displayBs, 2)} Bs`;
        const secundario = MONEDA === 'USD' ? `${formatNumber(displayBs, 2)} Bs` : `${formatNumber(displayUsd, 2)} USD`;
        const totalBsEl = document.getElementById('total-bs');
        const totalUsdEl = document.getElementById('total-usd');
        if (totalBsEl) totalBsEl.innerText = principal;
        if (totalUsdEl) totalUsdEl.innerText = secundario;
    } catch (e) { /* ignore */ }
}

const btnGuardarTasa = document.getElementById('btn-guardar-tasa');
if (btnGuardarTasa) {
    btnGuardarTasa.addEventListener('click', async () => {
        try {
            // 1) Intentar actualizar automáticamente desde la fuente pública
            let tasaFinal = null;
            try {
                const j = await apiFetchJson('/admin/ajustes/tasa-bcv/actualizar', { method: 'POST' });
                const tasaAuto = Number(j.tasa_bcv || 0);
                if (!Number.isNaN(tasaAuto) && tasaAuto > 0 && j.ok !== false) {
                            tasaFinal = tasaAuto;
                }
            } catch (e) {
                // Si falla la actualización automática, continuamos con el valor manual
            }

            // 2) Si no hubo tasa automática válida, usar el valor manual del input
            if (tasaFinal === null) {
                const val = parseFloat(document.getElementById('input-tasa').value);
                if (!val || Number.isNaN(val) || val <= 0) return;
                tasaFinal = val;
            }

            // 3) Guardar la tasa elegida en la configuración
            await apiFetchJson('/admin/ajustes/tasa-bcv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tasa_bcv: tasaFinal })
            });

            TASA_BCV = tasaFinal;
            TASA_BCV_UPDATED = new Date().toISOString();
            const kpiEl = document.getElementById('kpi-tasa');
            if (kpiEl) kpiEl.innerText = formatNumber(tasaFinal, 2);
            try {
                localStorage.setItem('tasa_bcv', String(tasaFinal));
                localStorage.setItem('tasa_bcv_updated', String(TASA_BCV_UPDATED));
            } catch (err) {
                console.warn('No se pudo escribir en localStorage', err);
            }
            await cargarDashboard();
        } catch (err) {
            console.error('No se pudo guardar/actualizar tasa BCV', err);
        }
    });
}

// Botón de guardar stock eliminado junto con el panel duplicado

async function cargarVendedores() {
    const desde = document.getElementById('vend-desde').value;
    const hasta = document.getElementById('vend-hasta').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    try {
        const baseRows = await apiFetchJson(`/api/reportes/vendedores?${params.toString()}`);
        const roiRows = await apiFetchJson(`/api/reportes/vendedores/roi?${params.toString()}`);
    const roiMap = new Map(roiRows.map(r => [r.vendedor || '—', r]));
    cacheVend = baseRows.map(row => {
        const extra = roiMap.get(row.vendedor || '—') || {};
        return { ...row, roi: extra.roi, ingresos_usd: extra.ingresos_usd };
    });
    const tb = document.getElementById('tabla-vendedores');
    tb.innerHTML = '';
    cacheVend.forEach((v) => {
        const total = MONEDA === 'USD' ? v.total_usd : v.total_bs;
        const margen = MONEDA === 'USD' ? v.margen_usd : v.margen_bs;
        const roi = v.roi != null ? `${(v.roi * 100).toFixed(1)}%` : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="p-2">${v.vendedor}</td><td class="p-2 text-right">${v.ventas}</td><td class="p-2 text-right">${formatNumber(total || 0, 2)}</td><td class="p-2 text-right">${formatNumber(margen || 0, 2)}</td><td class="p-2 text-right ${v.roi != null && v.roi >= 0 ? 'text-emerald-700' : 'text-amber-700'}">${roi}</td>`;
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
  } catch (err) {
    console.warn('No se pudo cargar vendedores', err);
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
// refrescar alertas periódicamente
setInterval(() => { renderAlertasTareas().catch(()=>{}); }, 60000);

// Asegurar que los filtros de periodo se construyan después de que
// layout-shell haya inyectado el header en DOMContentLoaded.
document.addEventListener('DOMContentLoaded', () => {
    initPeriodoSelectors();
});

// ===== Nuevas funciones de gráficos =====

async function renderVentasSeries(tipo) {
    try {
        const endpoint = tipo === 'mensuales' ? '/api/reportes/series/ventas-mensuales?meses=12' : '/api/reportes/series/ventas-diarias?dias=365';
        const rows = await apiFetchJson(endpoint);
        let filtered = rows;
        // El filtro de mes/año solo aplica a la vista DIARIA.
        // La vista MENSUAL muestra los últimos 12 meses completos como antes.
        if (tipo === 'diarias' && FILTRO_MES && FILTRO_ANO) {
            filtered = rows.filter(x => {
                const parts = String(x.dia || '').split('-');
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (!Number.isFinite(y) || !Number.isFinite(m)) return false;
                return y === FILTRO_ANO && m === FILTRO_MES;
            });
        }

        const labels = filtered.map(x => (tipo === 'mensuales' ? x.mes : x.dia));
        const total = filtered.map(x => Number((MONEDA === 'USD' ? x.total_usd : x.total_bs) || 0));
        const margen = filtered.map(x => Number((MONEDA === 'USD' ? x.margen_usd : x.margen_bs) || 0));
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
        const periodoQs = getPeriodoQueryString();
        const url = periodoQs
            ? `/api/reportes/top-clientes?limit=5&${periodoQs}`
            : '/api/reportes/top-clientes?limit=5';
        const rows = await apiFetchJson(url);
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
        const j = await apiFetchJson('/api/reportes/margen/actual');
        const hoy = MONEDA === 'USD' ? j.hoy.margen_usd : j.hoy.margen_bs;
        document.getElementById('margen-hoy').innerText = `${formatNumber(hoy || 0, 2)} ${MONEDA}`;

        // Calcular margen del mes según filtro usando series diarias
        const rows = await apiFetchJson('/api/reportes/series/ventas-diarias?dias=365');
        let filtered = rows;
        if (FILTRO_MES && FILTRO_ANO) {
            filtered = rows.filter(x => {
                const parts = String(x.dia || '').split('-');
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (!Number.isFinite(y) || !Number.isFinite(m)) return false;
                return y === FILTRO_ANO && m === FILTRO_MES;
            });
        }
        const mesTotal = filtered.reduce((acc, x) => acc + Number((MONEDA === 'USD' ? x.margen_usd : x.margen_bs) || 0), 0);
        document.getElementById('margen-mes').innerText = `${formatNumber(mesTotal || 0, 2)} ${MONEDA}`;

        // Sparkline con últimos días (filtrados por mes si aplica)
        const labels = filtered.map(x => x.dia);
        const data = filtered.map(x => Number((MONEDA === 'USD' ? x.margen_usd : x.margen_bs) || 0));
        const ctx = document.getElementById('chart-margen');
        if (!ctx) return;
        const cfg = {
            type: 'line', data: { labels, datasets: [{ label: `Margen (${MONEDA})`, data, borderColor: 'rgba(244,63,94,1)', backgroundColor: 'rgba(244,63,94,0.15)', tension: 0.3 }] },
            options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        };
        charts.margen?.destroy();
        charts.margen = new Chart(ctx, cfg);

        // Margen de hoy por vendedor
        await renderMargenVendedoresHoy();
    } catch (err) {
        console.error('No se pudo renderizar margen actual', err);
    }
}

async function renderMargenVendedoresHoy() {
    try {
        const hoy = new Date().toISOString().slice(0,10);
        const rows = await apiFetchJson(`/api/reportes/vendedores?desde=${hoy}&hasta=${hoy}`);
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
                        return `<div class="flex justify-between border-b pb-1"><span>${v.vendedor || '—'}</span><span class="font-semibold">${formatNumber(margen)} ${MONEDA} <span class="text-xs text-slate-400">(ventas ${formatNumber(total)})</span></span></div>`;
                    })
          .join('');
    } catch (err) {
        console.error('No se pudo renderizar margen por vendedor', err);
    }
}

function fmtMoney(v) { return formatNumber(v); }
function fmtPct(p) { return p == null ? '—' : `${(p * 100).toFixed(1)}%`; }

async function loadTendencias() {
    try {
        const rows = await apiFetchJson('/api/reportes/tendencias/mensuales?meses=12');
        const el = document.getElementById('tendencias-list');
        if (!el) return;
        const recent = rows.slice(-6);
        if (!recent.length) { el.innerHTML = '<div class="text-slate-400">Sin datos</div>'; return; }
        el.innerHTML = recent.map(row => {
            const delta = row.delta_margen_usd || {}; const pct = delta.pct;
            const cls = pct == null ? 'text-slate-500' : pct >= 0 ? 'text-emerald-700' : 'text-rose-700';
            const arrow = pct == null ? '' : (pct >= 0 ? '▲' : '▼');
            return `<div class="p-2 border rounded flex items-center justify-between">
                <div><div class="font-semibold">${row.mes}</div><div class="text-[10px] text-slate-400">Ventas $${fmtMoney(row.total_usd)} • Margen $${fmtMoney(row.margen_usd)}</div></div>
                <div class="text-[11px] ${cls}">${arrow} ${fmtPct(pct)}</div>
            </div>`;
        }).join('');
    } catch (err) {
        console.warn('No se pudo cargar tendencias', err);
    }
}

// Botones de periodo ventas
document.getElementById('ventas-diarias-btn')?.addEventListener('click', () => renderVentasSeries('diarias'));
document.getElementById('ventas-mensuales-btn')?.addEventListener('click', () => renderVentasSeries('mensuales'));

// ===== Alertas / Tareas =====
async function renderAlertasTareas() {
    try {
        // Usar umbral configurable para stock bajo
        const umbralActual = Number.isFinite(STOCK_UMBRAL) && STOCK_UMBRAL >= 0 ? STOCK_UMBRAL : 1;
        const j = await apiFetchJson(`/api/alertas/tareas?umbral=${encodeURIComponent(umbralActual)}`);

        const stock = Array.isArray(j.stock_bajo) ? j.stock_bajo : [];
        const morosos = Array.isArray(j.morosos) ? j.morosos : [];
        const incompletos = j.incompletos || {};

        const stockCountEl = document.getElementById('al-stock-count');
        const morososCountEl = document.getElementById('al-morosos-count');
        if (stockCountEl) stockCountEl.textContent = String(stock.length);
        if (morososCountEl) morososCountEl.textContent = String(morosos.length);

        // Sincronizar UI de umbral (input + botón)
        const umbralInput = document.getElementById('al-stock-umbral');
        const umbralGuardar = document.getElementById('al-umbral-guardar');
        if (umbralInput) umbralInput.value = String(umbralActual);
        if (umbralInput && !umbralInput.dataset.bound) {
            umbralInput.addEventListener('input', () => {
                const val = parseInt(umbralInput.value, 10);
                if (!Number.isNaN(val) && val >= 0) {
                    STOCK_UMBRAL = val;
                    try { localStorage.setItem('stock_umbral', String(STOCK_UMBRAL)); } catch {}
                    if (AL_UMBRAL_TIMER) clearTimeout(AL_UMBRAL_TIMER);
                    AL_UMBRAL_TIMER = setTimeout(() => { renderAlertasTareas(); }, 300);
                }
            });
            umbralInput.dataset.bound = '1';
        }
        if (umbralGuardar && !umbralGuardar.dataset.bound) {
            umbralGuardar.addEventListener('click', async () => {
                const val = parseInt((document.getElementById('al-stock-umbral')?.value || '1'), 10);
                if (!Number.isNaN(val) && val >= 0) {
                    STOCK_UMBRAL = val;
                    try { localStorage.setItem('stock_umbral', String(STOCK_UMBRAL)); } catch {}
                    await renderAlertasTareas();
                }
            });
            umbralGuardar.dataset.bound = '1';
        }

        // Lista combinada de pendientes (stock y morosos)
        const pendEl = document.getElementById('al-pend-list');
        if (pendEl) {
            const rowsStock = stock.map(s => ({
                tipo: 'STOCK',
                html: `<div class=\"py-1 border-b\"><div class=\"flex items-center justify-between\"><div><span class=\"text-[10px] px-1 mr-2 rounded bg-amber-100 text-amber-700\">STOCK</span><span class=\"font-semibold\">${s.codigo}</span></div><span class=\"text-slate-500\">${s.stock}</span></div><div class=\"text-xs text-slate-500 truncate\">${(s.descripcion || '').toString().toUpperCase()}</div></div>`
            }));
            const rowsMor = morosos.map(m => ({
                tipo: 'MOROSO',
                html: `<div class=\"py-1 border-b\"><div class=\"flex items-center justify-between\"><div><span class=\"text-[10px] px-1 mr-2 rounded bg-rose-100 text-rose-700\">MOROSO</span><span class=\"font-semibold\">${m.cliente_nombre || 'Cliente'}</span></div><span class=\"text-slate-500\">vence ${m.fecha_vencimiento}</span></div><div class=\"text-xs text-slate-500 truncate\">Saldo: $${formatNumber(m.saldo_usd || 0, 2)} (${m.estado_calc || m.estado || ''})</div></div>`
            }));
            const incTotal = Number(incompletos.total_incompletos || 0);
            const incParts = [];
            const incSinCosto = Number(incompletos.sin_costo || 0);
            const incSinCategoria = Number(incompletos.sin_categoria || 0);
            const incSinDeposito = Number(incompletos.sin_deposito || 0);
            const incSinStockDef = Number(incompletos.sin_stock_definido || 0);
            const incSinMarca = Number(incompletos.sin_marca || 0);
            const incSinPrecio = Number(incompletos.sin_precio || 0);
            if (incSinCosto > 0) incParts.push(`Sin costo: ${incSinCosto}`);
            if (incSinCategoria > 0) incParts.push(`Sin categoría: ${incSinCategoria}`);
            if (incSinDeposito > 0) incParts.push(`Sin depósito: ${incSinDeposito}`);
            if (incSinStockDef > 0) incParts.push(`Sin stock definido: ${incSinStockDef}`);
            if (incSinMarca > 0) incParts.push(`Sin marca: ${incSinMarca}`);
            if (incSinPrecio > 0) incParts.push(`Sin precio: ${incSinPrecio}`);

            const incResumen = incParts.join(' · ');

            const rowsInc = incTotal > 0 && incResumen
                ? [
                    {
                        tipo: 'DATOS',
                        html: `<div id=\"al-datos-incompletos\" class=\"py-1 border-b cursor-pointer hover:bg-slate-50\"><div class=\"flex items-center justify-between\"><div><span class=\"text-[10px] px-1 mr-2 rounded bg-sky-100 text-sky-700\">DATOS</span><span class=\"font-semibold\">Productos con datos incompletos</span></div><span class=\"text-slate-500\">${incTotal}</span></div><div class=\"text-xs text-slate-500 truncate\">${incResumen}</div></div>`
                    }
                ]
                : [];

            const combined = [...rowsInc, ...rowsStock, ...rowsMor];
            pendEl.innerHTML = combined.length
                ? combined.slice(0, 14).map(r => r.html).join('')
                : '<div class="text-slate-400">Sin elementos</div>';

            const datosRow = document.getElementById('al-datos-incompletos');
            if (datosRow && !datosRow.dataset.bound) {
                datosRow.dataset.bound = '1';
                datosRow.addEventListener('click', () => {
                    try {
                        localStorage.setItem('inventario_filtro_incompletos', '1');
                    } catch {}
                    window.location.href = '/pages/inventario.html';
                });
            }
        }
    } catch (err) {
        console.warn('No se pudo cargar alertas/tareas', err);
    }
}

document.getElementById('alertas-refrescar')?.addEventListener('click', () => renderAlertasTareas());

// === Tour guiado del Dashboard ===
if (window.GuidedTour) {
    const steps = [
        {
            selector: '#dash-kpis-ventas',
            title: 'Resúmenes de ventas',
            text: 'Aquí ves las ventas de hoy, de la semana y el total del periodo seleccionado. Es la forma más rápida de saber cómo va el negocio.',
            placement: 'bottom',
        },
        {
            selector: '#dash-kpis-inventario',
            title: 'Valor del inventario',
            text: 'Este bloque muestra el valor del inventario a precio de venta y a costo. Te ayuda a ver cuánto tienes invertido y cuánto podrías recuperar en ventas.',
            placement: 'top',
        },
        {
            selector: '#dash-ventas-chart',
            title: 'Gráfico de ventas y margen',
            text: 'En este gráfico puedes ver la evolución de ventas y margen por día o por mes. Usa los botones "Diarias" y "Mensuales" para cambiar la vista.',
            placement: 'top',
        },
        {
            selector: '#dash-top-productos',
            title: 'Top de productos más vendidos',
            text: 'Aquí se listan los productos que más facturan. Puedes cambiar cuántos mostrar con el selector "Mostrar" (5, 10, 20, etc.).',
            placement: 'top',
        },
        {
            selector: '#dash-top-clientes',
            title: 'Mejores clientes',
            text: 'Este gráfico muestra los clientes con mayor monto de compra en el periodo. Sirve para identificar a tus clientes clave.',
            placement: 'top',
        },
        {
            selector: '#alertas-panel',
            title: 'Alertas y tareas pendientes',
            text: 'En este panel ves productos con stock bajo, clientes morosos y un resumen de productos con datos incompletos. Desde aquí puedes saltar directo a inventario.',
            placement: 'left',
        },
        {
            selector: '#tendencias-list',
            title: 'Tendencias mensuales',
            text: 'Este bloque resume los últimos meses con sus ventas, margen y si van subiendo o bajando respecto al mes anterior.',
            placement: 'left',
        },
        {
            selector: '#dash-ranking-vendedores',
            title: 'Ranking de vendedores',
            text: 'Aquí comparas vendedores por número de ventas, monto y margen. Puedes filtrar por fecha usando las cajas de "desde" y "hasta".',
            placement: 'left',
        },
        {
            selector: '#dash-margen',
            title: 'Margen en tiempo real',
            text: 'En esta sección ves el margen de hoy, del mes y cómo se reparte por vendedor. Se actualiza automáticamente cada cierto tiempo.',
            placement: 'left',
        },
    ];

    const tourId = 'dashboard_v1';
    const startDashTour = (force = false) => {
        window.GuidedTour.start({
            id: tourId,
            steps,
            autoStart: !force,
        });
    };

    const btnDashTour = document.getElementById('btnDashTour');
    if (btnDashTour) {
        btnDashTour.addEventListener('click', () => {
            if (window.GuidedTour.reset && window.GuidedTour.hasSeen && window.GuidedTour.hasSeen(tourId)) {
                window.GuidedTour.reset(tourId);
            }
            startDashTour(true);
        });
    }

    // Lanzar automáticamente solo la primera vez que entra al dashboard
    startDashTour(false);
}
