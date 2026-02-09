import { apiFetchJson } from './app-api.js';
// Protección de autenticación para todas las páginas
 (function() {
  // Forzar uso de cookies httpOnly (no tokens en localStorage)
  try { localStorage.removeItem('auth_token'); } catch {}

  // Wrapper global de fetch para enviar cookies y limpiar Authorization inválido
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const opts = { ...init, credentials: 'same-origin' };
    if (opts.headers) {
      const headers = new Headers(opts.headers);
      const auth = headers.get('Authorization') || '';
      if (/^Bearer\s*(null|undefined)?\s*$/i.test(auth)) {
        headers.delete('Authorization');
      }
      opts.headers = headers;
    }
    return originalFetch(input, opts);
  };

  // Verificar si estamos en la página de login
  if (window.location.pathname.includes('/pages/login.html')) {
    return;
  }

  const user = JSON.parse(localStorage.getItem('auth_user') || 'null');

  function applyRoleGuards(u) {
    // Superadmin: puede usar panel master y página de ajustes (para 2FA)
    if (u && u.rol === 'superadmin') {
      const path = window.location.pathname;
      const esPanelEmpresas = path.includes('/pages/admin-empresas.html');
      const esAjustes = path.includes('/pages/ajustes.html');
      if (!esPanelEmpresas && !esAjustes) {
        window.location.href = '/pages/admin-empresas.html';
        return false;
      }
      return true;
    }

    if (window.location.pathname.includes('/pages/dashboard.html') && u.rol !== 'admin') {
      window.location.href = '/pages/index.html';
      return false;
    }
    return true;
  }

  async function verificarSesion() {
    try {
      const data = await apiFetchJson('/auth/verificar');
      if (data && data.valido && data.usuario) {
        localStorage.setItem('auth_user', JSON.stringify(data.usuario));
        return data.usuario;
      }
      throw new Error('Sesión inválida');
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function redirectLogin() {
    localStorage.removeItem('auth_user');
    window.location.href = '/pages/login.html';
  }

  if (user) {
    if (!applyRoleGuards(user)) return;
    verificarSesion().catch(() => redirectLogin());
  } else {
    verificarSesion()
      .then(u => { if (!applyRoleGuards(u)) return; })
      .catch(() => redirectLogin());
  }

  // Agregar botón de logout al drawer si existe
  setTimeout(() => {
    const drawer = document.getElementById('drawer');
    const currentUser = JSON.parse(localStorage.getItem('auth_user') || 'null');
    if (drawer && currentUser) {
      // Superadmin: menú especial para panel master y ajustes de cuenta
      if (currentUser.rol === 'superadmin') {
        const nav = drawer.querySelector('nav');
        if (nav) {
          nav.innerHTML = `
            <a href="/pages/admin-empresas.html" class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 transition">
              <i class="fas fa-building text-blue-600"></i>
              Empresas (Master)
            </a>
            <a href="/pages/ajustes.html" class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 transition">
              <i class="fas fa-shield-alt text-emerald-600"></i>
              Seguridad / 2FA
            </a>
          `;
        }
        // No añadimos enlaces admin-only ni dashboard para superadmin
        // El bloque de logout se seguirá mostrando abajo
      }
      // Mostrar/ocultar accesos solo admin
      const gearButtons = document.querySelectorAll('.admin-only-gear');
      gearButtons.forEach(btn => {
        if (currentUser.rol === 'admin' || currentUser.rol === 'superadmin') {
          btn.style.removeProperty('display');
        } else {
          btn.style.display = 'none';
        }
      });

      // Ocultar enlaces marcados solo para admin
      const adminLinks = document.querySelectorAll('.admin-only-nav');
      adminLinks.forEach(link => {
        if (currentUser.rol === 'admin') {
          link.style.removeProperty('display');
        } else {
          link.style.display = 'none';
        }
      });

      // Mostrar link de usuarios solo para admins
      if (currentUser.rol === 'admin') {
        const nav = drawer.querySelector('nav');
        if (nav) {
          // Evitar duplicados si ya existe un enlace a usuarios
          const existingUsuariosLink = nav.querySelector('#nav-usuarios') || nav.querySelector('a[href="/pages/usuarios.html"]');
          if (!existingUsuariosLink) {
            const usuariosLink = document.createElement('a');
            usuariosLink.href = '/pages/usuarios.html';
            usuariosLink.className = 'flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 transition';
            usuariosLink.id = 'nav-usuarios';
            usuariosLink.innerHTML = '<i class="fas fa-user-shield text-purple-600"></i>Usuarios';
            nav.appendChild(usuariosLink);
          }
        }
      }

      // Ocultar dashboard para roles no admin
      if (currentUser.rol !== 'admin') {
        const dashboardLinks = document.querySelectorAll('a[href="/pages/dashboard.html"]');
        dashboardLinks.forEach(link => {
          link.style.display = 'none';
        });
      }

      // Evitar duplicados del bloque de logout
      let logoutSection = document.getElementById('auth-logout-section');
      if (!logoutSection) {
        logoutSection = document.createElement('div');
        logoutSection.id = 'auth-logout-section';
        logoutSection.className = 'p-4 border-t border-slate-200 bg-slate-50';
        logoutSection.innerHTML = `
        <div class="flex items-center gap-3 mb-3">
          <div class="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
            <i class="fas fa-user text-blue-600"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-slate-800 truncate">${currentUser.nombre || currentUser.username}</p>
            <p class="text-xs text-slate-500 uppercase">${currentUser.rol}</p>
          </div>
        </div>
        <button id="btn-logout" class="w-full p-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-semibold transition">
          <i class="fas fa-sign-out-alt mr-2"></i>Cerrar Sesión
        </button>
        `;
      
        // Agregar al final del drawer (antes del último div de atajos)
        const atajosDiv = drawer.querySelector('.p-4.border-t.border-slate-100.text-xs.text-slate-500');
        if (atajosDiv && atajosDiv.parentNode) {
          atajosDiv.parentNode.insertBefore(logoutSection, atajosDiv);
        } else {
          drawer.appendChild(logoutSection);
        }

        // Evento de logout
        document.getElementById('btn-logout').addEventListener('click', async () => {
          try {
            await apiFetchJson('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          } catch (err) {
            console.error('Error cerrando sesión:', err);
          }
          
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
          window.location.href = '/pages/login.html';
        });
      }
    }
  }, 100);

  // Exportar utilidades de auth
  window.Auth = {
    getUser: () => JSON.parse(localStorage.getItem('auth_user') || 'null'),
    getToken: () => null,
    isAdmin: () => {
      const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      return user && user.rol === 'admin';
    },
    logout: () => {
      try {
        apiFetchJson('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
          .catch(() => {})
          .finally(() => {
            localStorage.removeItem('auth_user');
            window.location.href = '/pages/login.html';
          });
      } catch {
        localStorage.removeItem('auth_user');
        window.location.href = '/pages/login.html';
      }
    }
  };
})();
