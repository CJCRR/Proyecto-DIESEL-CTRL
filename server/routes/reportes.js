const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/ventas', (req, res) => {
    const ventas = db.prepare(`
    SELECT id, fecha, cliente, cedula, telefono, total_bs, tasa_bcv, descuento, metodo_pago, referencia
    FROM ventas
    ORDER BY fecha DESC
    LIMIT 100
  `).all();

    res.json(ventas);
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
      SELECT COALESCE(SUM(total_bs / NULLIF(tasa_bcv,0)), 0) as total_usd FROM ventas
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


// GET /reportes/top-productos?limit= - Top productos por ventas (cantidad y montos)
router.get('/top-productos', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const rows = db.prepare(`
      SELECT p.codigo, p.descripcion,
             SUM(vd.cantidad) as total_qty,
             COALESCE(SUM(vd.subtotal_bs),0) as total_bs,
             COALESCE(SUM(vd.subtotal_bs / NULLIF(v.tasa_bcv,0)),0) as total_usd
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
