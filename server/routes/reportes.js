const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// Clasificación ABC genérica por clave numérica (ej. total_usd o total_qty)
function classifyABC(rows, valueKey, aThresh = 0.8, bThresh = 0.95) {
  const total = rows.reduce((s, r) => s + Number(r[valueKey] || 0), 0);
  let acc = 0;
  return rows.map((r) => {
    const val = Number(r[valueKey] || 0);
    acc += val;
    const share = total ? val / total : 0;
    const cumulative = total ? acc / total : 0;
    const clase = cumulative <= aThresh ? 'A' : cumulative <= bThresh ? 'B' : 'C';
    return { ...r, share, cumulative, clase };
  });
}

function parseAB(query) {
  const toFrac = (v, def) => {
    let n = parseFloat(v);
    if (Number.isNaN(n)) return def;
    if (n > 1) n = n / 100; // permitir 80/95
    return Math.min(Math.max(n, 0.5), 0.99);
  };
  let a = toFrac(query.a_pct, 0.8);
  let b = toFrac(query.b_pct, 0.95);
  if (b <= a) b = Math.min(0.99, a + 0.05);
  return { a, b };
}

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

router.get('/ventas', requireAuth, (req, res) => {
    const ventas = db.prepare(`
    SELECT id, fecha, cliente, vendedor, cedula, telefono, total_bs, tasa_bcv, descuento, metodo_pago, referencia
    FROM ventas
    ORDER BY fecha DESC
    LIMIT 100
  `).all();

    res.json(ventas);
});

// GET /reportes/ventas-rango?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&vendedor=X&metodo=Y
router.get('/ventas-rango', requireAuth, (req, res) => {
  try {
    const { desde, hasta, vendedor, metodo } = req.query;
    const rows = queryVentasRango({ desde, hasta, vendedor, metodo, limit: 1000 });
    console.log('Ventas encontradas:', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('Error en ventas-rango:', err);
    res.status(500).json({ error: 'Error al obtener ventas por rango' });
  }
});

// GET /reportes/ventas/export/csv
router.get('/ventas/export/csv', requireAuth, (req, res) => {
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
router.get('/kpis', requireAuth, (req, res) => {
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
router.get('/top-productos', requireAuth, (req, res) => {
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

// GET /reportes/margen-productos?limit=&desde=&hasta= - ordenar por margen USD
router.get('/margen-productos', requireAuth, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const { desde, hasta } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    const rows = db.prepare(`
      SELECT p.codigo, p.descripcion,
        SUM(vd.cantidad) AS total_qty,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costo_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad) AS costo_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM venta_detalle vd
      JOIN ventas v ON v.id = vd.venta_id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY p.id
      ORDER BY margen_usd DESC
      LIMIT ?
    `).all(...params, limit);

    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo margen-productos:', err);
    res.status(500).json({ error: 'Error al obtener margen por producto' });
  }
});

// ABC de productos por facturación (volumen)
router.get('/abc/productos', requireAuth, (req, res) => {
  try {
    const { a, b } = parseAB(req.query);
    const { desde, hasta } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    const rows = db.prepare(`
      SELECT p.codigo, p.descripcion,
        SUM(vd.cantidad) AS total_qty,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd
      FROM venta_detalle vd
      JOIN ventas v ON v.id = vd.venta_id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY p.id
      ORDER BY total_usd DESC
    `).all(...params);

    res.json(classifyABC(rows, 'total_usd', a, b));
  } catch (err) {
    console.error('Error ABC productos:', err);
    res.status(500).json({ error: 'Error al obtener ABC de productos' });
  }
});

// GET /reportes/inventario - reporte de inventario / kardex simple
router.get('/inventario', requireAuth, (req, res) => {
  try {
    // obtener tasa desde config (preferida) o última venta como respaldo
    const cfgTasaRow = db.prepare(`SELECT valor FROM config WHERE clave='tasa_bcv'`).get();
    const cfgTasa = cfgTasaRow && cfgTasaRow.valor ? parseFloat(cfgTasaRow.valor) : null;
    const ventaTasaRow = db.prepare(`SELECT tasa_bcv FROM ventas WHERE tasa_bcv IS NOT NULL ORDER BY fecha DESC LIMIT 1`).get();
    const ventaTasa = ventaTasaRow && ventaTasaRow.tasa_bcv ? ventaTasaRow.tasa_bcv : null;
    const tasa = (!Number.isNaN(cfgTasa) && cfgTasa > 0)
      ? cfgTasa
      : (!Number.isNaN(ventaTasa) && ventaTasa > 0 ? ventaTasa : 1);

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

router.get('/ventas/:id', requireAuth, (req, res) => {
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
router.get('/bajo-stock', requireAuth, (req, res) => {
  try {
    const override = parseInt(req.query.umbral);
    const row = db.prepare(`SELECT valor FROM config WHERE clave='stock_minimo'`).get();
    const conf = row && row.valor ? parseInt(row.valor) : 3;
    const min = Number.isFinite(override) ? Math.max(0, override) : conf;
    const items = db.prepare(`
      SELECT codigo, descripcion, stock, precio_usd,
             (COALESCE(precio_usd,0) * stock) AS total_usd
      FROM productos
      WHERE CAST(stock AS INTEGER) <= ?
      ORDER BY CAST(stock AS INTEGER) ASC, codigo
      LIMIT 100
    `).all(min);
    res.json({ min, items });
  } catch (err) {
    console.error('Error bajo-stock:', err);
    res.status(500).json({ error: 'Error al obtener bajo stock' });
  }
});

// ===== Series y comparativas avanzadas para Dashboard =====

// Ventas diarias: últimos N días
router.get('/series/ventas-diarias', requireAuth, (req, res) => {
  try {
    const dias = Math.min(Math.max(parseInt(req.query.dias) || 30, 1), 180);
    const rows = db.prepare(`
      SELECT date(v.fecha) AS dia,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      WHERE date(v.fecha) >= date('now','localtime', ?)
      GROUP BY dia
      ORDER BY dia ASC
    `).all(`-${dias-1} days`);

    res.json(rows);
  } catch (err) {
    console.error('Error series ventas-diarias:', err);
    res.status(500).json({ error: 'Error al obtener ventas diarias' });
  }
});

// Ventas mensuales: últimos N meses (YYYY-MM)
router.get('/series/ventas-mensuales', requireAuth, (req, res) => {
  try {
    const meses = Math.min(Math.max(parseInt(req.query.meses) || 12, 1), 36);
    const rows = db.prepare(`
      SELECT strftime('%Y-%m', v.fecha) AS mes,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      WHERE date(v.fecha) >= date('now','localtime', ?)
      GROUP BY mes
      ORDER BY mes ASC
    `).all(`-${meses*30} days`);

    res.json(rows);
  } catch (err) {
    console.error('Error series ventas-mensuales:', err);
    res.status(500).json({ error: 'Error al obtener ventas mensuales' });
  }
});

// Tendencias mensuales con comparación mes a mes (delta)
router.get('/tendencias/mensuales', requireAuth, (req, res) => {
  try {
    const meses = Math.min(Math.max(parseInt(req.query.meses) || 12, 1), 36);
    const rows = db.prepare(`
      SELECT strftime('%Y-%m', v.fecha) AS mes,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      WHERE date(v.fecha) >= date('now','localtime', ?)
      GROUP BY mes
      ORDER BY mes ASC
    `).all(`-${meses*30} days`);

    const enhanced = rows.map((row, idx) => {
      const prev = idx > 0 ? rows[idx - 1] : null;
      const delta = (curr, prevVal) => {
        const c = Number(curr || 0);
        const p = Number(prevVal || 0);
        const abs = c - p;
        const pct = p !== 0 ? abs / p : null;
        return { abs, pct };
      };
      return {
        ...row,
        delta_total_usd: delta(row.total_usd, prev?.total_usd),
        delta_margen_usd: delta(row.margen_usd, prev?.margen_usd)
      };
    });

    res.json(enhanced);
  } catch (err) {
    console.error('Error tendencias mensuales:', err);
    res.status(500).json({ error: 'Error al obtener tendencias mensuales' });
  }
});

// Top clientes por monto (rango opcional)
router.get('/top-clientes', requireAuth, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 50);
    const { desde, hasta } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    const rows = db.prepare(`
      SELECT COALESCE(v.cliente, 'Sin nombre') AS cliente,
        COUNT(DISTINCT v.id) AS ventas,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      ${whereSQL}
      GROUP BY cliente
      ORDER BY total_usd DESC
      LIMIT ?
    `).all(...params, limit);

    res.json(rows);
  } catch (err) {
    console.error('Error top-clientes:', err);
    res.status(500).json({ error: 'Error al obtener top clientes' });
  }
});

// ABC de clientes por facturación (volumen)
router.get('/abc/clientes', requireAuth, (req, res) => {
  try {
    const { a, b } = parseAB(req.query);
    const { desde, hasta } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    const rows = db.prepare(`
      SELECT COALESCE(v.cliente, 'Sin nombre') AS cliente,
        COUNT(DISTINCT v.id) AS ventas,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      ${whereSQL}
      GROUP BY cliente
      ORDER BY total_usd DESC
    `).all(...params);

    res.json(classifyABC(rows, 'total_usd', a, b));
  } catch (err) {
    console.error('Error ABC clientes:', err);
    res.status(500).json({ error: 'Error al obtener ABC de clientes' });
  }
});

// Comparativa de vendedores
router.get('/vendedores', requireAuth, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    const rows = db.prepare(`
      SELECT COALESCE(v.vendedor, '—') AS vendedor,
        COUNT(DISTINCT v.id) AS ventas,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY vendedor
      ORDER BY total_usd DESC
      LIMIT 50
    `).all(...params);

    res.json(rows);
  } catch (err) {
    console.error('Error vendedores:', err);
    res.status(500).json({ error: 'Error al obtener comparativa de vendedores' });
  }
});

// ROI por vendedor (margen / costo e ingresos)
router.get('/vendedores/roi', requireAuth, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    const rows = db.prepare(`
      SELECT COALESCE(v.vendedor, '—') AS vendedor,
        COUNT(DISTINCT v.id) AS ventas,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad) AS costos_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY vendedor
      ORDER BY ingresos_usd DESC
      LIMIT 100
    `).all(...params);

    const enriched = rows.map((r) => {
      const ingresos = Number(r.ingresos_usd || 0);
      const margen = Number(r.margen_usd || 0);
      const costos = Number(r.costos_usd || 0);
      return {
        ...r,
        margen_pct: ingresos !== 0 ? margen / ingresos : null,
        roi: costos !== 0 ? margen / costos : null
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('Error ROI vendedores:', err);
    res.status(500).json({ error: 'Error al obtener ROI por vendedor' });
  }
});

// Margen en tiempo real (hoy y mes a la fecha)
router.get('/margen/actual', requireAuth, (req, res) => {
  try {
    const hoy = db.prepare(`
      SELECT 
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad) AS costos_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      WHERE date(v.fecha) = date('now','localtime')
    `).get();

    const mes = db.prepare(`
      SELECT 
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad) AS costos_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      WHERE strftime('%Y-%m', v.fecha) = strftime('%Y-%m', 'now','localtime')
    `).get();

    const calc = (x) => ({
      ingresos_bs: Number(x.ingresos_bs || 0),
      ingresos_usd: Number(x.ingresos_usd || 0),
      costos_bs: Number(x.costos_bs || 0),
      costos_usd: Number(x.costos_usd || 0),
      margen_bs: Number((x.ingresos_bs || 0) - (x.costos_bs || 0)),
      margen_usd: Number((x.ingresos_usd || 0) - (x.costos_usd || 0)),
    });

    res.json({ hoy: calc(hoy || {}), mes: calc(mes || {}) });
  } catch (err) {
    console.error('Error margen actual:', err);
    res.status(500).json({ error: 'Error al obtener margen' });
  }
});

// ===== Ranking de vendedores =====
router.get('/vendedores', requireAuth, (req, res) => {
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
router.get('/historial-cliente', requireAuth, (req, res) => {
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
