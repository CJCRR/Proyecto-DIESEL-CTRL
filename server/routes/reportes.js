const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const {
  getVentasSinDevolucion,
  getVentasRango,
  buildVentasRangoCsv,
  getKpis,
  getTopProductos,
  getMargenProductos,
  getAbcProductos,
  getInventario,
  getVentaConDetalles,
  getBajoStock,
  getSeriesVentasDiarias,
  getSeriesVentasMensuales,
  getTendenciasMensuales,
  getTopClientes,
  getAbcClientes,
  getVendedoresComparativa,
  getVendedoresRoi,
  getMargenActual,
  getVendedoresRanking,
  getHistorialCliente,
} = require('../services/reportesService');

router.get('/ventas', requireAuth, (req, res) => {
  try {
    const ventas = getVentasSinDevolucion();
    res.json(ventas);
  } catch (err) {
    console.error('Error en /reportes/ventas:', err);
    res.status(500).json({ error: 'Error al obtener ventas' });
  }
});

// GET /reportes/ventas-rango?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&vendedor=X&metodo=Y
router.get('/ventas-rango', requireAuth, (req, res) => {
  try {
    const { desde, hasta, cliente, vendedor, metodo } = req.query;
    const rows = getVentasRango({ desde, hasta, cliente, vendedor, metodo, limit: 1000 });
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
    const { desde, hasta, cliente, vendedor, metodo } = req.query;
    const csv = buildVentasRangoCsv({ desde, hasta, cliente, vendedor, metodo, limit: 5000 });
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
    const kpis = getKpis();
    res.json(kpis);
  } catch (err) {
    console.error('Error obteniendo KPIs:', err);
    res.status(500).json({ error: 'Error al obtener KPIs' });
  }
});


// GET /reportes/top-productos?limit= - Top productos por ventas (cantidad, montos, costo y margen)
router.get('/top-productos', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const rows = getTopProductos(limit);
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
    const rows = getMargenProductos({ desde, hasta, limit });
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo margen-productos:', err);
    res.status(500).json({ error: 'Error al obtener margen por producto' });
  }
});

// ABC de productos por facturación (volumen)
router.get('/abc/productos', requireAuth, (req, res) => {
  try {
    const { desde, hasta, a_pct, b_pct } = req.query;
    const rows = getAbcProductos({ desde, hasta, a_pct, b_pct });
    res.json(rows);
  } catch (err) {
    console.error('Error ABC productos:', err);
    res.status(500).json({ error: 'Error al obtener ABC de productos' });
  }
});

// GET /reportes/inventario - reporte de inventario / kardex simple
router.get('/inventario', requireAuth, (req, res) => {
  try {
    const inventario = getInventario();
    res.json(inventario);
  } catch (err) {
    console.error('Error obteniendo inventario:', err);
    res.status(500).json({ error: 'Error al obtener inventario' });
  }
});

router.get('/ventas/:id', requireAuth, (req, res) => {
  try {
    const result = getVentaConDetalles(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    res.json(result);
  } catch (err) {
    console.error('Error obteniendo venta por id:', err);
    res.status(500).json({ error: 'Error al obtener venta' });
  }
});

module.exports = router;

// ===== Bajo stock =====
router.get('/bajo-stock', requireAuth, (req, res) => {
  try {
    const { min, items } = getBajoStock(req.query.umbral);
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
    const rows = getSeriesVentasDiarias(dias);
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
    const rows = getSeriesVentasMensuales(meses);
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
    const enhanced = getTendenciasMensuales(meses);
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
    const rows = getTopClientes({ desde, hasta, limit });
    res.json(rows);
  } catch (err) {
    console.error('Error top-clientes:', err);
    res.status(500).json({ error: 'Error al obtener top clientes' });
  }
});

// ABC de clientes por facturación (volumen)
router.get('/abc/clientes', requireAuth, (req, res) => {
  try {
    const { desde, hasta, a_pct, b_pct } = req.query;
    const rows = getAbcClientes({ desde, hasta, a_pct, b_pct });
    res.json(rows);
  } catch (err) {
    console.error('Error ABC clientes:', err);
    res.status(500).json({ error: 'Error al obtener ABC de clientes' });
  }
});

// Comparativa de vendedores
router.get('/vendedores', requireAuth, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const rows = getVendedoresComparativa({ desde, hasta });
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
    const enriched = getVendedoresRoi({ desde, hasta });
    res.json(enriched);
  } catch (err) {
    console.error('Error ROI vendedores:', err);
    res.status(500).json({ error: 'Error al obtener ROI por vendedor' });
  }
});

// Margen en tiempo real (hoy y mes a la fecha)
router.get('/margen/actual', requireAuth, (req, res) => {
  try {
    const data = getMargenActual();
    res.json(data);
  } catch (err) {
    console.error('Error margen actual:', err);
    res.status(500).json({ error: 'Error al obtener margen' });
  }
});

// ===== Ranking de vendedores =====
router.get('/vendedores', requireAuth, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const enriched = getVendedoresRanking({ desde, hasta });
    res.json(enriched);
  } catch (err) {
    console.error('Error ranking vendedores:', err);
    res.status(500).json({ error: 'Error al obtener ranking de vendedores' });
  }
});

// ===== Historial por cliente =====
router.get('/historial-cliente', requireAuth, (req, res) => {
  try {
    const rows = getHistorialCliente(req.query);
    res.json(rows);
  } catch (err) {
    console.error('Error historial-cliente:', err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});
