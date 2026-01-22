// Protección de autenticación para todas las páginas
(function() {
  // Verificar si estamos en la página de login
  if (window.location.pathname.includes('login.html')) {
    return;
  }

  const token = localStorage.getItem('auth_token');
  const user = JSON.parse(localStorage.getItem('auth_user') || 'null');

  if (!token || !user) {
    // No autenticado, redirigir a login
    window.location.href = '/login.html';
    return;
  }

  // Bloquear acceso a dashboard para roles no admin
  if (window.location.pathname.includes('dashboard.html') && user.rol !== 'admin') {
    window.location.href = '/index.html';
    return;
  }

  // Verificar sesión en el servidor
  fetch('/auth/verificar', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  .then(res => {
    if (!res.ok) {
      // Sesión inválida
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login.html';
    }
  })
  .catch(err => {
    console.error('Error verificando autenticación:', err);
  });

  // Agregar botón de logout al drawer si existe
  setTimeout(() => {
    const drawer = document.getElementById('drawer');
    if (drawer && user) {
      // Mostrar link de usuarios solo para admins
      if (user.rol === 'admin') {
        const nav = drawer.querySelector('nav');
        if (nav) {
          const usuariosLink = document.createElement('a');
          usuariosLink.href = '/usuarios.html';
          usuariosLink.className = 'flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 transition';
          usuariosLink.id = 'nav-usuarios';
          usuariosLink.innerHTML = '<i class="fas fa-user-shield text-purple-600"></i>Usuarios';
          nav.appendChild(usuariosLink);
        }
      }

      // Ocultar dashboard para roles no admin
      if (user.rol !== 'admin') {
        const dashboardLinks = document.querySelectorAll('a[href="/dashboard.html"]');
        dashboardLinks.forEach(link => {
          link.style.display = 'none';
        });
      }

      const logoutSection = document.createElement('div');
      logoutSection.className = 'p-4 border-t border-slate-200 bg-slate-50';
      logoutSection.innerHTML = `
        <div class="flex items-center gap-3 mb-3">
          <div class="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
            <i class="fas fa-user text-blue-600"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-slate-800 truncate">${user.nombre || user.username}</p>
            <p class="text-xs text-slate-500 uppercase">${user.rol}</p>
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
          await fetch('/auth/logout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
          });
        } catch (err) {
          console.error('Error cerrando sesión:', err);
        }
        
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        window.location.href = '/login.html';
      });
    }
  }, 100);

  // Exportar utilidades de auth
  window.Auth = {
    getToken: () => localStorage.getItem('auth_token'),
    getUser: () => JSON.parse(localStorage.getItem('auth_user') || 'null'),
    isAdmin: () => {
      const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      return user && user.rol === 'admin';
    },
    logout: () => {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login.html';
    }
  };
})();
