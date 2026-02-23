const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// CRÍTICA TÉCNICA:
// Usar rutas relativas simples ('../database.sqlite') es peligroso porque depende
// de desde dónde ejecutes el comando 'node'.
// SOLUCIÓN: Usar path.join(__dirname) ancla la ruta al archivo actual, sin importar desde dónde se llame.

const isTest = process.env.NODE_ENV === 'test';
// Permitir configurar el nombre/ruta del archivo de base de datos vía variables de entorno.
// Para producción se recomienda establecer DB_PATH o DATABASE_FILE.
const dbFile = process.env.DB_PATH || process.env.DATABASE_FILE || 'database.sqlite';
const dbPath = isTest ? ':memory:' : path.join(__dirname, '..', dbFile);

// Verbose SQL solo si se habilita explícitamente (evita ruido en producción)
const sqlVerboseEnv = process.env.SQL_VERBOSE || process.env.SQL_DEBUG;
const sqlVerbose = sqlVerboseEnv && ['1', 'true', 'yes'].includes(String(sqlVerboseEnv).toLowerCase());

const db = new Database(dbPath, { verbose: sqlVerbose ? console.log : null });

// Inicialización de tablas (Idempotente: solo crea si no existen)
const schema = `
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE,
    descripcion TEXT,
    precio_usd REAL,
    costo_usd REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    categoria TEXT,
    marca TEXT
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT,
    cliente TEXT,
    vendedor TEXT,
    cedula TEXT,
    telefono TEXT,
    tasa_bcv REAL,
    descuento REAL DEFAULT 0,
    metodo_pago TEXT,
    referencia TEXT,
    total_bs REAL,
    iva_pct REAL DEFAULT 0,
    total_bs_iva REAL DEFAULT 0,
    total_usd_iva REAL DEFAULT 0,
    usuario_id INTEGER,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS devoluciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT,
    cliente TEXT,
    cliente_doc TEXT,
    telefono TEXT,
    tasa_bcv REAL,
    referencia TEXT,
    motivo TEXT,
    venta_original_id INTEGER,
    total_bs REAL DEFAULT 0,
    total_usd REAL DEFAULT 0,
    usuario_id INTEGER,
    notas TEXT,
    FOREIGN KEY(venta_original_id) REFERENCES ventas(id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS venta_detalle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER,
    producto_id INTEGER,
    cantidad INTEGER,
    precio_usd REAL,
    costo_usd REAL DEFAULT 0,
    subtotal_bs REAL,
    FOREIGN KEY(venta_id) REFERENCES ventas(id),
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  );

  CREATE TABLE IF NOT EXISTS devolucion_detalle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    devolucion_id INTEGER,
    producto_id INTEGER,
    cantidad INTEGER,
    precio_usd REAL,
    subtotal_bs REAL,
    FOREIGN KEY(devolucion_id) REFERENCES devoluciones(id),
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  );
  
  CREATE TABLE IF NOT EXISTS ajustes_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    diferencia INTEGER,
    motivo TEXT,
    fecha TEXT
  );

  CREATE TABLE IF NOT EXISTS config (
    clave TEXT PRIMARY KEY,
    valor TEXT,
    actualizado_en TEXT
  );

  CREATE TABLE IF NOT EXISTS cuentas_cobrar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_nombre TEXT,
    cliente_doc TEXT,
    venta_id INTEGER,
    total_usd REAL DEFAULT 0,
    tasa_bcv REAL DEFAULT 1,
    saldo_usd REAL DEFAULT 0,
    fecha_emision TEXT,
    fecha_vencimiento TEXT,
    estado TEXT DEFAULT 'pendiente',
    notas TEXT,
    creado_en TEXT DEFAULT (datetime('now')),
    actualizado_en TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pagos_cc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cuenta_id INTEGER NOT NULL,
    fecha TEXT,
    monto_usd REAL DEFAULT 0,
    moneda TEXT DEFAULT 'USD',
    tasa_bcv REAL DEFAULT 1,
    monto_moneda REAL DEFAULT 0,
    metodo TEXT,
    referencia TEXT,
    notas TEXT,
    usuario TEXT,
    creado_en TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(cuenta_id) REFERENCES cuentas_cobrar(id)
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nombre_completo TEXT,
    rol TEXT DEFAULT 'vendedor',
    activo INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now')),
    ultimo_login TEXT,
    must_change_password INTEGER DEFAULT 0,
    failed_attempts INTEGER DEFAULT 0,
    locked_until TEXT
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    creado_en TEXT DEFAULT (datetime('now')),
    expira_en TEXT,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS alertas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT,
    mensaje TEXT,
    data TEXT,
    leido INTEGER DEFAULT 0,
    creado_en TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS presupuestos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT,
    cliente TEXT,
    cliente_doc TEXT,
    telefono TEXT,
    tasa_bcv REAL,
    descuento REAL DEFAULT 0,
    total_bs REAL DEFAULT 0,
    total_usd REAL DEFAULT 0,
    valido_hasta TEXT,
    estado TEXT DEFAULT 'activo',
    notas TEXT,
    usuario_id INTEGER,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS presupuesto_detalle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    presupuesto_id INTEGER,
    producto_id INTEGER,
    codigo TEXT,
    descripcion TEXT,
    cantidad INTEGER,
    precio_usd REAL,
    subtotal_bs REAL,
    FOREIGN KEY(presupuesto_id) REFERENCES presupuestos(id),
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  );
`;

db.exec(schema);

// Migraciones controladas
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`);

const columnExists = (table, col) => {
  try {
    const info = db.prepare(`PRAGMA table_info('${table}')`).all();
    return info.some(c => c.name === col);
  } catch {
    return false;
  }
};

const indexExists = (name) => {
  try {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`).get(name);
    return !!row;
  } catch {
    return false;
  }
};

const migrations = [
  {
    id: '001_productos_categoria_costo',
    up: () => {
      if (!columnExists('productos', 'categoria')) {
        db.prepare("ALTER TABLE productos ADD COLUMN categoria TEXT").run();
      }
      if (!columnExists('productos', 'costo_usd')) {
        db.prepare("ALTER TABLE productos ADD COLUMN costo_usd REAL DEFAULT 0").run();
      }
    }
  },
  {
    id: '002_ventas_campos_extra',
    up: () => {
      const cols = [
        ['descuento', "ALTER TABLE ventas ADD COLUMN descuento REAL DEFAULT 0"],
        ['metodo_pago', "ALTER TABLE ventas ADD COLUMN metodo_pago TEXT"],
        ['referencia', "ALTER TABLE ventas ADD COLUMN referencia TEXT"],
        ['cedula', "ALTER TABLE ventas ADD COLUMN cedula TEXT"],
        ['telefono', "ALTER TABLE ventas ADD COLUMN telefono TEXT"],
        ['vendedor', "ALTER TABLE ventas ADD COLUMN vendedor TEXT"],
        ['usuario_id', "ALTER TABLE ventas ADD COLUMN usuario_id INTEGER"]
      ];
      cols.forEach(([name, sql]) => { if (!columnExists('ventas', name)) db.prepare(sql).run(); });
    }
  },
  {
    id: '003_venta_detalle_costo',
    up: () => {
      if (!columnExists('venta_detalle', 'costo_usd')) {
        db.prepare("ALTER TABLE venta_detalle ADD COLUMN costo_usd REAL DEFAULT 0").run();
      }
      db.prepare(`
        UPDATE venta_detalle
        SET costo_usd = (
          SELECT p.costo_usd FROM productos p WHERE p.id = venta_detalle.producto_id
        )
        WHERE costo_usd IS NULL
      `).run();
      db.prepare(`UPDATE venta_detalle SET costo_usd = 0 WHERE costo_usd IS NULL`).run();
      db.prepare(`
        UPDATE venta_detalle
        SET costo_usd = (
          SELECT p.costo_usd FROM productos p WHERE p.id = venta_detalle.producto_id AND p.costo_usd IS NOT NULL
        )
        WHERE (costo_usd = 0 OR costo_usd IS NULL)
      `).run();
    }
  },
  {
    id: '004_usuarios_seguridad',
    up: () => {
      if (!columnExists('usuarios', 'must_change_password')) {
        db.prepare("ALTER TABLE usuarios ADD COLUMN must_change_password INTEGER DEFAULT 0").run();
      }
      if (!columnExists('usuarios', 'failed_attempts')) {
        db.prepare("ALTER TABLE usuarios ADD COLUMN failed_attempts INTEGER DEFAULT 0").run();
      }
      if (!columnExists('usuarios', 'locked_until')) {
        db.prepare("ALTER TABLE usuarios ADD COLUMN locked_until TEXT").run();
      }
    }
  },
  {
    id: '005_indices_basicos',
    up: () => {
      if (!indexExists('idx_productos_codigo')) db.prepare('CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos (codigo)').run();
      if (!indexExists('idx_ventas_fecha')) db.prepare('CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas (fecha)').run();
      if (!indexExists('idx_venta_detalle_venta_id')) db.prepare('CREATE INDEX IF NOT EXISTS idx_venta_detalle_venta_id ON venta_detalle (venta_id)').run();
      if (!indexExists('idx_venta_detalle_producto_id')) db.prepare('CREATE INDEX IF NOT EXISTS idx_venta_detalle_producto_id ON venta_detalle (producto_id)').run();
      if (!indexExists('idx_devolucion_detalle_devolucion_id')) db.prepare('CREATE INDEX IF NOT EXISTS idx_devolucion_detalle_devolucion_id ON devolucion_detalle (devolucion_id)').run();
    }
  },
  {
    id: '006_presupuestos_tablas_indices',
    up: () => {
      db.prepare(`CREATE TABLE IF NOT EXISTS presupuestos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT,
        cliente TEXT,
        cliente_doc TEXT,
        telefono TEXT,
        tasa_bcv REAL,
        descuento REAL DEFAULT 0,
        total_bs REAL DEFAULT 0,
        total_usd REAL DEFAULT 0,
        valido_hasta TEXT,
        estado TEXT DEFAULT 'activo',
        notas TEXT,
        usuario_id INTEGER,
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
      )`).run();
      db.prepare(`CREATE TABLE IF NOT EXISTS presupuesto_detalle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presupuesto_id INTEGER,
        producto_id INTEGER,
        codigo TEXT,
        descripcion TEXT,
        cantidad INTEGER,
        precio_usd REAL,
        subtotal_bs REAL,
        FOREIGN KEY(presupuesto_id) REFERENCES presupuestos(id),
        FOREIGN KEY(producto_id) REFERENCES productos(id)
      )`).run();
      if (!indexExists('idx_presupuestos_fecha')) db.prepare('CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha ON presupuestos (fecha)').run();
      if (!indexExists('idx_presupuesto_detalle_presupuesto_id')) db.prepare('CREATE INDEX IF NOT EXISTS idx_presupuesto_detalle_presupuesto_id ON presupuesto_detalle (presupuesto_id)').run();
      if (!indexExists('idx_presupuesto_detalle_producto_id')) db.prepare('CREATE INDEX IF NOT EXISTS idx_presupuesto_detalle_producto_id ON presupuesto_detalle (producto_id)').run();
    }
  },
  {
    id: '007_proveedores_compras',
    up: () => {
      // Tabla de proveedores
      db.prepare(`CREATE TABLE IF NOT EXISTS proveedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        rif TEXT,
        telefono TEXT,
        email TEXT,
        direccion TEXT,
        notas TEXT,
        activo INTEGER DEFAULT 1,
        creado_en TEXT DEFAULT (datetime('now')),
        actualizado_en TEXT DEFAULT (datetime('now'))
      )`).run();

      // Vinculación opcional proveedor-producto
      if (!columnExists('productos', 'proveedor_id')) {
        db.prepare('ALTER TABLE productos ADD COLUMN proveedor_id INTEGER').run();
      }

      // Tablas de compras (ordenes de compra / ingresos de inventario)
      db.prepare(`CREATE TABLE IF NOT EXISTS compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proveedor_id INTEGER,
        fecha TEXT,
        numero TEXT,
        tasa_bcv REAL DEFAULT 1,
        total_bs REAL DEFAULT 0,
        total_usd REAL DEFAULT 0,
        estado TEXT DEFAULT 'recibida',
        notas TEXT,
        usuario_id INTEGER,
        creado_en TEXT DEFAULT (datetime('now')),
        actualizado_en TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(proveedor_id) REFERENCES proveedores(id),
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
      )`).run();

      db.prepare(`CREATE TABLE IF NOT EXISTS compra_detalle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compra_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        codigo TEXT,
        descripcion TEXT,
        marca TEXT,
        cantidad INTEGER NOT NULL,
        costo_usd REAL DEFAULT 0,
        subtotal_bs REAL DEFAULT 0,
        lote TEXT,
        observaciones TEXT,
        FOREIGN KEY(compra_id) REFERENCES compras(id),
        FOREIGN KEY(producto_id) REFERENCES productos(id)
      )`).run();

      // Índices básicos
      if (!indexExists('idx_proveedores_nombre')) db.prepare('CREATE INDEX IF NOT EXISTS idx_proveedores_nombre ON proveedores (nombre)').run();
      if (!indexExists('idx_compras_fecha')) db.prepare('CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras (fecha)').run();
      if (!indexExists('idx_compras_proveedor')) db.prepare('CREATE INDEX IF NOT EXISTS idx_compras_proveedor ON compras (proveedor_id)').run();
      if (!indexExists('idx_compra_detalle_compra')) db.prepare('CREATE INDEX IF NOT EXISTS idx_compra_detalle_compra ON compra_detalle (compra_id)').run();
      if (!indexExists('idx_compra_detalle_producto')) db.prepare('CREATE INDEX IF NOT EXISTS idx_compra_detalle_producto ON compra_detalle (producto_id)').run();
    }
  },
  {
    id: '008_productos_marca',
    up: () => {
      if (!columnExists('productos', 'marca')) {
        db.prepare("ALTER TABLE productos ADD COLUMN marca TEXT").run();
      }
    }
  },
  {
    id: '009_compra_detalle_marca',
    up: () => {
      if (!columnExists('compra_detalle', 'marca')) {
        db.prepare('ALTER TABLE compra_detalle ADD COLUMN marca TEXT').run();
      }
    }
  },
  {
    id: '010_ventas_iva',
    up: () => {
      if (!columnExists('ventas', 'iva_pct')) {
        db.prepare("ALTER TABLE ventas ADD COLUMN iva_pct REAL DEFAULT 0").run();
      }
      if (!columnExists('ventas', 'total_bs_iva')) {
        db.prepare("ALTER TABLE ventas ADD COLUMN total_bs_iva REAL DEFAULT 0").run();
      }
      if (!columnExists('ventas', 'total_usd_iva')) {
        db.prepare("ALTER TABLE ventas ADD COLUMN total_usd_iva REAL DEFAULT 0").run();
      }

      db.prepare(`
        UPDATE ventas
        SET total_bs_iva = CASE WHEN total_bs_iva IS NULL OR total_bs_iva = 0 THEN COALESCE(total_bs,0) ELSE total_bs_iva END,
            total_usd_iva = CASE
              WHEN total_usd_iva IS NULL OR total_usd_iva = 0 THEN
                CASE WHEN COALESCE(tasa_bcv,0) != 0 THEN COALESCE(total_bs,0) / tasa_bcv ELSE COALESCE(total_bs,0) END
              ELSE total_usd_iva
            END
      `).run();
    }
  },
  {
    id: '011_empresas_y_usuario_empresa_id',
    up: () => {
      // Tabla de empresas (multiempresa básica)
      db.prepare(`CREATE TABLE IF NOT EXISTS empresas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        codigo TEXT UNIQUE NOT NULL,
        estado TEXT DEFAULT 'activa',
        fecha_alta TEXT DEFAULT (datetime('now')),
        fecha_corte INTEGER DEFAULT 1,
        dias_gracia INTEGER DEFAULT 7,
        nota_interna TEXT,
        creado_en TEXT DEFAULT (datetime('now')),
        actualizado_en TEXT DEFAULT (datetime('now'))
      )`).run();

      // Empresa por defecto para instalaciones existentes / local
      const existeEmpresa = db.prepare('SELECT id FROM empresas WHERE id = 1').get();
      if (!existeEmpresa) {
        db.prepare(`
          INSERT INTO empresas (id, nombre, codigo, estado)
          VALUES (1, 'Empresa Local', 'LOCAL', 'activa')
        `).run();
      }

      // Asociar usuarios a empresas
      if (!columnExists('usuarios', 'empresa_id')) {
        db.prepare('ALTER TABLE usuarios ADD COLUMN empresa_id INTEGER DEFAULT 1').run();
      }

      // Normalizar empresa_id en usuarios existentes (solo usuarios normales, no superadmin futuros)
      db.prepare("UPDATE usuarios SET empresa_id = 1 WHERE empresa_id IS NULL AND (rol IS NULL OR rol != 'superadmin')").run();

      // Índice básico por empresa en usuarios
      if (!indexExists('idx_usuarios_empresa')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON usuarios (empresa_id)').run();
      }
    }
  },
  {
    id: '012_empresas_licencias_basicas',
    up: () => {
      // Campos adicionales para gestionar licencias/planes por empresa
      if (!columnExists('empresas', 'plan')) {
        db.prepare("ALTER TABLE empresas ADD COLUMN plan TEXT").run();
      }
      if (!columnExists('empresas', 'monto_mensual')) {
        db.prepare("ALTER TABLE empresas ADD COLUMN monto_mensual REAL DEFAULT 0").run();
      }
      if (!columnExists('empresas', 'ultimo_pago_en')) {
        db.prepare("ALTER TABLE empresas ADD COLUMN ultimo_pago_en TEXT").run();
      }
      if (!columnExists('empresas', 'proximo_cobro')) {
        db.prepare("ALTER TABLE empresas ADD COLUMN proximo_cobro TEXT").run();
      }
    }
  },
  {
    id: '013_sync_tablas_basicas',
    up: () => {
      // Cola de operaciones a sincronizar (principalmente usada en modo local)
      db.prepare(`CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER,
        tipo TEXT NOT NULL,
        entidad TEXT NOT NULL,
        entidad_id_local INTEGER,
        evento_uid TEXT NOT NULL,
        payload TEXT NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        intentos INTEGER DEFAULT 0,
        ultimo_error TEXT,
        creado_en TEXT DEFAULT (datetime('now')),
        actualizado_en TEXT DEFAULT (datetime('now')),
        enviado_en TEXT,
        confirmado_en TEXT
      )`).run();

      if (!indexExists('idx_sync_outbox_estado')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_sync_outbox_estado ON sync_outbox (estado)').run();
      }
      if (!indexExists('idx_sync_outbox_evento_uid')) {
        db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_evento_uid ON sync_outbox (evento_uid)').run();
      }

      // Registro de eventos ya aplicados en el lado nube para evitar duplicados (idempotencia)
      db.prepare(`CREATE TABLE IF NOT EXISTS sync_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER,
        origen TEXT,
        evento_uid TEXT NOT NULL,
        tipo TEXT NOT NULL,
        entidad TEXT NOT NULL,
        aplicado_en TEXT DEFAULT (datetime('now')),
        payload_original TEXT
      )`).run();

      if (!indexExists('idx_sync_inbox_evento_uid')) {
        db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_inbox_evento_uid ON sync_inbox (evento_uid)').run();
      }
    }
  },
  {
    id: '014_empresas_metricas_diarias',
    up: () => {
      db.prepare(`CREATE TABLE IF NOT EXISTS empresa_metricas_diarias (
        empresa_id INTEGER NOT NULL,
        fecha TEXT NOT NULL,
        ventas_count INTEGER DEFAULT 0,
        total_bs REAL DEFAULT 0,
        total_usd REAL DEFAULT 0,
        creado_en TEXT DEFAULT (datetime('now')),
        actualizado_en TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (empresa_id, fecha)
      )`).run();

      if (!indexExists('idx_emp_metricas_fecha')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_emp_metricas_fecha ON empresa_metricas_diarias (fecha)').run();
      }
    }
  },
  {
    id: '015_productos_multiempresa',
    up: () => {
      // Asociar productos a empresas para separar inventario
      if (!columnExists('productos', 'empresa_id')) {
        db.prepare('ALTER TABLE productos ADD COLUMN empresa_id INTEGER').run();
      }

      // Normalizar: productos existentes → empresa LOCAL (id=1) si está vacío
      db.prepare('UPDATE productos SET empresa_id = 1 WHERE empresa_id IS NULL').run();

      // Índice por empresa + código para búsquedas rápidas
      if (!indexExists('idx_productos_empresa_codigo')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_productos_empresa_codigo ON productos (empresa_id, codigo)').run();
      }
    }
  },
  {
    id: '016_empresas_contacto',
    up: () => {
      // Datos básicos de contacto por empresa
      if (!columnExists('empresas', 'rif')) {
        db.prepare("ALTER TABLE empresas ADD COLUMN rif TEXT").run();
      }
      if (!columnExists('empresas', 'telefono')) {
        db.prepare("ALTER TABLE empresas ADD COLUMN telefono TEXT").run();
      }
      if (!columnExists('empresas', 'direccion')) {
        db.prepare("ALTER TABLE empresas ADD COLUMN direccion TEXT").run();
      }
    }
  },
  {
    id: '017_proveedores_compras_multiempresa',
    up: () => {
      // Asociar proveedores a empresas
      if (!columnExists('proveedores', 'empresa_id')) {
        db.prepare('ALTER TABLE proveedores ADD COLUMN empresa_id INTEGER').run();
        // Proveedores existentes pertenecen a la empresa LOCAL (id=1)
        db.prepare('UPDATE proveedores SET empresa_id = 1 WHERE empresa_id IS NULL').run();
      }
      if (!indexExists('idx_proveedores_empresa')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_proveedores_empresa ON proveedores (empresa_id)').run();
      }

      // Asociar compras a empresas
      if (!columnExists('compras', 'empresa_id')) {
        db.prepare('ALTER TABLE compras ADD COLUMN empresa_id INTEGER').run();
      }

      // Rellenar empresa_id en compras a partir del usuario
      db.prepare(`
        UPDATE compras
        SET empresa_id = (
          SELECT u.empresa_id
          FROM usuarios u
          WHERE u.id = compras.usuario_id
        )
        WHERE empresa_id IS NULL
      `).run();

      // Cualquier compra huérfana va a LOCAL
      db.prepare('UPDATE compras SET empresa_id = 1 WHERE empresa_id IS NULL').run();

      if (!indexExists('idx_compras_empresa')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_compras_empresa ON compras (empresa_id)').run();
      }
    }
  },
  {
    id: '018_presupuestos_multiempresa',
    up: () => {
      // Asociar presupuestos a empresas
      if (!columnExists('presupuestos', 'empresa_id')) {
        db.prepare('ALTER TABLE presupuestos ADD COLUMN empresa_id INTEGER').run();
      }

      db.prepare(`
        UPDATE presupuestos
        SET empresa_id = (
          SELECT u.empresa_id
          FROM usuarios u
          WHERE u.id = presupuestos.usuario_id
        )
        WHERE empresa_id IS NULL
      `).run();

      // Presupuestos antiguos sin usuario asociado van a LOCAL
      db.prepare('UPDATE presupuestos SET empresa_id = 1 WHERE empresa_id IS NULL').run();

      if (!indexExists('idx_presupuestos_empresa')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_presupuestos_empresa ON presupuestos (empresa_id)').run();
      }
    }
  },
  {
    id: '019_indices_rendimiento_base',
    up: () => {
      // Índice compuesto para acelerar búsquedas de usuarios por empresa y username
      if (!indexExists('idx_usuarios_empresa_username')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_username ON usuarios (empresa_id, username)').run();
      }

      // Índice para acelerar consultas de ventas por usuario y fecha
      if (!indexExists('idx_ventas_usuario_fecha')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_ventas_usuario_fecha ON ventas (usuario_id, fecha)').run();
      }
    }
  },
  {
    id: '020_auditoria_y_2fa_basico',
    up: () => {
      // Tabla de auditoría para acciones críticas
      db.prepare(`CREATE TABLE IF NOT EXISTS auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL DEFAULT (datetime('now')),
        usuario_id INTEGER,
        empresa_id INTEGER,
        accion TEXT NOT NULL,
        entidad TEXT,
        entidad_id INTEGER,
        detalle TEXT,
        ip TEXT,
        user_agent TEXT
      )`).run();

      if (!indexExists('idx_auditoria_fecha')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria (fecha)').run();
      }
      if (!indexExists('idx_auditoria_usuario')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria (usuario_id)').run();
      }
      if (!indexExists('idx_auditoria_entidad')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON auditoria (entidad, entidad_id)').run();
      }

      // Campos básicos para 2FA opcional en usuarios (solo backend por ahora)
      if (!columnExists('usuarios', 'twofa_enabled')) {
        db.prepare("ALTER TABLE usuarios ADD COLUMN twofa_enabled INTEGER DEFAULT 0").run();
      }
      if (!columnExists('usuarios', 'twofa_secret')) {
        db.prepare("ALTER TABLE usuarios ADD COLUMN twofa_secret TEXT").run();
      }
    }
  },
  {
    id: '021_depositos_inventario_basico',
    up: () => {
      // Tabla de depósitos por empresa
      db.prepare(`CREATE TABLE IF NOT EXISTS depositos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        codigo TEXT,
        es_principal INTEGER DEFAULT 0,
        activo INTEGER DEFAULT 1,
        creado_en TEXT DEFAULT (datetime('now')),
        actualizado_en TEXT DEFAULT (datetime('now'))
      )`).run();

      if (!indexExists('idx_depositos_empresa')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_depositos_empresa ON depositos (empresa_id)').run();
      }

      // Columna depósito principal por producto (cada producto pertenece a un depósito)
      if (!columnExists('productos', 'deposito_id')) {
        db.prepare('ALTER TABLE productos ADD COLUMN deposito_id INTEGER').run();
      }

      // Crear un depósito "Principal" para la empresa LOCAL (id=1) si no existe ninguno
      const existePrincipal = db.prepare('SELECT id FROM depositos WHERE empresa_id = 1 AND es_principal = 1 LIMIT 1').get();
      let principalId = existePrincipal && existePrincipal.id;
      if (!principalId) {
        const info = db.prepare(`
          INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo)
          VALUES (1, 'Depósito Principal', 'PRINCIPAL', 1, 1)
        `).run();
        principalId = info.lastInsertRowid;
      }

      // Asegurar que productos existentes apunten al depósito principal por defecto
      if (principalId) {
        db.prepare('UPDATE productos SET deposito_id = ? WHERE deposito_id IS NULL').run(principalId);
      }
    }
  },
  {
    id: '022_movimientos_depositos_basico',
    up: () => {
      // Tabla de movimientos entre depósitos (por ahora registra cambios de depósito por producto)
      db.prepare(`CREATE TABLE IF NOT EXISTS movimientos_deposito (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        deposito_origen_id INTEGER,
        deposito_destino_id INTEGER NOT NULL,
        cantidad REAL,
        motivo TEXT,
        creado_en TEXT DEFAULT (datetime('now'))
      )`).run();

      if (!indexExists('idx_mov_dep_empresa_fecha')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_mov_dep_empresa_fecha ON movimientos_deposito (empresa_id, creado_en DESC)').run();
      }
      if (!indexExists('idx_mov_dep_producto')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_mov_dep_producto ON movimientos_deposito (producto_id, creado_en DESC)').run();
      }
    }
  },
  {
    id: '023_stock_por_deposito_basico',
    up: () => {
      // Existencias por depósito para soportar stock distribuido
      db.prepare(`CREATE TABLE IF NOT EXISTS stock_por_deposito (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        deposito_id INTEGER NOT NULL,
        cantidad REAL NOT NULL DEFAULT 0,
        creado_en TEXT DEFAULT (datetime('now')),
        actualizado_en TEXT DEFAULT (datetime('now')),
        UNIQUE (producto_id, deposito_id)
      )`).run();

      if (!indexExists('idx_stock_dep_empresa_producto')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_stock_dep_empresa_producto ON stock_por_deposito (empresa_id, producto_id)').run();
      }
      if (!indexExists('idx_stock_dep_deposito')) {
        db.prepare('CREATE INDEX IF NOT EXISTS idx_stock_dep_deposito ON stock_por_deposito (deposito_id)').run();
      }

      // Inicializar existencias por depósito a partir del stock actual y deposito_id de productos
      // Solo se insertan filas si aún no existen datos para ese producto/deposito
      db.prepare(`
        INSERT OR IGNORE INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad)
        SELECT
          COALESCE(p.empresa_id, 1) AS empresa_id,
          p.id AS producto_id,
          p.deposito_id AS deposito_id,
          COALESCE(p.stock, 0) AS cantidad
        FROM productos p
        WHERE p.deposito_id IS NOT NULL
      `).run();
    }
  }
  ,
  {
    id: '024_usuarios_comision_pct',
    up: () => {
      if (!columnExists('usuarios', 'comision_pct')) {
        db.prepare("ALTER TABLE usuarios ADD COLUMN comision_pct REAL DEFAULT 0").run();
      }
    }
  },
  {
    id: '025_ventas_comision',
    up: () => {
      if (!columnExists('ventas', 'comision_pct')) {
        db.prepare("ALTER TABLE ventas ADD COLUMN comision_pct REAL DEFAULT 0").run();
      }
      if (!columnExists('ventas', 'comision_bs')) {
        db.prepare("ALTER TABLE ventas ADD COLUMN comision_bs REAL DEFAULT 0").run();
      }
      if (!columnExists('ventas', 'comision_usd')) {
        db.prepare("ALTER TABLE ventas ADD COLUMN comision_usd REAL DEFAULT 0").run();
      }
    }
  }
];

const applyMigrations = () => {
  const has = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const insert = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');
  migrations.forEach(m => {
    if (has.get(m.id)) return;
    const tx = db.transaction(() => {
      m.up();
      insert.run(m.id);
    });
    try {
      tx();
      console.log(`✅ Migración aplicada: ${m.id}`);
    } catch (err) {
      console.warn(`❌ Error migración ${m.id}:`, err.message);
    }
  });
};

applyMigrations();

// Crear usuario admin por defecto si no existen usuarios
try {
  const usuariosCount = db.prepare('SELECT count(*) as c FROM usuarios').get();
  if (usuariosCount.c === 0) {
    const adminUser = process.env.ADMIN_USERNAME;
    const adminPass = process.env.ADMIN_PASSWORD;
    if (adminUser && adminPass) {
      const hash = bcrypt.hashSync(adminPass, 10);
      db.prepare(`
        INSERT INTO usuarios (username, password, nombre_completo, rol, must_change_password, empresa_id)
        VALUES (?, ?, ?, 'admin', 1, 1)
      `).run(adminUser, hash, 'Administrador');
      console.log('✅ Usuario admin inicial creado (debe cambiar contraseña)');
    } else {
      console.warn('⚠️ No se creó usuario admin: configure ADMIN_USERNAME y ADMIN_PASSWORD');
    }
  }

  // Crear usuario superadmin global por defecto si no existe ninguno
  const superAdmins = db.prepare("SELECT count(*) as c FROM usuarios WHERE rol = 'superadmin'").get();
  if (superAdmins.c === 0) {
    const superUser = process.env.SUPERADMIN_USERNAME;
    const superPass = process.env.SUPERADMIN_PASSWORD;
    if (superUser && superPass) {
      const hash = bcrypt.hashSync(superPass, 10);
      // empresa_id NULL para marcarlo como global (no ligado a una empresa concreta)
      db.prepare(`
        INSERT INTO usuarios (username, password, nombre_completo, rol, must_change_password, empresa_id)
        VALUES (?, ?, ?, 'superadmin', 1, NULL)
      `).run(superUser, hash, 'Super Administrador');
      console.log('✅ Usuario superadmin inicial creado (panel master)');
    } else {
      console.warn('⚠️ No se creó usuario superadmin: configure SUPERADMIN_USERNAME y SUPERADMIN_PASSWORD');
    }
  }
} catch (err) {
  console.warn('No se pudo crear usuario admin:', err.message);
}

// Seed inicial (solo si está vacío para evitar duplicados en reinicios)
const count = db.prepare('SELECT count(*) as c FROM productos').get();
if (count.c === 0) {
  const insert = db.prepare('INSERT INTO productos (codigo, descripcion, precio_usd, stock) VALUES (?, ?, ?, ?)');
  insert.run('INJ-001', 'Inyector Cummins', 45.00, 10);
  insert.run('FLT-020', 'Filtro de Aceite', 12.50, 50);
}

// Valores por defecto en config
try {
  const ensureConfig = db.prepare(`INSERT OR IGNORE INTO config (clave, valor, actualizado_en) VALUES (?, ?, ?)`);
  const now = new Date().toISOString();
  ensureConfig.run('stock_minimo', '3', now);
  // tasa_bcv: si existe una venta reciente, usarla; si no, default 1
  const ultimaTasa = db.prepare(`SELECT tasa_bcv FROM ventas WHERE tasa_bcv IS NOT NULL AND tasa_bcv > 0 ORDER BY fecha DESC LIMIT 1`).get();
  const tasa = (ultimaTasa && ultimaTasa.tasa_bcv) ? String(ultimaTasa.tasa_bcv) : '1';
  ensureConfig.run('tasa_bcv', tasa, now);
} catch (err) {
  console.warn('No se pudo inicializar config (ignorado):', err.message);
}

module.exports = db;