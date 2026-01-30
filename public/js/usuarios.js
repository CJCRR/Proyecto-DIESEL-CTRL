import { apiFetchJson } from './app-api.js';

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
const passwordHint = document.getElementById('password-hint');

// Cargar usuarios
async function cargarUsuarios() {
  try {
    usuarios = await apiFetchJson('/admin/usuarios');
    renderUsuarios();
  } catch (err) {
    console.error(err);
    if (String(err.message).includes('403') || String(err.message).toLowerCase().includes('forbidden')) {
      alert('No tienes permisos para acceder a esta página');
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

    const esMismoUsuario = u.id === usuarioActual.id;

    html += '<tr class="hover:bg-slate-50 transition">';
    html += '<td class="p-4"><div class="flex items-center gap-2"><div class="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center"><i class="fas fa-user text-slate-600"></i></div><div><div class="font-semibold text-slate-800">' + (u.username || '') + '</div>' + (esMismoUsuario ? '<span class="text-xs text-blue-600">(Tú)</span>' : '') + '</div></div></td>';
    html += '<td class="p-4 text-slate-600">' + (u.nombre_completo || '-') + '</td>';
    html += '<td class="p-4">' + (rolBadge[u.rol] || (u.rol || '')) + '</td>';
    html += '<td class="p-4">' + estadoBadge + '</td>';
    html += '<td class="p-4 text-sm text-slate-500">' + ultimoLogin + '</td>';
    html += '<td class="p-4"><div class="flex gap-2 justify-end">';
    html += '<button onclick="editarUsuario(' + u.id + ')" class="h-8 w-8 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition flex items-center justify-center" title="Editar usuario"><i class="fas fa-edit"></i></button>';

    if (!esMismoUsuario) {
      html += '<button onclick="eliminarUsuario(' + u.id + ')" class="h-8 w-8 rounded-lg bg-rose-100 text-rose-600 hover:bg-rose-200 transition flex items-center justify-center" title="Eliminar usuario"><i class="fas fa-trash"></i></button>';
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

  abrirModal();
}

// Guardar usuario (crear o actualizar)
async function guardarUsuario(e) {
  e.preventDefault();

  const datos = {
    username: inputUsername.value.trim(),
    password: inputPassword.value,
    nombre_completo: inputNombre.value.trim(),
    rol: inputRol.value
  };

  // Si estamos editando y no se cambió la contraseña, no enviarla
  if (modoEdicion && !datos.password) {
    delete datos.password;
  }

  try {
    if (modoEdicion) {
      const id = inputId.value;
      await apiFetchJson(`/admin/usuarios/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
    } else {
      await apiFetchJson('/admin/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
    }

    alert(modoEdicion ? 'Usuario actualizado exitosamente' : 'Usuario creado exitosamente');
    cerrarModal();
    await cargarUsuarios();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Error al guardar usuario');
  }
}

// Desactivar usuario
async function desactivarUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  if (!usuario) return;

  if (!confirm(`¿Estás seguro de desactivar al usuario "${usuario.username}"?\n\nEsto cerrará todas sus sesiones activas.`)) {
    return;
  }

  try {
    await apiFetchJson(`/admin/usuarios/${id}`, { method: 'DELETE' });
    alert('Usuario desactivado exitosamente');
    await cargarUsuarios();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Error al desactivar usuario');
  }
}

// Activar usuario
async function activarUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  if (!usuario) return;

  if (!confirm(`¿Activar al usuario "${usuario.username}"?`)) {
    return;
  }

  try {
    await apiFetchJson(`/admin/usuarios/${id}/activar`, { method: 'POST' });
    alert('Usuario activado exitosamente');
    await cargarUsuarios();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Error al activar usuario');
  }
}

// Eliminar usuario definitivamente
async function eliminarUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  if (!usuario) return;

  const confirmado = confirm(`¿Eliminar definitivamente al usuario "${usuario.username}"?\n\nEsta acción no se puede deshacer. Si tiene ventas asociadas, no se podrá eliminar.`);
  if (!confirmado) return;

  try {
    await apiFetchJson(`/admin/usuarios/${id}/eliminar`, { method: 'DELETE' });
    alert('Usuario eliminado definitivamente');
    await cargarUsuarios();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Error al eliminar usuario');
  }
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

// Cargar usuarios al iniciar
cargarUsuarios();

// Hacer funciones globales para onclick
window.editarUsuario = editarUsuario;
window.desactivarUsuario = desactivarUsuario;
window.activarUsuario = activarUsuario;
window.eliminarUsuario = eliminarUsuario;
