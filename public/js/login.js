// Sistema de autenticación
import { apiFetchJson } from './app-api.js';
import { borrarDatosLocales } from './db-local.js';
import { upsertEmpresaFirebase } from './firebase-sync.js';

const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');
const infoMessage = document.getElementById('info-message');
const infoText = document.getElementById('info-text');

// Modal 2FA (solo se usa si existe en el DOM)
const twofaModal = document.getElementById('twofa-modal');
const twofaCodeInput = document.getElementById('twofa-code');
const twofaError = document.getElementById('twofa-error');
const twofaConfirmBtn = document.getElementById('twofa-confirm');
const twofaCancelBtn = document.getElementById('twofa-cancel');

// Auto-registro de empresa
const modalRegistro = document.getElementById('modal-registro-empresa');
const btnOpenRegistro = document.getElementById('btn-open-registro-empresa');
const reEmpresaNombre = document.getElementById('re-empresa-nombre');
const reEmpresaRif = document.getElementById('re-empresa-rif');
const reEmpresaTelefono = document.getElementById('re-empresa-telefono');
const reEmpresaUbicacion = document.getElementById('re-empresa-ubicacion');
const reAdminUsername = document.getElementById('re-admin-username');
const reAdminPassword = document.getElementById('re-admin-password');
const reAdminNombre = document.getElementById('re-admin-nombre');
const reError = document.getElementById('re-error');
const reForm = document.getElementById('form-registro-empresa');
const reCancelar = document.getElementById('re-cancelar');
const reCerrar = document.getElementById('re-cerrar');
const reSubmit = document.getElementById('re-submit');

// Modal éxito registro
const modalRegistroExito = document.getElementById('modal-registro-exito');
const reExitoCerrar = document.getElementById('re-exito-cerrar');
const reExitoOk = document.getElementById('re-exito-ok');

let confettiActivo = false;
let confetiIconoEjecutado = false;

let pendingLoginBody = null;

// Verificar si ya está autenticado
try { localStorage.removeItem('auth_token'); } catch {}
const cachedUser = localStorage.getItem('auth_user');
if (cachedUser) {
  verificarSesion();
}

function mostrarError(mensaje) {
  if (!errorText || !errorMessage) return;
  // Ocultar mensaje informativo si estuviera visible
  if (infoMessage) infoMessage.classList.add('hidden');
  errorText.textContent = mensaje;
  errorMessage.classList.remove('hidden');
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 5000);
}

function mostrarInfo(mensaje) {
  if (!infoText || !infoMessage) return;
  // Ocultar error si estuviera visible
  if (errorMessage) errorMessage.classList.add('hidden');
  infoText.textContent = mensaje;
  infoMessage.classList.remove('hidden');
  setTimeout(() => {
    infoMessage.classList.add('hidden');
  }, 7000);
}

async function verificarSesion() {
  try {
    const data = await apiFetchJson('/auth/verificar');
    if (data && data.valido) {
      if (data.usuario) localStorage.setItem('auth_user', JSON.stringify(data.usuario));
      if (data.usuario && data.usuario.rol === 'superadmin') {
        window.location.href = '/admin-empresas';
      } else {
        window.location.href = '/pos';
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

      // Avisos de estado/licencia de empresa
      if (data.usuario && data.usuario.empresa_trial && data.usuario.empresa_trial.dias_restantes > 0) {
        const dias = data.usuario.empresa_trial.dias_restantes;
        const msgTrial = dias === 1
          ? 'Estás en el último día de tu prueba gratis. Contacta al administrador para activar un plan.'
          : `Estás usando una prueba gratis de Nexa CTRL. Te quedan ${dias} días. Contacta al administrador para activar un plan antes de que termine.`;
        mostrarInfo(msgTrial);
      } else if (data.usuario && data.usuario.empresa_estado === 'morosa') {
        mostrarError('Aviso: la cuenta de su empresa está en mora. Algunas funciones podrían limitarse si no se regulariza el pago.');
      }

      // Redirigir según rol
      setTimeout(() => {
          if (data.usuario && data.usuario.rol === 'superadmin') {
            window.location.href = '/admin-empresas';
        } else {
            window.location.href = '/pos';
        }
      }, 800);
    } else {
      const msg = (data && data.error) || 'Credenciales inválidas';

      const msgStr = typeof msg === 'string' ? msg.toLowerCase() : '';
      const esMensaje2FA = msgStr.includes('2fa');

      if (!desdeTwofaModal && esMensaje2FA) {
        // Primera respuesta indicando que se requiere 2FA para superadmin
        pendingLoginBody = body;
            window.location.href = '/pos';
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

// --- Auto-registro de empresa (fase 37) ---

function abrirModalRegistro() {
  if (!modalRegistro) return;
  if (reEmpresaNombre) reEmpresaNombre.value = '';
  if (reEmpresaRif) reEmpresaRif.value = '';
  if (reEmpresaTelefono) reEmpresaTelefono.value = '';
  if (reEmpresaUbicacion) reEmpresaUbicacion.value = '';
  if (reAdminUsername) reAdminUsername.value = '';
  if (reAdminPassword) reAdminPassword.value = '';
  if (reAdminNombre) reAdminNombre.value = '';
  if (reError) {
    reError.textContent = '';
    reError.classList.add('hidden');
  }
  modalRegistro.classList.remove('hidden');
  if (reEmpresaNombre) {
    setTimeout(() => reEmpresaNombre.focus(), 50);
  }
}

function cerrarModalRegistro() {
  if (!modalRegistro) return;
  modalRegistro.classList.add('hidden');
}

function abrirModalRegistroExito() {
  if (!modalRegistroExito) return;
  modalRegistroExito.classList.remove('hidden');
  lanzarConfetiRegistro();
  lanzarConfetiIcono();
}

function cerrarModalRegistroExito() {
  if (!modalRegistroExito) return;
  modalRegistroExito.classList.add('hidden');
  detenerConfetiRegistro();
}

function lanzarConfetiIcono() {
  if (confetiIconoEjecutado) return;
  const iconContainer = document.getElementById('registro-exito-icon');
  if (!iconContainer) return;

  confetiIconoEjecutado = true;

  const colors = ['#34A3F2', '#B400AC', '#88E259', '#F75E19', '#39C5C0', '#E3004D'];
  const pieces = 26;

  for (let i = 0; i < pieces; i++) {
    const piece = document.createElement('span');
    piece.className = 'registro-confetti-piece';

    const angle = (Math.PI * 2 * i) / pieces;
    const distance = 26 + Math.random() * 18;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance * 0.9;
    const rotate = (Math.random() * 360 - 180).toFixed(2) + 'deg';

    piece.style.setProperty('--x', `${x}px`);
    piece.style.setProperty('--y', `${y}px`);
    piece.style.setProperty('--r', rotate);
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

    iconContainer.appendChild(piece);

    piece.addEventListener('animationend', () => {
      piece.remove();
    });
  }
}

function lanzarConfetiRegistro() {
  if (confettiActivo) return;
  if (typeof window === 'undefined' || !window.tsParticles) return;
  const targetId = 'tsparticles';
  const el = document.getElementById(targetId);
  if (!el) return;

  confettiActivo = true;

  window.tsParticles.load({
    id: targetId,
    options: {
      fullScreen: {
        zIndex: 1
      },
      particles: {
        number: {
          value: 0
        },
        color: {
          value: ['#00FFFC', '#FC00FF', '#fffc00']
        },
        shape: {
          type: ['circle', 'square', 'triangle', 'polygon'],
          options: {
            polygon: [
              { sides: 5 },
              { sides: 6 }
            ]
          }
        },
        opacity: {
          value: { min: 0, max: 1 },
          animation: {
            enable: true,
            speed: 2,
            startValue: 'max',
            destroy: 'min'
          }
        },
        size: {
          value: { min: 2, max: 4 }
        },
        links: {
          enable: false
        },
        life: {
          duration: {
            sync: true,
            value: 5
          },
          count: 1
        },
        move: {
          enable: true,
          gravity: {
            enable: true,
            acceleration: 10
          },
          speed: { min: 10, max: 20 },
          decay: 0.1,
          direction: 'none',
          straight: false,
          outModes: {
            default: 'destroy',
            top: 'none'
          }
        },
        rotate: {
          value: { min: 0, max: 360 },
          direction: 'random',
          move: true,
          animation: {
            enable: true,
            speed: 60
          }
        },
        tilt: {
          direction: 'random',
          enable: true,
          move: true,
          value: { min: 0, max: 360 },
          animation: {
            enable: true,
            speed: 60
          }
        },
        roll: {
          darken: {
            enable: true,
            value: 25
          },
          enable: true,
          speed: { min: 15, max: 25 }
        },
        wobble: {
          distance: 30,
          enable: true,
          move: true,
          speed: { min: -15, max: 15 }
        }
      },
      emitters: {
        life: {
          count: 0,
          duration: 0.1,
          delay: 0.4
        },
        rate: {
          delay: 0.1,
          quantity: 150
        },
        size: {
          width: 0,
          height: 0
        }
      }
    }
  });
}

function detenerConfetiRegistro() {
  if (typeof window === 'undefined' || !window.tsParticles) {
    confettiActivo = false;
    return;
  }
  try {
    const all = window.tsParticles.dom();
    all.forEach((instance) => {
      instance.destroy();
    });
  } catch (e) {
    // ignorar errores al destruir
  } finally {
    confettiActivo = false;
  }
}

async function enviarRegistroEmpresa(e) {
  if (e) e.preventDefault();
  if (!reEmpresaNombre || !reAdminUsername || !reAdminPassword || !reSubmit) return;

  const nombre = reEmpresaNombre.value.trim();
  const username = reAdminUsername.value.trim();
  const password = reAdminPassword.value;
  const rif = reEmpresaRif ? reEmpresaRif.value.trim() : '';
  const telefono = reEmpresaTelefono ? reEmpresaTelefono.value.trim() : '';
  const ubicacion = reEmpresaUbicacion ? reEmpresaUbicacion.value.trim() : '';
  const adminNombre = reAdminNombre ? reAdminNombre.value.trim() : '';

  if (!nombre || nombre.length < 3) {
    if (reError) {
      reError.textContent = 'El nombre de la empresa debe tener al menos 3 caracteres.';
      reError.classList.remove('hidden');
    }
    reEmpresaNombre.focus();
    return;
  }
  if (!username || username.length < 3) {
    if (reError) {
      reError.textContent = 'El usuario administrador debe tener al menos 3 caracteres.';
      reError.classList.remove('hidden');
    }
    reAdminUsername.focus();
    return;
  }
  if (!password || password.length < 6) {
    if (reError) {
      reError.textContent = 'La contraseña del administrador debe tener al menos 6 caracteres.';
      reError.classList.remove('hidden');
    }
    reAdminPassword.focus();
    return;
  }

  reSubmit.disabled = true;
  const originalHtml = reSubmit.innerHTML;
  reSubmit.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Creando...';

  try {
    const body = {
      empresa_nombre: nombre,
      empresa_rif: rif,
      empresa_telefono: telefono,
      empresa_ubicacion: ubicacion,
      admin_username: username,
      admin_password: password,
      admin_nombre: adminNombre || username
    };

    const data = await apiFetchJson('/auth/registro-empresa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!data || !data.success) {
      const msg = (data && data.error) || 'No se pudo crear la empresa.';
      if (reError) {
        reError.textContent = msg;
        reError.classList.remove('hidden');
      }
    } else {
      // Intentar registrar también la empresa en Firebase con metadatos básicos
      try {
        const empresa = data.empresa || {};
        if (empresa && empresa.codigo) {
          await upsertEmpresaFirebase({
            ...empresa,
            rif: rif || null,
            telefono: telefono || null,
            direccion: ubicacion || null,
            estado: 'activa'
          });
        }
      } catch (syncErr) {
        console.warn('No se pudo registrar la empresa en Firebase (auto-registro):', syncErr);
      }

      cerrarModalRegistro();
      // Precargar campos de login con el usuario recién creado
      if (usernameInput) usernameInput.value = username;
      if (passwordInput) passwordInput.value = '';
      abrirModalRegistroExito();
    }
  } catch (err) {
    console.error('Error registrando empresa:', err);
    const msg = err && err.message ? err.message : 'Error al crear la empresa. Intente nuevamente.';
    if (reError) {
      reError.textContent = msg;
      reError.classList.remove('hidden');
    }
  } finally {
    reSubmit.disabled = false;
    reSubmit.innerHTML = originalHtml;
  }
}

if (btnOpenRegistro) {
  btnOpenRegistro.addEventListener('click', () => {
    abrirModalRegistro();
  });
}

if (reCancelar) {
  reCancelar.addEventListener('click', () => {
    cerrarModalRegistro();
  });
}

if (reCerrar) {
  reCerrar.addEventListener('click', () => {
    cerrarModalRegistro();
  });
}

if (reForm) {
  reForm.addEventListener('submit', enviarRegistroEmpresa);
}

if (reExitoCerrar) {
  reExitoCerrar.addEventListener('click', () => {
    cerrarModalRegistroExito();
  });
}

if (reExitoOk) {
  reExitoOk.addEventListener('click', () => {
    cerrarModalRegistroExito();
    if (usernameInput) {
      usernameInput.focus();
    }
  });
}
