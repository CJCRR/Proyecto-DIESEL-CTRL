import { apiFetchJson } from './app-api.js';
import { showToast, escapeHtml } from './app-utils.js';
import { upsertProductoFirebase } from './firebase-sync.js';
import { initCustomSelect } from './modules/ui.js';
import { formatNumber } from './format-utils.js';

let proveedores = [];
let items = [];
let productoSeleccionado = null;
let comprasHistorial = [];
const comprasDetallesCache = {};
let compraExpandidaId = null;
let modalNuevoProducto;
let modalNuevoProductoMsg;
let depositosComprasCargados = false;
let categoriasCompras = [];
let marcasCompras = [];
let compraFocusId = null;

async function cargarCategoriasCompras() {
  const dataList = document.getElementById('npCategoriaOptions');
  const sugList = document.getElementById('npCategoriaSug');
  if (!dataList && !sugList) return;
  try {
    const data = await apiFetchJson('/admin/productos/categorias');
    const categorias = Array.isArray(data.items) ? data.items : [];
    categoriasCompras = categorias;
    if (dataList) {
      dataList.innerHTML = categorias.map(c => `<option value="${c}"></option>`).join('');
    }
    if (sugList) {
      renderCategoriasComprasSug(categoriasCompras);
      sugList.classList.add('hidden');
    }
  } catch (err) {
    console.error(err);
  }
}

async function cargarMarcasCompras() {
  const sugMain = document.getElementById('cMarcaSug');
  const sugModal = document.getElementById('npMarcaSug');
  if (!sugMain && !sugModal) return;
  try {
    const data = await apiFetchJson('/admin/productos/marcas');
    const marcas = Array.isArray(data.items) ? data.items : [];
    marcasCompras = marcas;
    renderMarcasComprasSug(marcasCompras);
    if (sugMain) sugMain.classList.add('hidden');
    if (sugModal) sugModal.classList.add('hidden');
  } catch (err) {
    console.error(err);
  }
}

function renderCategoriasComprasSug(list = []) {
  const sugList = document.getElementById('npCategoriaSug');
  const input = document.getElementById('np_categoria');
  if (!sugList || !input) return;
  sugList.innerHTML = '';
  const items = Array.isArray(list) ? list : [];
  if (!items.length) {
    sugList.classList.add('hidden');
    return;
  }
  items.forEach((cat) => {
    const li = document.createElement('li');
    li.textContent = cat;
    li.addEventListener('click', () => {
      input.value = cat;
      sugList.classList.add('hidden');
    });
    sugList.appendChild(li);
  });
  sugList.classList.remove('hidden');
}

function renderMarcasComprasSug(list = []) {
  const mainSug = document.getElementById('cMarcaSug');
  const mainInput = document.getElementById('c_lote');
  const modalSug = document.getElementById('npMarcaSug');
  const modalInput = document.getElementById('np_marca');
  const items = Array.isArray(list) ? list : [];

  const pairs = [
    [mainSug, mainInput],
    [modalSug, modalInput],
  ];

  pairs.forEach(([ul, input]) => {
    if (!ul || !input) return;
    ul.innerHTML = '';
    if (!items.length) {
      ul.classList.add('hidden');
      return;
    }
    items.forEach((marca) => {
      const li = document.createElement('li');
      li.textContent = marca;
      li.addEventListener('click', () => {
        input.value = marca;
        ul.classList.add('hidden');
      });
      ul.appendChild(li);
    });
    ul.classList.remove('hidden');
  });
}

function formNumber(id, def = 0) {
  const v = parseFloat(document.getElementById(id).value || '');
  return Number.isNaN(v) ? def : v;
}

function formInt(id, def = 0) {
  const v = parseInt(document.getElementById(id).value || '', 10);
  return Number.isNaN(v) ? def : v;
}

function limpiarFormularioCompra() {
  const hoy = new Date().toISOString().slice(0, 10);
  document.getElementById('c_fecha').value = hoy;
  document.getElementById('c_numero').value = '';
  document.getElementById('c_codigo').value = '';
  document.getElementById('c_cantidad').value = '';
  document.getElementById('c_costo').value = '';
  const precioEl = document.getElementById('c_precio');
  if (precioEl) precioEl.value = '';
  document.getElementById('c_lote').value = '';
  productoSeleccionado = null;
  renderProductoInfo();
  items = [];
  renderItems();
  renderResumen();
}

function renderProductoInfo() {
  const info = document.getElementById('c_producto_info');
  if (!info) return;
  if (!productoSeleccionado) {
    info.textContent = '';
    return;
  }
  const p = productoSeleccionado;
  const desc = p.descripcion ? ` - ${p.descripcion}` : '';
  const stock = typeof p.stock === 'number' ? ` | Stock: ${p.stock}` : '';
	const precio = typeof p.precio_usd === 'number' ? ` | Precio ref: $${formatNumber(p.precio_usd, 2)}` : '';
  const marca = p.marca ? ` | Marca: ${p.marca}` : '';
  info.textContent = `Producto: ${p.codigo || ''}${desc}${stock}${precio}${marca}`;
}

function rellenarCamposProductoEnFormulario(prod) {
  if (!prod) return;
  const costoEl = document.getElementById('c_costo');
  const precioEl = document.getElementById('c_precio');
  const marcaEl = document.getElementById('c_lote');

  if (costoEl && typeof prod.costo_usd === 'number') {
    costoEl.value = prod.costo_usd > 0 ? prod.costo_usd.toFixed(2) : '';
  }
  if (precioEl && typeof prod.precio_usd === 'number') {
    precioEl.value = prod.precio_usd > 0 ? prod.precio_usd.toFixed(2) : '';
  }
  if (marcaEl) {
    marcaEl.value = prod.marca || '';
  }
}

function renderItems() {
  const tbody = document.getElementById('c_items');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="p-2 text-center text-slate-400 text-sm">Sin items</td></tr>';
    return;
  }
  const tasa = formNumber('c_tasa', 1) || 1;
  tbody.innerHTML = items
    .map((it, idx) => {
      const subUsd = it.cantidad * it.costo;
      const subBs = subUsd * tasa;
      return `
        <tr>
          <td class="p-2 text-xs font-semibold text-slate-800">${escapeHtml(it.codigo)}</td>
          <td class="p-2 text-xs text-slate-600">${escapeHtml(it.descripcion || '')}</td>
          <td class="p-2 text-xs text-slate-600">${escapeHtml(it.marca || '')}</td>
          <td class="p-2 text-xs text-right">${it.cantidad}</td>
          <td class="p-2 text-xs text-right">$${formatNumber(it.costo, 2)}</td>
          <td class="p-2 text-xs text-right">$${formatNumber(subUsd, 2)}</td>
          <td class="p-2 text-xs text-right">${formatNumber(subBs, 2)}</td>
          <td class="p-2 text-xs text-slate-500">${escapeHtml(it.lote || '')}</td>
            <td class="p-2 text-xs text-right">
            <button data-idx="${idx}" class="btn-trash" title="Quitar item">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M8.78842 5.03866C8.86656 4.96052 8.97254 4.91663 9.08305 4.91663H11.4164C11.5269 4.91663 11.6329 4.96052 11.711 5.03866C11.7892 5.11681 11.833 5.22279 11.833 5.33329V5.74939H8.66638V5.33329C8.66638 5.22279 8.71028 5.11681 8.78842 5.03866ZM7.16638 5.74939V5.33329C7.16638 4.82496 7.36832 4.33745 7.72776 3.978C8.08721 3.61856 8.57472 3.41663 9.08305 3.41663H11.4164C11.9247 3.41663 12.4122 3.61856 12.7717 3.978C13.1311 4.33745 13.333 4.82496 13.333 5.33329V5.74939H15.5C15.9142 5.74939 16.25 6.08518 16.25 6.49939C16.25 6.9136 15.9142 7.24939 15.5 7.24939H15.0105L14.2492 14.7095C14.2382 15.2023 14.0377 15.6726 13.6883 16.0219C13.3289 16.3814 12.8414 16.5833 12.333 16.5833H8.16638C7.65805 16.5833 7.17054 16.3814 6.81109 16.0219C6.46176 15.6726 6.2612 15.2023 6.25019 14.7095L5.48896 7.24939H5C4.58579 7.24939 4.25 6.9136 4.25 6.49939C4.25 6.08518 4.58579 5.74939 5 5.74939H6.16667H7.16638ZM7.91638 7.24996H12.583H13.5026L12.7536 14.5905C12.751 14.6158 12.7497 14.6412 12.7497 14.6666C12.7497 14.7771 12.7058 14.8831 12.6277 14.9613C12.5495 15.0394 12.4436 15.0833 12.333 15.0833H8.16638C8.05588 15.0833 7.94989 15.0394 7.87175 14.9613C7.79361 14.8831 7.74972 14.7771 7.74972 14.6666C7.74972 14.6412 7.74842 14.6158 7.74584 14.5905L6.99681 7.24996H7.91638Z" clip-rule="evenodd" fill-rule="evenodd"></path>
              </svg>
            </button>
            </td>
        </tr>
      `;
    })
    .join('');
  tbody.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (!Number.isNaN(idx)) {
        items.splice(idx, 1);
        renderItems();
        renderResumen();
      }
    });
  });
}

function renderResumen() {
  const tasa = formNumber('c_tasa', 1) || 1;
  let totalUsd = 0;
  items.forEach(it => {
    totalUsd += it.cantidad * it.costo;
  });
  const totalBs = totalUsd * tasa;
  const el = document.getElementById('c_resumen');
  el.textContent = `Items: ${items.length} • Total USD: $${formatNumber(totalUsd, 2)} • Total Bs: ${formatNumber(totalBs, 2)}`;
}

function abrirModalNuevoProducto() {
  if (!modalNuevoProducto) return;
  const codigoInput = document.getElementById('c_codigo');
  const npCodigo = document.getElementById('np_codigo');
  const npDescripcion = document.getElementById('np_descripcion');
  const npPrecio = document.getElementById('np_precio');
  const npCosto = document.getElementById('np_costo');
  const npStock = document.getElementById('np_stock');
  const npCategoria = document.getElementById('np_categoria');
  const npMarca = document.getElementById('np_marca');
  const npDeposito = document.getElementById('np_deposito');

  if (modalNuevoProductoMsg) modalNuevoProductoMsg.textContent = '';

  // Prefill con código actual si existe
  if (codigoInput && npCodigo) {
    npCodigo.value = (codigoInput.value || '').trim();
  }
  if (npDescripcion) npDescripcion.value = '';
  if (npPrecio) npPrecio.value = '';
  if (npCosto) npCosto.value = '';
  if (npStock) npStock.value = '0';
  if (npCategoria) npCategoria.value = '';
  if (npMarca) npMarca.value = '';
  if (npDeposito) npDeposito.value = '';

  modalNuevoProducto.classList.remove('hidden');
}

function cerrarModalNuevoProducto() {
  if (!modalNuevoProducto) return;
  modalNuevoProducto.classList.add('hidden');
}

async function crearProductoDesdeCompras(event) {
  event.preventDefault();
  const npCodigo = document.getElementById('np_codigo');
  const npDescripcion = document.getElementById('np_descripcion');
  const npPrecio = document.getElementById('np_precio');
  const npCosto = document.getElementById('np_costo');
  const npStock = document.getElementById('np_stock');
  const npCategoria = document.getElementById('np_categoria');
  const npMarca = document.getElementById('np_marca');
  const npDeposito = document.getElementById('np_deposito');

  const body = {
    codigo: (npCodigo.value || '').trim().toUpperCase(),
    descripcion: (npDescripcion.value || '').trim().toUpperCase(),
    precio_usd: parseFloat(npPrecio.value || '0'),
    costo_usd: parseFloat(npCosto.value || '0') || 0,
    stock: parseInt(npStock.value || '0', 10) || 0,
    categoria: (npCategoria.value || '').trim(),
    marca: (npMarca.value || '').trim(),
    deposito_id: (npDeposito && npDeposito.value) ? parseInt(npDeposito.value, 10) : null,
  };

  if (!body.codigo || !body.descripcion || !body.precio_usd || body.precio_usd <= 0) {
    if (modalNuevoProductoMsg) {
      modalNuevoProductoMsg.textContent = 'Código, descripción y precio son obligatorios.';
    }
    return;
  }

  try {
    const res = await apiFetchJson('/admin/productos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (modalNuevoProductoMsg) {
      modalNuevoProductoMsg.textContent = '';
    }
    showToast(res.message || 'Producto creado', 'success');

    // Cerrar modal y preseleccionar el producto recién creado en el campo de código
    cerrarModalNuevoProducto();
    const codigoInput = document.getElementById('c_codigo');
    if (codigoInput) {
      codigoInput.value = body.codigo;
      await cargarProductoPorCodigo(body.codigo);
    }
  } catch (err) {
    console.error(err);
    if (modalNuevoProductoMsg) {
      modalNuevoProductoMsg.textContent = err.message || 'Error creando producto';
    }
  }
}

async function cargarDepositosCompras() {
  if (depositosComprasCargados) return;
  const npDeposito = document.getElementById('np_deposito');
  const cDeposito = document.getElementById('c_deposito');
  if (!npDeposito && !cDeposito) return;
  try {
    const res = await apiFetchJson('/depositos?soloActivos=1');
    const items = Array.isArray(res) ? res : [];
    const optionsHtml = items.map(d => `<option value="${d.id}">${escapeHtml(d.nombre || '')}</option>`).join('');
    if (npDeposito) {
      npDeposito.innerHTML = '<option value="">(Depósito principal)</option>' + optionsHtml;
    }
    if (cDeposito) {
      cDeposito.innerHTML = '<option value="">Depósito destino (opcional)</option>' + optionsHtml;
    }
    depositosComprasCargados = true;
  } catch (err) {
    console.error(err);
    if (npDeposito) npDeposito.innerHTML = '<option value="">(Depósito principal)</option>';
    if (cDeposito) cDeposito.innerHTML = '<option value="">Depósito destino (opcional)</option>';
  }
}

async function cargarProveedoresParaSelect() {
  try {
  const data = await apiFetchJson('/api/proveedores?soloActivos=1');
    proveedores = Array.isArray(data) ? data : [];
    const sel = document.getElementById('c_proveedor');
    const selFiltro = document.getElementById('c_filtro_proveedor');
    sel.innerHTML = '<option value="">(Sin proveedor)</option>' + proveedores.map(p => `<option value="${p.id}">${escapeHtml(p.nombre || '')}</option>`).join('');
    selFiltro.innerHTML = '<option value="">Todos los proveedores</option>' + proveedores.map(p => `<option value="${p.id}">${escapeHtml(p.nombre || '')}</option>`).join('');

    try {
      initCustomSelect('c_proveedor');
      initCustomSelect('c_filtro_proveedor');
    } catch {}
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error cargando proveedores', 'error');
  }
}

function agregarItemDesdeFormulario() {
  const codigo = document.getElementById('c_codigo').value.trim();
  const cantidad = formInt('c_cantidad', 0);
  const costoInputEl = document.getElementById('c_costo');
  const costoRaw = (costoInputEl && costoInputEl.value ? costoInputEl.value : '').trim();
  let costo;
  let usarCostoAnterior = false;
  const precioInputEl = document.getElementById('c_precio');
  const precioRaw = (precioInputEl && precioInputEl.value ? precioInputEl.value : '').trim();
  let precio = null;
  let usarPrecioAnterior = true;
  const marcaInput = document.getElementById('c_lote').value.trim();

  if (!codigo) {
    showToast('El código es requerido', 'error');
    return;
  }
  if (cantidad <= 0) {
    showToast('La cantidad debe ser mayor a 0', 'error');
    return;
  }
  if (costoRaw === '') {
    usarCostoAnterior = true;
    if (productoSeleccionado && typeof productoSeleccionado.costo_usd === 'number') {
      costo = productoSeleccionado.costo_usd;
    } else {
      costo = 0;
    }
  } else {
    costo = formNumber('c_costo', 0);
  }

  if (costo < 0) {
    showToast('El costo no puede ser negativo', 'error');
    return;
  }

  if (precioRaw !== '') {
    const precioNum = parseFloat(precioRaw);
    if (Number.isNaN(precioNum) || precioNum < 0) {
      showToast('El precio no puede ser negativo', 'error');
      return;
    }
    precio = precioNum;
    usarPrecioAnterior = false;
  }

  const desc = productoSeleccionado && productoSeleccionado.codigo === codigo
    ? (productoSeleccionado.descripcion || '')
    : '';

  const marcaBase = productoSeleccionado && productoSeleccionado.codigo === codigo
    ? (productoSeleccionado.marca || '')
    : '';

  const marca = marcaInput || marcaBase;

  const depSelect = document.getElementById('c_deposito');
  const depositoId = depSelect && depSelect.value ? (parseInt(depSelect.value, 10) || null) : null;
  const depositoNombre = depSelect && depSelect.value
    ? (depSelect.options[depSelect.selectedIndex]?.textContent || '').trim()
    : '';

  items.push({
    codigo,
    descripcion: desc,
    marca,
    cantidad,
    costo,
    usarCostoAnterior,
    precio,
    usarPrecioAnterior,
    lote: '',
    deposito_id: depositoId,
    deposito_nombre: depositoNombre,
  });
  document.getElementById('c_codigo').value = '';
  document.getElementById('c_cantidad').value = '';
  document.getElementById('c_costo').value = '';
  if (precioInputEl) precioInputEl.value = '';
  document.getElementById('c_lote').value = '';
  productoSeleccionado = null;
  renderProductoInfo();
  const sug = document.getElementById('c_sugerencias');
  if (sug) sug.classList.add('hidden');
  renderItems();
  renderResumen();
}

async function guardarCompra() {
  if (!items.length) {
    showToast('Agregue al menos un item', 'error');
    return;
  }
  const proveedorIdVal = document.getElementById('c_proveedor').value || '';
  const payload = {
    proveedor_id: proveedorIdVal ? parseInt(proveedorIdVal, 10) : null,
    fecha: document.getElementById('c_fecha').value || new Date().toISOString(),
    numero: document.getElementById('c_numero').value.trim(),
    tasa_bcv: formNumber('c_tasa', 1),
    notas: '',
    items: items.map(it => ({
      codigo: it.codigo,
      descripcion: it.descripcion,
      marca: it.marca,
      cantidad: it.cantidad,
      // Si el usuario dejó el costo en blanco, enviamos null para que el backend use el costo anterior
      costo_usd: it.usarCostoAnterior ? null : it.costo,
      // Si el usuario no cambió el precio, enviamos null para no tocar el precio de venta
      precio_venta_usd: it.usarPrecioAnterior ? null : it.precio,
      lote: '',
      observaciones: it.observaciones,
      deposito_id: it.deposito_id != null ? it.deposito_id : null,
    })),
  };

  try {
  const saved = await apiFetchJson('/api/compras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showToast('Compra registrada y stock actualizado', 'success');

    // Sincronizar stock y datos del producto en Firebase para los códigos comprados
    try {
      const codigos = [...new Set(items.map(it => (it && it.codigo ? String(it.codigo).trim() : '')).filter(Boolean))];
      for (const codigo of codigos) {
        try {
          const prod = await apiFetchJson(`/productos/${encodeURIComponent(codigo)}`);
          if (!prod || prod.error) continue;
          await upsertProductoFirebase({
            codigo: prod.codigo,
            descripcion: prod.descripcion,
            precio_usd: prod.precio_usd,
            costo_usd: prod.costo_usd,
            stock: prod.stock,
            categoria: prod.categoria,
            marca: prod.marca,
            deposito_id: prod.deposito_id || null,
          });
        } catch (syncErrProd) {
          console.warn('No se pudo sincronizar producto a Firebase tras compra', codigo, syncErrProd);
        }
      }
    } catch (syncErrList) {
      console.warn('No se pudo preparar sincronización de productos tras compra', syncErrList);
    }

    limpiarFormularioCompra();
    cargarHistorialCompras();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error registrando compra', 'error');
  }
}

async function buscarProductos(q) {
  const lista = document.getElementById('c_sugerencias');
  if (!lista) return;
  if (!q || q.length < 2) {
     lista.innerHTML = '';
     lista.classList.add('hidden');
     return;
  }
  try {
    const data = await apiFetchJson(`/buscar?q=${encodeURIComponent(q)}`);
    const results = Array.isArray(data) ? data : [];
    if (!results.length) {
      lista.innerHTML = '<li class="p-3 text-[11px] text-slate-400">Sin coincidencias</li>';
      lista.classList.remove('hidden');
      return;
    }
    lista.innerHTML = results.map(p => {
      const desc = (p.descripcion || '').toString().toUpperCase();
      const marca = p.marca ? `Marca: ${escapeHtml(p.marca)} · ` : '';
      const stock = typeof p.stock === 'number' ? `Stock: ${p.stock}` : '';
      const precio = typeof p.precio_usd === 'number' ? ` · $${formatNumber(p.precio_usd, 2)}` : '';
      return `
        <li data-cod="${escapeHtml(p.codigo)}" class="p-3 border-b last:border-b-0 hover:bg-slate-50 cursor-pointer flex justify-between items-center text-sm">
          <div class="flex flex-col">
            <span class="font-semibold text-slate-700 text-xs">${escapeHtml(p.codigo)}</span>
            <span class="text-[11px] text-slate-400">${escapeHtml(desc)}</span>
          </div>
          <div class="flex flex-col items-end text-[11px] text-slate-400">
            <span>${marca}${stock}${precio}</span>
          </div>
        </li>
      `;
    }).join('');
    lista.classList.remove('hidden');
    lista.querySelectorAll('li[data-cod]').forEach(li => {
      li.addEventListener('click', () => {
        const cod = li.getAttribute('data-cod');
        const prod = results.find(p => p.codigo === cod) || null;
        if (prod) {
          productoSeleccionado = prod;
          const inp = document.getElementById('c_codigo');
          if (inp) inp.value = prod.codigo;
          renderProductoInfo();
          rellenarCamposProductoEnFormulario(prod);
        }
        lista.classList.add('hidden');
      });
    });
  } catch (err) {
    console.error(err);
  }
}

async function cargarProductoPorCodigo(codigo) {
  if (!codigo) return;
  try {
    const prod = await apiFetchJson(`/productos/${encodeURIComponent(codigo)}`);
    productoSeleccionado = prod || null;
    renderProductoInfo();
    if (productoSeleccionado) {
      rellenarCamposProductoEnFormulario(productoSeleccionado);
    }
  } catch (err) {
    productoSeleccionado = null;
    renderProductoInfo();
  }
}

async function cargarHistorialCompras() {
  try {
    const proveedorFiltro = document.getElementById('c_filtro_proveedor').value || '';
    const qs = proveedorFiltro ? `?proveedor_id=${encodeURIComponent(proveedorFiltro)}` : '';
	const data = await apiFetchJson(`/api/compras${qs}`);
    const tbody = document.getElementById('c_historial');
    const list = Array.isArray(data) ? data : [];
    comprasHistorial = list;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="p-2 text-center text-slate-400 text-sm">Sin compras registradas</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(c => {
      const totalUsd = c.total_usd || 0;
      const totalBs = c.total_bs || 0;
      const fechaStr = c.fecha ? new Date(c.fecha).toLocaleDateString() : '';
      const id = c.id;
      return `
        <tr class="cursor-pointer hover:bg-slate-50" data-compra-id="${id}">
          <td class="p-2 text-xs">${escapeHtml(fechaStr)}</td>
          <td class="p-2 text-xs">${escapeHtml(c.proveedor_nombre || '')}</td>
          <td class="p-2 text-xs text-right">$${formatNumber(totalUsd, 2)}</td>
          <td class="p-2 text-xs text-right">${formatNumber(totalBs, 2)}</td>
        </tr>
        <tr class="bg-slate-50 hidden" data-compra-detalle-id="${id}">
          <td colspan="4" class="p-2">
            <div id="compra_detalle_${id}" class="text-xs text-slate-600"></div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('tr[data-compra-id]').forEach(row => {
      row.addEventListener('click', () => {
        const idStr = row.getAttribute('data-compra-id');
        const id = parseInt(idStr, 10);
        if (!Number.isNaN(id)) {
          toggleDetalleCompra(id);
        }
      });
    });

    // Si venimos con un ID específico en la URL, abrir directamente esa compra
    if (compraFocusId != null) {
      toggleDetalleCompra(compraFocusId);
      const row = tbody.querySelector(`tr[data-compra-id="${compraFocusId}"]`);
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      compraFocusId = null;
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error cargando historial de compras', 'error');
  }
}

async function toggleDetalleCompra(id) {
  const detalleRow = document.querySelector(`tr[data-compra-detalle-id="${id}"]`);
  if (!detalleRow) return;

  // Cerrar si ya está abierta
  if (compraExpandidaId === id) {
    detalleRow.classList.add('hidden');
    compraExpandidaId = null;
    return;
  }

  // Cerrar la anterior
  if (compraExpandidaId != null) {
    const prev = document.querySelector(`tr[data-compra-detalle-id="${compraExpandidaId}"]`);
    if (prev) prev.classList.add('hidden');
  }

  // Cargar detalles si no están en cache
  if (!comprasDetallesCache[id]) {
    try {
    const data = await apiFetchJson(`/api/compras/${id}`);
      comprasDetallesCache[id] = data;
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error cargando detalle de compra', 'error');
      return;
    }
  }

  const data = comprasDetallesCache[id];
  const cont = document.getElementById(`compra_detalle_${id}`);
  if (!cont || !data) return;

  const { compra, detalles } = data;
  const itemsDet = Array.isArray(detalles) ? detalles : [];
  const header = `
    <div class="flex justify-between items-center mb-2">
      <div>
        <div class="font-semibold text-slate-700">Compra #${compra.id || ''} ${compra.numero ? `- ${escapeHtml(compra.numero)}` : ''}</div>
        <div class="text-[11px] text-slate-500">Tasa BCV: ${compra.tasa_bcv || 1} ${compra.notas ? `| Notas: ${escapeHtml(compra.notas)}` : ''}</div>
      </div>
        <div class="text-[11px] text-slate-500 text-right">
        <div>Total USD: $${formatNumber(compra.total_usd || 0, 2)}</div>
        <div>Total Bs: ${formatNumber(compra.total_bs || 0, 2)}</div>
      </div>
    </div>
  `;

  let tabla = '';
  if (!itemsDet.length) {
    tabla = '<div class="text-[11px] text-slate-400">Sin items en esta compra</div>';
  } else {
    tabla = `
      <div class="overflow-auto max-h-60 border rounded-lg bg-white">
        <table class="w-full text-[11px]">
          <thead class="bg-slate-100 text-slate-500 uppercase">
            <tr>
              <th class="p-2 text-left">Código</th>
              <th class="p-2 text-left">Descripción</th>
              <th class="p-2 text-left">Marca</th>
              <th class="p-2 text-right">Cant.</th>
              <th class="p-2 text-right">Costo USD</th>
              <th class="p-2 text-right">Subtotal USD</th>
              <th class="p-2 text-right">Subtotal Bs</th>
              <th class="p-2 text-left">Lote</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            ${itemsDet.map(d => {
              const subUsd = (d.costo_usd || 0) * (d.cantidad || 0);
              const subBs = d.subtotal_bs || 0;
              return `
                <tr>
                  <td class="p-2">${escapeHtml(d.codigo || '')}</td>
                  <td class="p-2">${escapeHtml((d.descripcion || d.producto_descripcion_db || '').toString().toUpperCase())}</td>
                  <td class="p-2">${escapeHtml(d.marca || d.producto_marca_db || '')}</td>
                  <td class="p-2 text-right">${d.cantidad || 0}</td>
                  <td class="p-2 text-right">$${formatNumber(d.costo_usd || 0, 2)}</td>
                  <td class="p-2 text-right">$${formatNumber(subUsd, 2)}</td>
                  <td class="p-2 text-right">${formatNumber(subBs, 2)}</td>
                  <td class="p-2">${escapeHtml(d.lote || '')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  cont.innerHTML = header + tabla;
  detalleRow.classList.remove('hidden');
  compraExpandidaId = id;
}

function setupUI() {
  document.getElementById('btnAgregarItemCompra').addEventListener('click', (e) => {
    e.preventDefault();
    agregarItemDesdeFormulario();
  });
  document.getElementById('btnGuardarCompra').addEventListener('click', (e) => {
    e.preventDefault();
    guardarCompra();
  });
  document.getElementById('btnNuevaCompra').addEventListener('click', (e) => {
    e.preventDefault();
    limpiarFormularioCompra();
  });
  document.getElementById('c_tasa').addEventListener('input', () => {
    renderItems();
    renderResumen();
  });
  const codigoInput = document.getElementById('c_codigo');
  if (codigoInput) {
    codigoInput.addEventListener('input', () => {
      buscarProductos(codigoInput.value.trim());
    });
    codigoInput.addEventListener('blur', () => {
      setTimeout(() => {
        const val = codigoInput.value.trim();
        if (val) cargarProductoPorCodigo(val);
      }, 200);
    });
  }
  document.getElementById('c_filtro_proveedor').addEventListener('change', () => {
    cargarHistorialCompras();
  });

  // Modal nuevo producto
  modalNuevoProducto = document.getElementById('modal-nuevo-producto');
  modalNuevoProductoMsg = document.getElementById('modal-nuevo-producto-msg');
  const btnNuevoProducto = document.getElementById('btnNuevoProducto');
  const btnCerrarModal = document.getElementById('modal-nuevo-producto-cerrar');
  const btnCancelarModal = document.getElementById('modal-nuevo-producto-cancelar');
  const formNuevoProducto = document.getElementById('formNuevoProducto');

  if (btnNuevoProducto && modalNuevoProducto) {
    btnNuevoProducto.addEventListener('click', (e) => {
      e.preventDefault();
      abrirModalNuevoProducto();
    });
  }
  if (btnCerrarModal && modalNuevoProducto) {
    btnCerrarModal.addEventListener('click', (e) => {
      e.preventDefault();
      cerrarModalNuevoProducto();
    });
  }
  if (btnCancelarModal && modalNuevoProducto) {
    btnCancelarModal.addEventListener('click', (e) => {
      e.preventDefault();
      cerrarModalNuevoProducto();
    });
  }
  if (formNuevoProducto) {
    formNuevoProducto.addEventListener('submit', crearProductoDesdeCompras);
  }

  // Cargar depósitos para el modal de nuevo producto
  cargarDepositosCompras();

  // Dropdown de categorías en el modal de nuevo producto
  const npCatInput = document.getElementById('np_categoria');
  const npCatSug = document.getElementById('npCategoriaSug');
  if (npCatInput && npCatSug) {
    npCatInput.addEventListener('focus', () => {
      if (!categoriasCompras.length) return;
      renderCategoriasComprasSug(categoriasCompras);
    });

    npCatInput.addEventListener('input', (e) => {
      const q = (e.target.value || '').toString().toLowerCase().trim();
      if (!categoriasCompras.length) return;
      if (!q) {
        renderCategoriasComprasSug(categoriasCompras);
        return;
      }
      const filtered = categoriasCompras.filter(c => c && c.toString().toLowerCase().includes(q));
      renderCategoriasComprasSug(filtered);
    });

    document.addEventListener('click', (ev) => {
      if (!npCatSug) return;
      if (npCatSug.contains(ev.target) || npCatInput.contains(ev.target)) return;
      npCatSug.classList.add('hidden');
    });
  }

  // Dropdown de marcas en formulario principal y modal
  const cMarcaInput = document.getElementById('c_lote');
  const cMarcaSug = document.getElementById('cMarcaSug');
  if (cMarcaInput && cMarcaSug) {
    cMarcaInput.addEventListener('focus', () => {
      if (!marcasCompras.length) return;
      renderMarcasComprasSug(marcasCompras);
    });
    cMarcaInput.addEventListener('input', (e) => {
      const q = (e.target.value || '').toString().toLowerCase().trim();
      if (!marcasCompras.length) return;
      if (!q) {
        renderMarcasComprasSug(marcasCompras);
        return;
      }
      const filtered = marcasCompras.filter(m => m && m.toString().toLowerCase().includes(q));
      renderMarcasComprasSug(filtered);
    });
    document.addEventListener('click', (ev) => {
      if (!cMarcaSug) return;
      if (cMarcaSug.contains(ev.target) || cMarcaInput.contains(ev.target)) return;
      cMarcaSug.classList.add('hidden');
    });
  }

  const npMarcaInput = document.getElementById('np_marca');
  const npMarcaSug = document.getElementById('npMarcaSug');
  if (npMarcaInput && npMarcaSug) {
    npMarcaInput.addEventListener('focus', () => {
      if (!marcasCompras.length) return;
      renderMarcasComprasSug(marcasCompras);
    });
    npMarcaInput.addEventListener('input', (e) => {
      const q = (e.target.value || '').toString().toLowerCase().trim();
      if (!marcasCompras.length) return;
      if (!q) {
        renderMarcasComprasSug(marcasCompras);
        return;
      }
      const filtered = marcasCompras.filter(m => m && m.toString().toLowerCase().includes(q));
      renderMarcasComprasSug(filtered);
    });
    document.addEventListener('click', (ev) => {
      if (!npMarcaSug) return;
      if (npMarcaSug.contains(ev.target) || npMarcaInput.contains(ev.target)) return;
      npMarcaSug.classList.add('hidden');
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const foco = params.get('compra_id');
    if (foco) {
      const idNum = parseInt(foco, 10);
      if (!Number.isNaN(idNum) && idNum > 0) {
        compraFocusId = idNum;
      }
    }
  } catch {}
  setupUI();
  limpiarFormularioCompra();
  cargarProveedoresParaSelect();
  cargarHistorialCompras();
  cargarCategoriasCompras();
  cargarMarcasCompras();
});
