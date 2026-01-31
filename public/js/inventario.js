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
const msg = document.getElementById('msg');
const btnBorrar = document.getElementById('btnBorrar');
const pageSize = document.getElementById('pageSize');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pagInfo = document.getElementById('paginacion-info');

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

let productosCache = [];
let currentPage = 0;
let currentTotal = 0;

async function cargarProductos() {
    lista.innerHTML = 'Cargando...';
    try {
        const limit = parseInt(pageSize.value);
        const offset = currentPage * limit;
        // aplicar filtros
        const categoriaVal = document.getElementById('filterCategoria') ? document.getElementById('filterCategoria').value.trim() : '';
        const stockFilter = document.getElementById('filterStock') ? document.getElementById('filterStock').value : 'all';
        const params = new URLSearchParams();
        params.set('limit', limit);
        params.set('offset', offset);
        if (categoriaVal) params.set('categoria', categoriaVal);
        const qv = document.getElementById('q') ? document.getElementById('q').value.trim() : '';
        if (qv) params.set('q', qv);
        if (stockFilter === 'out') params.set('stock_lt', '1');
        if (stockFilter === 'low') params.set('stock_lt', '5');
        if (stockFilter === 'medium') params.set('stock_lt', '20');
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
            d.innerHTML = `<div class="font-bold">${r.codigo || '—'} <span class="text-xs text-slate-400">(${r.diferencia>0?'+':''}${r.diferencia})</span></div><div class="text-xs text-slate-400">${r.motivo} — ${new Date(r.fecha).toLocaleString()}</div>`;
            el.appendChild(d);
        });
    } catch (err) {
        el.innerHTML = '<div class="text-xs text-red-500">Error cargando ajustes</div>';
        console.error(err);
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
    const filtered = items.filter(p => !qv || p.codigo.toLowerCase().includes(qv) || (p.descripcion || '').toLowerCase().includes(qv));
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
        el.innerHTML = `<div><div class="font-bold">${p.codigo} <span class="text-xs text-slate-400">${p.categoria||''}</span></div><div class="text-xs text-slate-400">${p.descripcion || ''}</div></div>
            <div class="text-right space-y-1 min-w-[160px]">
                <div class="text-sm font-black">Stock: ${p.stock}</div>
                <div class="text-xs text-slate-600">Precio $${precio.toFixed(2)} • Costo $${costo.toFixed(2)}</div>
                <div class="text-xs ${margenCls}">Margen $${margenVal.toFixed(2)}${margenPct !== null ? ` (${margenPct.toFixed(1)}%)` : ''}</div>
            </div>`;
        el.onclick = () => {
            f_codigo.value = p.codigo;
            f_desc.value = p.descripcion || '';
            f_precio.value = p.precio_usd || 0;
            f_costo.value = p.costo_usd || 0;
            f_stock.value = p.stock || 0;
            const f_cat = document.getElementById('f_categoria'); if (f_cat) f_cat.value = p.categoria || '';
            msg.innerText = '';
        };
        lista.appendChild(el);
    });
}

q.addEventListener('input', () => renderList(productosCache));
// Filter controls (moved to top)
const topFilterCategoria = document.getElementById('filterCategoria');
const topFilterStock = document.getElementById('filterStock');
if (topFilterCategoria) topFilterCategoria.addEventListener('input', () => { currentPage = 0; cargarProductos(); });
if (topFilterStock) topFilterStock.addEventListener('change', () => { currentPage = 0; cargarProductos(); });

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
function detectDelimiter(text){
    const raw = text.replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).slice(0,5).join('\n');
    const counts = { '\t': (lines.match(/\t/g)||[]).length, ';': (lines.match(/;/g)||[]).length, ',': (lines.match(/,/g)||[]).length };
    let delim = ';';
    const max = Math.max(counts['\t'], counts[';'], counts[',']);
    if (max === counts['\t']) delim = '\t';
    else if (max === counts[',']) delim = ',';
    return delim;
}

// Client-side parser for preview (supports quotes)
function parseDelimited(text, delim){
    const rows = [];
    let i = 0, len = text.length;
    let cur = [];
    let field = '';
    let inQuotes = false;
    while (i < len) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i+1 < len && text[i+1] === '"') { field += '"'; i += 2; continue; }
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
    return rows.map(r => r.map(c => (c||'').toString()));
}

btnImportCsv.addEventListener('click', async () => {
    const file = csvFile.files && csvFile.files[0];
    if (!file) return showToast('Seleccione un archivo CSV', 'error');
    const text = await file.text();
    try {
        // detect and parse for preview
        const delim = detectDelimiter(text);
        const rows = parseDelimited(text.replace(/^\uFEFF/, ''), delim).filter(r => r.some(c => (c||'').toString().trim() !== ''));
        if (!rows || rows.length === 0) return showToast('Archivo sin filas', 'error');

        // determine if header
        let start = 0;
        const first = rows[0].map(c => (c||'').toString().toLowerCase());
        if (first.some(h => h.includes('codigo')) && first.some(h => h.includes('descripcion'))) start = 1;

        // build HTML preview table (up to 10 rows)
        const previewRows = rows.slice(0, Math.min(10, rows.length));
        let html = '<table class="w-full text-xs table-fixed border-collapse">';
        html += '<thead><tr class="bg-slate-100"><th class="px-2 py-1 border">#</th>';
        const headerCols = ['codigo','descripcion','precio_usd','costo_usd','stock','categoria'];
        headerCols.forEach(h => { html += `<th class="px-2 py-1 border">${h}</th>`; });
        html += '</tr></thead><tbody>';
        for (let i = 0; i < previewRows.length; i++){
            const cols = previewRows[i];
            html += `<tr class="odd:bg-white even:bg-slate-50"><td class="px-2 py-1 border">${i+1}</td>`;
            for (let j=0;j<6;j++){ html += `<td class="px-2 py-1 border">${(cols[j]||'').toString()}</td>`; }
            html += '</tr>';
        }
        html += '</tbody></table>';
        importPreviewBody.innerHTML = html;

        // show modal
        previewModal.classList.remove('hidden');
        requestAnimationFrame(() => { previewModal.classList.add('modal-open'); previewModal.style.display = 'flex'; });

        // confirm handler: send original text to server
        const onConfirm = async () => {
            importPreviewConfirm.disabled = true;
            try {
                const res = await fetch('/admin/productos/import', { 
                    method: 'POST', 
                    credentials: 'same-origin',
                    headers: { 
                        'Content-Type': 'text/plain'
                    }, 
                    body: text 
                });
                const d = await res.json();
                if (!res.ok) { console.error('Import error response:', d); const errMsg = d.error || d.details || 'Error importando CSV'; showToast(errMsg, 'error'); }
                else {
                    if (d.counts) {
                        const c = d.counts;
                        const msg = `Filas: ${c.dataRows}, Insertadas: ${c.inserted}, Actualizadas: ${c.updated}, Omitidas: ${c.skipped}, Errores: ${c.errors}`;
                        showToast(msg, 'success', 5000);
                    } else showToast(d.message || 'Importado', 'success');
                    currentPage = 0; cargarProductos();
                }
            } catch (err) { console.error(err); showToast('Error importando CSV', 'error'); }
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
    const body = {
        codigo: f_codigo.value.trim(),
        descripcion: f_desc.value.trim(),
        precio_usd: parseFloat(f_precio.value),
        costo_usd: parseFloat(f_costo.value) || 0,
        stock: parseInt(f_stock.value) || 0,
        categoria: (document.getElementById('f_categoria') && document.getElementById('f_categoria').value.trim()) || ''
    };

    // Decide POST (create) or PUT (update) based on existence
    const exists = productosCache.find(p => p.codigo === body.codigo);
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
                    stock: body.stock, 
                    categoria: body.categoria 
                }) 
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Error actualizar');
            msg.innerText = 'Producto actualizado.';
        }
        // reload list at first page (do not overwrite user's top filter)
        currentPage = 0;
        await cargarProductos();
        // Limpiar inputs excepto categoria (permite ingresar varios del mismo grupo)
        f_codigo.value = f_desc.value = f_precio.value = f_costo.value = f_stock.value = '';
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