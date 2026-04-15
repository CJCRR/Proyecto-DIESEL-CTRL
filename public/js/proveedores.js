import { apiFetchJson } from './app-api.js';
import { showToast, escapeHtml } from './app-utils.js';
import { initCustomSelect } from './modules/ui.js';

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
  const data = await apiFetchJson('/api/proveedores');
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
	  saved = await apiFetchJson(`/api/proveedores/${proveedorSeleccionadoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
    saved = await apiFetchJson('/api/proveedores', {
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
  try { initCustomSelect('p_activo'); } catch {}
});

// Tour guiado de la pantalla de proveedores
if (window.GuidedTour) {
  const proveedoresTourId = 'proveedores_v1';

  const proveedoresSteps = [
    {
      selector: '#proveedores-form',
      title: 'Formulario del proveedor',
      text: 'Aquí completas la ficha del proveedor: datos básicos, contacto y observaciones.',
      placement: 'right',
    },
    {
      selector: '#p_nombre',
      title: 'Nombre del proveedor',
      text: 'Escribe el nombre comercial del proveedor. Es el dato principal que verás en la lista.',
      placement: 'bottom',
    },
    {
      selector: '#p_rif',
      title: 'RIF o identificación',
      text: 'Coloca el RIF o identificación fiscal. Ayuda a evitar duplicados y facilita la búsqueda.',
      placement: 'bottom',
    },
    {
      selector: '#p_telefono',
      title: 'Teléfono y contacto',
      text: 'Opcionalmente agrega un teléfono para contactar rápido al proveedor.',
      placement: 'bottom',
    },
    {
      selector: '#p_email',
      title: 'Email y estado activo',
      text: 'Puedes guardar el correo del proveedor y marcar si está activo o no según si sigues trabajando con él.',
      placement: 'bottom',
    },
    {
      selector: '#p_notas',
      title: 'Notas y condiciones especiales',
      text: 'Usa este espacio para condiciones de pago, marcas que maneja, tiempos de entrega u otros detalles importantes.',
      placement: 'top',
    },
    {
      selector: '#btnGuardarProveedor',
      title: 'Guardar o actualizar proveedor',
      text: 'Con este botón guardas un nuevo proveedor o actualizas uno existente. El formulario se llena al seleccionar desde la lista.',
      placement: 'top',
    },
    {
      selector: '#btnNuevoProveedor',
      title: 'Limpiar el formulario',
      text: 'Si quieres cargar un nuevo proveedor desde cero, usa este botón para limpiar todos los campos.',
      placement: 'top',
    },
    {
      selector: '#proveedores-lista-header',
      title: 'Listado y búsqueda de proveedores',
      text: 'En esta sección ves todos los proveedores registrados y puedes filtrar por nombre o RIF usando la barra de búsqueda.',
      placement: 'bottom',
    },
    {
      selector: '#proveedores-tabla-wrapper',
      title: 'Seleccionar un proveedor existente',
      text: 'Haz clic sobre una fila para cargar los datos de ese proveedor en el formulario y poder editarlos.',
      placement: 'top',
    },
  ];

  function startProveedoresTour(force = false) {
    if (!window.GuidedTour) return;
    window.GuidedTour.start({
      id: proveedoresTourId,
      steps: proveedoresSteps,
      autoStart: !force,
    });
  }

  const btnProveedoresTour = document.getElementById('btnProveedoresTour');
  if (btnProveedoresTour) {
    btnProveedoresTour.addEventListener('click', () => {
      if (window.GuidedTour.hasSeen && window.GuidedTour.hasSeen(proveedoresTourId)) {
        window.GuidedTour.reset(proveedoresTourId);
      }
      startProveedoresTour(true);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    startProveedoresTour(false);
  });
}
