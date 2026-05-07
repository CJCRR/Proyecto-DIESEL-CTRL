export const MODULE_DEFINITIONS = [
  {
    key: 'pos',
    label: 'Punto de venta',
    description: 'Ventas, notas y flujo comercial diario.',
    path: '/pos',
    routes: ['/pos', '/pages/index.html']
  },
  {
    key: 'inventario',
    label: 'Inventario',
    description: 'Productos, stock, depósitos y exportaciones.',
    path: '/inventario',
    routes: ['/inventario', '/pages/inventario.html']
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Indicadores generales y panel ejecutivo.',
    path: '/dashboard',
    routes: ['/dashboard', '/pages/dashboard.html']
  },
  {
    key: 'clientes',
    label: 'Clientes',
    description: 'Consulta y gestión de clientes.',
    path: '/clientes',
    routes: ['/clientes', '/pages/clientes.html']
  },
  {
    key: 'reportes',
    label: 'Reportes',
    description: 'KPIs, exportaciones y análisis de negocio.',
    path: '/reportes',
    routes: ['/reportes', '/pages/reportes.html']
  },
  {
    key: 'cobranzas',
    label: 'Cobranzas',
    description: 'Cuentas por cobrar, pagos y vencimientos.',
    path: '/cobranzas',
    routes: ['/cobranzas', '/pages/cobranzas.html']
  },
  {
    key: 'proveedores',
    label: 'Proveedores',
    description: 'Consulta y mantenimiento de proveedores.',
    path: '/proveedores',
    routes: ['/proveedores', '/pages/proveedores.html']
  },
  {
    key: 'compras',
    label: 'Compras',
    description: 'Ingresos, órdenes y movimientos de compra.',
    path: '/compras',
    routes: ['/compras', '/pages/compras.html']
  },
  {
    key: 'usuarios',
    label: 'Usuarios',
    description: 'Administración de accesos y cuentas.',
    path: '/usuarios',
    routes: ['/usuarios', '/pages/usuarios.html']
  },
  {
    key: 'ajustes',
    label: 'Ajustes',
    description: 'Configuración global y parámetros del sistema.',
    path: '/ajustes',
    routes: ['/ajustes', '/pages/ajustes.html']
  },
  {
    key: 'admin_empresas',
    label: 'Empresas (Master)',
    description: 'Panel maestro multiempresa.',
    path: '/admin-empresas',
    routes: ['/admin-empresas', '/pages/admin-empresas.html']
  }
];

export const MODULE_KEYS = MODULE_DEFINITIONS.map((moduleDef) => moduleDef.key);

const DEFAULT_ROLE_PERMISSION_KEYS = {
  admin: ['pos', 'inventario', 'dashboard', 'clientes', 'reportes', 'cobranzas', 'proveedores', 'compras', 'usuarios', 'ajustes'],
  admin_empresa: ['pos', 'inventario', 'dashboard', 'clientes', 'reportes', 'cobranzas', 'proveedores', 'compras', 'usuarios', 'ajustes'],
  vendedor: ['pos', 'inventario', 'clientes', 'reportes', 'cobranzas', 'proveedores', 'compras'],
  lectura: ['inventario', 'clientes', 'reportes', 'cobranzas', 'proveedores', 'compras'],
  superadmin: ['admin_empresas', 'ajustes']
};

function buildPermissionMap(enabledKeys) {
  const enabled = new Set(Array.isArray(enabledKeys) ? enabledKeys : []);
  return MODULE_KEYS.reduce((accumulator, key) => {
    accumulator[key] = enabled.has(key);
    return accumulator;
  }, {});
}

function normalizePath(pathname) {
  const rawPath = String(pathname || '').split('?')[0].split('#')[0].trim();
  if (!rawPath) {
    return '/';
  }

  if (rawPath === '/') {
    return rawPath;
  }

  return rawPath.replace(/\/+$/, '') || '/';
}

export function getRoleBasePermissions(role) {
  const permissionKeys = DEFAULT_ROLE_PERMISSION_KEYS[role] || DEFAULT_ROLE_PERMISSION_KEYS.vendedor;
  return buildPermissionMap(permissionKeys);
}

export function sanitizeModulePermissions(rawPermissions) {
  let parsed = rawPermissions;

  if (!parsed) {
    return {};
  }

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      return {};
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return Object.entries(parsed).reduce((accumulator, [key, value]) => {
    if (MODULE_KEYS.includes(key) && typeof value === 'boolean') {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});
}

export function getEffectiveModulePermissions(user) {
  const basePermissions = getRoleBasePermissions(user && user.rol ? user.rol : 'vendedor');
  const overrides = sanitizeModulePermissions(user && user.permisos_modulos);
  return {
    ...basePermissions,
    ...overrides
  };
}

export function userHasModulePermission(user, moduleKey) {
  if (!moduleKey) {
    return true;
  }

  const permissions = getEffectiveModulePermissions(user);
  return !!permissions[moduleKey];
}

export function getRouteModuleKey(pathname) {
  const normalizedPath = normalizePath(pathname);
  const match = MODULE_DEFINITIONS.find((moduleDef) => {
    const routes = Array.isArray(moduleDef.routes) ? moduleDef.routes : [];
    return routes.some((route) => normalizePath(route) === normalizedPath);
  });
  return match ? match.key : null;
}

export function getFirstAllowedRoute(user) {
  if (user && user.rol === 'superadmin' && userHasModulePermission(user, 'admin_empresas')) {
    return '/admin-empresas';
  }

  const permissions = getEffectiveModulePermissions(user);
  const firstAllowed = MODULE_DEFINITIONS.find((moduleDef) => moduleDef.path && permissions[moduleDef.key]);
  return firstAllowed ? firstAllowed.path : '/inicio';
}