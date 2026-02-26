const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const logger = require('../services/logger');
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
  getComisionesVendedores,
  getVendedoresRanking,
  getHistorialCliente,
  getRentabilidadCategorias,
  getRentabilidadProveedores,
  getResumenFinanciero,
  buildRentabilidadCategoriasCsv,
  buildRentabilidadProveedoresCsv,
} = require('../services/reportesService');

// Middleware para evitar que el superadmin vea datos de ventas de empresas
function forbidSuperadmin(req, res, next) {
  if (req.usuario && req.usuario.rol === 'superadmin') {
    return res.status(403).json({ error: 'Superadmin no puede acceder a reportes de ventas de empresas' });
  }
  next();
}

router.get('/ventas', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const ventas = getVentasSinDevolucion(req.usuario.empresa_id || null);
    res.json(ventas);
  } catch (err) {
  logger.error('Error en /reportes/ventas', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener ventas', code: 'REPORTE_VENTAS_ERROR' });
  }
});

// GET /reportes/ventas-rango?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&vendedor=X&metodo=Y
router.get('/ventas-rango', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta, cliente, vendedor, metodo } = req.query;
    const rows = getVentasRango({ desde, hasta, cliente, vendedor, metodo, limit: 1000 }, req.usuario.empresa_id || null);
    console.log('Ventas encontradas:', rows.length);
    res.json(rows);
  } catch (err) {
  logger.error('Error en ventas-rango', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener ventas por rango', code: 'REPORTE_VENTAS_RANGO_ERROR' });
  }
});

// GET /reportes/ventas/export/csv
router.get('/ventas/export/csv', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta, cliente, vendedor, metodo } = req.query;
    const csv = buildVentasRangoCsv({ desde, hasta, cliente, vendedor, metodo, limit: 5000 }, req.usuario.empresa_id || null);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ventas_rango.csv"');
    res.send(csv);
  } catch (err) {
  logger.error('Error exportando CSV ventas-rango', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al exportar CSV', code: 'REPORTE_VENTAS_CSV_ERROR' });
  }
});

// GET /reportes/kpis - indicadores clave para el dashboard
router.get('/kpis', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const kpis = getKpis(req.usuario.empresa_id || null);
    res.json(kpis);
  } catch (err) {
  logger.error('Error obteniendo KPIs', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener KPIs', code: 'REPORTE_KPIS_ERROR' });
  }
});


// GET /reportes/top-productos?limit= - Top productos por ventas (cantidad, montos, costo y margen)
router.get('/top-productos', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const rows = getTopProductos(limit, req.usuario.empresa_id || null);
    res.json(rows);
  } catch (err) {
  logger.error('Error obteniendo top productos', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener top productos', code: 'REPORTE_TOP_PRODUCTOS_ERROR' });
  }
});

// GET /reportes/margen-productos?limit=&desde=&hasta= - ordenar por margen USD
router.get('/margen-productos', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const { desde, hasta } = req.query;
    const rows = getMargenProductos({ desde, hasta, limit, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error obteniendo margen-productos', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener margen por producto', code: 'REPORTE_MARGEN_PRODUCTOS_ERROR' });
  }
});

// ABC de productos por facturación (volumen)
router.get('/abc/productos', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta, a_pct, b_pct } = req.query;
    const rows = getAbcProductos({ desde, hasta, a_pct, b_pct, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error ABC productos', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener ABC de productos', code: 'REPORTE_ABC_PRODUCTOS_ERROR' });
  }
});

// GET /reportes/inventario - reporte de inventario / kardex simple
router.get('/inventario', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const inventario = getInventario(req.usuario.empresa_id || null);
    res.json(inventario);
  } catch (err) {
  logger.error('Error obteniendo inventario', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener inventario', code: 'REPORTE_INVENTARIO_ERROR' });
  }
});

router.get('/ventas/:id', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const result = getVentaConDetalles(req.params.id, req.usuario.empresa_id || null);
    if (!result) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    res.json(result);
  } catch (err) {
  logger.error('Error obteniendo venta por id', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null,
    ventaId: req.params.id
  });
  res.status(500).json({ error: 'Error al obtener venta', code: 'REPORTE_VENTA_DETALLE_ERROR' });
  }
});

// ===== Rentabilidad por categoría y proveedor =====
router.get('/rentabilidad/categorias', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const rows = getRentabilidadCategorias({ desde, hasta, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error rentabilidad categorias', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener rentabilidad por categoría', code: 'REPORTE_RENTABILIDAD_CATEGORIAS_ERROR' });
  }
});

router.get('/rentabilidad/proveedores', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const rows = getRentabilidadProveedores({ desde, hasta, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error rentabilidad proveedores', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener rentabilidad por proveedor', code: 'REPORTE_RENTABILIDAD_PROVEEDORES_ERROR' });
  }
});

router.get('/resumen-financiero', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const data = getResumenFinanciero({ desde, hasta, empresaId: req.usuario.empresa_id || null });
    res.json(data);
  } catch (err) {
  logger.error('Error resumen financiero', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener resumen financiero', code: 'REPORTE_RESUMEN_FINANCIERO_ERROR' });
  }
});

router.get('/comisiones-vendedores', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const rows = getComisionesVendedores({ desde, hasta, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
    logger.error('Error comisiones vendedores', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      user: req.usuario ? req.usuario.id : null
    });
    res.status(500).json({ error: 'Error al obtener comisiones por vendedor', code: 'REPORTE_COMISIONES_VENDEDORES_ERROR' });
  }
});

router.get('/rentabilidad/categorias/export/csv', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const csv = buildRentabilidadCategoriasCsv({ desde, hasta }, req.usuario.empresa_id || null);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rentabilidad_categorias.csv"');
    res.send(csv);
  } catch (err) {
  logger.error('Error exportando CSV categorias', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al exportar CSV de categorías', code: 'REPORTE_RENTABILIDAD_CATEGORIAS_CSV_ERROR' });
  }
});

router.get('/rentabilidad/proveedores/export/csv', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const csv = buildRentabilidadProveedoresCsv({ desde, hasta }, req.usuario.empresa_id || null);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rentabilidad_proveedores.csv"');
    res.send(csv);
  } catch (err) {
  logger.error('Error exportando CSV proveedores', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al exportar CSV de proveedores', code: 'REPORTE_RENTABILIDAD_PROVEEDORES_CSV_ERROR' });
  }
});

module.exports = router;

// ===== Bajo stock =====
router.get('/bajo-stock', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { min, items } = getBajoStock(req.query.umbral, req.usuario.empresa_id || null);
    res.json({ min, items });
  } catch (err) {
  logger.error('Error bajo-stock', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener bajo stock', code: 'REPORTE_BAJO_STOCK_ERROR' });
  }
});

// ===== Series y comparativas avanzadas para Dashboard =====

// Ventas diarias: últimos N días
router.get('/series/ventas-diarias', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const dias = Math.min(Math.max(parseInt(req.query.dias) || 30, 1), 180);
    const rows = getSeriesVentasDiarias(dias, req.usuario.empresa_id || null);
    res.json(rows);
  } catch (err) {
  logger.error('Error series ventas-diarias', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener ventas diarias', code: 'REPORTE_SERIES_DIARIAS_ERROR' });
  }
});

// Ventas mensuales: últimos N meses (YYYY-MM)
router.get('/series/ventas-mensuales', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const meses = Math.min(Math.max(parseInt(req.query.meses) || 12, 1), 36);
    const rows = getSeriesVentasMensuales(meses, req.usuario.empresa_id || null);
    res.json(rows);
  } catch (err) {
  logger.error('Error series ventas-mensuales', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener ventas mensuales', code: 'REPORTE_SERIES_MENSUALES_ERROR' });
  }
});

// Tendencias mensuales con comparación mes a mes (delta)
router.get('/tendencias/mensuales', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const meses = Math.min(Math.max(parseInt(req.query.meses) || 12, 1), 36);
    const enhanced = getTendenciasMensuales(meses, req.usuario.empresa_id || null);
    res.json(enhanced);
  } catch (err) {
  logger.error('Error tendencias mensuales', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener tendencias mensuales', code: 'REPORTE_TENDENCIAS_MENSUALES_ERROR' });
  }
});

// Top clientes por monto (rango opcional)
router.get('/top-clientes', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 50);
    const { desde, hasta } = req.query;
    const rows = getTopClientes({ desde, hasta, limit, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error top-clientes', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener top clientes', code: 'REPORTE_TOP_CLIENTES_ERROR' });
  }
});

// ABC de clientes por facturación (volumen)
router.get('/abc/clientes', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta, a_pct, b_pct } = req.query;
    const rows = getAbcClientes({ desde, hasta, a_pct, b_pct, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error ABC clientes', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener ABC de clientes', code: 'REPORTE_ABC_CLIENTES_ERROR' });
  }
});

// Comparativa de vendedores
router.get('/vendedores', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const rows = getVendedoresComparativa({ desde, hasta, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error vendedores comparativa', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener comparativa de vendedores', code: 'REPORTE_VENDEDORES_COMPARATIVA_ERROR' });
  }
});

// ROI por vendedor (margen / costo e ingresos)
router.get('/vendedores/roi', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const enriched = getVendedoresRoi({ desde, hasta, empresaId: req.usuario.empresa_id || null });
    res.json(enriched);
  } catch (err) {
  logger.error('Error ROI vendedores', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener ROI por vendedor', code: 'REPORTE_VENDEDORES_ROI_ERROR' });
  }
});

// Margen en tiempo real (hoy y mes a la fecha)
router.get('/margen/actual', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const data = getMargenActual(req.usuario.empresa_id || null);
    res.json(data);
  } catch (err) {
  logger.error('Error margen actual', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener margen', code: 'REPORTE_MARGEN_ACTUAL_ERROR' });
  }
});

// ===== Ranking de vendedores =====
router.get('/vendedores', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const enriched = getVendedoresRanking({ desde, hasta, empresaId: req.usuario.empresa_id || null });
    res.json(enriched);
  } catch (err) {
  logger.error('Error ranking vendedores', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener ranking de vendedores', code: 'REPORTE_VENDEDORES_RANKING_ERROR' });
  }
});

// ===== Historial por cliente =====
router.get('/historial-cliente', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const rows = getHistorialCliente({ ...req.query, empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error historial-cliente', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'Error al obtener historial', code: 'REPORTE_HISTORIAL_CLIENTE_ERROR' });
  }
});
