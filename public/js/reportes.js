// Reporte de ventas independiente
console.log('reportes.js v2.0 cargado - con autenticación');
let MONEDA = 'USD';
let cacheRows = [];

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
        const t = MONEDA === 'USD' ? r.total_usd || 0 : r.total_bs || 0;
        const m = MONEDA === 'USD' ? r.margen_usd || 0 : r.margen_bs || 0;
        total += Number(t);
        margen += Number(m);
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td class="p-2 whitespace-nowrap">${new Date(r.fecha).toLocaleString()}</td>
      <td class="p-2">${r.cliente || ''}</td>
      <td class="p-2">${r.vendedor || ''}</td>
      <td class="p-2">${r.metodo_pago || ''}</td>
      <td class="p-2 text-slate-600 text-xs">${r.referencia || '—'}</td>
      <td class="p-2 text-right font-semibold">${Number(t).toFixed(2)}</td>
      <td class="p-2 text-right text-blue-700 font-semibold">${Number(m).toFixed(2)}</td>
    `;
        tbody.appendChild(tr);
    });
    document.getElementById('rpt-resumen').innerText = `Ventas: ${cacheRows.length} | Total ${MONEDA}: ${total.toFixed(2)} | Margen ${MONEDA}: ${margen.toFixed(2)}`;
    document.getElementById('th-total-moneda').innerText = `Total ${MONEDA}`;
    document.getElementById('th-margen-moneda').innerText = `Margen ${MONEDA}`;
}

async function cargarReporte() {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const vendedor = document.getElementById('rpt-vendedor').value.trim();
    const metodo = document.getElementById('rpt-metodo').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    if (vendedor) params.set('vendedor', vendedor);
    if (metodo) params.set('metodo', metodo);

    const token = localStorage.getItem('auth_token');
    console.log('Cargando reporte con token:', token ? 'presente' : 'ausente');
    console.log('Parámetros:', params.toString());

    const res = await fetch(`/reportes/ventas-rango?${params.toString()}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!res.ok) {
        console.error('Error cargando reporte:', res.status, await res.text());
        alert('Error cargando el reporte. Por favor refresca la página.');
        return;
    }
    cacheRows = await res.json();
    console.log('Ventas cargadas:', cacheRows.length);
    renderReporte();
}

// Eventos
const monedaSel = document.getElementById('moneda-toggle');
monedaSel.addEventListener('change', (e) => {
    MONEDA = e.target.value;
    renderReporte();
});

document.getElementById('rpt-filtrar').addEventListener('click', cargarReporte);

document.getElementById('rpt-export').addEventListener('click', () => {
    const desde = document.getElementById('rpt-desde').value;
    const hasta = document.getElementById('rpt-hasta').value;
    const vendedor = document.getElementById('rpt-vendedor').value.trim();
    const metodo = document.getElementById('rpt-metodo').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    if (vendedor) params.set('vendedor', vendedor);
    if (metodo) params.set('metodo', metodo);
    window.open(`/reportes/ventas/export/csv?${params.toString()}`, '_blank');
});

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
