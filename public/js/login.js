// Sistema de autenticación
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');

// Verificar si ya está autenticado
const token = localStorage.getItem('auth_token');
if (token) {
  verificarSesion(token);
}

function mostrarError(mensaje) {
  errorText.textContent = mensaje;
  errorMessage.classList.remove('hidden');
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 5000);
}

async function verificarSesion(token) {
  try {
    const res = await fetch('/auth/verificar', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.valido) {
        // Sesión válida, redirigir
        window.location.href = '/pages/index.html';
      }
    } else {
      localStorage.removeItem('auth_token');
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
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      // Guardar token y datos de usuario
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_user', JSON.stringify(data.usuario));
      
      // Mostrar mensaje de éxito breve
      loginBtn.innerHTML = '<i class="fas fa-check mr-2"></i>¡Bienvenido!';
      loginBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      loginBtn.classList.add('bg-green-600');
      
      // Redirigir al POS
      setTimeout(() => {
        window.location.href = '/pages/index.html';
      }, 500);
    } else {
      mostrarError(data.error || 'Credenciales inválidas');
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Ingresar';
    }
  } catch (err) {
    console.error('Error en login:', err);
    mostrarError('Error de conexión. Intente nuevamente.');
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>Ingresar';
  }
});

// Focus automático en el campo de usuario
usernameInput.focus();
