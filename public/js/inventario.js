import { upsertProductoFirebase, eliminarProductoFirebasePorCodigo } from './firebase-sync.js';

// Código principal de inventario (movido desde inventario.html)
console.log('inventario.html v2.0 - con autenticación');
const lista = document.getElementById('lista');
const q = document.getElementById('q');
const form = document.getElementById('form');
const f_codigo = document.getElementById('f_codigo');
const f_desc = document.getElementById('f_desc');
const f_precio = document.getElementById('f_precio');
const f_costo = document.getElementById('f_costo');
const f_stock = document.getElementById('f_stock');
const f_motivoAjuste = document.getElementById('f_motivo_ajuste');
const f_marca = document.getElementById('f_marca');
const f_deposito = document.getElementById('f_deposito');
const msg = document.getElementById('msg');
const btnBorrar = document.getElementById('btnBorrar');
const pageSize = document.getElementById('pageSize');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pagInfo = document.getElementById('paginacion-info');
const filterDeposito = document.getElementById('filterDeposito');
const btnRebuildStock = document.getElementById('btnRebuildStock');
const rebuildStockMsg = document.getElementById('rebuildStockMsg');
// Movimiento entre depósitos
const movCodigo = document.getElementById('mov_codigo');
const movInfo = document.getElementById('mov_info');
const movCantidad = document.getElementById('mov_cantidad');
const movDepOrigen = document.getElementById('mov_deposito_origen');
const movDepDestino = document.getElementById('mov_deposito_destino');
const movMotivo = document.getElementById('mov_motivo');
const movMsg = document.getElementById('mov_msg');
const movList = document.getElementById('movimientos-list');
const btnMoverDeposito = document.getElementById('btnMoverDeposito');
const movStockDetalle = document.getElementById('mov_stock_detalle');

// Determinar rol de usuario para habilitar o no edición de stock desde inventario
let esEmpresaAdmin = false;
let esSuperAdmin = false;
try {
    const currentUser = JSON.parse(localStorage.getItem('auth_user') || 'null');
    if (currentUser && currentUser.rol) {
        esEmpresaAdmin = currentUser.rol === 'admin' || currentUser.rol === 'admin_empresa';
        esSuperAdmin = currentUser.rol === 'superadmin';
    }
} catch (e) {
    console.warn('No se pudo leer auth_user para roles en inventario:', e);
}
const puedeEditarStockDesdeInventario = esEmpresaAdmin || esSuperAdmin;

// Select dinámico para elegir depósito origen cuando hay stock en varios depósitos
let movDepOrigenSelect = null;

// Modal simple con animación
const modal = document.createElement('div');
modal.id = 'confirmModal';
modal.className = 'fixed inset-0 hidden items-center justify-center z-50';
modal.innerHTML = `
  <div class="absolute inset-0 bg-black bg-opacity-40 modal-backdrop opacity-0"></div>
  <div class="relative bg-white p-4 rounded shadow w-96 modal-panel">
    <div id="modal-text" class="mb-4">¿Confirmar?</div>
    <div class="flex justify-end gap-2">
      <button id="modal-cancel" class="p-2 bg-slate-200 rounded">Cancelar</button>
      <button id="modal-ok" class="p-2 bg-red-600 text-white rounded">Eliminar</button>
    </div>
  </div>
`;
document.body.appendChild(modal);
const modalText = modal.querySelector('#modal-text');
const modalCancel = modal.querySelector('#modal-cancel');
const modalOk = modal.querySelector('#modal-ok');

// Import preview modal
const previewModal = document.createElement('div');
previewModal.id = 'importPreviewModal';
previewModal.className = 'fixed inset-0 hidden items-center justify-center z-50';
previewModal.innerHTML = `
<div class="absolute inset-0 bg-black bg-opacity-40 modal-backdrop opacity-0"></div>
<div class="relative bg-white p-4 rounded shadow w-11/12 max-w-3xl modal-panel">
    <h3 class="font-bold mb-2">Vista previa de importación</h3>
    <div id="importPreviewBody" class="max-h-64 overflow-auto text-sm border rounded p-2 mb-4"></div>
    <div class="flex items-center justify-between mb-4 text-[11px] text-slate-600">
        <span class="font-semibold">Modo de importación</span>
        <select id="importMode" class="border rounded px-2 py-1 text-[11px]">
            <option value="reconteo">Reconteo total (reemplaza stock del depósito principal o indicado)</option>
            <option value="adicional">Ingreso adicional (suma unidades al depósito)</option>
        </select>
    </div>
    <div class="flex justify-end gap-2">
        <button id="importPreviewCancel" class="p-2 bg-slate-200 rounded">Cancelar</button>
        <button id="importPreviewConfirm" class="p-2 bg-indigo-600 text-white rounded">Confirmar importación</button>
    </div>
</div>
`;
document.body.appendChild(previewModal);
const importPreviewBody = previewModal.querySelector('#importPreviewBody');
const importPreviewCancel = previewModal.querySelector('#importPreviewCancel');
const importPreviewConfirm = previewModal.querySelector('#importPreviewConfirm');
const importModeSelect = previewModal.querySelector('#importMode');

let productosCache = [];
let currentPage = 0;
let currentTotal = 0;

// Ocultar campos de stock/depósito/ajuste para usuarios que no son admin
if (!puedeEditarStockDesdeInventario) {
    if (f_stock) {
        const lblStock = f_stock.previousElementSibling;
        if (lblStock && lblStock.tagName === 'LABEL') lblStock.classList.add('hidden');
        f_stock.classList.add('hidden');
    }
    if (f_motivoAjuste) {
        const lblMotivo = f_motivoAjuste.previousElementSibling;
        if (lblMotivo && lblMotivo.tagName === 'LABEL') lblMotivo.classList.add('hidden');
        f_motivoAjuste.classList.add('hidden');
    }
    if (f_deposito) {
        const lblDep = f_deposito.previousElementSibling;
        if (lblDep && lblDep.tagName === 'LABEL') lblDep.classList.add('hidden');
        f_deposito.classList.add('hidden');
    }
}

async function cargarProductos() {
    lista.innerHTML = 'Cargando...';
    try {
        const limit = parseInt(pageSize.value);
        const offset = currentPage * limit;
        // aplicar filtros
        const categoriaVal = document.getElementById('filterCategoria') ? document.getElementById('filterCategoria').value.trim() : '';
        const stockFilter = document.getElementById('filterStock') ? document.getElementById('filterStock').value : 'all';
        const depositoFilterVal = filterDeposito ? filterDeposito.value : '';
        const params = new URLSearchParams();
        params.set('limit', limit);
        params.set('offset', offset);
        if (categoriaVal) params.set('categoria', categoriaVal);
        const qv = document.getElementById('q') ? document.getElementById('q').value.trim() : '';
        if (qv) params.set('q', qv);
        if (stockFilter === 'out') params.set('stock_lt', '1');
        if (stockFilter === 'low') params.set('stock_lt', '5');
        if (stockFilter === 'medium') params.set('stock_lt', '20');
        if (stockFilter === 'over') params.set('stock_gt', '100');
        if (depositoFilterVal) params.set('deposito_id', depositoFilterVal);
        try {
            const flagIncompletos = localStorage.getItem('inventario_filtro_incompletos');
            if (flagIncompletos === '1') {
                params.set('incompletos', '1');
            }
        } catch {}
        const res = await fetch(`/admin/productos?${params.toString()}`, {
            credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('Error listando');
        const data = await res.json();
        productosCache = data.items || [];
        currentTotal = data.total || 0;
        renderList(productosCache);
        updatePaginationInfo();
    } catch (err) {
        lista.innerHTML = '<div class="text-red-500">Error cargando productos</div>';
        console.error(err);
    }
}

// cargar historial de ajustes
async function cargarAjustes() {
    const el = document.getElementById('ajustes-list');
    try {
        const res = await fetch('/admin/ajustes?limit=50', {
            credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('Error ajustes');
        const rows = await res.json();
        el.innerHTML = '';
        rows.forEach(r => {
            const d = document.createElement('div');
            d.className = 'p-2 border-b';
            d.innerHTML = `<div class="font-bold">${r.codigo || '—'} <span class="text-xs text-slate-400">(${r.diferencia > 0 ? '+' : ''}${r.diferencia})</span></div><div class="text-xs text-slate-400">${r.motivo} — ${new Date(r.fecha).toLocaleString()}</div>`;
            el.appendChild(d);
        });
    } catch (err) {
        el.innerHTML = '<div class="text-xs text-red-500">Error cargando ajustes</div>';
        console.error(err);
    }
}

// Historial de movimientos entre depósitos
async function cargarMovimientosDeposito() {
    if (!movList) return;
    try {
        const res = await fetch('/depositos/movimientos?limit=20', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Error movimientos');
        const rows = await res.json();
        if (!rows.length) {
            movList.innerHTML = '<div class="p-2 text-slate-400">Sin movimientos registrados.</div>';
            return;
        }
        movList.innerHTML = rows.map(r => {
            const fecha = r.creado_en ? new Date(r.creado_en).toLocaleString() : '';
            const prod = `${r.producto_codigo || ''} — ${r.producto_descripcion || ''}`;
            const origen = r.deposito_origen_nombre || '—';
            const destino = r.deposito_destino_nombre || '—';
            const motivo = r.motivo || '';
            const cantidad = r.cantidad != null ? r.cantidad : '';
            return `
                <div class="px-3 py-2 border-b last:border-b-0 bg-white odd:bg-slate-50">
                    <div class="flex justify-between items-center">
                        <div class="font-semibold text-slate-700">${prod}</div>
                        <div class="text-[10px] text-slate-400">${fecha}</div>
                    </div>
                    <div class="text-[11px] text-slate-500">${origen} → ${destino}${cantidad !== '' ? ` • Cant: ${cantidad}` : ''}${motivo ? ` • ${motivo}` : ''}</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error(err);
        movList.innerHTML = '<div class="p-2 text-rose-500">Error cargando movimientos</div>';
    }
}

function updatePaginationInfo() {
    const limit = parseInt(pageSize.value);
    const start = currentPage * limit + 1;
    const end = Math.min((currentPage + 1) * limit, currentTotal);
    pagInfo.innerText = `${start}-${end} de ${currentTotal}`;
    prevPage.disabled = currentPage === 0;
    nextPage.disabled = end >= currentTotal;
}

function renderList(items) {
    const qv = q.value.trim().toLowerCase();
    const filtered = items.filter(p => {
        const codigo = (p.codigo || '').toLowerCase();
        const desc = (p.descripcion || '').toLowerCase();
        const marca = (p.marca || '').toLowerCase();
        return !qv || codigo.includes(qv) || desc.includes(qv) || marca.includes(qv);
    });
    // Asegurar orden alfabético estable por categoría y luego código
    filtered.sort((a, b) => {
        const catA = (a.categoria || '').toString().toLowerCase();
        const catB = (b.categoria || '').toString().toLowerCase();
        if (catA < catB) return -1;
        if (catA > catB) return 1;
        const ca = (a.codigo || '').toString().toLowerCase();
        const cb = (b.codigo || '').toString().toLowerCase();
        if (ca < cb) return -1;
        if (ca > cb) return 1;
        return 0;
    });
    if (filtered.length === 0) {
        lista.innerHTML = '<div class="text-sm text-slate-400">Sin resultados</div>';
        return;
    }
    lista.innerHTML = '';
    filtered.forEach(p => {
        const precio = Number(p.precio_usd || 0);
        const costo = Number(p.costo_usd || 0);
        const margenVal = precio - costo;
        const margenPct = precio ? (margenVal / precio) * 100 : null;
        const margenCls = margenVal >= 0 ? 'text-emerald-700' : 'text-rose-700';
        const el = document.createElement('div');
        el.className = 'p-3 border rounded flex justify-between items-start gap-3 hover:bg-slate-50 cursor-pointer';
        const depositoDetalle = p.stock_detalle || '';
        const totalStock = Number(p.stock || 0);
        let depositoLabel = '';
        if (totalStock <= 0) {
            depositoLabel = 'No hay stock del producto';
        } else if (depositoDetalle) {
            depositoLabel = `Depósito: ${depositoDetalle}`;
        } else if (p.deposito_nombre) {
            depositoLabel = `Depósito: ${p.deposito_nombre}`;
        }
        // Badges visuales según nivel de stock
        let badgeHtml = '';
        if (Number.isFinite(totalStock)) {
            if (totalStock <= 0) {
                badgeHtml = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700 ml-2">Sin stock</span>';
            } else if (totalStock > 0 && totalStock < 5) {
                badgeHtml = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 ml-2">Stock bajo</span>';
            } else if (totalStock > 100) {
                badgeHtml = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700 ml-2">Sobre stock</span>';
            }
        }
        el.innerHTML = `<div><div class="font-bold">${p.codigo} <span class="text-xs text-slate-400">${p.categoria || ''}</span></div><div class="text-xs text-slate-400">${p.descripcion || ''}</div>${p.marca ? `<div class="text-xs text-slate-500">Marca: ${p.marca}</div>` : ''}${depositoLabel ? `<div class="text-xs text-slate-400">${depositoLabel}</div>` : ''}</div>
            <div class="text-right space-y-1 min-w-[190px]">
                <div class="text-sm font-black">Stock: ${p.stock || 0}${badgeHtml}</div>
                <div class="text-xs text-slate-600">Precio $${precio.toFixed(2)} • Costo $${costo.toFixed(2)}</div>
                <div class="text-xs ${margenCls}">Margen $${margenVal.toFixed(2)}${margenPct !== null ? ` (${margenPct.toFixed(1)}%)` : ''}</div>
            </div>`;

        el.addEventListener('click', () => {
            // Click en la tarjeta → cargar datos en el formulario
            f_codigo.value = p.codigo;
            f_desc.value = p.descripcion || '';
            f_precio.value = p.precio_usd || 0;
            f_costo.value = p.costo_usd || 0;
            f_stock.value = p.stock || 0;
            const f_cat = document.getElementById('f_categoria'); if (f_cat) f_cat.value = p.categoria || '';
            if (f_marca) f_marca.value = p.marca || '';
            if (f_deposito) f_deposito.value = p.deposito_id || '';
            msg.innerText = '';

            // Autocompletar sección de movimientos entre depósitos
            if (movCodigo) {
                movCodigo.value = p.codigo;
                cargarProductoParaMovimiento();
            }

            // Cargar historial de ajustes filtrado por código
            (async () => {
                const elHist = document.getElementById('ajustes-list');
                if (!elHist) return;
                elHist.innerHTML = 'Cargando ajustes...';
                try {
                    const res = await fetch('/admin/ajustes?limit=50&codigo=' + encodeURIComponent(p.codigo), { credentials: 'same-origin' });
                    if (!res.ok) throw new Error('Error ajustes');
                    const rows = await res.json();
                    if (!rows.length) {
                        elHist.innerHTML = '<div class="text-xs text-slate-400">Sin ajustes para este producto.</div>';
                    } else {
                        elHist.innerHTML = '';
                        rows.forEach(r => {
                            const d = document.createElement('div');
                            d.className = 'p-2 border-b last:border-b-0';
                            d.innerHTML = `<div class="font-bold text-xs">${r.codigo || p.codigo} <span class="text-slate-400">(${r.diferencia > 0 ? '+' : ''}${r.diferencia})</span></div><div class="text-[10px] text-slate-500">${r.motivo || ''} — ${new Date(r.fecha).toLocaleString()}</div>`;
                            elHist.appendChild(d);
                        });
                    }
                } catch (err) {
                    console.error(err);
                    elHist.innerHTML = '<div class="text-xs text-rose-500">Error cargando ajustes para este producto.</div>';
                }
            })();

            // Cargar historial de movimientos filtrado por código
            (async () => {
                if (!movList) return;
                movList.innerHTML = '<div class="p-2 text-slate-400">Cargando movimientos...</div>';
                try {
                    const res = await fetch('/depositos/movimientos?limit=20&codigo=' + encodeURIComponent(p.codigo), { credentials: 'same-origin' });
                    if (!res.ok) throw new Error('Error movimientos');
                    const rows = await res.json();
                    if (!rows.length) {
                        movList.innerHTML = '<div class="p-2 text-slate-400">Sin movimientos para este producto.</div>';
                    } else {
                        movList.innerHTML = rows.map(r => {
                            const fecha = r.creado_en ? new Date(r.creado_en).toLocaleString() : '';
                            const prod = `${r.producto_codigo || ''} — ${r.producto_descripcion || ''}`;
                            const origen = r.deposito_origen_nombre || '—';
                            const destino = r.deposito_destino_nombre || '—';
                            const motivo = r.motivo || '';
                            const cantidad = r.cantidad != null ? r.cantidad : '';
                            return `
                                <div class="px-3 py-2 border-b last:border-b-0 bg-white odd:bg-slate-50">
                                    <div class="flex justify-between items-center">
                                        <div class="font-semibold text-slate-700 text-xs">${prod}</div>
                                        <div class="text-[10px] text-slate-400">${fecha}</div>
                                    </div>
                                    <div class="text-[11px] text-slate-500">${origen} → ${destino}${cantidad !== '' ? ` • Cant: ${cantidad}` : ''}${motivo ? ` • ${motivo}` : ''}</div>
                                </div>
                            `;
                        }).join('');
                    }
                } catch (err) {
                    console.error(err);
                    movList.innerHTML = '<div class="p-2 text-rose-500">Error cargando movimientos para este producto.</div>';
                }
            })();
        });
        lista.appendChild(el);
    });
}

// Aplicar filtro de datos incompletos cuando se llega desde dashboard
try {
    const flagIncompletos = localStorage.getItem('inventario_filtro_incompletos');
    if (flagIncompletos === '1') {
        localStorage.removeItem('inventario_filtro_incompletos');
        if (window.showToast) {
            window.showToast('Mostrando productos con datos incompletos (sin costo, sin categoría, sin depósito o sin stock definido).', 'info');
        }
    }
} catch {}

q.addEventListener('input', () => renderList(productosCache));
// Filter controls (moved to top)
const topFilterCategoria = document.getElementById('filterCategoria');
const topFilterStock = document.getElementById('filterStock');
if (topFilterCategoria) topFilterCategoria.addEventListener('input', () => { currentPage = 0; cargarProductos(); });
if (topFilterStock) topFilterStock.addEventListener('change', () => { currentPage = 0; cargarProductos(); });
if (filterDeposito) filterDeposito.addEventListener('change', () => { currentPage = 0; cargarProductos(); });

// Import / Export CSV handlers
const csvFile = document.getElementById('csvFile');
const btnImportCsv = document.getElementById('btnImportCsv');
const btnExportCsv = document.getElementById('btnExportCsv');

btnExportCsv.addEventListener('click', async () => {
    try {
        const res = await fetch('/admin/productos/export', {
            credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'productos.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('CSV exportado', 'info');
    } catch (err) {
        console.error(err);
        showToast('Error exportando CSV', 'error');
    }
});

// Helper: detect delimiter by counting in a sample
function detectDelimiter(text) {
    const raw = text.replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).slice(0, 5).join('\n');
    const counts = { '\t': (lines.match(/\t/g) || []).length, ';': (lines.match(/;/g) || []).length, ',': (lines.match(/,/g) || []).length };
    let delim = ';';
    const max = Math.max(counts['\t'], counts[';'], counts[',']);
    if (max === counts['\t']) delim = '\t';
    else if (max === counts[',']) delim = ',';
    return delim;
}

// Client-side parser for preview (supports quotes)
function parseDelimited(text, delim) {
    const rows = [];
    let i = 0, len = text.length;
    let cur = [];
    let field = '';
    let inQuotes = false;
    while (i < len) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < len && text[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            } else { field += ch; i++; continue; }
        } else {
            if (ch === '"') { inQuotes = true; i++; continue; }
            if (ch === delim) { cur.push(field); field = ''; i++; continue; }
            if (ch === '\r') { i++; continue; }
            if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
            field += ch; i++; continue;
        }
    }
    if (field !== '' || inQuotes || cur.length) { cur.push(field); rows.push(cur); }
    return rows.map(r => r.map(c => (c || '').toString()));
}

btnImportCsv.addEventListener('click', async () => {
    const file = csvFile.files && csvFile.files[0];
    if (!file) return showToast('Seleccione un archivo CSV', 'error');
    const text = await file.text();
    try {
        // detect and parse for preview
        const delim = detectDelimiter(text);
        const rows = parseDelimited(text.replace(/^\uFEFF/, ''), delim).filter(r => r.some(c => (c || '').toString().trim() !== ''));
        if (!rows || rows.length === 0) return showToast('Archivo sin filas', 'error');

        // determine if header
        let start = 0;
        const first = rows[0].map(c => (c || '').toString().toLowerCase());
        if (first.some(h => h.includes('codigo')) && first.some(h => h.includes('descripcion'))) start = 1;

        // build HTML preview table (up to 10 rows)
        const previewRows = rows.slice(0, Math.min(10, rows.length));
        let html = '<table class="w-full text-xs table-fixed border-collapse">';
        html += '<thead><tr class="bg-slate-100"><th class="px-2 py-1 border">#</th>';
        const headerCols = ['codigo', 'descripcion', 'precio_usd', 'costo_usd', 'stock', 'categoria', 'marca', 'deposito_codigo'];
        headerCols.forEach(h => { html += `<th class="px-2 py-1 border">${h}</th>`; });
        html += '</tr></thead><tbody>';
        for (let i = 0; i < previewRows.length; i++) {
            const cols = previewRows[i];
            html += `<tr class="odd:bg-white even:bg-slate-50"><td class="px-2 py-1 border">${i + 1}</td>`;
            for (let j = 0; j < headerCols.length; j++) { html += `<td class="px-2 py-1 border">${(cols[j] || '').toString()}</td>`; }
            html += '</tr>';
        }
        html += '</tbody></table>';
        importPreviewBody.innerHTML = html;

        // Restaurar modo de importación guardado por usuario (si existe)
        if (importModeSelect) {
            try {
                const savedMode = localStorage.getItem('inventario_import_mode');
                if (savedMode === 'reconteo' || savedMode === 'adicional') {
                    importModeSelect.value = savedMode;
                }
            } catch {}
        }

        // show modal
        previewModal.classList.remove('hidden');
        requestAnimationFrame(() => { previewModal.classList.add('modal-open'); previewModal.style.display = 'flex'; });

        // confirm handler: send original text to server
        const onConfirm = async () => {
            importPreviewConfirm.disabled = true;
            try {
                const mode = importModeSelect ? importModeSelect.value : '';
                let url = '/admin/productos/import';
                if (mode === 'reconteo' || mode === 'adicional') {
                    try { localStorage.setItem('inventario_import_mode', mode); } catch {}
                    url += `?mode=${encodeURIComponent(mode)}`;
                }

                const res = await fetch(url, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'text/plain'
                    },
                    body: text
                });
                const d = await res.json();
                if (!res.ok) {
                    console.error('Import error response:', d);
                    const errMsg = d.error || d.details || 'Error importando CSV';
                    showToast(errMsg, 'error');
                } else {
                    if (d.counts) {
                        const c = d.counts;
                        const msg = `Filas: ${c.dataRows}, Insertadas: ${c.inserted}, Actualizadas: ${c.updated}, Omitidas: ${c.skipped}, Errores: ${c.errors}`;
                        showToast(msg, 'success', 5000);

                        // Detalle de filas con problemas (errores u omitidas)
                        const rowErrors = Array.isArray(d.items?.rowErrors) ? d.items.rowErrors : [];
                        const skipped = Array.isArray(d.items?.skipped) ? d.items.skipped : [];
                        if (rowErrors.length || skipped.length) {
                            const lines = [];
                            rowErrors.forEach(e => {
                                const codigo = (e.cols && e.cols[0] ? String(e.cols[0]).trim() : '');
                                lines.push(`Error fila ${e.row}${codigo ? ` (codigo=${codigo})` : ''}: ${e.error}`);
                            });
                            skipped.forEach(s => {
                                const codigo = (s.cols && s.cols[0] ? String(s.cols[0]).trim() : '');
                                lines.push(`Omitida fila ${s.row}${codigo ? ` (codigo=${codigo})` : ''}: ${s.reason}`);
                            });
                            // Limitar el tamaño del mensaje mostrado en pantalla
                            const preview = lines.slice(0, 20).join(' \n ');
                            showToast(`Detalle de problemas en importación (máx 20): ${preview}`, 'warning', 8000);
                            console.warn('Detalle completo de problemas en importación CSV:', lines.join('\n'));
                        }
                    } else {
                        showToast(d.message || 'Importado', 'success');
                    }

                    // Sincronizar con Firebase los productos insertados/actualizados
                    try {
                        const codigosInsertados = Array.isArray(d.items?.inserted) ? d.items.inserted : [];
                        const codigosActualizados = Array.isArray(d.items?.updated) ? d.items.updated : [];
                        const codigos = [...codigosInsertados, ...codigosActualizados];

                        for (const codigo of codigos) {
                            try {
                                const prodRes = await fetch('/productos/' + encodeURIComponent(codigo), {
                                    credentials: 'same-origin'
                                });
                                if (!prodRes.ok) continue;
                                const prod = await prodRes.json();
                                await upsertProductoFirebase({
                                    codigo: prod.codigo,
                                    descripcion: prod.descripcion,
                                    precio_usd: prod.precio_usd,
                                    costo_usd: prod.costo_usd,
                                    stock: prod.stock,
                                    categoria: prod.categoria,
                                    marca: prod.marca
                                });
                            } catch (syncErr) {
                                console.error('Error sincronizando producto importado a Firebase', codigo, syncErr);
                            }
                        }
                    } catch (syncListErr) {
                        console.error('Error preparando sincronización a Firebase tras importación', syncListErr);
                    }

                    currentPage = 0;
                    cargarProductos();
                }
            } catch (err) {
                console.error(err);
                showToast('Error importando CSV', 'error');
            }
            importPreviewConfirm.disabled = false;
            // close modal
            previewModal.classList.remove('modal-open');
            setTimeout(() => { previewModal.classList.add('hidden'); previewModal.style.display = ''; }, 220);
            importPreviewConfirm.removeEventListener('click', onConfirm);
        };

        importPreviewConfirm.addEventListener('click', onConfirm);
        importPreviewCancel.onclick = () => { previewModal.classList.remove('modal-open'); setTimeout(() => { previewModal.classList.add('hidden'); previewModal.style.display = ''; }, 220); };

    } catch (err) {
        console.error(err);
        showToast('Error procesando archivo', 'error');
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let body = {
        codigo: f_codigo.value.trim(),
        descripcion: f_desc.value.trim(),
        precio_usd: parseFloat(f_precio.value),
        costo_usd: parseFloat(f_costo.value) || 0,
        stock: parseInt(f_stock.value) || 0,
        categoria: (document.getElementById('f_categoria') && document.getElementById('f_categoria').value.trim()) || '',
        marca: (f_marca && f_marca.value.trim()) || '',
        deposito_id: (f_deposito && f_deposito.value) ? parseInt(f_deposito.value, 10) : null,
    };
    const motivoAjuste = f_motivoAjuste ? f_motivoAjuste.value.trim() : '';
    const exists = productosCache.find(p => p.codigo === body.codigo);
    const oldStock = exists ? Number(exists.stock || 0) : 0;
    // Si el usuario no es admin, no debe poder ajustar stock desde este formulario
    if (!puedeEditarStockDesdeInventario) {
        body = {
            ...body,
            stock: exists ? oldStock : 0,
        };
    }
    const diffStock = body.stock - oldStock;

    // Decide POST (create) or PUT (update) based on existence
    try {
        if (!exists) {
            const res = await fetch('/admin/productos', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Error crear');
            msg.innerText = 'Producto creado.';
        } else {
            // Si se intenta cambiar el stock, exigir motivo de ajuste para admins
            if (puedeEditarStockDesdeInventario && diffStock !== 0 && !motivoAjuste) {
                msg.innerText = 'Para cambiar el stock debes indicar un motivo de ajuste.';
                showToast('Para cambiar el stock debes indicar un motivo de ajuste.', 'error');
                return;
            }

            // Actualizar datos generales del producto (sin tocar stock aquí)
            const res = await fetch('/admin/productos/' + encodeURIComponent(body.codigo), {
                method: 'PUT',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    descripcion: body.descripcion,
                    precio_usd: body.precio_usd,
                    costo_usd: body.costo_usd,
                    categoria: body.categoria,
                    marca: body.marca,
                    deposito_id: body.deposito_id
                })
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Error actualizar');
            msg.innerText = 'Producto actualizado.';

            // Si cambió el stock y hay motivo, registrar ajuste de stock
            if (diffStock !== 0 && motivoAjuste) {
                try {
                    const ajusteRes = await fetch('/admin/ajustes', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            codigo: body.codigo,
                            diferencia: diffStock,
                            motivo: motivoAjuste
                        })
                    });
                    const adjData = await ajusteRes.json();
                    if (!ajusteRes.ok || adjData.error) {
                        throw new Error(adjData.error || 'Error registrando ajuste');
                    }
                } catch (errAdj) {
                    console.error(errAdj);
                    showToast('Error registrando ajuste de stock: ' + (errAdj.message || ''), 'error');
                }
            }
        }

        // Sincronizar producto a Firebase (por empresa)
        try {
            await upsertProductoFirebase(body);
        } catch (syncErr) {
            console.error('No se pudo sincronizar producto a Firebase:', syncErr);
        }
        // reload list at first page (do not overwrite user's top filter)
        currentPage = 0;
        await cargarProductos();
        await cargarAjustes();
        // Limpiar inputs excepto categoria (permite ingresar varios del mismo grupo)
        f_codigo.value = f_desc.value = f_precio.value = f_costo.value = f_stock.value = '';
        if (f_marca) f_marca.value = '';
        if (f_deposito) f_deposito.value = '';
        if (f_motivoAjuste) f_motivoAjuste.value = '';
        msg.innerText = '';
        showToast(!exists ? 'Producto creado.' : 'Producto actualizado.', 'success');
    } catch (err) {
        msg.innerText = 'Error: ' + err.message;
        console.error(err);
    }
});

btnBorrar.addEventListener('click', () => {
    const codigo = f_codigo.value.trim();
    if (!codigo) return msg.innerText = 'Ingrese código para eliminar.';
    modalText.innerText = `¿Eliminar producto ${codigo}? Esta acción no se puede deshacer.`;
    // open modal with animation
    modal.classList.remove('hidden');
    // slight delay to allow CSS transitions
    requestAnimationFrame(() => {
        modal.classList.add('modal-open');
        modal.style.display = 'flex';
    });
    modalOk.onclick = async () => {
        try {
            const res = await fetch('/admin/productos/' + encodeURIComponent(codigo), {
                method: 'DELETE',
                credentials: 'same-origin'
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Error eliminar');
            msg.innerText = 'Producto eliminado.';
            f_codigo.value = f_desc.value = f_precio.value = f_stock.value = '';
            showToast('Producto eliminado.', 'error');
            // Intentar eliminar también en Firebase (best-effort, no bloqueante)
            try {
                await eliminarProductoFirebasePorCodigo(codigo);
            } catch (syncErr) {
                console.warn('No se pudo eliminar producto en Firebase (se ignora):', syncErr);
            }
            // close modal with animation
            modal.classList.remove('modal-open');
            setTimeout(() => { modal.classList.add('hidden'); modal.style.display = ''; }, 220);
            await cargarProductos();
        } catch (err) {
            msg.innerText = 'Error: ' + err.message;
            console.error(err);
        }
    };
    modalCancel.onclick = () => {
        modal.classList.remove('modal-open');
        setTimeout(() => { modal.classList.add('hidden'); modal.style.display = ''; }, 220);
    };
});

prevPage.addEventListener('click', () => { if (currentPage > 0) { currentPage--; cargarProductos(); } });
nextPage.addEventListener('click', () => { const limit = parseInt(pageSize.value); if ((currentPage + 1) * limit < currentTotal) { currentPage++; cargarProductos(); } });
pageSize.addEventListener('change', () => { currentPage = 0; cargarProductos(); });

// Toast container + function
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
document.body.appendChild(toastContainer);
function showToast(text, type = 'info', ms = 3500) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerText = text;
    toastContainer.appendChild(t);
    // show
    requestAnimationFrame(() => t.classList.add('show'));
    const remover = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); };
    setTimeout(remover, ms);
    t.addEventListener('click', remover);
}

// Inicializar
cargarProductos();
cargarAjustes();

// Cargar depósitos para el selector
async function cargarDepositos() {
    if (!f_deposito && !filterDeposito && !movDepDestino) return;
    try {
        const res = await fetch('/depositos?soloActivos=1', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Error depósitos');
        const items = await res.json();
        if (f_deposito) {
            f_deposito.innerHTML = '<option value="">(Elegir Depósito)</option>' +
                items.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');
        }
        if (filterDeposito) {
            filterDeposito.innerHTML = '<option value="">Todos los depósitos</option>' +
                items.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');
        }
        if (movDepDestino) {
            movDepDestino.innerHTML = '<option value="">Seleccione depósito destino</option>' +
                items.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');
        }
    } catch (err) {
        console.error(err);
        if (f_deposito) f_deposito.innerHTML = '<option value="">(Elegir Depósito)</option>';
    }
}

cargarDepositos();

// Buscar producto para movimiento por código
async function cargarProductoParaMovimiento() {
    if (!movCodigo || !movInfo || !movDepOrigen) return;
    const codigo = movCodigo.value.trim();
    movInfo.textContent = 'Buscando producto...';
    movDepOrigen.textContent = '—';
    if (movStockDetalle) movStockDetalle.textContent = '';
    if (movDepOrigenSelect) {
        movDepOrigenSelect.remove();
        movDepOrigenSelect = null;
    }
    if (!codigo) {
        movInfo.textContent = 'Ingresa un código y presiona Enter.';
        return;
    }
    try {
        const res = await fetch(`/productos/${encodeURIComponent(codigo)}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Producto no encontrado');
        const p = await res.json();
        movInfo.textContent = `${p.codigo || ''} — ${p.descripcion || ''} (Stock total: ${p.stock ?? 0})`;
        const exps = Array.isArray(p.existencias_por_deposito) ? p.existencias_por_deposito : [];

        if (movStockDetalle) {
            if (exps.length) {
                const partes = exps.map(e => `${e.deposito_nombre || 'Depósito'}: ${e.cantidad}`);
                movStockDetalle.textContent = `Stock por depósito → ${partes.join(' • ')}`;
            } else {
                movStockDetalle.textContent = '';
            }
        }

        // Determinar depósitos con stock positivo para posible selección de origen
        const expsConStock = exps.filter(e => Number(e.cantidad || 0) > 0);

        if (expsConStock.length <= 1) {
            // Solo un depósito con stock: mostrar texto fijo (no editable)
            const unico = expsConStock[0];
            movDepOrigen.textContent = (unico && unico.deposito_nombre) ? unico.deposito_nombre : (p.deposito_nombre || 'Depósito actual');
            if (movDepOrigenSelect) {
                movDepOrigenSelect.remove();
                movDepOrigenSelect = null;
            }
        } else {
            // Varios depósitos con stock: permitir elegir depósito origen
            movDepOrigen.textContent = 'Seleccione depósito origen';
            if (!movDepOrigenSelect) {
                movDepOrigenSelect = document.createElement('select');
                movDepOrigenSelect.id = 'mov_deposito_origen_select';
                movDepOrigenSelect.className = 'w-full p-2 border rounded mt-1 text-[11px]';
                if (movDepOrigen.parentElement) {
                    movDepOrigen.parentElement.appendChild(movDepOrigenSelect);
                }
            }
            movDepOrigenSelect.innerHTML = '';
            expsConStock.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.deposito_id;
                opt.textContent = `${e.deposito_nombre || 'Depósito'} (${e.cantidad})`;
                movDepOrigenSelect.appendChild(opt);
            });

            // Seleccionar por defecto el depósito principal del producto si está en la lista
            if (p.deposito_id && expsConStock.some(e => e.deposito_id === p.deposito_id)) {
                movDepOrigenSelect.value = String(p.deposito_id);
            }
        }
    } catch (err) {
        console.error(err);
        movInfo.textContent = err.message || 'Error cargando producto';
        movDepOrigen.textContent = '—';
        if (movStockDetalle) movStockDetalle.textContent = '';
    }
}

async function ejecutarMovimientoDeposito() {
    if (!movCodigo || !movDepDestino || !movMsg) return;
    const codigo = movCodigo.value.trim();
    const cantidadStr = movCantidad ? movCantidad.value.trim() : '';
    const destId = movDepDestino.value;
    const motivo = movMotivo ? movMotivo.value.trim() : '';
    movMsg.textContent = '';
    if (!codigo) {
        movMsg.textContent = 'Ingresa un código de producto.';
        return;
    }
    if (!destId) {
        movMsg.textContent = 'Selecciona un depósito destino.';
        return;
    }
    const cantidad = cantidadStr ? parseFloat(cantidadStr) : NaN;
    if (!cantidadStr || Number.isNaN(cantidad) || cantidad <= 0) {
        movMsg.textContent = 'Ingresa una cantidad válida a mover.';
        return;
    }
    try {
        const origenId = movDepOrigenSelect && movDepOrigenSelect.value
            ? parseInt(movDepOrigenSelect.value, 10)
            : NaN;
        const payload = {
            codigo,
            deposito_destino_id: parseInt(destId, 10),
            cantidad,
            motivo,
        };
        if (!Number.isNaN(origenId)) {
            payload.deposito_origen_id = origenId;
        }
        const res = await fetch('/depositos/mover', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error moviendo producto');
        movMsg.textContent = data.message || 'Producto movido.';
        // refrescar lista, historial y datos del producto
        await cargarProductos();
        await cargarMovimientosDeposito();
        await cargarProductoParaMovimiento();
        if (movCantidad) movCantidad.value = '';
    } catch (err) {
        console.error(err);
        movMsg.textContent = err.message || 'Error moviendo producto';
    }
}

if (movCodigo) {
    movCodigo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            cargarProductoParaMovimiento();
        }
    });
}
if (btnMoverDeposito) {
    btnMoverDeposito.addEventListener('click', (e) => {
        e.preventDefault();
        ejecutarMovimientoDeposito();
    });
}

// Recalcular stock total desde stock_por_deposito (solo admin/superadmin)
if (btnRebuildStock) {
    if (!(esEmpresaAdmin || esSuperAdmin)) {
        btnRebuildStock.classList.add('hidden');
        if (rebuildStockMsg) rebuildStockMsg.classList.add('hidden');
    } else {
        btnRebuildStock.addEventListener('click', async () => {
            const confirmar = window.confirm('Esto recalculará el stock total de todos los productos a partir de los depósitos. ¿Continuar?');
            if (!confirmar) return;
            if (rebuildStockMsg) rebuildStockMsg.textContent = 'Recalculando stock, por favor espera...';
            try {
                const res = await fetch('/admin/ajustes/rebuild-stock', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Error al recalcular stock');

                const total = data.totalProductos || 0;
                const actualizados = data.actualizados || 0;
                const mismatches = Array.isArray(data.mismatches) ? data.mismatches.length : 0;
                const sinDep = Array.isArray(data.sinStockPorDeposito) ? data.sinStockPorDeposito.length : 0;
                const negativos = Array.isArray(data.negativos) ? data.negativos.length : 0;

                if (rebuildStockMsg) {
                    rebuildStockMsg.textContent = `Productos: ${total}, actualizados: ${actualizados}. Anomalías → desajustes: ${mismatches}, sin detalle por depósito: ${sinDep}, negativos: ${negativos}.`;
                }
                showToast('Recalculo de stock completado.', 'success');
                currentPage = 0;
                cargarProductos();
            } catch (err) {
                console.error(err);
                if (rebuildStockMsg) rebuildStockMsg.textContent = 'Error: ' + (err.message || 'No se pudo recalcular el stock');
                showToast('Error al recalcular stock de inventario', 'error');
            }
        });
    }
}

// Cargar historial inicial de movimientos
cargarMovimientosDeposito();