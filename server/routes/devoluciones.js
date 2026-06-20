const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { body, validate } = require('../middleware/validation');
const { registrarDevolucion, getHistorialDevoluciones, getDevolucionConDetalles } = require('../services/devolucionesService');

// El superadmin no debe registrar ni ver devoluciones de empresas
function forbidSuperadmin(req, res, next) {
  if (req.usuario && req.usuario.rol === 'superadmin') {
    return res.status(403).json({ error: 'Superadmin no puede acceder a devoluciones de empresas' });
  }
  next();
}

// Validaciones para crear devolución
const devolucionValidaciones = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Debe enviar al menos un ítem en la devolución'),
  body('items.*.codigo')
    .notEmpty()
    .isString()
    .isLength({ max: 64 })
    .withMessage('Código de producto inválido'),
  body('items.*.cantidad')
    .isInt({ min: 1, max: 100000 })
    .withMessage('Cantidad debe ser un número entero entre 1 y 100000'),
  body('cliente')
    .optional()
    .isString()
    .isLength({ max: 120 })
    .withMessage('Nombre de cliente demasiado largo'),
  body('cliente_doc')
    .optional()
    .isString()
    .isLength({ max: 40 })
    .withMessage('Documento de cliente inválido'),
  body('telefono')
    .optional()
    .isString()
    .isLength({ max: 40 })
    .withMessage('Teléfono inválido'),
  body('motivo')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Motivo demasiado largo'),
  body('venta_original_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('ID de venta original inválido'),
  body('tasa_bcv')
    .optional()
    .isFloat({ gt: 0 })
    .withMessage('La tasa BCV debe ser un número mayor a 0'),
];

// Validaciones para historial (query params)
const historialValidaciones = [
  body('cliente')
    .optional()
    .isString()
    .isLength({ max: 120 })
    .withMessage('Cliente inválido'),
  body('desde')
    .optional()
    .isISO8601()
    .withMessage('Fecha desde inválida'),
  body('hasta')
    .optional()
    .isISO8601()
    .withMessage('Fecha hasta inválida'),
];

// Registrar una devolución de productos
router.post('/', requireAuth, forbidSuperadmin, validate(devolucionValidaciones), (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : 1;
    const usuarioId = req.usuario && req.usuario.id ? req.usuario.id : null;
    const { devolucionId, total_bs, total_usd } = registrarDevolucion({
      ...(req.body || {}),
      empresa_id: empresaId,
      usuario_id: usuarioId,
    });
    res.json({ message: 'Devolución registrada', devolucionId, total_bs, total_usd });
  } catch (err) {
    console.error('Error registrando devolución:', err.message);
    if (err.tipo === 'LIMITE_DIAS' && err.message && err.message.includes('límite')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.tipo === 'VALIDACION') {
      return res.status(400).json({ error: err.message || 'Error al registrar devolución' });
    }
    res.status(400).json({ error: err.message || 'Error al registrar devolución' });
  }
});

// Historial de devoluciones (por cliente y rango opcional)
router.get('/historial', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const rows = getHistorialDevoluciones({ ...(req.query || {}), empresaId: req.usuario.empresa_id || null });
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo historial de devoluciones:', err.message);
    res.status(500).json({ error: 'Error al obtener devoluciones' });
  }
});

// Detalle de una devolución específica
router.get('/:id', requireAuth, forbidSuperadmin, (req, res) => {
  try {
    const dev = getDevolucionConDetalles(req.params.id, req.usuario.empresa_id || null);
    if (!dev) {
      return res.status(404).json({ error: 'Devolución no encontrada' });
    }
    res.json(dev);
  } catch (err) {
    console.error('Error obteniendo devolución por id:', err.message);
    res.status(500).json({ error: 'Error al obtener devolución' });
  }
});

module.exports = router;