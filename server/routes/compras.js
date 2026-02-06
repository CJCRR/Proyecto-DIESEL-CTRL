const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./auth');
const { listCompras, getCompra, crearCompra } = require('../services/comprasService');

// GET /compras - listar compras (ingresos de inventario)
router.get('/', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const proveedor_id = req.query.proveedor_id ? parseInt(req.query.proveedor_id, 10) : undefined;
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const rows = listCompras({ limit, proveedor_id, empresaId });
    res.json(rows);
  } catch (err) {
    console.error('Error listando compras:', err.message);
    res.status(500).json({ error: 'Error al listar compras' });
  }
});

// GET /compras/:id - detalle de compra con items
router.get('/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const data = getCompra(id, empresaId);
    if (!data) return res.status(404).json({ error: 'Compra no encontrada' });
    res.json(data);
  } catch (err) {
    console.error('Error obteniendo compra:', err.message);
    res.status(500).json({ error: 'Error al obtener compra' });
  }
});

// POST /compras - registrar una compra y cargar inventario (solo admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const compra = crearCompra(req.body || {}, req.usuario);
    res.status(201).json(compra);
  } catch (err) {
    console.error('Error creando compra:', err.message);
    if (err.tipo === 'VALIDACION') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Error al registrar compra' });
  }
});

module.exports = router;
