import { apiFetchJson } from './app-api.js';

// Protección de autenticación para todas las páginas
(function () {
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

  // Verificar si estamos en la página de login: ahí no aplicamos guardas
  if (window.location.pathname.startsWith('/login')) {
    return;
  }

  const storedUser = JSON.parse(localStorage.getItem('auth_user') || 'null');

  const isEmpresaAdminRole = (rol) => rol === 'admin' || rol === 'admin_empresa';
  const isSuperAdminRole = (rol) => rol === 'superadmin';

  function clearTrialSessionFlags() {
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('trial_notice_shown_')) {
          keys.push(k);
        }
      }
      keys.forEach((k) => sessionStorage.removeItem(k));
    } catch (_) {
      // ignorar errores de sessionStorage
    }
  }

  function mostrarModalTrial(user) {
    if (!user || !user.empresa_trial || !user.empresa_trial.dias_restantes) return;

    const empresaId = user.empresa_id || user.empresa_codigo || 'unknown';
    const storageKey = `trial_notice_hidden_${empresaId}`;
    const sessionKey = `trial_notice_shown_${empresaId}`;
    try {
      if (localStorage.getItem(storageKey) === '1') return;
      if (sessionStorage.getItem(sessionKey) === '1') return;
    } catch (_) {
      // si localStorage falla, seguimos y mostramos una sola vez
    }

    if (document.getElementById('trial-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'trial-modal-overlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4';

    const card = document.createElement('div');
    card.className = 'bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'absolute top-3 right-3 text-slate-400 hover:text-slate-600';
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';

    const header = document.createElement('div');
    header.className = 'flex items-start gap-3 mb-3';
    header.innerHTML = `
      <div class="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
        <i class="fas fa-gift"></i>
      </div>
      <div>
        <h2 class="text-base font-semibold text-slate-800">Prueba gratis activa</h2>
        <p class="text-xs text-slate-500 mt-0.5">Aprovecha estos días para configurar tu empresa y probar Nexa CTRL.</p>
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'text-sm text-slate-700 space-y-2';

    const dias = Number(user.empresa_trial.dias_restantes || 0);
    const diasTexto = dias === 1 ? '1 día restante' : `${dias} días restantes`;
    const fechaFin = user.empresa_trial.termina_el
      ? new Date(user.empresa_trial.termina_el).toLocaleDateString('es-VE')
      : null;

    const p1 = document.createElement('p');
    p1.textContent = `Tu empresa está en período de prueba gratis. Tienes ${diasTexto}.`;

    const p2 = document.createElement('p');
    p2.className = 'text-xs text-slate-500';
    p2.textContent = fechaFin
      ? `Al finalizar la prueba podrás activar un plan de pago para seguir usando el sistema sin interrupciones. Fecha estimada de fin: ${fechaFin}.`
      : 'Al finalizar la prueba podrás activar un plan de pago para seguir usando el sistema sin interrupciones.';

    body.appendChild(p1);
    body.appendChild(p2);

    const footer = document.createElement('div');
    footer.className = 'mt-4 flex items-center justify-between gap-3';

    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'rounded border-slate-300 text-blue-600 focus:ring-blue-500';
    const spanChk = document.createElement('span');
    spanChk.textContent = 'No mostrar más este mensaje para esta empresa';
    checkboxLabel.appendChild(checkbox);
    checkboxLabel.appendChild(spanChk);

    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm';
    btnOk.textContent = 'Entendido';

    footer.appendChild(checkboxLabel);
    footer.appendChild(btnOk);

    function cerrar() {
      try {
        if (checkbox.checked) {
          localStorage.setItem(storageKey, '1');
        }
        // marcar que ya se mostró en esta sesión de navegador
        sessionStorage.setItem(sessionKey, '1');
      } catch (_) {}
      overlay.remove();
    }

    closeBtn.addEventListener('click', cerrar);
    btnOk.addEventListener('click', cerrar);

    card.appendChild(closeBtn);
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function actualizarPillSesion(user, intento = 0) {
    if (!user) return;
    const pill = document.getElementById('app-session-status');
    const textEl = document.getElementById('app-session-status-text');
    const dotEl = document.getElementById('app-session-status-dot');

    // Si el header aún no está montado (páginas con layout-shell), reintentar unas veces
    if ((!pill || !textEl || !dotEl) && intento < 5) {
      setTimeout(() => actualizarPillSesion(user, intento + 1), 120);
      return;
    }
    if (!pill || !textEl || !dotEl) return;

    let label = 'Sesión activa';
    let color = '#22c55e'; // verde por defecto

    if (user.empresa_estado === 'suspendida') {
      label = 'Cuenta suspendida';
      color = '#ef4444';
    } else if (user.empresa_trial && Number(user.empresa_trial.dias_restantes || 0) > 0) {
      label = 'Free trial';
      color = '#fbbf24';
    }

    textEl.textContent = label;
    dotEl.style.backgroundColor = color;
    dotEl.style.boxShadow = `0 0 0 2px ${color}33`;
    pill.classList.remove('hidden');
  }

  function applyRoleGuards(u) {
    if (!u) return false;

    const path = window.location.pathname;

    // Superadmin: solo panel master y ajustes (2FA)
    if (isSuperAdminRole(u.rol)) {
      const esPanelEmpresas = path.startsWith('/admin-empresas');
      const esAjustes = path.startsWith('/ajustes');
      if (!esPanelEmpresas && !esAjustes) {
        window.location.href = '/admin-empresas';
        return false;
      }
      return true;
    }

    const esPanelEmpresas = path.startsWith('/admin-empresas');
    if (esPanelEmpresas) {
      // Panel master solo para superadmin
      window.location.href = '/pos';
      return false;
    }

    // Dashboard solo para administradores de empresa
    if (path.startsWith('/dashboard') && !isEmpresaAdminRole(u.rol)) {
      window.location.href = '/pos';
      return false;
    }

    return true;
  }

  async function verificarSesion() {
    const data = await apiFetchJson('/auth/verificar');
    if (data && data.valido && data.usuario) {
      localStorage.setItem('auth_user', JSON.stringify(data.usuario));
      return data.usuario;
    }
    throw new Error('Sesión inválida');
  }

  function redirectLogin() {
    localStorage.removeItem('auth_user');
    clearTrialSessionFlags();
    window.location.href = '/login';
  }

  if (storedUser) {
    if (!applyRoleGuards(storedUser)) return;
    verificarSesion()
      .then((u) => {
        if (!applyRoleGuards(u)) return;
        mostrarModalTrial(u);
        actualizarPillSesion(u);
      })
      .catch(() => redirectLogin());
  } else {
    verificarSesion()
      .then((u) => {
        if (!applyRoleGuards(u)) return;
        mostrarModalTrial(u);
        actualizarPillSesion(u);
      })
      .catch(() => redirectLogin());
  }

  function applyNavGuards() {
    const drawer = document.getElementById('drawer');
    const currentUser = JSON.parse(localStorage.getItem('auth_user') || 'null');
    if (drawer && currentUser) {
      const isEmpresaAdmin = isEmpresaAdminRole(currentUser.rol);
      const isSuperAdmin = isSuperAdminRole(currentUser.rol);

      // Superadmin: menú especial para panel master y ajustes de cuenta
      if (isSuperAdmin) {
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
      }

      // Mostrar/ocultar accesos solo admin (engranes de ajustes)
      const gearButtons = document.querySelectorAll('.admin-only-gear');
      gearButtons.forEach((btn) => {
        if (isEmpresaAdmin || isSuperAdmin) {
          btn.style.removeProperty('display');
        } else {
          btn.style.display = 'none';
        }
      });

      // Ocultar enlaces marcados solo para admin
      const adminLinks = document.querySelectorAll('.admin-only-nav');
      adminLinks.forEach((link) => {
        if (isEmpresaAdmin) {
          link.style.removeProperty('display');
        } else {
          link.style.display = 'none';
        }
      });

      // Mostrar link de usuarios solo para admins de empresa
      if (isEmpresaAdmin) {
        const nav = drawer.querySelector('nav');
        if (nav) {
          const existingUsuariosLink = nav.querySelector('#nav-usuarios') || nav.querySelector('a[href="/usuarios"]');
          if (!existingUsuariosLink) {
            const usuariosLink = document.createElement('a');
            usuariosLink.href = '/usuarios';
            usuariosLink.className = 'flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 transition';
            usuariosLink.id = 'nav-usuarios';
            usuariosLink.innerHTML = '<i class="fas fa-user-shield text-purple-600"></i>Usuarios';
            nav.appendChild(usuariosLink);
          }
        }
      }

      // Ocultar dashboard para roles que no sean admin de empresa
      if (!isEmpresaAdmin) {
        const dashboardLinks = document.querySelectorAll('a[href="/pages/dashboard.html"]');
        dashboardLinks.forEach((link) => {
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

        const atajosDiv = drawer.querySelector('.p-4.border-t.border-slate-100.text-xs.text-slate-500');
        if (atajosDiv && atajosDiv.parentNode) {
          atajosDiv.parentNode.insertBefore(logoutSection, atajosDiv);
        } else {
          drawer.appendChild(logoutSection);
        }

        document.getElementById('btn-logout').addEventListener('click', async () => {
          try {
            await apiFetchJson('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          } catch (err) {
            console.error('Error cerrando sesión:', err);
          }

          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
          clearTrialSessionFlags();
          window.location.href = '/login';
        });
      }
    }
  }

  // Agregar botón de logout y enlaces del menú al drawer si existe
  setTimeout(() => {
    try {
      applyNavGuards();
    } catch (err) {
      console.error('Error aplicando guards de navegación:', err);
    }
  }, 100);

  // Exportar utilidades de auth
  window.Auth = {
    getUser: () => JSON.parse(localStorage.getItem('auth_user') || 'null'),
    getToken: () => null,
    isAdmin: () => {
      const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
      return user && (user.rol === 'admin' || user.rol === 'admin_empresa');
    },
    applyNavGuards,
    logout: () => {
      try {
        apiFetchJson('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
          .catch(() => { })
          .finally(() => {
            localStorage.removeItem('auth_user');
            clearTrialSessionFlags();
            window.location.href = '/login';
          });
      } catch {
        localStorage.removeItem('auth_user');
        clearTrialSessionFlags();
        window.location.href = '/login';
      }
    }
  };
})();
