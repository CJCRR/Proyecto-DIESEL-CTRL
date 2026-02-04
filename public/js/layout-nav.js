// layout-nav.js - genera el drawer de navegación común

const NAV_LINKS = [
  { id: 'pos', href: '/pages/index.html', icon: 'fa-cash-register', iconColor: 'text-blue-600', label: 'Punto de Venta' },
  { id: 'inventario', href: '/pages/inventario.html', icon: 'fa-boxes-stacked', iconColor: 'text-amber-600', label: 'Inventario' },
  { id: 'dashboard', href: '/pages/dashboard.html', icon: 'fa-chart-line', iconColor: 'text-emerald-600', label: 'Dashboard', adminOnly: true },
  { id: 'clientes', href: '/pages/clientes.html', icon: 'fa-users', iconColor: 'text-indigo-600', label: 'Clientes' },
  { id: 'reportes', href: '/pages/reportes.html', icon: 'fa-file-invoice', iconColor: 'text-rose-600', label: 'Reportes' },
  { id: 'cobranzas', href: '/pages/cobranzas.html', icon: 'fa-money-check-dollar', iconColor: 'text-emerald-600', label: 'Cobranzas' },
  { id: 'proveedores', href: '/pages/proveedores.html', icon: 'fa-truck-field', iconColor: 'text-orange-600', label: 'Proveedores' },
  { id: 'compras', href: '/pages/compras.html', icon: 'fa-file-invoice-dollar', iconColor: 'text-lime-600', label: 'Compras' }
];

function buildNavHtml(activeId) {
  return NAV_LINKS.map(link => {
    const isActive = link.id === activeId;
    const baseClasses = 'flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 transition';
    const activeClass = isActive ? ' bg-slate-100' : '';
    const adminClass = link.adminOnly ? ' admin-only-nav' : '';
    return `<a href="${link.href}" class="${baseClasses}${activeClass}${adminClass}">
      <i class="fas ${link.icon} ${link.iconColor}"></i>
      ${link.label}
    </a>`;
  }).join('\n');
}

function initDrawerNav(pageId) {
  try {
    const nav = document.querySelector('#drawer nav');
    if (!nav) return;
    const id = pageId || getActiveIdFromLocation();
    nav.innerHTML = buildNavHtml(id);
  } catch (err) {
    console.error('Error inicializando drawer nav', err);
  }
}

function getActiveIdFromLocation() {
  try {
    const path = window.location?.pathname || '';
    const match = NAV_LINKS.find(l => l.href === path);
    return match ? match.id : '';
  } catch {
    return '';
  }
}

// Auto-inicialización básica
if (typeof window !== 'undefined') {
  window.initDrawerNav = initDrawerNav;
  document.addEventListener('DOMContentLoaded', () => {
    initDrawerNav();
  });
}
