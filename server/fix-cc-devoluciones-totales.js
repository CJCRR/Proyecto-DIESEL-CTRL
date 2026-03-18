// Script de mantenimiento para limpiar cuentas por cobrar
// de ventas que ya fueron devueltas al 100%.
//
// Uso desde la raíz del proyecto:
//   node server/fix-cc-devoluciones-totales.js

const db = require('./db');

function obtenerDevueltosPorVenta(ventaId) {
  const rows = db.prepare(`
    SELECT dd.producto_id, SUM(dd.cantidad) AS devuelto
    FROM devolucion_detalle dd
    JOIN devoluciones d ON d.id = dd.devolucion_id
    WHERE d.venta_original_id = ?
    GROUP BY dd.producto_id
  `).all(ventaId);
  const map = new Map();
  rows.forEach(r => map.set(r.producto_id, Number(r.devuelto || 0)));
  return map;
}

function main() {
  const ventasConCC = db.prepare(`
      SELECT DISTINCT venta_id AS id
      FROM cuentas_cobrar
      WHERE venta_id IS NOT NULL
    `).all();

  console.log('Ventas con cuentas por cobrar encontradas:', ventasConCC.length);

  let cuentasEliminadas = 0;
  let pagosEliminados = 0;

  const deletePagosByCuenta = db.prepare('DELETE FROM pagos_cc WHERE cuenta_id = ?');
  const deleteCuenta = db.prepare('DELETE FROM cuentas_cobrar WHERE id = ?');

  const tx = db.transaction(() => {
    for (const v of ventasConCC) {
      const ventaId = Number(v.id);
      if (!ventaId) continue;

      const detalles = db.prepare(`
          SELECT producto_id, cantidad
          FROM venta_detalle
          WHERE venta_id = ?
        `).all(ventaId);
      if (!detalles.length) continue;

      const devueltos = obtenerDevueltosPorVenta(ventaId);
      if (!devueltos.size) continue; // sin devoluciones ligadas

      const esTotal = detalles.every(det => {
        const dev = devueltos.get(det.producto_id) || 0;
        return dev >= Number(det.cantidad || 0);
      });

      if (!esTotal) continue; // solo nos interesan devoluciones totales

      const cuentas = db.prepare('SELECT id FROM cuentas_cobrar WHERE venta_id = ?').all(ventaId);
      if (!cuentas.length) continue;

      for (const c of cuentas) {
        const pagosAntes = db.prepare('SELECT COUNT(*) AS c FROM pagos_cc WHERE cuenta_id = ?').get(c.id);
        deletePagosByCuenta.run(c.id);
        deleteCuenta.run(c.id);
        pagosEliminados += Number(pagosAntes.c || 0);
        cuentasEliminadas += 1;
      }
    }
  });

  tx();

  console.log('Cuentas por cobrar eliminadas:', cuentasEliminadas);
  console.log('Pagos asociados eliminados:', pagosEliminados);
  console.log('Listo. Revisa ahora el módulo de Cobranzas.');
}

main();
