// Sistema de autenticación
import { apiFetchJson } from './app-api.js';

const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');

// Verificar si ya está autenticado
try { localStorage.removeItem('auth_token'); } catch {}
const cachedUser = localStorage.getItem('auth_user');
if (cachedUser) {
  verificarSesion();
}

function mostrarError(mensaje) {
  errorText.textContent = mensaje;
  errorMessage.classList.remove('hidden');
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 5000);
}

async function verificarSesion() {
  try {
    const data = await apiFetchJson('/auth/verificar');
    if (data && data.valido) {
      if (data.usuario) localStorage.setItem('auth_user', JSON.stringify(data.usuario));
      if (data.usuario && data.usuario.rol === 'superadmin') {
        window.location.href = '/pages/admin-empresas.html';
      } else {
        window.location.href = '/pages/index.html';
      }
    } else {
      localStorage.removeItem('auth_user');
    }
  } catch (err) {
    console.error('Error verificando sesión:', err);
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    mostrarError('Por favor complete todos los campos');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Ingresando...';

  try {
    const data = await apiFetchJson('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });

    if (data && data.success) {
      // Guardar solo datos de usuario (cookie httpOnly maneja la sesión)
      localStorage.setItem('auth_user', JSON.stringify(data.usuario));
      
      // Mostrar mensaje de éxito breve
      loginBtn.innerHTML = '<i class="fas fa-check mr-2"></i>¡Bienvenido!';
      loginBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      loginBtn.classList.add('bg-green-600');

      // Si la empresa está morosa, mostrar advertencia antes de redirigir
      if (data.usuario && data.usuario.empresa_estado === 'morosa') {
        mostrarError('Aviso: la cuenta de su empresa está en mora. Algunas funciones podrían limitarse si no se regulariza el pago.');
      }

      // Redirigir según rol
      setTimeout(() => {
        if (data.usuario && data.usuario.rol === 'superadmin') {
          window.location.href = '/pages/admin-empresas.html';
        } else {
          window.location.href = '/pages/index.html';
        }
      }, 800);
    } else {
      mostrarError((data && data.error) || 'Credenciales inválidas');
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Ingresar';
    }
  } catch (err) {
    console.error('Error en login:', err);
    mostrarError(err.message || 'Error de conexión. Intente nuevamente.');
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Ingresar';
  }
});

// Focus automático en el campo de usuario
usernameInput.focus();
