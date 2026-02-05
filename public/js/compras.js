import { apiFetchJson } from './app-api.js';
import { showToast, escapeHtml } from './app-utils.js';

let proveedores = [];
let items = [];
let productoSeleccionado = null;
let comprasHistorial = [];
const comprasDetallesCache = {};
let compraExpandidaId = null;

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
  const precio = typeof p.precio_usd === 'number' ? ` | Precio ref: $${p.precio_usd.toFixed(2)}` : '';
  const marca = p.marca ? ` | Marca: ${p.marca}` : '';
  info.textContent = `Producto: ${p.codigo || ''}${desc}${stock}${precio}${marca}`;
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
          <td class="p-2 text-xs text-right">$${it.costo.toFixed(2)}</td>
          <td class="p-2 text-xs text-right">$${subUsd.toFixed(2)}</td>
          <td class="p-2 text-xs text-right">${subBs.toFixed(2)}</td>
          <td class="p-2 text-xs text-slate-500">${escapeHtml(it.lote || '')}</td>
          <td class="p-2 text-xs text-right">
            <button data-idx="${idx}" class="text-red-500 hover:text-red-700"><i class="fas fa-trash"></i></button>
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
  el.textContent = `Items: ${items.length} • Total USD: $${totalUsd.toFixed(2)} • Total Bs: ${totalBs.toFixed(2)}`;
}

async function cargarProveedoresParaSelect() {
  try {
    const data = await apiFetchJson('/proveedores?soloActivos=1');
    proveedores = Array.isArray(data) ? data : [];
    const sel = document.getElementById('c_proveedor');
    const selFiltro = document.getElementById('c_filtro_proveedor');
    sel.innerHTML = '<option value="">(Sin proveedor)</option>' + proveedores.map(p => `<option value="${p.id}">${escapeHtml(p.nombre || '')}</option>`).join('');
    selFiltro.innerHTML = '<option value="">Todos los proveedores</option>' + proveedores.map(p => `<option value="${p.id}">${escapeHtml(p.nombre || '')}</option>`).join('');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error cargando proveedores', 'error');
  }
}

function agregarItemDesdeFormulario() {
  const codigo = document.getElementById('c_codigo').value.trim();
  const cantidad = formInt('c_cantidad', 0);
  const costo = formNumber('c_costo', 0);
  const lote = document.getElementById('c_lote').value.trim();

  if (!codigo || cantidad <= 0 || costo <= 0) {
    showToast('Código, cantidad y costo son requeridos', 'error');
    return;
  }

  const desc = productoSeleccionado && productoSeleccionado.codigo === codigo
    ? (productoSeleccionado.descripcion || '')
    : '';

  const marca = productoSeleccionado && productoSeleccionado.codigo === codigo
    ? (productoSeleccionado.marca || '')
    : '';

  items.push({ codigo, descripcion: desc, marca, cantidad, costo, lote });
  document.getElementById('c_codigo').value = '';
  document.getElementById('c_cantidad').value = '';
  document.getElementById('c_costo').value = '';
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
      costo_usd: it.costo,
      lote: it.lote,
      observaciones: it.observaciones,
    })),
  };

  try {
    const saved = await apiFetchJson('/compras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showToast('Compra registrada y stock actualizado', 'success');
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
      lista.innerHTML = '<li class="px-3 py-2 text-[11px] text-slate-400">Sin coincidencias</li>';
      lista.classList.remove('hidden');
      return;
    }
    lista.innerHTML = results.map(p => {
      const desc = p.descripcion || '';
      const marca = p.marca ? `Marca: ${escapeHtml(p.marca)} · ` : '';
      const stock = typeof p.stock === 'number' ? `Stock: ${p.stock}` : '';
      const precio = typeof p.precio_usd === 'number' ? ` · $${p.precio_usd.toFixed(2)}` : '';
      return `
        <li data-cod="${escapeHtml(p.codigo)}" class="px-3 py-2 border-b last:border-b-0 hover:bg-slate-50 cursor-pointer flex justify-between items-center">
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
  } catch (err) {
    productoSeleccionado = null;
    renderProductoInfo();
  }
}

async function cargarHistorialCompras() {
  try {
    const proveedorFiltro = document.getElementById('c_filtro_proveedor').value || '';
    const qs = proveedorFiltro ? `?proveedor_id=${encodeURIComponent(proveedorFiltro)}` : '';
    const data = await apiFetchJson(`/compras${qs}`);
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
          <td class="p-2 text-xs text-right">$${totalUsd.toFixed(2)}</td>
          <td class="p-2 text-xs text-right">${totalBs.toFixed(2)}</td>
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
      const data = await apiFetchJson(`/compras/${id}`);
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
        <div>Total USD: $${(compra.total_usd || 0).toFixed(2)}</div>
        <div>Total Bs: ${(compra.total_bs || 0).toFixed(2)}</div>
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
                  <td class="p-2">${escapeHtml(d.descripcion || d.producto_descripcion_db || '')}</td>
                  <td class="p-2">${escapeHtml(d.marca || d.producto_marca_db || '')}</td>
                  <td class="p-2 text-right">${d.cantidad || 0}</td>
                  <td class="p-2 text-right">$${(d.costo_usd || 0).toFixed(2)}</td>
                  <td class="p-2 text-right">$${subUsd.toFixed(2)}</td>
                  <td class="p-2 text-right">${subBs.toFixed(2)}</td>
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
}

window.addEventListener('DOMContentLoaded', () => {
  setupUI();
  limpiarFormularioCompra();
  cargarProveedoresParaSelect();
  cargarHistorialCompras();
});
