const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const logger = require('../services/logger');
const {
  getResumenPagos,
  listCuentasPagos,
  getCuentaConPagos,
  generarCuentasDesdeReporte,
  syncCuentasMensualesPeriodo,
  registrarPago,
} = require('../services/pagosService');

function forbidSuperadmin(req, res, next) {
  if (req.usuario && req.usuario.rol === 'superadmin') {
    return res.status(403).json({ error: 'Superadmin no puede acceder a pagos de empresas' });
  }
  next();
}

router.get('/resumen', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta, vendedor } = req.query || {};
    if (desde && hasta) {
      syncCuentasMensualesPeriodo({ empresaId: req.usuario.empresa_id || null, desde, hasta, vendedor });
    }
    const rows = getResumenPagos(req.usuario.empresa_id || null, { desde, hasta });
    res.json(rows);
  } catch (err) {
    logger.error('Error resumen pagos comisiones', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      user: req.usuario ? req.usuario.id : null,
    });
    res.status(500).json({ error: 'No se pudo obtener resumen de pagos', code: 'PAGOS_RESUMEN_ERROR' });
  }
});

router.get('/list', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const { desde, hasta, vendedor } = req.query || {};
    if (desde && hasta) {
      syncCuentasMensualesPeriodo({ empresaId: req.usuario.empresa_id || null, desde, hasta, vendedor });
    }
    const rows = listCuentasPagos({ ...(req.query || {}), empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
    logger.error('Error listando pagos comisiones', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      user: req.usuario ? req.usuario.id : null,
    });
    res.status(500).json({ error: 'No se pudo listar pagos', code: 'PAGOS_LISTADO_ERROR' });
  }
});

router.get('/:id', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const data = getCuentaConPagos(req.params.id, req.usuario.empresa_id || null);
    if (!data) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(data);
  } catch (err) {
    logger.error('Error detalle pagos comisiones', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      user: req.usuario ? req.usuario.id : null,
      cuentaId: req.params.id,
    });
    res.status(500).json({ error: 'No se pudo obtener cuenta', code: 'PAGOS_DETALLE_ERROR' });
  }
});

router.post('/generar', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const data = generarCuentasDesdeReporte({ ...(req.body || {}), empresaId: req.usuario.empresa_id || null });
    res.json(data);
  } catch (err) {
    logger.error('Error generando pagos de comisiones', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      user: req.usuario ? req.usuario.id : null,
    });
    if (err && err.message === 'Rango inválido') {
      return res.status(400).json({ error: err.message, code: 'PAGOS_RANGO_INVALIDO' });
    }
    res.status(500).json({ error: 'No se pudo generar cuentas de comisión', code: 'PAGOS_GENERAR_ERROR' });
  }
});

router.post('/:id/pago', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const data = registrarPago(req.params.id, req.usuario.empresa_id || null, req.body || {});
    if (!data) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(data);
  } catch (err) {
    logger.error('Error registrando pago de comisión', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      user: req.usuario ? req.usuario.id : null,
      cuentaId: req.params.id,
    });
    const msg = err && err.message;
    if (msg === 'Monto inválido' || msg === 'Moneda inválida' || msg === 'Tasa inválida') {
      let code = 'PAGOS_VALIDACION_ERROR';
      if (msg === 'Monto inválido') code = 'PAGOS_MONTO_INVALIDO';
      else if (msg === 'Moneda inválida') code = 'PAGOS_MONEDA_INVALIDA';
      else if (msg === 'Tasa inválida') code = 'PAGOS_TASA_INVALIDA';
      return res.status(400).json({ error: msg, code });
    }
    res.status(500).json({ error: 'No se pudo registrar pago', code: 'PAGOS_REGISTRO_ERROR' });
  }
});

module.exports = router;