import { apiFetchJson } from './app-api.js';
import { formatNumber } from './format-utils.js';
import { upsertUsuarioFirebase, deleteUsuarioFirebase } from './firebase-sync.js';
import { initCustomSelect } from './modules/ui.js';

// Intentar cargar utilidades centralizadas para toasts si no están disponibles
(async () => {
  if (!window.showToast) {
    try {
      const m = await import('./app-utils.js');
      window.showToast = window.showToast || m.showToast;
    } catch (e) {
      // si falla, nos quedamos con alert() como último recurso
    }
  }
})();

console.log('usuarios.js v1.0 cargado');

let usuarios = [];
let modoEdicion = false;

const tbody = document.getElementById('usuarios-tbody');
const modal = document.getElementById('modal-usuario');
const modalTitulo = document.getElementById('modal-titulo');
const btnNuevo = document.getElementById('btn-nuevo-usuario');
const btnClose = document.getElementById('modal-close');
const btnCancelar = document.getElementById('btn-cancelar');
const form = document.getElementById('form-usuario');

// Inputs del formulario
const inputId = document.getElementById('usuario-id');
const inputUsername = document.getElementById('usuario-username');
const inputPassword = document.getElementById('usuario-password');
const inputNombre = document.getElementById('usuario-nombre');
const inputRol = document.getElementById('usuario-rol');
const inputComision = document.getElementById('usuario-comision');
const passwordHint = document.getElementById('password-hint');
const inputEmail = document.getElementById('usuario-email');
const emailGroup = document.getElementById('usuario-email-group');

// Modal de confirmación de acciones (activar / desactivar / eliminar)
const modalConfirmUsuario = document.getElementById('modal-confirm-usuario');
const ucTitle = document.getElementById('uc-title');
const ucMessage = document.getElementById('uc-message');
const ucCancelar = document.getElementById('uc-cancelar');
const ucConfirmar = document.getElementById('uc-confirmar');
let currentUsuarioConfirmAction = null;

try { initCustomSelect('usuario-rol'); } catch {}

function actualizarVisibilidadEmail() {
  if (!emailGroup) return;
  if (inputRol && inputRol.value === 'admin') {
    emailGroup.classList.remove('hidden');
  } else {
    emailGroup.classList.add('hidden');
  }
}

if (inputRol) {
  inputRol.addEventListener('change', actualizarVisibilidadEmail);
}

// Cargar usuarios
async function cargarUsuarios() {
  try {
    usuarios = await apiFetchJson('/admin/usuarios');
    renderUsuarios();
  } catch (err) {
    console.error(err);
    if (String(err.message).includes('403') || String(err.message).toLowerCase().includes('forbidden')) {
		  if (window.showToast) {
			  window.showToast('No tienes permisos para acceder a esta página', 'error');
		  } else {
			  alert('No tienes permisos para acceder a esta página');
		  }
      window.location.href = '/pages/dashboard.html';
      return;
    }
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-red-500">Error cargando usuarios</td></tr>';
  }
}

// Renderizar tabla de usuarios
function renderUsuarios() {
  if (!Array.isArray(usuarios) || usuarios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-400">No hay usuarios registrados</td></tr>';
    return;
  }

  let html = '';
  const usuarioActual = JSON.parse(localStorage.getItem('auth_user') || 'null') || {};

  usuarios.forEach(u => {
    const rolBadge = {
      'admin': '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-semibold">Admin</span>',
      'vendedor': '<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">Vendedor</span>',
      'lectura': '<span class="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">Lectura</span>'
    };

    const estadoBadge = u.activo
      ? '<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">Activo</span>'
      : '<span class="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">Inactivo</span>';

    const ultimoLogin = u.ultimo_login
      ? new Date(u.ultimo_login).toLocaleString()
      : '<span class="text-slate-400">Nunca</span>';

    const comisionTexto = (u.comision_pct !== undefined && u.comision_pct !== null)
    ? (Number(u.comision_pct) ? (formatNumber(u.comision_pct, 2).replace(/,00$/, '') + '%') : '0%')
    : '0%';

    const esMismoUsuario = u.id === usuarioActual.id;

    html += '<tr class="hover:bg-slate-50 transition">';
    html += '<td class="p-4"><div class="flex items-center gap-2"><div class="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center"><i class="fas fa-user text-slate-600"></i></div><div><div class="font-semibold text-slate-800">' + (u.username || '') + '</div>' + (esMismoUsuario ? '<span class="text-xs text-blue-600">(Tú)</span>' : '') + '</div></div></td>';
    html += '<td class="p-4 text-slate-600">' + (u.nombre_completo || '-') + '</td>';
    html += '<td class="p-4">' + (rolBadge[u.rol] || (u.rol || '')) + '</td>';
    html += '<td class="p-4 text-slate-600">' + comisionTexto + '</td>';
    html += '<td class="p-4">' + estadoBadge + '</td>';
    html += '<td class="p-4 text-sm text-slate-500">' + ultimoLogin + '</td>';
    html += '<td class="p-4"><div class="flex gap-2 justify-end">';
    html += '<button onclick="editarUsuario(' + u.id + ')" class="h-8 w-8 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition flex items-center justify-center" title="Editar usuario"><i class="fas fa-edit"></i></button>';

    if (!esMismoUsuario) {
        	html += '<button onclick="eliminarUsuario(' + u.id + ')" class="btn-trash btn-trash--sm" title="Eliminar usuario">'
                  + '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
                  + '<path fill="currentColor" d="M8.78842 5.03866C8.86656 4.96052 8.97254 4.91663 9.08305 4.91663H11.4164C11.5269 4.91663 11.6329 4.96052 11.711 5.03866C11.7892 5.11681 11.833 5.22279 11.833 5.33329V5.74939H8.66638V5.33329C8.66638 5.22279 8.71028 5.11681 8.78842 5.03866ZM7.16638 5.74939V5.33329C7.16638 4.82496 7.36832 4.33745 7.72776 3.978C8.08721 3.61856 8.57472 3.41663 9.08305 3.41663H11.4164C11.9247 3.41663 12.4122 3.61856 12.7717 3.978C13.1311 4.33745 13.333 4.82496 13.333 5.33329V5.74939H15.5C15.9142 5.74939 16.25 6.08518 16.25 6.49939C16.25 6.9136 15.9142 7.24939 15.5 7.24939H15.0105L14.2492 14.7095C14.2382 15.2023 14.0377 15.6726 13.6883 16.0219C13.3289 16.3814 12.8414 16.5833 12.333 16.5833H8.16638C7.65805 16.5833 7.17054 16.3814 6.81109 16.0219C6.46176 15.6726 6.2612 15.2023 6.25019 14.7095L5.48896 7.24939H5C4.58579 7.24939 4.25 6.9136 4.25 6.49939C4.25 6.08518 4.58579 5.74939 5 5.74939H6.16667H7.16638ZM7.91638 7.24996H12.583H13.5026L12.7536 14.5905C12.751 14.6158 12.7497 14.6412 12.7497 14.6666C12.7497 14.7771 12.7058 14.8831 12.6277 14.9613C12.5495 15.0394 12.4436 15.0833 12.333 15.0833H8.16638C8.05588 15.0833 7.94989 15.0394 7.87175 14.9613C7.79361 14.8831 7.74972 14.7771 7.74972 14.6666C7.74972 14.6412 7.74842 14.6158 7.74584 14.5905L6.99681 7.24996H7.91638Z" clip-rule="evenodd" fill-rule="evenodd"></path>'
                  + '</svg>'
                  + '</button>';
      const accion = u.activo ? 'desactivarUsuario(' + u.id + ')' : 'activarUsuario(' + u.id + ')';
      const btnClass = u.activo ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-600 hover:bg-green-200';
      const title = u.activo ? 'Desactivar usuario' : 'Activar usuario';
      const icon = u.activo ? 'ban' : 'check';
      html += '<button onclick="' + accion + '" class="h-8 w-8 rounded-lg ' + btnClass + ' transition flex items-center justify-center" title="' + title + '"><i class="fas fa-' + icon + '"></i></button>';
    }

    html += '</div></td></tr>';
  });

  tbody.innerHTML = html;
}

// Abrir modal para nuevo usuario
function nuevoUsuario() {
  modoEdicion = false;
  modalTitulo.textContent = 'Nuevo Usuario';
  form.reset();
  inputId.value = '';
  inputUsername.disabled = false;
  inputPassword.required = true;
  passwordHint.textContent = 'Mínimo 6 caracteres';
  if (inputComision) inputComision.value = '';
   if (inputEmail) inputEmail.value = '';
   actualizarVisibilidadEmail();
  abrirModal();
}

// Editar usuario
function editarUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  if (!usuario) return;

  modoEdicion = true;
  modalTitulo.textContent = 'Editar Usuario';
  
  inputId.value = usuario.id;
  inputUsername.value = usuario.username;
  inputUsername.disabled = true; // No permitir cambiar el username
  inputPassword.value = '';
  inputPassword.required = false;
  passwordHint.textContent = 'Dejar en blanco para mantener la contraseña actual';
  inputNombre.value = usuario.nombre_completo || '';
  inputRol.value = usuario.rol;
  if (inputEmail) inputEmail.value = usuario.email || '';
  if (inputComision) inputComision.value = (usuario.comision_pct !== undefined && usuario.comision_pct !== null)
    ? String(usuario.comision_pct)
    : '';

  actualizarVisibilidadEmail();
  abrirModal();
}

// Guardar usuario (crear o actualizar)
async function guardarUsuario(e) {
  e.preventDefault();

  const datos = {
    username: inputUsername.value.trim(),
    password: inputPassword.value,
    nombre_completo: inputNombre.value.trim(),
    rol: inputRol.value,
    comision_pct: inputComision && inputComision.value !== '' ? parseFloat(inputComision.value) : 0
  };

  if (inputRol && inputRol.value === 'admin' && inputEmail) {
    const emailValor = (inputEmail.value || '').trim();
    if (emailValor) {
      datos.email = emailValor;
    }
  }

  // Si estamos editando y no se cambió la contraseña, no enviarla
  if (modoEdicion && !datos.password) {
    delete datos.password;
  }

  try {
    if (modoEdicion) {
      const id = inputId.value;
      const resp = await apiFetchJson(`/admin/usuarios/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
      // Sincronizar perfil ligero a Firebase (mejor esfuerzo)
      if (resp && resp.usuario) {
        try {
          await upsertUsuarioFirebase(resp.usuario);
        } catch (syncErr) {
          console.warn('No se pudo sincronizar usuario a Firebase (update):', syncErr);
        }
      }
    } else {
      const resp = await apiFetchJson('/admin/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
      if (resp && resp.usuario) {
        try {
          await upsertUsuarioFirebase(resp.usuario);
        } catch (syncErr) {
          console.warn('No se pudo sincronizar usuario a Firebase (create):', syncErr);
        }
      }
    }

	if (window.showToast) {
		window.showToast(modoEdicion ? 'Usuario actualizado exitosamente' : 'Usuario creado exitosamente', 'success');
	} else {
		alert(modoEdicion ? 'Usuario actualizado exitosamente' : 'Usuario creado exitosamente');
	}
    cerrarModal();
    await cargarUsuarios();
  } catch (err) {
    console.error(err);
	if (window.showToast) {
		window.showToast(err.message || 'Error al guardar usuario', 'error');
	} else {
		alert(err.message || 'Error al guardar usuario');
	}
  }
}

// Desactivar usuario
async function desactivarUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  if (!usuario) return;
  const doDesactivar = async () => {
    try {
      await apiFetchJson(`/admin/usuarios/${id}`, { method: 'DELETE' });
      if (window.showToast) {
        window.showToast('Usuario desactivado exitosamente', 'success');
      } else {
        alert('Usuario desactivado exitosamente');
      }
      await cargarUsuarios();
    } catch (err) {
      console.error(err);
      if (window.showToast) {
        window.showToast(err.message || 'Error al desactivar usuario', 'error');
      } else {
        alert(err.message || 'Error al desactivar usuario');
      }
    }
  };

  if (!modalConfirmUsuario) {
    const ok = window.confirm(`¿Estás seguro de desactivar al usuario "${usuario.username}"?\n\nEsto cerrará todas sus sesiones activas.`);
    if (!ok) return;
    await doDesactivar();
    return;
  }

  ucTitle.textContent = 'Desactivar usuario';
  ucMessage.textContent = `¿Estás seguro de desactivar al usuario "${usuario.username}"? Esto cerrará todas sus sesiones activas.`;
  currentUsuarioConfirmAction = doDesactivar;
  modalConfirmUsuario.classList.remove('hidden');
  modalConfirmUsuario.classList.add('flex');
}

// Activar usuario
async function activarUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  if (!usuario) return;
  const doActivar = async () => {
    try {
      await apiFetchJson(`/admin/usuarios/${id}/activar`, { method: 'POST' });
      if (window.showToast) {
        window.showToast('Usuario activado exitosamente', 'success');
      } else {
        alert('Usuario activado exitosamente');
      }
      await cargarUsuarios();
    } catch (err) {
      console.error(err);
      if (window.showToast) {
        window.showToast(err.message || 'Error al activar usuario', 'error');
      } else {
        alert(err.message || 'Error al activar usuario');
      }
    }
  };

  if (!modalConfirmUsuario) {
    const ok = window.confirm(`¿Activar al usuario "${usuario.username}"?`);
    if (!ok) return;
    await doActivar();
    return;
  }

  ucTitle.textContent = 'Activar usuario';
  ucMessage.textContent = `¿Activar al usuario "${usuario.username}"?`;
  currentUsuarioConfirmAction = doActivar;
  modalConfirmUsuario.classList.remove('hidden');
  modalConfirmUsuario.classList.add('flex');
}

// Eliminar usuario definitivamente
async function eliminarUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  if (!usuario) return;
  const doEliminar = async () => {
    try {
      await apiFetchJson(`/admin/usuarios/${id}/eliminar`, { method: 'DELETE' });
      try {
        await deleteUsuarioFirebase(id);
      } catch (syncErr) {
        console.warn('No se pudo eliminar perfil de usuario en Firebase:', syncErr);
      }
      if (window.showToast) {
        window.showToast('Usuario eliminado definitivamente', 'success');
      } else {
        alert('Usuario eliminado definitivamente');
      }
      await cargarUsuarios();
    } catch (err) {
      console.error(err);
      if (window.showToast) {
        window.showToast(err.message || 'Error al eliminar usuario', 'error');
      } else {
        alert(err.message || 'Error al eliminar usuario');
      }
    }
  };

  if (!modalConfirmUsuario) {
    const confirmado = window.confirm(`¿Eliminar definitivamente al usuario "${usuario.username}"?\n\nEsta acción no se puede deshacer. Si tiene ventas asociadas, no se podrá eliminar.`);
    if (!confirmado) return;
    await doEliminar();
    return;
  }

  ucTitle.textContent = 'Eliminar usuario';
  ucMessage.textContent = `¿Eliminar definitivamente al usuario "${usuario.username}"? Esta acción no se puede deshacer. Si tiene ventas asociadas, no se podrá eliminar.`;
  currentUsuarioConfirmAction = doEliminar;
  modalConfirmUsuario.classList.remove('hidden');
  modalConfirmUsuario.classList.add('flex');
}

// Funciones del modal
function abrirModal() {
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => inputUsername.focus(), 100);
}

function cerrarModal() {
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  form.reset();
}

// Event listeners
btnNuevo.addEventListener('click', nuevoUsuario);
btnClose.addEventListener('click', cerrarModal);
btnCancelar.addEventListener('click', cerrarModal);
form.addEventListener('submit', guardarUsuario);

// Cerrar modal con ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
    cerrarModal();
  }
});

// Eventos para modal de confirmación de usuario
if (modalConfirmUsuario && ucCancelar) {
  ucCancelar.addEventListener('click', () => {
    modalConfirmUsuario.classList.add('hidden');
    modalConfirmUsuario.classList.remove('flex');
    currentUsuarioConfirmAction = null;
  });
}

if (modalConfirmUsuario && ucConfirmar) {
  ucConfirmar.addEventListener('click', () => {
    try {
      if (typeof currentUsuarioConfirmAction === 'function') {
        currentUsuarioConfirmAction();
      }
    } finally {
      modalConfirmUsuario.classList.add('hidden');
      modalConfirmUsuario.classList.remove('flex');
      currentUsuarioConfirmAction = null;
    }
  });
}

// Cargar usuarios al iniciar
cargarUsuarios();

// Hacer funciones globales para onclick
window.editarUsuario = editarUsuario;
window.desactivarUsuario = desactivarUsuario;
window.activarUsuario = activarUsuario;
window.eliminarUsuario = eliminarUsuario;
