import { apiFetchJson } from './app-api.js';
import { showToast, escapeHtml } from './app-utils.js';

let proveedores = [];
let proveedorSeleccionadoId = null;

function limpiarFormulario() {
  proveedorSeleccionadoId = null;
  document.getElementById('p_nombre').value = '';
  document.getElementById('p_rif').value = '';
  document.getElementById('p_telefono').value = '';
  document.getElementById('p_email').value = '';
  document.getElementById('p_direccion').value = '';
  document.getElementById('p_notas').value = '';
  document.getElementById('p_activo').value = '1';
}

function llenarFormulario(prov) {
  proveedorSeleccionadoId = prov.id;
  document.getElementById('p_nombre').value = prov.nombre || '';
  document.getElementById('p_rif').value = prov.rif || '';
  document.getElementById('p_telefono').value = prov.telefono || '';
  document.getElementById('p_email').value = prov.email || '';
  document.getElementById('p_direccion').value = prov.direccion || '';
  document.getElementById('p_notas').value = prov.notas || '';
  document.getElementById('p_activo').value = prov.activo ? '1' : '0';
}

function renderTabla() {
  const tbody = document.getElementById('p_tabla');
  const q = (document.getElementById('p_buscar').value || '').toLowerCase().trim();
  let list = proveedores || [];
  if (q) {
    list = list.filter(p => {
      return (
        (p.nombre || '').toLowerCase().includes(q) ||
        (p.rif || '').toLowerCase().includes(q)
      );
    });
  }
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-slate-400 text-sm">Sin proveedores</td></tr>';
    return;
  }
  tbody.innerHTML = list
    .map(p => {
      const estado = p.activo ? '<span class="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">Activo</span>' : '<span class="px-2 py-1 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold">Inactivo</span>';
      return `
        <tr class="hover:bg-slate-50 cursor-pointer" data-id="${p.id}">
          <td class="p-3 text-sm font-semibold text-slate-800">${escapeHtml(p.nombre || '')}</td>
          <td class="p-3 text-sm text-slate-600">${escapeHtml(p.rif || '')}</td>
          <td class="p-3 text-sm text-slate-600">${escapeHtml(p.telefono || '')}</td>
          <td class="p-3 text-sm">${estado}</td>
        </tr>
      `;
    })
    .join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const id = parseInt(tr.getAttribute('data-id'), 10);
      const prov = proveedores.find(p => p.id === id);
      if (prov) llenarFormulario(prov);
    });
  });
}

async function cargarProveedores() {
  try {
    const data = await apiFetchJson('/proveedores');
    proveedores = Array.isArray(data) ? data : [];
    renderTabla();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error cargando proveedores', 'error');
  }
}

async function guardarProveedor() {
  const payload = {
    nombre: document.getElementById('p_nombre').value.trim(),
    rif: document.getElementById('p_rif').value.trim(),
    telefono: document.getElementById('p_telefono').value.trim(),
    email: document.getElementById('p_email').value.trim(),
    direccion: document.getElementById('p_direccion').value.trim(),
    notas: document.getElementById('p_notas').value.trim(),
    activo: document.getElementById('p_activo').value === '1',
  };

  try {
    let saved;
    if (proveedorSeleccionadoId) {
      saved = await apiFetchJson(`/proveedores/${proveedorSeleccionadoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      saved = await apiFetchJson('/proveedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    const idx = proveedores.findIndex(p => p.id === saved.id);
    if (idx >= 0) {
      proveedores[idx] = saved;
    } else {
      proveedores.unshift(saved);
    }
    showToast('Proveedor guardado', 'success');
    renderTabla();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error guardando proveedor', 'error');
  }
}

function setupUI() {
  document.getElementById('p_buscar').addEventListener('input', () => renderTabla());
  document.getElementById('btnGuardarProveedor').addEventListener('click', (e) => {
    e.preventDefault();
    guardarProveedor();
  });
  document.getElementById('btnNuevoProveedor').addEventListener('click', (e) => {
    e.preventDefault();
    limpiarFormulario();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setupUI();
  limpiarFormulario();
  cargarProveedores();
});
