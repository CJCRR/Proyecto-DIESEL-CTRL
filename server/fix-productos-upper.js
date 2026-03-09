// Script para normalizar a MAYÚSCULAS los textos de productos existentes.
// Ejecutar con:
//   node server/fix-productos-upper.js

const Database = require('better-sqlite3');
const path = require('path');

// Usar la misma convención que db.js (archivo database.sqlite en la raíz del proyecto)
const dbFile = process.env.DB_PATH || process.env.DATABASE_FILE || 'database.sqlite';
const dbPath = path.join(__dirname, '..', dbFile);
const db = new Database(dbPath);

function toUpperOrNull(v) {
  if (v === null || v === undefined) return v;
  const s = String(v).trim();
  return s ? s.toUpperCase() : s;
}

function main() {
  const rows = db.prepare('SELECT id, codigo, descripcion, categoria, marca FROM productos').all();
  console.log(`Productos encontrados: ${rows.length}`);

  const updateStmt = db.prepare(`
    UPDATE productos
    SET descripcion = @descripcion,
        categoria = @categoria,
        marca = @marca
    WHERE id = @id
  `);

  const tx = db.transaction((items) => {
    for (const p of items) {
      const nuevaDescripcion = toUpperOrNull(p.descripcion);
      const nuevaCategoria = toUpperOrNull(p.categoria);
      const nuevaMarca = toUpperOrNull(p.marca);

      // Si ya están exactamente iguales, saltar para evitar escrituras innecesarias
      if (nuevaDescripcion === p.descripcion &&
          nuevaCategoria === p.categoria &&
          nuevaMarca === p.marca) {
        continue;
      }

      updateStmt.run({
        id: p.id,
        descripcion: nuevaDescripcion,
        categoria: nuevaCategoria,
        marca: nuevaMarca,
      });
    }
  });

  tx(rows);

  console.log('Normalización completada.');
}

main();
