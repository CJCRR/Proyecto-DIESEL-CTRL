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
    tasa_bcv REAL,
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

// Seed inicial (solo si está vacío para evitar duplicados en reinicios)
const count = db.prepare('SELECT count(*) as c FROM productos').get();
if (count.c === 0) {
    const insert = db.prepare('INSERT INTO productos (codigo, descripcion, precio_usd, stock) VALUES (?, ?, ?, ?)');
    insert.run('INJ-001', 'Inyector Cummins', 45.00, 10);
    insert.run('FLT-020', 'Filtro de Aceite', 12.50, 50);
}

module.exports = db;