import { apiFetchJson } from './app-api.js';

const form = document.getElementById('resetForm');
const passwordInput = document.getElementById('rp-password');
const passwordConfirmInput = document.getElementById('rp-password-confirm');
const formError = document.getElementById('rp-form-error');
const globalError = document.getElementById('rp-global-error');
const globalErrorText = document.getElementById('rp-global-error-text');
const globalSuccess = document.getElementById('rp-global-success');
const globalSuccessText = document.getElementById('rp-global-success-text');
const saveBtn = document.getElementById('rp-save-btn');
const backLoginBtn = document.getElementById('rp-back-login');

const params = new URLSearchParams(window.location.search);
const token = (params.get('token') || '').trim();

function mostrarGlobalError(msg) {
  if (!globalError || !globalErrorText) return;
  globalErrorText.textContent = msg;
  globalError.classList.remove('hidden');
}

function limpiarMensajes() {
  if (formError) {
    formError.textContent = '';
    formError.classList.add('hidden');
  }
  if (globalError) {
    globalError.classList.add('hidden');
  }
  if (globalSuccess) {
    globalSuccess.classList.add('hidden');
  }
}

if (!token) {
  mostrarGlobalError('El enlace de recuperación no es válido. Solicita nuevamente la recuperación de contraseña desde la pantalla de login.');
  if (form && saveBtn) {
    form.querySelectorAll('input').forEach(el => el.disabled = true);
    saveBtn.disabled = true;
  }
} else if (passwordInput) {
  setTimeout(() => passwordInput.focus(), 50);
}

async function enviarNuevaContrasena(e) {
  if (e) e.preventDefault();
  if (!form || !passwordInput || !passwordConfirmInput || !saveBtn) return;

  limpiarMensajes();

  const password = passwordInput.value.trim();
  const password2 = passwordConfirmInput.value.trim();

  if (!password || !password2) {
    if (formError) {
      formError.textContent = 'Por favor completa ambos campos de contraseña.';
      formError.classList.remove('hidden');
    }
    return;
  }
  if (password.length < 6) {
    if (formError) {
      formError.textContent = 'La contraseña debe tener al menos 6 caracteres.';
      formError.classList.remove('hidden');
    }
    return;
  }
  if (password !== password2) {
    if (formError) {
      formError.textContent = 'Las contraseñas no coinciden.';
      formError.classList.remove('hidden');
    }
    return;
  }

  saveBtn.disabled = true;
  const originalHtml = saveBtn.innerHTML;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Guardando...';

  try {
    const data = await apiFetchJson('/auth/password-reset-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password })
    });

    if (!data || !data.success) {
      const msg = (data && data.error) || 'No se pudo actualizar la contraseña.';
      mostrarGlobalError(msg);
    } else {
      if (globalSuccess && globalSuccessText) {
        globalSuccessText.textContent = data.message || 'Contraseña actualizada correctamente. Ya puedes iniciar sesión con tu nueva contraseña.';
        globalSuccess.classList.remove('hidden');
      }
      if (form) {
        form.querySelectorAll('input').forEach(el => el.disabled = true);
      }
      // Opcional: redirigir automáticamente después de unos segundos
      setTimeout(() => {
        window.location.href = '/login';
      }, 3000);
    }
  } catch (err) {
    console.error('Error enviando nueva contraseña:', err);
    mostrarGlobalError(err && err.message ? err.message : 'Error al actualizar la contraseña. Intenta nuevamente.');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalHtml;
  }
}

if (form) {
  form.addEventListener('submit', enviarNuevaContrasena);
}

if (backLoginBtn) {
  backLoginBtn.addEventListener('click', () => {
    window.location.href = '/login';
  });
}
