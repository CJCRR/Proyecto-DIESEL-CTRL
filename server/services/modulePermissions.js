const MODULE_DEFINITIONS = [
  { key: 'pos', label: 'Punto de venta', path: '/pos' },
  { key: 'inventario', label: 'Inventario', path: '/inventario' },
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { key: 'clientes', label: 'Clientes', path: '/clientes' },
  { key: 'reportes', label: 'Reportes', path: '/reportes' },
  { key: 'cobranzas', label: 'Cobranzas', path: '/cobranzas' },
  { key: 'proveedores', label: 'Proveedores', path: '/proveedores' },
  { key: 'compras', label: 'Compras', path: '/compras' },
  { key: 'usuarios', label: 'Usuarios', path: '/usuarios' },
  { key: 'ajustes', label: 'Ajustes', path: '/ajustes' },
  { key: 'admin_empresas', label: 'Empresas (Master)', path: '/admin-empresas' }
];

const MODULE_KEYS = MODULE_DEFINITIONS.map((moduleDef) => moduleDef.key);

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

function getRoleBasePermissions(role) {
  const permissionKeys = DEFAULT_ROLE_PERMISSION_KEYS[role] || DEFAULT_ROLE_PERMISSION_KEYS.vendedor;
  return buildPermissionMap(permissionKeys);
}

function sanitizePermissionOverrides(rawPermissions) {
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

function getEffectiveModulePermissions(user) {
  const basePermissions = getRoleBasePermissions(user && user.rol ? user.rol : 'vendedor');
  const overrides = sanitizePermissionOverrides(
    user && Object.prototype.hasOwnProperty.call(user, 'permisos_modulos')
      ? user.permisos_modulos
      : user && Object.prototype.hasOwnProperty.call(user, 'permissions')
        ? user.permissions
        : user && Object.prototype.hasOwnProperty.call(user, 'module_permissions')
          ? user.module_permissions
          : null
  );

  return {
    ...basePermissions,
    ...overrides
  };
}

function attachEffectiveModulePermissions(user) {
  if (!user || typeof user !== 'object') {
    return user;
  }

  return {
    ...user,
    permisos_modulos: getEffectiveModulePermissions(user)
  };
}

function canAccessModule(user, moduleKey) {
  if (!moduleKey) {
    return true;
  }

  const permissions = getEffectiveModulePermissions(user);
  return !!permissions[moduleKey];
}

module.exports = {
  MODULE_DEFINITIONS,
  MODULE_KEYS,
  getRoleBasePermissions,
  sanitizePermissionOverrides,
  getEffectiveModulePermissions,
  attachEffectiveModulePermissions,
  canAccessModule
};