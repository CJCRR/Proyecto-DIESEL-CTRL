const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const {
  getResumenCuentas,
  listCuentas,
  getCuentaConPagos,
  crearCuenta,
  registrarPago,
  actualizarCuenta,
} = require('../services/cobranzasService');

router.get('/resumen', requireAuth, (req, res) => {
  try {
    const rows = getResumenCuentas();
    res.json(rows);
  } catch (err) {
    console.error('Error resumen cc:', err);
    res.status(500).json({ error: 'No se pudo obtener resumen' });
  }
});

router.get('/', requireAuth, (req, res) => {
  try {
    const rows = listCuentas(req.query || {});
    res.json(rows);
  } catch (err) {
    console.error('Error listando cc:', err);
    res.status(500).json({ error: 'No se pudo listar cuentas' });
  }
});

router.get('/:id', requireAuth, (req, res) => {
  try {
    const data = getCuentaConPagos(req.params.id);
    if (!data) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(data);
  } catch (err) {
    console.error('Error detalle cc:', err);
    res.status(500).json({ error: 'No se pudo obtener cuenta' });
  }
});

router.post('/', requireAuth, (req, res) => {
  try {
    const cuenta = crearCuenta(req.body || {});
    res.json(cuenta);
  } catch (err) {
    console.error('Error creando cuenta por cobrar:', err);
    const msg = err && err.message;
    if (msg === 'Total inválido' || msg === 'Tasa inválida' || msg === 'Fecha de vencimiento inválida') {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: 'No se pudo crear cuenta por cobrar' });
  }
});

router.post('/:id/pago', requireAuth, (req, res) => {
  try {
    const data = registrarPago(req.params.id, req.body || {});
    if (!data) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(data);
  } catch (err) {
    console.error('Error registrando pago:', err);
    const msg = err && err.message;
    if (msg === 'Monto inválido' || msg === 'Moneda inválida' || msg === 'Tasa inválida') {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: 'No se pudo registrar pago' });
  }
});

router.patch('/:id', requireAuth, (req, res) => {
  try {
    const data = actualizarCuenta(req.params.id, req.body || {});
    if (!data) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(data);
  } catch (err) {
    console.error('Error actualizando cuenta:', err);
    const msg = err && err.message;
    if (msg === 'Fecha inválida' || msg === 'Estado inválido') {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: 'No se pudo actualizar cuenta' });
  }
});

module.exports = router;
