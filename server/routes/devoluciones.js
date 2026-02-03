const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { registrarDevolucion, getHistorialDevoluciones } = require('../services/devolucionesService');

// Registrar una devolución de productos
router.post('/', requireAuth, (req, res) => {
  try {
    const { devolucionId, total_bs, total_usd } = registrarDevolucion(req.body || {});
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
router.get('/historial', requireAuth, (req, res) => {
  try {
    const rows = getHistorialDevoluciones(req.query || {});
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo historial de devoluciones:', err.message);
    res.status(500).json({ error: 'Error al obtener devoluciones' });
  }
});

module.exports = router;
