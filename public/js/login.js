// Sistema de autenticación
import { apiFetchJson } from './app-api.js';
import { borrarDatosLocales } from './db-local.js';

const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');

// Modal 2FA (solo se usa si existe en el DOM)
const twofaModal = document.getElementById('twofa-modal');
const twofaCodeInput = document.getElementById('twofa-code');
const twofaError = document.getElementById('twofa-error');
const twofaConfirmBtn = document.getElementById('twofa-confirm');
const twofaCancelBtn = document.getElementById('twofa-cancel');

let pendingLoginBody = null;

// Verificar si ya está autenticado
try { localStorage.removeItem('auth_token'); } catch {}
const cachedUser = localStorage.getItem('auth_user');
if (cachedUser) {
  verificarSesion();
}

function mostrarError(mensaje) {
  if (!errorText || !errorMessage) return;
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

function abrirModalTwofa() {
  if (!twofaModal || !twofaCodeInput || !twofaError) return;
  twofaCodeInput.value = '';
  twofaError.textContent = '';
  twofaError.classList.add('hidden');
  twofaModal.classList.remove('hidden');
  setTimeout(() => {
    twofaCodeInput.focus();
  }, 50);
}

function cerrarModalTwofa() {
  if (!twofaModal || !twofaCodeInput || !twofaError) return;
  twofaModal.classList.add('hidden');
  twofaCodeInput.value = '';
  twofaError.textContent = '';
  twofaError.classList.add('hidden');
  pendingLoginBody = null;
}

async function intentarLogin(body, opciones = {}) {
  const { desdeTwofaModal = false } = opciones;

  if (!loginBtn) return;

  loginBtn.disabled = true;
  loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Ingresando...';

  try {
    const data = await apiFetchJson('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (data && data.success) {
      // Éxito: cerrar modal si estaba abierto
      if (desdeTwofaModal) {
        cerrarModalTwofa();
      }

      // Limpiar caches locales (clientes, ventas, etc.) al cambiar de usuario/empresa
      try {
        await borrarDatosLocales();
      } catch (e) {
        console.warn('No se pudieron limpiar datos locales al iniciar sesión', e);
      }
      try {
        localStorage.removeItem('clientes_frecuentes_v2');
      } catch {}

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
      const msg = (data && data.error) || 'Credenciales inválidas';

      const msgStr = typeof msg === 'string' ? msg.toLowerCase() : '';
      const esMensaje2FA = msgStr.includes('2fa');

      if (!desdeTwofaModal && esMensaje2FA) {
        // Primera respuesta indicando que se requiere 2FA para superadmin
        pendingLoginBody = body;
        abrirModalTwofa();
      } else if (desdeTwofaModal && esMensaje2FA) {
        // Error al validar el código 2FA dentro del modal
        if (twofaError) {
          twofaError.textContent = msg;
          twofaError.classList.remove('hidden');
        }
      } else {
        mostrarError(msg);
      }

      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Ingresar';
    }
  } catch (err) {
    console.error('Error en login:', err);
    const msg = err && err.message ? err.message : 'Error de conexión. Intente nuevamente.';
    const msgStr = msg.toLowerCase();
    const esMensaje2FA = msgStr.includes('2fa');

    if (!desdeTwofaModal && esMensaje2FA) {
      // El backend exige código 2FA: abrir modal y guardar body pendiente
      pendingLoginBody = body;
      abrirModalTwofa();
    } else if (desdeTwofaModal && esMensaje2FA && twofaError) {
      // Error validando código 2FA dentro del modal
      twofaError.textContent = msg;
      twofaError.classList.remove('hidden');
    } else if (desdeTwofaModal && twofaError) {
      twofaError.textContent = msg;
      twofaError.classList.remove('hidden');
    } else {
      mostrarError(msg);
    }
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Ingresar';
  }
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value.trim() : '';

    if (!username || !password) {
      mostrarError('Por favor complete todos los campos');
      return;
    }

    const body = { username, password };
    pendingLoginBody = body;
    await intentarLogin(body, { desdeTwofaModal: false });
  });
}

if (twofaCancelBtn) {
  twofaCancelBtn.addEventListener('click', () => {
    cerrarModalTwofa();
  });
}

if (twofaConfirmBtn) {
  twofaConfirmBtn.addEventListener('click', async () => {
    const token = twofaCodeInput ? twofaCodeInput.value.trim() : '';
    if (!token) {
      if (twofaError) {
        twofaError.textContent = 'Ingrese el código 2FA.';
        twofaError.classList.remove('hidden');
      }
      if (twofaCodeInput) twofaCodeInput.focus();
      return;
    }

    if (!pendingLoginBody) {
      // Por seguridad, si no tenemos body pendiente cerramos el modal
      cerrarModalTwofa();
      return;
    }

    const bodyConTwofa = { ...pendingLoginBody, twofa: token };
    await intentarLogin(bodyConTwofa, { desdeTwofaModal: true });
  });
}

if (twofaCodeInput && twofaConfirmBtn) {
  twofaCodeInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      twofaConfirmBtn.click();
    }
  });
}

// Focus automático en el campo de usuario
if (usernameInput) {
  usernameInput.focus();
}
