const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const logger = require('../services/logger');
const {
  getResumenCuentas,
  listCuentas,
  getCuentaConPagos,
  crearCuenta,
  registrarPago,
  actualizarCuenta,
} = require('../services/cobranzasService');

// El superadmin no debe ver ni gestionar cuentas por cobrar de las empresas
function forbidSuperadmin(req, res, next) {
  if (req.usuario && req.usuario.rol === 'superadmin') {
    return res.status(403).json({ error: 'Superadmin no puede acceder a cobranzas de empresas' });
  }
  next();
}

router.get('/resumen', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const rows = getResumenCuentas(req.usuario.empresa_id || null);
    res.json(rows);
  } catch (err) {
  logger.error('Error resumen cc', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'No se pudo obtener resumen', code: 'COBRANZAS_RESUMEN_ERROR' });
  }
});

router.get('/', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const rows = listCuentas({ ...(req.query || {}), empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
  logger.error('Error listando cc', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
  res.status(500).json({ error: 'No se pudo listar cuentas', code: 'COBRANZAS_LISTADO_ERROR' });
  }
});

router.get('/:id', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const data = getCuentaConPagos(req.params.id, req.usuario.empresa_id || null);
    if (!data) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(data);
  } catch (err) {
  logger.error('Error detalle cc', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null,
    cuentaId: req.params.id
  });
  res.status(500).json({ error: 'No se pudo obtener cuenta', code: 'COBRANZAS_DETALLE_ERROR' });
  }
});

router.post('/', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const cuenta = crearCuenta({ ...(req.body || {}), empresaId: req.usuario.empresa_id || null });
    res.json(cuenta);
  } catch (err) {
  logger.error('Error creando cuenta por cobrar', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null
  });
    const msg = err && err.message;
    if (msg === 'Total inválido' || msg === 'Tasa inválida' || msg === 'Fecha de vencimiento inválida') {
    let code = 'COBRO_VALIDACION_ERROR';
    if (msg === 'Total inválido') code = 'COBRO_TOTAL_INVALIDO';
    else if (msg === 'Tasa inválida') code = 'COBRO_TASA_INVALIDA';
    else if (msg === 'Fecha de vencimiento inválida') code = 'COBRO_FECHA_VENCIMIENTO_INVALIDA';
    return res.status(400).json({ error: msg, code });
    }
  res.status(500).json({ error: 'No se pudo crear cuenta por cobrar', code: 'COBRO_CREACION_ERROR' });
  }
});

router.post('/:id/pago', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const data = registrarPago(req.params.id, req.usuario.empresa_id || null, req.body || {});
    if (!data) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(data);
  } catch (err) {
  logger.error('Error registrando pago', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null,
    cuentaId: req.params.id
  });
    const msg = err && err.message;
    if (msg === 'Monto inválido' || msg === 'Moneda inválida' || msg === 'Tasa inválida') {
    let code = 'PAGO_VALIDACION_ERROR';
    if (msg === 'Monto inválido') code = 'PAGO_MONTO_INVALIDO';
    else if (msg === 'Moneda inválida') code = 'PAGO_MONEDA_INVALIDA';
    else if (msg === 'Tasa inválida') code = 'PAGO_TASA_INVALIDA';
    return res.status(400).json({ error: msg, code });
    }
  res.status(500).json({ error: 'No se pudo registrar pago', code: 'PAGO_ERROR' });
  }
});

router.patch('/:id', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const data = actualizarCuenta(req.params.id, req.usuario.empresa_id || null, req.body || {});
    if (!data) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(data);
  } catch (err) {
  logger.error('Error actualizando cuenta', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.usuario ? req.usuario.id : null,
    cuentaId: req.params.id
  });
    const msg = err && err.message;
    if (msg === 'Fecha inválida' || msg === 'Estado inválido') {
    let code = 'COBRO_ACTUALIZACION_ERROR';
    if (msg === 'Fecha inválida') code = 'COBRO_FECHA_INVALIDA';
    else if (msg === 'Estado inválido') code = 'COBRO_ESTADO_INVALIDO';
    return res.status(400).json({ error: msg, code });
    }
  res.status(500).json({ error: 'No se pudo actualizar cuenta', code: 'COBRO_ACTUALIZAR_ERROR' });
  }
});

module.exports = router;
