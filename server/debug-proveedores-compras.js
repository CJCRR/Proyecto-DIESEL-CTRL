// Script de diagnóstico para revisar proveedores y compras por empresa
// Ejecutar con: node server/debug-proveedores-compras.js

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new Database(dbPath);

function main() {
  console.log('Usando base de datos:', dbPath);

  try {
    const empresas = db.prepare('SELECT id, nombre FROM empresas ORDER BY id').all();
    console.log('\nEmpresas registradas:');
    empresas.forEach(e => {
      console.log(`  Empresa ${e.id}: ${e.nombre}`);
    });
  } catch (e) {
    console.log('\nNo se pudo leer tabla empresas (puede no existir aún).');
  }

  console.log('\nProveedores por empresa_id:');
  const provResumen = db.prepare(`
    SELECT COALESCE(empresa_id, 0) AS empresa_id, COUNT(*) AS total
    FROM proveedores
    GROUP BY COALESCE(empresa_id, 0)
    ORDER BY empresa_id
  `).all();
  provResumen.forEach(r => {
    console.log(`  empresa_id=${r.empresa_id}: ${r.total} proveedor(es)`);
  });

  console.log('\nCompras por empresa_id:');
  const compResumen = db.prepare(`
    SELECT COALESCE(empresa_id, 0) AS empresa_id, COUNT(*) AS total
    FROM compras
    GROUP BY COALESCE(empresa_id, 0)
    ORDER BY empresa_id
  `).all();
  compResumen.forEach(r => {
    console.log(`  empresa_id=${r.empresa_id}: ${r.total} compra(s)`);
  });

  console.log('\nEjemplo de proveedores (máx 5 por empresa):');
  const provEj = db.prepare(`
    SELECT id, nombre, empresa_id, rif, activo
    FROM proveedores
    ORDER BY empresa_id, id
    LIMIT 25
  `).all();
  provEj.forEach(p => {
    console.log(`  [emp=${p.empresa_id || 0}] prov #${p.id}: ${p.nombre} (${p.rif || 'sin RIF'}) activo=${p.activo}`);
  });

  console.log('\nEjemplo de compras (máx 5 por empresa):');
  const compEj = db.prepare(`
    SELECT id, proveedor_id, empresa_id, fecha, total_usd
    FROM compras
    ORDER BY empresa_id, id
    LIMIT 25
  `).all();
  compEj.forEach(c => {
    console.log(`  [emp=${c.empresa_id || 0}] compra #${c.id}: proveedor_id=${c.proveedor_id || 'null'} fecha=${c.fecha || ''} total_usd=${c.total_usd}`);
  });

  console.log('\nFin del diagnóstico.');
}

main();
