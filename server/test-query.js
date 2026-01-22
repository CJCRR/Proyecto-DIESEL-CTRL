const db = require('./db');

// Probar query de ventas de hoy
const hoy = '2026-01-21';
const rows = db.prepare(`
  SELECT v.id, v.fecha, v.cliente, v.vendedor, v.metodo_pago, v.referencia,
         v.tasa_bcv, v.descuento,
         COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), v.total_bs, 0) AS total_bs,
         COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) / NULLIF(v.tasa_bcv,0),
                  SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),
                  v.total_bs) AS total_usd,
         COALESCE(SUM(vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)), 0) AS bruto_bs,
         COALESCE(SUM(vd.precio_usd * vd.cantidad), 0) AS bruto_usd,
         COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)), 0) AS costo_bs,
         COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad), 0) AS costo_usd,
         COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), v.total_bs, 0)
           - COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)), 0) AS margen_bs,
         COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) / NULLIF(v.tasa_bcv,0),
                  SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),
                  v.total_bs) - COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad),0) AS margen_usd
  FROM ventas v
  JOIN venta_detalle vd ON vd.venta_id = v.id
  JOIN productos p ON p.id = vd.producto_id
  WHERE date(v.fecha) >= date(?)
    AND date(v.fecha) <= date(?)
  GROUP BY v.id
  ORDER BY v.fecha DESC
  LIMIT 1000
`).all(hoy, hoy);

console.log('Ventas encontradas:', rows.length);
if (rows.length > 0) {
  console.log('Primera venta:', JSON.stringify(rows[0], null, 2));
}

// Probar todas las ventas sin filtro
const todas = db.prepare(`SELECT COUNT(*) as c FROM ventas`).get();
console.log('\nTotal ventas en DB:', todas.c);

// Probar ventas de hoy
const ventasHoy = db.prepare(`SELECT COUNT(*) as c FROM ventas WHERE date(fecha) = date(?)`).get(hoy);
console.log('Ventas de hoy (2026-01-21):', ventasHoy.c);
