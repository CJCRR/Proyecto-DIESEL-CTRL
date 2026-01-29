const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// CRÍTICA TÉCNICA:
// Usar rutas relativas simples ('../database.sqlite') es peligroso porque depende
// de desde dónde ejecutes el comando 'node'.
// SOLUCIÓN: Usar path.join(__dirname) ancla la ruta al archivo actual, sin importar desde dónde se llame.

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new Database(dbPath, { verbose: console.log }); // Verbose ayuda a depurar

// Inicialización de tablas (Idempotente: solo crea si no existen)
const schema = `
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE,
    descripcion TEXT,
    precio_usd REAL,
    costo_usd REAL DEFAULT 0,
    stock INTEGER DEFAULT 0
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
        INSERT INTO usuarios (username, password, nombre_completo, rol, must_change_password)
        VALUES (?, ?, ?, 'admin', 1)
      `).run(adminUser, hash, 'Administrador');
      console.log('✅ Usuario admin inicial creado (debe cambiar contraseña)');
    } else {
      console.warn('⚠️ No se creó usuario admin: configure ADMIN_USERNAME y ADMIN_PASSWORD');
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