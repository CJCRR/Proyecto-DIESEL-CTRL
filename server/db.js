const Database = require('better-sqlite3');
const path = require('path');

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
    ultimo_login TEXT
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    creado_en TEXT DEFAULT (datetime('now')),
    expira_en TEXT,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  );
`;

db.exec(schema);

// Asegurar columna 'categoria' en productos (agregar si no existe)
try {
  const info = db.prepare("PRAGMA table_info('productos')").all();
  const hasCategoria = info.some(col => col.name === 'categoria');
  const hasCosto = info.some(col => col.name === 'costo_usd');
  if (!hasCategoria) {
    db.prepare("ALTER TABLE productos ADD COLUMN categoria TEXT").run();
    console.log('Columna categoria añadida a productos');
  }
  if (!hasCosto) {
    db.prepare("ALTER TABLE productos ADD COLUMN costo_usd REAL DEFAULT 0").run();
    console.log('Columna costo_usd añadida a productos');
  }
} catch (err) {
  console.warn('No se pudo actualizar esquema para categoria (ignorado):', err.message);
}

// Asegurar columnas en 'ventas' para descuento y metodo_pago (si la tabla ya existe)
try {
  const infoVentas = db.prepare("PRAGMA table_info('ventas')").all();
  const hasDescuento = infoVentas.some(col => col.name === 'descuento');
  const hasMetodo = infoVentas.some(col => col.name === 'metodo_pago');
  const hasReferencia = infoVentas.some(col => col.name === 'referencia');
  const hasCedula = infoVentas.some(col => col.name === 'cedula');
  const hasTelefono = infoVentas.some(col => col.name === 'telefono');
  const hasVendedor = infoVentas.some(col => col.name === 'vendedor');
  const hasUsuarioId = infoVentas.some(col => col.name === 'usuario_id');
  if (!hasDescuento) {
    db.prepare("ALTER TABLE ventas ADD COLUMN descuento REAL DEFAULT 0").run();
    console.log('Columna descuento añadida a ventas');
  }
  if (!hasMetodo) {
    db.prepare("ALTER TABLE ventas ADD COLUMN metodo_pago TEXT").run();
    console.log('Columna metodo_pago añadida a ventas');
  }
  if (!hasReferencia) {
    db.prepare("ALTER TABLE ventas ADD COLUMN referencia TEXT").run();
    console.log('Columna referencia añadida a ventas');
  }
  if (!hasCedula) {
    db.prepare("ALTER TABLE ventas ADD COLUMN cedula TEXT").run();
    console.log('Columna cedula añadida a ventas');
  }
  if (!hasTelefono) {
    db.prepare("ALTER TABLE ventas ADD COLUMN telefono TEXT").run();
    console.log('Columna telefono añadida a ventas');
  }
  if (!hasVendedor) {
    db.prepare("ALTER TABLE ventas ADD COLUMN vendedor TEXT").run();
    console.log('Columna vendedor añadida a ventas');
  }
  if (!hasUsuarioId) {
    db.prepare("ALTER TABLE ventas ADD COLUMN usuario_id INTEGER").run();
    console.log('Columna usuario_id añadida a ventas');
  }
} catch (err) {
  console.warn('No se pudo actualizar esquema para ventas (ignorado):', err.message);
}

// Asegurar columna costo_usd en venta_detalle
try {
  const infoVD = db.prepare("PRAGMA table_info('venta_detalle')").all();
  const hasCosto = infoVD.some(col => col.name === 'costo_usd');
  if (!hasCosto) {
    db.prepare("ALTER TABLE venta_detalle ADD COLUMN costo_usd REAL DEFAULT 0").run();
    console.log('Columna costo_usd añadida a venta_detalle');
  }

  // Backfill costo_usd en venta_detalle con el costo del producto si está vacío
  db.prepare(`
    UPDATE venta_detalle
    SET costo_usd = (
      SELECT p.costo_usd FROM productos p WHERE p.id = venta_detalle.producto_id
    )
    WHERE costo_usd IS NULL
  `).run();
  db.prepare(`UPDATE venta_detalle SET costo_usd = 0 WHERE costo_usd IS NULL`).run();

  // Backfill también cuando costo_usd es 0 pero el producto tiene costo > 0
  db.prepare(`
    UPDATE venta_detalle
    SET costo_usd = (
      SELECT p.costo_usd FROM productos p WHERE p.id = venta_detalle.producto_id AND p.costo_usd IS NOT NULL
    )
    WHERE (costo_usd = 0 OR costo_usd IS NULL)
  `).run();
} catch (err) {
  console.warn('No se pudo actualizar esquema para venta_detalle (ignorado):', err.message);
}

// Crear usuario admin por defecto si no existen usuarios
try {
  const usuariosCount = db.prepare('SELECT count(*) as c FROM usuarios').get();
  if (usuariosCount.c === 0) {
    // Password por defecto: "admin123" (en producción debería estar hasheado)
    db.prepare(`
      INSERT INTO usuarios (username, password, nombre_completo, rol)
      VALUES ('admin', 'admin123', 'Administrador', 'admin')
    `).run();
    console.log('✅ Usuario admin creado (username: admin, password: admin123)');
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