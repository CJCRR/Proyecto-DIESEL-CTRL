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
    stock INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT,
    cliente TEXT,
    cedula TEXT,
    telefono TEXT,
    tasa_bcv REAL,
    descuento REAL DEFAULT 0,
    metodo_pago TEXT,
    referencia TEXT,
    total_bs REAL
  );

  CREATE TABLE IF NOT EXISTS venta_detalle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER,
    producto_id INTEGER,
    cantidad INTEGER,
    precio_usd REAL,
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
`;

db.exec(schema);

// Asegurar columna 'categoria' en productos (agregar si no existe)
try {
  const info = db.prepare("PRAGMA table_info('productos')").all();
  const hasCategoria = info.some(col => col.name === 'categoria');
  if (!hasCategoria) {
    db.prepare("ALTER TABLE productos ADD COLUMN categoria TEXT").run();
    console.log('Columna categoria añadida a productos');
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
} catch (err) {
  console.warn('No se pudo actualizar esquema para ventas (ignorado):', err.message);
}

// Seed inicial (solo si está vacío para evitar duplicados en reinicios)
const count = db.prepare('SELECT count(*) as c FROM productos').get();
if (count.c === 0) {
    const insert = db.prepare('INSERT INTO productos (codigo, descripcion, precio_usd, stock) VALUES (?, ?, ?, ?)');
    insert.run('INJ-001', 'Inyector Cummins', 45.00, 10);
    insert.run('FLT-020', 'Filtro de Aceite', 12.50, 50);
}

module.exports = db;