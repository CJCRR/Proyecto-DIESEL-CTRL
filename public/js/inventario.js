import { upsertProductoFirebase, eliminarProductoFirebasePorCodigo } from './firebase-sync.js';
import { showToast, escapeHtml } from './app-utils.js';
import { initCustomSelect } from './modules/ui.js';
import { apiFetchJson } from './app-api.js';
import { formatNumber } from './format-utils.js';

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
const btnActualizarCodigo = document.getElementById('btnActualizarCodigo');
const pageSize = document.getElementById('pageSize');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pagInfo = document.getElementById('paginacion-info');
const filterDeposito = document.getElementById('filterDeposito');
const filterIncompletosTipo = document.getElementById('filterIncompletosTipo');
const btnRebuildStock = document.getElementById('btnRebuildStock');
const rebuildStockMsg = document.getElementById('rebuildStockMsg');
const layoutInventario = document.getElementById('inventario-layout');
const productosSection = document.getElementById('productos-section');
const panelEditor = document.getElementById('panel-editor');
const toggleEditorBtn = document.getElementById('toggle-editor');
const filtrosInventario = document.getElementById('filtros-inventario');
const btnMobileFiltros = document.getElementById('btn-mobile-filtros');
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
const f_categoria = document.getElementById('f_categoria');
const categoriaSugList = document.getElementById('categoria_sugerencias');
const marcaSugList = document.getElementById('marca_sugerencias');
const actividadProductoEl = document.getElementById('actividad-producto');
const stockMarcaEditorEl = document.getElementById('stock-marca-editor');
const btnEditarMarcas = document.getElementById('btnEditarMarcas');
let stockMarcaModal = document.getElementById('stock-marca-modal');
const stockMarcaModalClose = document.getElementById('stock-marca-modal-close');

// Asegurar que el modal de stock por marca cuelgue del body para cubrir toda la pantalla
if (stockMarcaModal && stockMarcaModal.parentElement !== document.body) {
    document.body.appendChild(stockMarcaModal);
}

let categoriasInventario = [];
let marcasInventario = [];
let depositosInventario = [];
let codigoOriginalSeleccionado = null;

// Determinar rol de usuario para habilitar o no edición de stock desde inventario
let esEmpresaAdmin = false;
let esSuperAdmin = false;
let esVendedor = false;
try {
    const currentUser = JSON.parse(localStorage.getItem('auth_user') || 'null');
    if (currentUser && currentUser.rol) {
        esEmpresaAdmin = currentUser.rol === 'admin' || currentUser.rol === 'admin_empresa';
        esSuperAdmin = currentUser.rol === 'superadmin';
        esVendedor = currentUser.rol === 'vendedor';
    }
} catch (e) {
    console.warn('No se pudo leer auth_user para roles en inventario:', e);
}
const puedeEditarStockDesdeInventario = esEmpresaAdmin || esSuperAdmin;
const puedeEditarDesgloseMarca = esEmpresaAdmin || esSuperAdmin || esVendedor;

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
    <div class="flex justify-end gap-2 relative z-10">
        <button id="importPreviewCancel" class="p-2 bg-slate-200 rounded">Cancelar</button>
        <button id="importPreviewConfirm" class="p-2 bg-indigo-600 text-white rounded">Confirmar importación</button>
    </div>
    <div id="importLoader" class="hidden absolute inset-0 z-20 bg-slate-100/90 rounded flex flex-col items-center justify-center">
        <div class="h-10 w-10 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin mb-3"></div>
        <p class="text-xs font-semibold text-slate-700">Importando productos, por favor espera...</p>
        <p class="text-[10px] text-slate-500 mt-1">No cierres esta ventana ni repitas la importación.</p>
    </div>
</div>
`;
document.body.appendChild(previewModal);
const importPreviewBody = previewModal.querySelector('#importPreviewBody');
const importPreviewCancel = previewModal.querySelector('#importPreviewCancel');
const importPreviewConfirm = previewModal.querySelector('#importPreviewConfirm');
const importModeSelect = previewModal.querySelector('#importMode');
const importLoaderEl = previewModal.querySelector('#importLoader');
let importInProgress = false;

function setInventarioImportLoading(isLoading) {
    importInProgress = !!isLoading;
    if (importLoaderEl) {
        if (isLoading) importLoaderEl.classList.remove('hidden');
        else importLoaderEl.classList.add('hidden');
    }
    if (importPreviewConfirm) {
        importPreviewConfirm.disabled = !!isLoading;
        importPreviewConfirm.classList.toggle('opacity-60', !!isLoading);
        importPreviewConfirm.classList.toggle('cursor-not-allowed', !!isLoading);
    }
    if (importPreviewCancel) {
        importPreviewCancel.disabled = !!isLoading;
        importPreviewCancel.classList.toggle('opacity-60', !!isLoading);
        importPreviewCancel.classList.toggle('cursor-not-allowed', !!isLoading);
    }
}

const exportModal = document.createElement('div');
exportModal.id = 'inventarioExportModal';
exportModal.className = 'fixed inset-0 hidden items-center justify-center z-50';
exportModal.innerHTML = `
<div class="absolute inset-0 bg-black bg-opacity-40 modal-backdrop opacity-0"></div>
<div class="relative bg-white p-4 rounded-2xl shadow w-11/12 max-w-2xl modal-panel border border-slate-200">
    <div class="flex items-start justify-between gap-3 mb-4">
        <div>
            <h3 class="text-sm font-black text-slate-900">Exportar inventario</h3>
            <p class="text-[11px] text-slate-500 mt-1">Filtra por depósito, categoría, stock y alertas antes de descargar el CSV.</p>
        </div>
        <button id="exportModalClose" type="button" class="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <label class="block">
            <span class="block text-[11px] font-semibold text-slate-600 mb-1">Depósito</span>
            <select id="exportFilterDeposito" class="w-full p-2 border rounded-xl text-sm bg-white text-slate-700">
                <option value="">Todos los depósitos</option>
            </select>
        </label>
        <label class="block">
            <span class="block text-[11px] font-semibold text-slate-600 mb-1">Categoría</span>
            <select id="exportFilterCategoria" class="w-full p-2 border rounded-xl text-sm bg-white text-slate-700">
                <option value="">Todas las categorías</option>
            </select>
        </label>
        <label class="block md:col-span-2">
            <span class="block text-[11px] font-semibold text-slate-600 mb-1">Stock</span>
            <select id="exportFilterStock" class="w-full p-2 border rounded-xl text-sm bg-white text-slate-700">
                <option value="all">Todos</option>
                <option value="out">Solo 0 stock</option>
                <option value="low">Stock bajo (&lt;5)</option>
                <option value="medium">Stock medio (&lt;20)</option>
                <option value="over">Sobre stock (&gt;100)</option>
            </select>
        </label>
    </div>
    <div class="mb-4">
        <div class="flex items-center justify-between gap-2 mb-2">
            <span class="text-[11px] font-semibold text-slate-600">Alertas</span>
            <span class="text-[10px] text-slate-400">Si marcas varias, se incluyen productos con cualquiera de esas alertas.</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
            <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" name="exportAlertas" value="sin_costo" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500">
                <span>Sin costo</span>
            </label>
            <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" name="exportAlertas" value="sin_precio" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500">
                <span>Sin precio</span>
            </label>
            <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" name="exportAlertas" value="sin_marca" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500">
                <span>Sin marca</span>
            </label>
            <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" name="exportAlertas" value="sin_categoria" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500">
                <span>Sin categoría</span>
            </label>
            <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" name="exportAlertas" value="sin_deposito" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500">
                <span>Sin depósito</span>
            </label>
            <label class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" name="exportAlertas" value="sin_stock_def" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500">
                <span>Sin stock definido</span>
            </label>
        </div>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 mb-4">
        <div class="text-[11px] font-semibold text-slate-700 mb-1">Resumen de exportación</div>
        <p id="exportFilterSummary" class="text-[11px] text-slate-500">Se exportará todo el inventario activo.</p>
    </div>
    <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 relative z-10">
        <button id="exportModalReset" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wide py-2.5 px-4 transition-all duration-150">
            <i class="fas fa-rotate-left text-[11px]"></i> Limpiar filtros
        </button>
        <div class="flex justify-end gap-2">
            <button id="exportModalCancel" type="button" class="p-2 px-4 bg-slate-200 rounded-xl text-xs font-semibold text-slate-700">Cancelar</button>
            <button id="exportModalConfirm" type="button" class="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wide py-2.5 px-4 shadow-sm shadow-emerald-200 transition-all duration-150">
                <i class="fas fa-file-arrow-down text-[11px]"></i> Exportar CSV
            </button>
        </div>
    </div>
    <div id="exportLoader" class="hidden absolute inset-0 z-20 bg-slate-100/90 rounded-2xl flex flex-col items-center justify-center">
        <div class="h-10 w-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin mb-3"></div>
        <p class="text-xs font-semibold text-slate-700">Preparando archivo de exportación...</p>
        <p class="text-[10px] text-slate-500 mt-1">Espera a que termine la descarga.</p>
    </div>
</div>
`;
document.body.appendChild(exportModal);
const exportModalClose = exportModal.querySelector('#exportModalClose');
const exportModalCancel = exportModal.querySelector('#exportModalCancel');
const exportModalConfirm = exportModal.querySelector('#exportModalConfirm');
const exportModalReset = exportModal.querySelector('#exportModalReset');
const exportFilterDeposito = exportModal.querySelector('#exportFilterDeposito');
const exportFilterCategoria = exportModal.querySelector('#exportFilterCategoria');
const exportFilterStock = exportModal.querySelector('#exportFilterStock');
const exportFilterSummary = exportModal.querySelector('#exportFilterSummary');
const exportLoaderEl = exportModal.querySelector('#exportLoader');
let exportInProgress = false;

function getExportAlertInputs() {
    return Array.from(exportModal.querySelectorAll('input[name="exportAlertas"]'));
}

function setInventarioExportLoading(isLoading) {
    exportInProgress = !!isLoading;
    if (exportLoaderEl) {
        if (isLoading) exportLoaderEl.classList.remove('hidden');
        else exportLoaderEl.classList.add('hidden');
    }
    [exportModalConfirm, exportModalCancel, exportModalReset, exportModalClose].forEach((el) => {
        if (!el) return;
        el.disabled = !!isLoading;
        el.classList.toggle('opacity-60', !!isLoading);
        el.classList.toggle('cursor-not-allowed', !!isLoading);
    });
    [exportFilterDeposito, exportFilterCategoria, exportFilterStock, ...getExportAlertInputs()].forEach((el) => {
        if (!el) return;
        el.disabled = !!isLoading;
    });
}

function fillExportDepositosOptions(selectedValue = '') {
    if (!exportFilterDeposito) return;
    const desired = String(selectedValue || exportFilterDeposito.value || '');
    exportFilterDeposito.innerHTML = '<option value="">Todos los depósitos</option>' +
        depositosInventario.map((dep) => {
            const label = dep && dep.codigo ? `${dep.nombre} (${dep.codigo})` : (dep && dep.nombre ? dep.nombre : 'Depósito');
            return `<option value="${dep.id}">${escapeHtml(label)}</option>`;
        }).join('');
    const hasDesired = Array.from(exportFilterDeposito.options).some((opt) => opt.value === desired);
    exportFilterDeposito.value = hasDesired ? desired : '';
}

function fillExportCategoriasOptions(selectedValue = '') {
    if (!exportFilterCategoria) return;
    const desired = String(selectedValue || exportFilterCategoria.value || '');
    exportFilterCategoria.innerHTML = '<option value="">Todas las categorías</option>' +
        categoriasInventario.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    const hasDesired = Array.from(exportFilterCategoria.options).some((opt) => opt.value === desired);
    exportFilterCategoria.value = hasDesired ? desired : '';
}

function getExportFiltersState() {
    return {
        depositoId: exportFilterDeposito ? String(exportFilterDeposito.value || '') : '',
        depositoLabel: exportFilterDeposito && exportFilterDeposito.selectedIndex >= 0
            ? exportFilterDeposito.options[exportFilterDeposito.selectedIndex].textContent.trim()
            : '',
        categoria: exportFilterCategoria ? String(exportFilterCategoria.value || '').trim() : '',
        stock: exportFilterStock ? String(exportFilterStock.value || 'all') : 'all',
        alertas: getExportAlertInputs()
            .filter((input) => input.checked)
            .map((input) => ({
                valor: input.value,
                label: input.closest('label') ? input.closest('label').textContent.trim().replace(/\s+/g, ' ') : input.value,
            })),
    };
}

function updateExportSummary() {
    if (!exportFilterSummary) return;
    const state = getExportFiltersState();
    const parts = [];
    const stockLabels = {
        out: 'solo productos con 0 stock',
        low: 'stock bajo (<5)',
        medium: 'stock medio (<20)',
        over: 'sobre stock (>100)',
    };

    if (state.depositoId) parts.push(`depósito ${state.depositoLabel}`);
    if (state.categoria) parts.push(`categoría ${state.categoria}`);
    if (state.stock && state.stock !== 'all' && stockLabels[state.stock]) parts.push(stockLabels[state.stock]);
    if (state.alertas.length) parts.push(`alertas: ${state.alertas.map((item) => item.label).join(', ')}`);

    exportFilterSummary.textContent = parts.length
        ? `Se exportarán productos filtrados por ${parts.join(' · ')}.`
        : 'Se exportará todo el inventario activo.';
}

function resetExportFilters() {
    fillExportDepositosOptions(filterDeposito ? filterDeposito.value : '');
    fillExportCategoriasOptions(topFilterCategoria ? topFilterCategoria.value : '');
    if (exportFilterStock) exportFilterStock.value = topFilterStock ? (topFilterStock.value || 'all') : 'all';
    getExportAlertInputs().forEach((input) => {
        input.checked = false;
    });
    updateExportSummary();
}

async function openExportModal() {
    if (!depositosInventario.length) {
        try { await cargarDepositos(); } catch {}
    }
    if (!categoriasInventario.length) {
        try { await cargarCategorias(); } catch {}
    }
    resetExportFilters();
    exportModal.classList.remove('hidden');
    requestAnimationFrame(() => {
        exportModal.classList.add('modal-open');
        exportModal.style.display = 'flex';
    });
}

function closeExportModal(force = false) {
    if (exportInProgress && !force) return;
    exportModal.classList.remove('modal-open');
    setTimeout(() => {
        exportModal.classList.add('hidden');
        exportModal.style.display = '';
    }, 200);
}

async function ejecutarExportacionInventario() {
    const state = getExportFiltersState();
    const params = new URLSearchParams();
    if (state.depositoId) params.append('deposito_id', state.depositoId);
    if (state.categoria) params.set('categoria', state.categoria);
    if (state.stock && state.stock !== 'all') params.set('stock', state.stock);
    state.alertas.forEach((item) => params.append('alerta', item.valor));

    try {
        setInventarioExportLoading(true);
        const url = '/admin/productos/export' + (params.toString() ? `?${params.toString()}` : '');
        const res = await fetch(url, {
            credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = params.toString() ? 'productos-filtrados.csv' : 'productos.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        closeExportModal(true);
        showToast(params.toString() ? 'CSV exportado con filtros' : 'CSV exportado', 'info');
    } catch (err) {
        console.error(err);
        showToast('Error exportando CSV', 'error');
    } finally {
        setInventarioExportLoading(false);
    }
}

[exportFilterDeposito, exportFilterCategoria, exportFilterStock].forEach((el) => {
    if (!el) return;
    el.addEventListener('change', updateExportSummary);
});
getExportAlertInputs().forEach((input) => {
    input.addEventListener('change', updateExportSummary);
});
if (exportModalReset) exportModalReset.addEventListener('click', resetExportFilters);
if (exportModalCancel) exportModalCancel.addEventListener('click', () => closeExportModal());
if (exportModalClose) exportModalClose.addEventListener('click', () => closeExportModal());
if (exportModalConfirm) exportModalConfirm.addEventListener('click', ejecutarExportacionInventario);
if (exportModal) {
    exportModal.addEventListener('click', (e) => {
        const target = e.target;
        if (target === exportModal || (target && target.classList && target.classList.contains('modal-backdrop'))) {
            closeExportModal();
        }
    });
}
updateExportSummary();

let productosCache = [];
let currentPage = 0;
let currentTotal = 0;
let filtroIncompletosActivo = false;

// Ocultar campos de stock/depósito/ajuste para usuarios que no son admin
if (!puedeEditarStockDesdeInventario) {
    if (f_stock) {
        const lblStock = f_stock.previousElementSibling;
        if (lblStock && lblStock.tagName === 'LABEL') lblStock.classList.add('hidden');
        f_stock.classList.add('hidden');
        // Evitar que la validación nativa bloquee el submit por un campo requerido no visible
        try {
            f_stock.required = false;
            f_stock.removeAttribute('required');
        } catch {}
        // Forzar valor 0 por defecto para nuevos productos creados por vendedores
        if (!f_stock.value) {
            f_stock.value = '0';
        }
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

// Hacer que el botón de Marca abra el modal de stock por depósito y marca
if (btnEditarMarcas && stockMarcaModal && stockMarcaEditorEl) {
    btnEditarMarcas.addEventListener('click', async () => {
        const codigoValRaw = f_codigo ? String(f_codigo.value || '').trim() : '';
        if (!codigoValRaw) {
            showToast('Selecciona primero un producto de la lista para editar sus marcas.', 'info');
            return;
        }
        const codigoVal = codigoValRaw.toUpperCase();

        // Si ya hay un producto seleccionado y el usuario cambió el código
        // en el formulario, primero intentamos actualizar el código en backend
        // (mismo comportamiento que el botón "Actualizar código").
        if (codigoOriginalSeleccionado && codigoOriginalSeleccionado !== codigoVal) {
            try {
                const res = await fetch('/admin/productos/' + encodeURIComponent(codigoOriginalSeleccionado), {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nuevo_codigo: codigoVal })
                });
                const data = await res.json();
                if (!res.ok) {
                    const msgErr = data && data.error ? data.error : 'No se pudo actualizar el código antes de editar marcas.';
                    showToast(msgErr, 'error');
                    return;
                }
                codigoOriginalSeleccionado = codigoVal;
                // Recargar lista para que productosCache refleje el nuevo código
                currentPage = 0;
                await cargarProductos();
            } catch (err) {
                console.error('Error actualizando código antes de abrir editor de marcas', err);
                showToast(err.message || 'Error actualizando código antes de editar marcas', 'error');
                return;
            }
        }

        // Si el producto aún no existe en la lista (producto recién digitado pero no guardado),
        // intentar crearlo rápido con los datos del formulario para poder editar marcas de inmediato.
        let prodEnCache = productosCache.find(p => p.codigo === codigoVal);
        if (!prodEnCache && !codigoOriginalSeleccionado) {
            const desc = f_desc ? String(f_desc.value || '').trim().toUpperCase() : '';
            const precio = parseFloat(f_precio && f_precio.value ? f_precio.value : '0');
            const stockInput = parseInt(f_stock && f_stock.value ? f_stock.value : '0', 10) || 0;
            const depositoId = (f_deposito && f_deposito.value) ? parseInt(f_deposito.value, 10) : null;

            if (!desc || !precio || !depositoId) {
                showToast('Completa Código, Descripción, Precio y Depósito y guarda el producto antes de editar marcas.', 'error');
                return;
            }

            let stock = stockInput;
            if (!puedeEditarStockDesdeInventario) {
                stock = 0;
            }

            const body = {
                codigo: codigoVal,
                descripcion: desc,
                precio_usd: precio,
                costo_usd: parseFloat(f_costo && f_costo.value ? f_costo.value : '0') || 0,
                stock,
                categoria: (f_categoria && f_categoria.value.trim()) || '',
                marca: '',
                deposito_id: depositoId,
            };

            try {
                const res = await fetch('/admin/productos', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Error creando producto antes de editar marcas');
                showToast('Producto creado. Ahora puedes editar marcas por depósito.', 'success');
                codigoOriginalSeleccionado = codigoVal;
                currentPage = 0;
                await cargarProductos();
                prodEnCache = productosCache.find(p => p.codigo === codigoVal) || null;
            } catch (err) {
                console.error(err);
                showToast('No se pudo crear el producto para editar marcas: ' + (err.message || ''), 'error');
                return;
            }
        }

        // Asegurar que el editor tenga el desglose actualizado para este código
        try {
            await cargarStockMarcaEditor(codigoVal);
        } catch (e) {
            console.warn('No se pudo cargar stock por marca antes de abrir el modal:', e);
        }

        // Abrir modal con misma animación que otros modales
        stockMarcaModal.classList.remove('hidden');
        requestAnimationFrame(() => {
            stockMarcaModal.classList.add('modal-open');
            stockMarcaModal.style.display = 'flex';
        });
    });
}

// Cerrar modal de stock por depósito y marca
if (stockMarcaModal && stockMarcaModalClose) {
    stockMarcaModalClose.addEventListener('click', () => {
        stockMarcaModal.classList.remove('modal-open');
        setTimeout(() => {
            stockMarcaModal.classList.add('hidden');
            stockMarcaModal.style.display = '';
        }, 200);
    });
    stockMarcaModal.addEventListener('click', (e) => {
        if (e.target === stockMarcaModal || (e.target && e.target.classList && e.target.classList.contains('modal-backdrop'))) {
            stockMarcaModal.classList.remove('modal-open');
            setTimeout(() => {
                stockMarcaModal.classList.add('hidden');
                stockMarcaModal.style.display = '';
            }, 200);
        }
    });
}

// Cargar productos con filtros aplicados y paginación, ordenados alfabéticamente por descripción
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
        if (filtroIncompletosActivo) {
            params.set('incompletos', '1');
        }
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

// Actualizar info de paginación y estado de botones de navegación
function updatePaginationInfo() {
    const limit = parseInt(pageSize.value);
    const start = currentPage * limit + 1;
    const end = Math.min((currentPage + 1) * limit, currentTotal);
    pagInfo.innerText = `${start}-${end} de ${currentTotal}`;
    prevPage.disabled = currentPage === 0;
    nextPage.disabled = end >= currentTotal;
}

// Renderizar lista de productos con filtros aplicados y orden alfabético
function renderList(items) {
    const qv = q.value.trim().toLowerCase();
    const tipoInc = filterIncompletosTipo ? filterIncompletosTipo.value : '';
    const filtered = items.filter(p => {
        const codigo = (p.codigo || '').toLowerCase();
        const desc = (p.descripcion || '').toLowerCase();
        const cat = (p.categoria || '').toLowerCase();
        const marca = (p.marca || '').toLowerCase();

        // Coincidencia por texto (código, descripción, categoría o marca)
        const matchTexto = !qv || codigo.includes(qv) || desc.includes(qv) || cat.includes(qv) || marca.includes(qv);

        // Calcular qué datos están incompletos para este producto
        const sinCosto = p.costo_usd == null || Number(p.costo_usd) <= 0;
        const sinPrecio = p.precio_usd == null || Number(p.precio_usd) <= 0;
        const sinCategoria = !p.categoria || !String(p.categoria).trim();
        const sinMarca = !p.marca || !String(p.marca).trim();
        const sinDeposito = p.deposito_id == null;
        const sinStockDef = p.stock == null;

        // Filtro por tipo de dato incompleto: se aplica siempre que el usuario
        // haya elegido una opción en el selector, aunque no venga desde dashboard.
        let matchTipo = true;
        if (tipoInc) {
            if (tipoInc === 'sin_costo') matchTipo = sinCosto;
            else if (tipoInc === 'sin_precio') matchTipo = sinPrecio;
            else if (tipoInc === 'sin_marca') matchTipo = sinMarca;
            else if (tipoInc === 'sin_categoria') matchTipo = sinCategoria;
            else if (tipoInc === 'sin_deposito') matchTipo = sinDeposito;
            else if (tipoInc === 'sin_stock_def') matchTipo = sinStockDef;
        }

        return matchTexto && matchTipo;
    });
    // Orden alfabético por descripción (y luego por código como desempate)
    filtered.sort((a, b) => {
        const da = (a.descripcion || '').toString().toLowerCase();
        const db = (b.descripcion || '').toString().toLowerCase();
        if (da < db) return -1;
        if (da > db) return 1;
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
        el.className = 'p-1 border rounded flex justify-between items-start gap-1 hover:bg-slate-50 cursor-pointer';
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
                badgeHtml = '<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700 ml-2">Sin stock</span>';
            } else if (totalStock > 0 && totalStock < 5) {
                badgeHtml = '<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 ml-2">Stock bajo</span>';
            } else if (totalStock > 100) {
                badgeHtml = '<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700 ml-2">Sobre stock</span>';
            }
        }

        // Badges para mostrar rápidamente qué dato está incompleto
        let incompletosBadges = '';
        const tags = [];
        if (p.costo_usd == null || Number(p.costo_usd) <= 0) tags.push('<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">Sin costo</span>');
        if (p.precio_usd == null || Number(p.precio_usd) <= 0) tags.push('<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700">Sin precio</span>');
        if (!p.categoria || !String(p.categoria).trim()) tags.push('<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700">Sin categoría</span>');
        const tieneMarcasStock = p.marcas_stock && String(p.marcas_stock).trim();
        if ((!p.marca || !String(p.marca).trim()) && !tieneMarcasStock) {
            tags.push('<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700">Sin marca principal</span>');
        }
        if (p.deposito_id == null) tags.push('<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">Sin depósito</span>');
        if (p.stock == null) tags.push('<span class="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700">Sin stock definido</span>');

        if (tags.length) {
            incompletosBadges = `<div class="mt-0.5 flex flex-wrap gap-1">${tags.join('')}</div>`;
        }
        const descUpper = (p.descripcion || '').toString().toUpperCase();
        const catUpper = (p.categoria || '').toString().toUpperCase();
        const marcasStockUpper = (p.marcas_stock || '').toString().toUpperCase();
        const marcaPrincipalUpper = (p.marca || '').toString().toUpperCase();
        const marcaTexto = marcasStockUpper || marcaPrincipalUpper;
        el.innerHTML = `<div><div class="font-bold">${p.codigo} <span class="text-xs ">${descUpper}</span></div><div class="text-xs text-slate-400">${catUpper}${marcaTexto ? ` · Marca: ${marcaTexto}` : ''}</div>${depositoLabel ? `<div class="text-xs text-slate-400">${depositoLabel}</div>` : ''}${incompletosBadges}</div>
            <div class="text-right space-y-0.5 min-w-[170px]">
                <div class="text-sm font-black">Stock: ${p.stock || 0}${badgeHtml}</div>
                <div class="text-xs text-slate-600">Precio $${formatNumber(precio, 2)}</div>
            </div>`;
             
            // por si quieres que saga el margen y costo también en la lista, aunque puede quedar muy cargada visualmente
            //<div class="text-xs text-slate-600">Precio $${precio.toFixed(2)} • Costo $${costo.toFixed(2)}</div>
            // <div class="text-xs ${margenCls}">Margen $${margenVal.toFixed(2)}${margenPct !== null ? ` (${margenPct.toFixed(1)}%)` : ''}</div>

        el.addEventListener('click', () => {
            // Click en la tarjeta → cargar datos en el formulario
            codigoOriginalSeleccionado = p.codigo || null;
            f_codigo.value = p.codigo;
            f_desc.value = p.descripcion || '';
            f_precio.value = p.precio_usd || 0;
            f_costo.value = p.costo_usd || 0;
            f_stock.value = p.stock || 0;
            const f_cat = document.getElementById('f_categoria'); if (f_cat) f_cat.value = p.categoria || '';
            const marcasStockUpperSel = (p.marcas_stock || '').toString().toUpperCase();
            const marcaPrincipalUpperSel = (p.marca || '').toString().toUpperCase();
            const marcaTextoSel = marcasStockUpperSel || marcaPrincipalUpperSel;
            if (f_marca) f_marca.value = marcaTextoSel || '';
            const btnEditarMarcasLabel = document.getElementById('btnEditarMarcasLabel');
            if (btnEditarMarcasLabel) btnEditarMarcasLabel.textContent = marcaTextoSel || '—';
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

            // Cargar desglose de stock por depósito y marca para este producto
            cargarStockMarcaEditor(p.codigo);

            // Cargar actividad de compras y ventas para este producto
            (async () => {
                if (!actividadProductoEl) return;
                actividadProductoEl.innerHTML = '<div class="text-[11px] text-slate-400">Cargando actividad...</div>';
                try {
                    const res = await fetch(`/admin/productos/actividad?codigo=${encodeURIComponent(p.codigo)}`, { credentials: 'same-origin' });
                    if (!res.ok) {
                        actividadProductoEl.innerHTML = '<div class="text-[11px] text-rose-500">No se pudo cargar la actividad del producto.</div>';
                        return;
                    }
                    const data = await res.json();
                    const comp = data.ultima_compra || null;
                    const vent = data.ultima_venta || null;
                    if (!comp && !vent) {
                        actividadProductoEl.innerHTML = '<div class="text-[11px] text-slate-400">Sin movimientos de compra o venta registrados para este producto.</div>';
                        return;
                    }

                    const partes = [];
                    if (comp) {
                        const fechaC = comp.fecha ? new Date(comp.fecha).toLocaleString() : '';
                        const cantC = comp.cantidad != null ? comp.cantidad : '';
                        const prov = comp.proveedor_nombre || '';
                        partes.push(`
                            <div class="flex items-center justify-between gap-2">
                                <div>
                                    <div class="font-semibold text-[11px] text-slate-700">Última compra</div>
                                    <div class="text-[11px] text-slate-500">${fechaC || '—'}${cantC !== '' ? ` · Cant: ${cantC}` : ''}${prov ? ` · Prov: ${prov}` : ''}</div>
                                </div>
                                <button type="button" class="px-2 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200 text-slate-700" data-actividad-compra="${comp.id}">Ver compra</button>
                            </div>
                        `);
                    }
                    if (vent) {
                        const fechaV = vent.fecha ? new Date(vent.fecha).toLocaleString() : '';
                        const cantV = vent.cantidad != null ? vent.cantidad : '';
                        const cli = vent.cliente || '';
                        partes.push(`
                            <div class="flex items-center justify-between gap-2 mt-2">
                                <div>
                                    <div class="font-semibold text-[11px] text-slate-700">Última venta</div>
                                    <div class="text-[11px] text-slate-500">${fechaV || '—'}${cantV !== '' ? ` · Cant: ${cantV}` : ''}${cli ? ` · Cliente: ${cli}` : ''}</div>
                                </div>
                                <button type="button" class="px-2 py-1 text-[11px] rounded bg-blue-100 hover:bg-blue-200 text-blue-700" data-actividad-venta="${vent.id}" data-actividad-venta-fecha="${vent.fecha || ''}">Ver venta</button>
                            </div>
                        `);
                    }

                    actividadProductoEl.innerHTML = `<div class="space-y-1">${partes.join('')}</div>`;

                    actividadProductoEl.querySelectorAll('[data-actividad-compra]').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const idStr = btn.getAttribute('data-actividad-compra');
                            if (!idStr) return;
                            const url = `/pages/compras.html?compra_id=${encodeURIComponent(idStr)}`;
                            window.location.href = url;
                        });
                    });

                    actividadProductoEl.querySelectorAll('[data-actividad-venta]').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const idStr = btn.getAttribute('data-actividad-venta');
                            const fechaStr = btn.getAttribute('data-actividad-venta-fecha') || '';
                            if (!idStr) return;
                            let url = `/pages/reportes.html?venta_id=${encodeURIComponent(idStr)}`;
                            if (fechaStr) {
                                const d = new Date(fechaStr);
                                if (!Number.isNaN(d.getTime())) {
                                    const iso = d.toISOString().slice(0, 10);
                                    url += `&venta_fecha=${encodeURIComponent(iso)}`;
                                }
                            }
                            window.location.href = url;
                        });
                    });
                } catch (err) {
                    console.error(err);
                    actividadProductoEl.innerHTML = '<div class="text-[11px] text-rose-500">Error cargando actividad del producto.</div>';
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
        filtroIncompletosActivo = true;
        localStorage.removeItem('inventario_filtro_incompletos');
        if (window.showToast) {
            window.showToast('Mostrando productos con datos incompletos (sin costo, sin categoría, sin depósito, sin stock definido, sin marca o sin precio).', 'info');
        }
    }
} catch {}
q.addEventListener('input', () => { currentPage = 0; cargarProductos(); });
const topFilterCategoria = document.getElementById('filterCategoria');
const topFilterStock = document.getElementById('filterStock');
if (topFilterCategoria) topFilterCategoria.addEventListener('change', () => { currentPage = 0; cargarProductos(); });
if (topFilterStock) topFilterStock.addEventListener('change', () => { currentPage = 0; cargarProductos(); });
if (filterDeposito) filterDeposito.addEventListener('change', () => { currentPage = 0; cargarProductos(); });
if (filterIncompletosTipo) filterIncompletosTipo.addEventListener('change', () => { currentPage = 0; cargarProductos(); });

// Toggle de filtros en vista móvil (sin afectar escritorio)
if (btnMobileFiltros && filtrosInventario) {
    btnMobileFiltros.addEventListener('click', () => {
        filtrosInventario.classList.toggle('hidden');
    });
}

// Import / Export CSV handlers
const csvFile = document.getElementById('csvFile');
const btnImportCsv = document.getElementById('btnImportCsv');
const btnExportCsv = document.getElementById('btnExportCsv');

btnExportCsv.addEventListener('click', async (e) => {
    e.preventDefault();
    await openExportModal();
});

// Búsqueda con fallback a cache local
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

// Función de parseo de texto delimitado (CSV/TSV) con soporte para comillas y saltos de línea dentro de campos
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
        const headerCols = ['codigo', 'descripcion', 'precio_usd', 'costo_usd', 'stock', 'categoria', 'marca', 'deposito_codigo', 'stock_marca_detalle'];
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

        // handler de confirmación de importación   
        const onConfirm = async () => {
            if (importInProgress) return;
            setInventarioImportLoading(true);
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
            setInventarioImportLoading(false);
            // close modal
            previewModal.classList.remove('modal-open');
            setTimeout(() => { previewModal.classList.add('hidden'); previewModal.style.display = ''; }, 220);
            importPreviewConfirm.removeEventListener('click', onConfirm);
        };

        importPreviewConfirm.addEventListener('click', onConfirm);
        importPreviewCancel.onclick = () => {
            if (importInProgress) return;
            previewModal.classList.remove('modal-open');
            setTimeout(() => { previewModal.classList.add('hidden'); previewModal.style.display = ''; }, 220);
        };

    } catch (err) {
        console.error(err);
        showToast('Error procesando archivo', 'error');
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigoActual = f_codigo.value.trim().toUpperCase();
    let body = {
        codigo: codigoActual,
        descripcion: f_desc.value.trim().toUpperCase(),
        precio_usd: parseFloat(f_precio.value),
        costo_usd: parseFloat(f_costo.value) || 0,
        stock: parseInt(f_stock.value) || 0,
        categoria: (document.getElementById('f_categoria') && document.getElementById('f_categoria').value.trim()) || '',
        marca: (f_marca && f_marca.value.trim()) || '',
        deposito_id: (f_deposito && f_deposito.value) ? parseInt(f_deposito.value, 10) : null,
    };
    const motivoAjuste = f_motivoAjuste ? f_motivoAjuste.value.trim() : '';
    const prodExistente = codigoOriginalSeleccionado
        ? productosCache.find(p => p.codigo === codigoOriginalSeleccionado)
        : productosCache.find(p => p.codigo === body.codigo);
    const oldStock = prodExistente ? Number(prodExistente.stock || 0) : 0;
    const existeProducto = !!prodExistente;
    // Si el usuario no es admin, no debe poder ajustar stock desde este formulario
    if (!puedeEditarStockDesdeInventario) {
        body = {
            ...body,
            stock: existeProducto ? oldStock : 0,
        };
    }
    const diffStock = body.stock - oldStock;

    const estaEditando = !!codigoOriginalSeleccionado;

    // Decide POST (create) or PUT (update) basado en si hay producto seleccionado
    try {
        if (!estaEditando) {
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
            const codigoOriginal = codigoOriginalSeleccionado || body.codigo;
            const nuevoCodigo = codigoActual !== codigoOriginal ? codigoActual : undefined;

            // Actualizar datos generales del producto (sin tocar stock aquí)
            const res = await fetch('/admin/productos/' + encodeURIComponent(codigoOriginal), {
                method: 'PUT',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    nuevo_codigo: nuevoCodigo,
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

            const codigoParaAjuste = nuevoCodigo || codigoOriginal;

            // Si cambió el stock y hay motivo, registrar ajuste de stock
            if (diffStock !== 0 && motivoAjuste) {
                try {
                    const ajusteRes = await fetch('/admin/ajustes', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            codigo: codigoParaAjuste,
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
            const codigoOriginal = codigoOriginalSeleccionado || body.codigo;
            await upsertProductoFirebase({
                ...body,
                original_codigo: codigoOriginal
            });
        } catch (syncErr) {
            console.error('No se pudo sincronizar producto a Firebase:', syncErr);
        }
        // Recargar lista: si se está creando un producto nuevo, ir a la primera página;
        // si se está editando, mantener la página actual para no interrumpir el flujo.
        if (!estaEditando) {
            currentPage = 0;
        }
        await cargarProductos();
        await cargarAjustes();

        // Si es un producto nuevo, seleccionar automáticamente su tarjeta en la lista
        // para que el usuario pueda ir directo al editor de stock por depósito y marca.
        if (!estaEditando) {
            const card = lista.querySelector(`[data-codigo="${codigoActual}"]`);
            if (card) {
                card.click();
            }
        } else {
            // En edición sí limpiamos el formulario para dejarlo listo para otro producto
            f_codigo.value = f_desc.value = f_precio.value = f_costo.value = f_stock.value = '';
            codigoOriginalSeleccionado = null;
            if (f_marca) f_marca.value = '';
            if (f_deposito) f_deposito.value = '';
            if (f_motivoAjuste) f_motivoAjuste.value = '';
            msg.innerText = '';
        }
        showToast(!estaEditando ? 'Producto creado.' : 'Producto actualizado.', 'success');
    } catch (err) {
        msg.innerText = 'Error: ' + err.message;
        console.error(err);
    }
});

// Handler para botón de eliminación con confirmación en modal
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
            codigoOriginalSeleccionado = null;
            showToast('Producto eliminado.', 'success');
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

// Botón para actualizar solo el código del producto seleccionado
if (btnActualizarCodigo) {
    btnActualizarCodigo.addEventListener('click', async () => {
        const nuevoCodigo = f_codigo.value.trim().toUpperCase();
        if (!codigoOriginalSeleccionado) {
            msg.innerText = 'Selecciona primero un producto de la lista.';
            showToast('Selecciona primero un producto de la lista.', 'error');
            return;
        }
        if (!nuevoCodigo || nuevoCodigo.length < 3) {
            msg.innerText = 'El nuevo código debe tener al menos 3 caracteres.';
            showToast('El nuevo código debe tener al menos 3 caracteres.', 'error');
            return;
        }
        if (nuevoCodigo === codigoOriginalSeleccionado) {
            msg.innerText = 'El código no cambió.';
            return;
        }
        try {
            const res = await fetch('/admin/productos/' + encodeURIComponent(codigoOriginalSeleccionado), {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nuevo_codigo: nuevoCodigo })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Error actualizando código');
            }
            codigoOriginalSeleccionado = nuevoCodigo;
            msg.innerText = 'Código actualizado.';
            showToast('Código actualizado.', 'success');
            currentPage = 0;
            await cargarProductos();
        } catch (err) {
            console.error(err);
            msg.innerText = 'Error: ' + (err.message || 'Error actualizando código');
            showToast(err.message || 'Error actualizando código', 'error');
        }
    });
}

prevPage.addEventListener('click', () => { if (currentPage > 0) { currentPage--; cargarProductos(); } });
nextPage.addEventListener('click', () => { const limit = parseInt(pageSize.value); if ((currentPage + 1) * limit < currentTotal) { currentPage++; cargarProductos(); } });
pageSize.addEventListener('change', () => { currentPage = 0; cargarProductos(); });

// Panel Crear / Editar retraible
function setEditorVisible(visible) {
    if (!layoutInventario || !panelEditor || !productosSection) return;
    if (visible) {
        panelEditor.classList.remove('inv-editor-collapsed', 'hidden');
        productosSection.classList.remove('lg:col-span-3');
        if (!productosSection.classList.contains('lg:col-span-2')) {
            productosSection.classList.add('lg:col-span-2');
        }
        if (toggleEditorBtn) toggleEditorBtn.textContent = '>';
    } else {
        panelEditor.classList.add('inv-editor-collapsed');
        panelEditor.classList.add('hidden');
        productosSection.classList.remove('lg:col-span-2');
        if (!productosSection.classList.contains('lg:col-span-3')) {
            productosSection.classList.add('lg:col-span-3');
        }
        if (toggleEditorBtn) toggleEditorBtn.textContent = '<';
    }
}

try {
    window.setInventarioEditorVisible = setEditorVisible;
} catch {}

if (toggleEditorBtn && layoutInventario && panelEditor && productosSection) {
    let visible = true;
    try {
        const saved = localStorage.getItem('inventario_editor_visible');
        if (saved === '0') visible = false;
    } catch {}
    setEditorVisible(visible);
    toggleEditorBtn.addEventListener('click', () => {
        visible = !visible;
        setEditorVisible(visible);
        try { localStorage.setItem('inventario_editor_visible', visible ? '1' : '0'); } catch {}
    });
}

// Inicializar
cargarProductos();
cargarAjustes();

// Cargar depósitos para el selector
async function cargarDepositos() {
    if (!f_deposito && !filterDeposito && !movDepDestino && !exportFilterDeposito) return;
    try {
        const res = await fetch('/depositos?soloActivos=1', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Error depósitos');
        const items = await res.json();
        depositosInventario = Array.isArray(items) ? items : [];
        if (f_deposito) {
            f_deposito.innerHTML = '<option value="">(Elegir Depósito)</option>' +
                items.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');
            try { initCustomSelect('f_deposito'); } catch {}
        }
        if (filterDeposito) {
            filterDeposito.innerHTML = '<option value="">Todos los depós.</option>' +
                items.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');
            try { initCustomSelect('filterDeposito'); } catch {}
        }
        if (movDepDestino) {
            movDepDestino.innerHTML = '<option value="">Seleccione depósito destino</option>' +
                items.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');
            try { initCustomSelect('mov_deposito_destino'); } catch {}
        }
        fillExportDepositosOptions(exportFilterDeposito ? exportFilterDeposito.value : '');
    } catch (err) {
        console.error(err);
        depositosInventario = [];
        if (f_deposito) f_deposito.innerHTML = '<option value="">(Elegir Depósito)</option>';
        fillExportDepositosOptions('');
    }
}

cargarDepositos();

// Cargar categorías para el filtro superior
async function cargarCategorias() {
    const select = document.getElementById('filterCategoria');
    const dataList = document.getElementById('categoriaOptions');
    if (!select && !dataList) return;
    try {
        const res = await fetch('/admin/productos/categorias', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Error categorías');
        const data = await res.json();
        const categorias = Array.isArray(data.items) ? data.items : [];
        categoriasInventario = categorias;
        if (select) {
            select.innerHTML = '<option value="">Todas las cat.</option>' +
                categorias.map(c => `<option value="${c}">${c}</option>`).join('');
            try { initCustomSelect('filterCategoria'); } catch {}
        }
        if (dataList) {
            dataList.innerHTML = categorias.map(c => `<option value="${c}"></option>`).join('');
        }
        if (f_categoria && categoriaSugList) {
            renderCategoriaSugerencias(categoriasInventario);
            categoriaSugList.classList.add('hidden');
        }
        fillExportCategoriasOptions(exportFilterCategoria ? exportFilterCategoria.value : '');
    } catch (err) {
        console.error(err);
    }
}

cargarCategorias();

// Cargar marcas para sugerencias en formulario
async function cargarMarcas() {
    if (!f_marca && !marcaSugList) return;
    try {
        const res = await fetch('/admin/productos/marcas', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Error marcas');
        const data = await res.json();
        const marcas = Array.isArray(data.items) ? data.items : [];
        marcasInventario = marcas;
        if (f_marca && marcaSugList) {
            renderMarcaSugerencias(marcasInventario);
            marcaSugList.classList.add('hidden');
        }
    } catch (err) {
        console.error(err);
    }
}

cargarMarcas();

// Cargar y renderizar desglose de stock por depósito y marca para un producto
async function cargarStockMarcaEditor(codigo) {
    if (!stockMarcaEditorEl) return;
    if (!codigo) {
        stockMarcaEditorEl.innerHTML = '<div class="text-[11px] text-slate-400">Selecciona un producto para ver su stock por depósito y marca.</div>';
        return;
    }
    stockMarcaEditorEl.innerHTML = '<div class="text-[11px] text-slate-400">Cargando desglose...</div>';
    try {
        const res = await fetch('/productos/' + encodeURIComponent(codigo), { credentials: 'same-origin' });
        if (!res.ok) throw new Error('No se pudo cargar el producto');
        const prod = await res.json();
        const existencias = Array.isArray(prod.existencias_por_deposito) ? prod.existencias_por_deposito : [];
        if (!existencias.length) {
            stockMarcaEditorEl.innerHTML = '<div class="text-[11px] text-slate-400">Este producto no tiene stock detallado por depósito.</div>';
            return;
        }

        let html = '';
        existencias.forEach((e, idx) => {
            const totalDep = Number(e.cantidad || 0) || 0;
            const marcas = Array.isArray(e.marcas) && e.marcas.length ? e.marcas : [{ marca: '', cantidad: totalDep }];
            const depNombre = e.deposito_nombre || 'Depósito';
            html += `
                <div class="mb-3 border rounded p-2 bg-slate-50" data-deposito-id="${e.deposito_id}" data-total-cantidad="${totalDep}">
                    <div class="flex justify-between items-center mb-1">
                        <div class="font-semibold text-[11px] text-slate-700">${depNombre}</div>
                        <div class="text-[11px] text-slate-500">Total depósito: ${totalDep}</div>
                    </div>
                    <div class="space-y-1 js-deposito-marcas">
                        ${marcas.map((m, i) => {
                            const marcaLabel = (m.marca || '').toString();
                            const cant = Number(m.cantidad || 0) || 0;
                            return `
                                <div class="flex items-center gap-1 js-fila-marca" data-index="${i}">
                                    <input type="text" class="flex-1 px-1 py-0.5 border rounded text-[11px]" placeholder="Marca" value="${marcaLabel}">
                                    <input type="number" step="1" min="0" class="w-16 px-1 py-0.5 border rounded text-[11px] text-right" value="${cant}">
                                    <button type="button" class="px-1 py-0.5 text-[10px] text-rose-600 hover:text-rose-800 js-remove-marca" title="Eliminar marca">×</button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="mt-1 flex justify-between items-center">
                        <button type="button" class="px-2 py-0.5 text-[11px] rounded bg-slate-200 hover:bg-slate-300 text-slate-700 js-add-marca">Agregar marca</button>
                        <span class="text-[10px] text-slate-400">La suma por depósito debe ser igual a ${totalDep}.</span>
                    </div>
                </div>
            `;
        });

        if (puedeEditarDesgloseMarca) {
            html += `
                <button type="button" id="btnGuardarStockMarca" class="w-full mt-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold">Guardar desglose por marca</button>
                <p class="mt-1 text-[10px] text-slate-500">Este ajuste solo cambia el reparto por marca dentro de cada depósito. El stock total y por depósito se mantienen.</p>
            `;
        } else {
            html += '<p class="mt-1 text-[10px] text-slate-400">Vista solo lectura: no tienes permisos para editar este desglose.</p>';
        }

        stockMarcaEditorEl.innerHTML = html;

        // Wiring de botones de agregar/eliminar marcas
        const contenedores = stockMarcaEditorEl.querySelectorAll('[data-deposito-id]');
        contenedores.forEach((cont) => {
            const lista = cont.querySelector('.js-deposito-marcas');
            if (!lista) return;

            // Eliminar fila de marca (no permitir dejar el depósito sin ninguna fila)
            lista.addEventListener('click', (ev) => {
                const target = ev.target;
                if (!(target && target.classList && target.classList.contains('js-remove-marca'))) return;
                const filas = lista.querySelectorAll('.js-fila-marca');
                if (filas.length <= 1) {
                    showToast('Debe existir al menos una fila de marca por depósito.', 'warning');
                    return;
                }
                const fila = target.closest('.js-fila-marca');
                if (fila) fila.remove();
            });

            // Agregar nueva fila de marca vacía
            const btnAdd = cont.querySelector('.js-add-marca');
            if (btnAdd) {
                btnAdd.addEventListener('click', () => {
                    const fila = document.createElement('div');
                    fila.className = 'flex items-center gap-1 js-fila-marca';
                    fila.innerHTML = `
                        <input type="text" class="flex-1 px-1 py-0.5 border rounded text-[11px]" placeholder="Marca">
                        <input type="number" step="1" min="0" class="w-16 px-1 py-0.5 border rounded text-[11px] text-right" value="0">
                        <button type="button" class="px-1 py-0.5 text-[10px] text-rose-600 hover:text-rose-800 js-remove-marca" title="Eliminar marca">×</button>
                    `;
                    lista.appendChild(fila);
                });
            }
        });

        // El botón se muestra para admins y vendedores (puedeEditarDesgloseMarca),
        // y aquí también debemos habilitar el handler para ese mismo grupo.
        if (puedeEditarDesgloseMarca) {
            const btnGuardar = document.getElementById('btnGuardarStockMarca');
            if (btnGuardar) {
                btnGuardar.addEventListener('click', async () => {
                    try {
                        const distribucion = [];
                        const errores = [];
                        const conts = stockMarcaEditorEl.querySelectorAll('[data-deposito-id]');
                        conts.forEach((cont) => {
                            const depositoId = parseInt(cont.getAttribute('data-deposito-id') || '0', 10) || 0;
                            const totalEsperado = Number(cont.getAttribute('data-total-cantidad') || 0) || 0;
                            let suma = 0;
                            const filas = cont.querySelectorAll('.js-fila-marca');
                            filas.forEach((fila) => {
                                const inputs = fila.querySelectorAll('input');
                                if (!inputs || inputs.length < 2) return;
                                const marca = (inputs[0].value || '').toString().trim();
                                const cantidad = Number(inputs[1].value || 0) || 0;
                                if (cantidad < 0) return;
                                suma += cantidad;
                                if (cantidad > 0 && marca) {
                                    distribucion.push({ deposito_id: depositoId, marca, cantidad });
                                }
                            });
                            if (Math.abs(suma - totalEsperado) > 1e-6) {
                                errores.push(`Depósito ID ${depositoId}: suma por marca ${suma} ≠ total ${totalEsperado}`);
                            }
                        });

                        if (errores.length) {
                            showToast('No se pudo guardar: ' + errores.join(' | '), 'error', 6000);
                            return;
                        }

                        if (!distribucion.length) {
                            showToast('No hay líneas de marca con cantidades > 0 para guardar.', 'warning');
                            return;
                        }

                        const payload = { codigo: codigo.toUpperCase(), distribucion };
                        const resSave = await fetch('/admin/productos/stock-marca', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const data = await resSave.json();
                        if (!resSave.ok) {
                            throw new Error(data.error || 'Error guardando desglose por marca');
                        }
                        showToast(data.message || 'Desglose por marca actualizado.', 'success');
                        // recargar para reflejar lo guardado
                        await cargarStockMarcaEditor(codigo);
                    } catch (err) {
                        console.error(err);
                        showToast(err.message || 'Error guardando desglose por marca', 'error');
                    }
                });
            }
        }
    } catch (err) {
        console.error(err);
        stockMarcaEditorEl.innerHTML = '<div class="text-[11px] text-rose-500">Error cargando desglose: ' + (err.message || 'Error desconocido') + '</div>';
    }
}

function renderCategoriaSugerencias(list = []) {
    if (!categoriaSugList) return;
    categoriaSugList.innerHTML = '';
    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
        categoriaSugList.classList.add('hidden');
        return;
    }
    items.forEach((cat) => {
        const li = document.createElement('li');
        li.textContent = cat;
        li.addEventListener('click', () => {
            if (f_categoria) f_categoria.value = cat;
            categoriaSugList.classList.add('hidden');
        });
        categoriaSugList.appendChild(li);
    });
    categoriaSugList.classList.remove('hidden');
}

if (f_categoria && categoriaSugList) {
    f_categoria.addEventListener('focus', () => {
        if (!categoriasInventario.length) return;
        renderCategoriaSugerencias(categoriasInventario);
    });

    f_categoria.addEventListener('input', (e) => {
        const q = (e.target.value || '').toString().toLowerCase().trim();
        if (!categoriasInventario.length) return;
        if (!q) {
            renderCategoriaSugerencias(categoriasInventario);
            return;
        }
        const filtered = categoriasInventario.filter((c) => c && c.toString().toLowerCase().includes(q));
        renderCategoriaSugerencias(filtered);
    });

    document.addEventListener('click', (ev) => {
        if (!categoriaSugList) return;
        if (categoriaSugList.contains(ev.target) || f_categoria.contains(ev.target)) return;
        categoriaSugList.classList.add('hidden');
    });
}

function renderMarcaSugerencias(list = []) {
    if (!marcaSugList) return;
    marcaSugList.innerHTML = '';
    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
        marcaSugList.classList.add('hidden');
        return;
    }
    items.forEach((marca) => {
        const li = document.createElement('li');
        li.textContent = marca;
        li.addEventListener('click', () => {
            if (f_marca) f_marca.value = marca;
            marcaSugList.classList.add('hidden');
        });
        marcaSugList.appendChild(li);
    });
    marcaSugList.classList.remove('hidden');
}

if (f_marca && marcaSugList) {
    f_marca.addEventListener('focus', () => {
        if (!marcasInventario.length) return;
        renderMarcaSugerencias(marcasInventario);
    });

    f_marca.addEventListener('input', (e) => {
        const q = (e.target.value || '').toString().toLowerCase().trim();
        if (!marcasInventario.length) return;
        if (!q) {
            renderMarcaSugerencias(marcasInventario);
            return;
        }
        const filtered = marcasInventario.filter((m) => m && m.toString().toLowerCase().includes(q));
        renderMarcaSugerencias(filtered);
    });
}

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
        const descUpper = (p.descripcion || '').toString().toUpperCase();
        movInfo.textContent = `${p.codigo || ''} — ${descUpper} (Stock total: ${p.stock ?? 0})`;
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

// Ejecutar movimiento entre depósitos
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

// Selects con dropdown moderno tipo POS
['pageSize', 'filterCategoria', 'filterStock', 'importMode'].forEach((id) => {
    try { initCustomSelect(id); } catch {}
});

// Tour guiado para Inventario
if (window.GuidedTour) {
    const steps = [
        {
            selector: '#q',
            title: 'Buscar productos',
            text: 'Escribe parte del código, descripción, categoría o marca para filtrar la lista de productos de la izquierda en tiempo real.',
            placement: 'bottom',
            onEnter: () => {
                const filtros = document.getElementById('filtros-inventario');
                if (filtros) filtros.classList.remove('hidden');
            },
        },
        {
            selector: '#filtros-inventario',
            title: 'Filtros por categoría, depósito y stock',
            text: 'Desde aquí ajustas cuántos productos ver por página y filtras por categoría, depósito o nivel de stock (sin stock, bajo, sobre stock).',
            placement: 'bottom',
            onEnter: () => {
                const filtros = document.getElementById('filtros-inventario');
                if (filtros) filtros.classList.remove('hidden');
            },
        },
        {
            selector: '#lista',
            title: 'Listado de productos',
            text: 'Aquí ves los productos con su stock y alertas visuales (sin stock, stock bajo, datos incompletos, etc.). Haz clic en una tarjeta para cargarla en el panel de la derecha.',
            placement: 'top',
        },
        {
            selector: '#paginacion-info',
            title: 'Paginación',
            text: 'Si tienes muchos productos, usa Anterior y Siguiente para moverte entre páginas. Aquí ves cuántos productos se están mostrando.',
            placement: 'top',
        },
        {
            selector: '#panel-editor',
            title: 'Crear y editar productos',
            text: 'En este panel llenas o ajustas los datos del producto: código, descripción, precios, stock, categoría, depósito y motivo de ajuste cuando cambias el stock.',
            placement: 'left',
            onEnter: () => {
                try {
                    if (window.setInventarioEditorVisible) window.setInventarioEditorVisible(true);
                } catch {}
            },
        },
        {
            selector: '#btnEditarMarcas',
            title: 'Marcas por depósito',
            text: 'Con este botón abres un editor donde repartes el stock de este producto entre diferentes marcas dentro de cada depósito.',
            placement: 'left',
            onEnter: () => {
                try {
                    if (window.setInventarioEditorVisible) window.setInventarioEditorVisible(true);
                } catch {}
            },
        },
        {
            selector: '#btnImportCsv',
            title: 'Importar y exportar inventario por CSV',
            text: 'Aquí puedes exportar todo el inventario a CSV y también importar muchos productos a la vez desde un archivo, revisando primero una vista previa.',
            placement: 'top',
            onEnter: () => {
                try {
                    if (window.setInventarioEditorVisible) window.setInventarioEditorVisible(true);
                } catch {}
            },
        },
        {
            selector: '#actividad-producto',
            title: 'Actividad del producto',
            text: 'Al seleccionar un producto ves su última compra y última venta, con accesos rápidos para abrir esas pantallas.',
            placement: 'top',
            onEnter: () => {
                try {
                    if (window.setInventarioEditorVisible) window.setInventarioEditorVisible(true);
                } catch {}
            },
        },
        {
            selector: '#ajustes-list',
            title: 'Historial de ajustes de stock',
            text: 'Aquí se registran los cambios manuales de stock. Al elegir un producto se filtran solo los ajustes relacionados con ese código.',
            placement: 'top',
            onEnter: () => {
                try {
                    if (window.setInventarioEditorVisible) window.setInventarioEditorVisible(true);
                } catch {}
            },
        },
        {
            selector: '#inv-movimientos',
            title: 'Movimientos entre depósitos',
            text: 'En esta sección mueves stock de un depósito a otro y revisas el historial reciente de movimientos por depósito.',
            placement: 'top',
        },
    ];

    const tourId = 'inventario_v1';
    const startTourInventario = (force = false) => {
        window.GuidedTour.start({
            id: tourId,
            steps,
            autoStart: !force,
        });
    };

    const btnInvTour = document.getElementById('btnInvTour');
    if (btnInvTour) {
        btnInvTour.addEventListener('click', () => {
            if (window.GuidedTour.reset && window.GuidedTour.hasSeen && window.GuidedTour.hasSeen(tourId)) {
                window.GuidedTour.reset(tourId);
            }
            startTourInventario(true);
        });
    }

    // Lanzar automáticamente solo la primera vez que entra a Inventario
    startTourInventario(false);
}