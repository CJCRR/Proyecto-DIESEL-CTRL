const express = require('express');
const router = express.Router();
const db = require('../db');

function queryVentasRango({ desde, hasta, vendedor, metodo, limit = 500 }) {
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  if (vendedor) { where.push("v.vendedor LIKE ?"); params.push('%' + vendedor + '%'); }
  if (metodo) { where.push("v.metodo_pago = ?"); params.push(metodo); }
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

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
    ${whereSQL}
    GROUP BY v.id
    ORDER BY v.fecha DESC
    LIMIT ?
  `).all(...params, limit);

  return rows;
}

router.get('/ventas', (req, res) => {
    const ventas = db.prepare(`
    SELECT id, fecha, cliente, vendedor, cedula, telefono, total_bs, tasa_bcv, descuento, metodo_pago, referencia
    FROM ventas
    ORDER BY fecha DESC
    LIMIT 100
  `).all();

    res.json(ventas);
});

// GET /reportes/ventas-rango?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&vendedor=X&metodo=Y
router.get('/ventas-rango', (req, res) => {
  try {
    const { desde, hasta, vendedor, metodo } = req.query;
    const rows = queryVentasRango({ desde, hasta, vendedor, metodo, limit: 1000 });
    res.json(rows);
  } catch (err) {
    console.error('Error en ventas-rango:', err);
    res.status(500).json({ error: 'Error al obtener ventas por rango' });
  }
});

// GET /reportes/ventas/export/csv
router.get('/ventas/export/csv', (req, res) => {
  try {
    const { desde, hasta, vendedor, metodo } = req.query;
    const rows = queryVentasRango({ desde, hasta, vendedor, metodo, limit: 5000 });
    const header = ['fecha','cliente','vendedor','metodo_pago','referencia','tasa_bcv','descuento','total_bs','total_usd','bruto_bs','bruto_usd','costo_bs','costo_usd','margen_bs','margen_usd'];
    const toCsv = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (/[",\n\r;]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
      return s;
    };
    const lines = rows.map(r => header.map(h => toCsv(r[h])).join(';'));
    const csv = '\uFEFF' + header.join(';') + '\r\n' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ventas_rango.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Error exportando CSV:', err);
    res.status(500).json({ error: 'Error al exportar CSV' });
  }
});

// GET /reportes/kpis - indicadores clave para el dashboard
router.get('/kpis', (req, res) => {
  try {
    const ventasHoyRow = db.prepare(`
      SELECT COUNT(*) as count FROM ventas
      WHERE date(fecha) = date('now','localtime')
    `).get();

    const ventasSemanaRow = db.prepare(`
      SELECT COUNT(*) as count FROM ventas
      WHERE date(fecha) >= date('now','localtime','-6 days')
    `).get();

    const totalBsRow = db.prepare(`
      SELECT COALESCE(SUM(total_bs), 0) as total_bs FROM ventas
    `).get();

    // calcular total en USD a partir de total_bs y tasa por venta
    const totalUsdRow = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN COALESCE(tasa_bcv,0) != 0 THEN total_bs / tasa_bcv ELSE total_bs END), 0) as total_usd FROM ventas
    `).get();

    res.json({
      ventasHoy: ventasHoyRow.count || 0,
      ventasSemana: ventasSemanaRow.count || 0,
      totalBs: totalBsRow.total_bs || 0,
      totalUsd: totalUsdRow.total_usd || 0
    });
  } catch (err) {
    console.error('Error obteniendo KPIs:', err);
    res.status(500).json({ error: 'Error al obtener KPIs' });
  }
});


// GET /reportes/top-productos?limit= - Top productos por ventas (cantidad, montos, costo y margen)
router.get('/top-productos', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const rows = db.prepare(`
      SELECT p.codigo, p.descripcion,
        SUM(vd.cantidad) as total_qty,
        COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0) as total_bs,
        COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)))/NULLIF(v.tasa_bcv,0),
                 SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0) as total_usd,
        COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)),0) as costo_bs,
        COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad),0) as costo_usd,
        COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0)
          - COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)),0) as margen_bs,
        COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)))/NULLIF(v.tasa_bcv,0),
                 SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0)
          - COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad),0) as margen_usd
      FROM venta_detalle vd
      JOIN ventas v ON v.id = vd.venta_id
      JOIN productos p ON p.id = vd.producto_id
      GROUP BY p.id
      ORDER BY total_qty DESC
      LIMIT ?
    `).all(limit);

    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo top productos:', err);
    res.status(500).json({ error: 'Error al obtener top productos' });
  }
});

// GET /reportes/inventario - reporte de inventario / kardex simple
router.get('/inventario', (req, res) => {
  try {
    // obtener última tasa conocida para convertir a BS
    const tasaRow = db.prepare(`SELECT tasa_bcv FROM ventas WHERE tasa_bcv IS NOT NULL ORDER BY fecha DESC LIMIT 1`).get();
    const tasa = tasaRow && tasaRow.tasa_bcv ? tasaRow.tasa_bcv : 1;

    const productos = db.prepare(`
      SELECT codigo, descripcion, precio_usd, stock, (stock * COALESCE(precio_usd,0)) as total_usd
      FROM productos
      ORDER BY codigo
    `).all();

    const totalUsd = productos.reduce((s,p) => s + (p.total_usd || 0), 0);
    const totalBs = totalUsd * tasa;

    res.json({ items: productos, totals: { totalUsd, totalBs, tasa } });
  } catch (err) {
    console.error('Error obteniendo inventario:', err);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

router.get('/ventas/:id', (req, res) => {
    const venta = db.prepare(`
    SELECT * FROM ventas WHERE id = ?
  `).get(req.params.id);

    if (!venta) {
        return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const detalles = db.prepare(`
    SELECT p.descripcion, vd.cantidad, vd.precio_usd, vd.subtotal_bs
    FROM venta_detalle vd
    JOIN productos p ON p.id = vd.producto_id
    WHERE vd.venta_id = ?
  `).all(req.params.id);

    res.json({ venta, detalles });
});

module.exports = router;

// ===== Bajo stock =====
router.get('/bajo-stock', (req, res) => {
  try {
    const row = db.prepare(`SELECT valor FROM config WHERE clave='stock_minimo'`).get();
    const min = row && row.valor ? parseInt(row.valor) : 3;
    const items = db.prepare(`
      SELECT codigo, descripcion, stock, precio_usd,
             (COALESCE(precio_usd,0) * stock) AS total_usd
      FROM productos
      WHERE stock <= ?
      ORDER BY stock ASC, codigo
      LIMIT 100
    `).all(min);
    res.json({ min, items });
  } catch (err) {
    console.error('Error bajo-stock:', err);
    res.status(500).json({ error: 'Error al obtener bajo stock' });
  }
});

// ===== Ranking de vendedores =====
router.get('/vendedores', (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const rows = db.prepare(`
      SELECT COALESCE(v.vendedor, '—') as vendedor,
             COUNT(DISTINCT v.id) as ventas,
             COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), 0) as total_bs,
             COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)))/NULLIF(v.tasa_bcv,0),
                      SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0) as total_usd,
             COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)),0) as costo_bs,
             COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad),0) as costo_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY vendedor
      ORDER BY total_usd DESC
      LIMIT 100
    `).all(...params);

    const enriched = rows.map(r => ({
      ...r,
      margen_bs: Number(r.total_bs || 0) - Number(r.costo_bs || 0),
      margen_usd: Number(r.total_usd || 0) - Number(r.costo_usd || 0)
    }));
    res.json(enriched);
  } catch (err) {
    console.error('Error ranking vendedores:', err);
    res.status(500).json({ error: 'Error al obtener ranking de vendedores' });
  }
});

// ===== Historial por cliente =====
router.get('/historial-cliente', (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q || !q.trim()) return res.json([]);
    const lim = parseInt(limit) || 100;
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT v.id, v.fecha, v.cliente, v.vendedor, v.metodo_pago, v.tasa_bcv,
             COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), v.total_bs, 0) as total_bs,
             COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)))/NULLIF(v.tasa_bcv,0),
                      SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), v.total_bs) as total_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      WHERE v.cliente LIKE ? OR v.cedula LIKE ? OR v.telefono LIKE ?
      GROUP BY v.id
      ORDER BY v.fecha DESC
      LIMIT ?
    `).all(like, like, like, lim);
    res.json(rows);
  } catch (err) {
    console.error('Error historial-cliente:', err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});
