const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./auth');
const {
  listProveedores,
  getProveedor,
  createProveedor,
  updateProveedor,
  toggleProveedorActivo,
} = require('../services/proveedoresService');

// GET /proveedores - listado (con filtro opcional q y soloActivos)
router.get('/', requireAuth, (req, res) => {
  try {
    const { q, soloActivos } = req.query || {};
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const proveedores = listProveedores({ q, soloActivos: soloActivos === '1' || soloActivos === 'true', empresaId });
    res.json(proveedores);
  } catch (err) {
    console.error('Error listando proveedores:', err.message);
    res.status(500).json({ error: 'Error al listar proveedores' });
  }
});

// GET /proveedores/:id - detalle
router.get('/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const prov = getProveedor(id, empresaId);
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(prov);
  } catch (err) {
    console.error('Error obteniendo proveedor:', err.message);
    res.status(500).json({ error: 'Error al obtener proveedor' });
  }
});

// POST /proveedores - crear (solo admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const prov = createProveedor(req.body || {}, empresaId);
    res.status(201).json(prov);
  } catch (err) {
    console.error('Error creando proveedor:', err.message);
    if (err.tipo === 'VALIDACION') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Error al crear proveedor' });
  }
});

// PATCH /proveedores/:id - actualizar (solo admin)
router.patch('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const prov = updateProveedor(id, req.body || {}, empresaId);
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(prov);
  } catch (err) {
    console.error('Error actualizando proveedor:', err.message);
    if (err.tipo === 'VALIDACION') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Error al actualizar proveedor' });
  }
});

// POST /proveedores/:id/activar - activar/desactivar (solo admin)
router.post('/:id/activar', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { activo } = req.body || {};
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const prov = toggleProveedorActivo(id, activo !== false && activo !== 0, empresaId);
    if (!prov) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(prov);
  } catch (err) {
    console.error('Error cambiando estado de proveedor:', err.message);
    res.status(500).json({ error: 'Error al cambiar estado de proveedor' });
  }
});

module.exports = router;
