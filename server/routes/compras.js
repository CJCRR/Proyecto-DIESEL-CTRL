const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./auth');
const logger = require('../services/logger');
const { registrarAuditoria } = require('../services/auditLogService');
const { listCompras, getCompra, crearCompra, anularCompra } = require('../services/comprasService');

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

// POST /compras - registrar una compra y cargar inventario
// Permitido para admin, admin de empresa y vendedores (se bloquea superadmin implícitamente).
router.post('/', requireAuth, requireRole('admin', 'admin_empresa', 'vendedor'), (req, res) => {
  try {
    const compra = crearCompra(req.body || {}, req.usuario);
    res.status(201).json(compra);
  } catch (err) {
    console.error('Error creando compra:', err.message);
    if (err.tipo === 'VALIDACION') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Error al registrar compra' });
  }
});

// DELETE /compras/:id - Anular una compra (solo admin/admin_empresa)
router.delete('/:id', requireAuth, requireRole('admin', 'admin_empresa'), (req, res) => {
  try {
    const compraId = parseInt(req.params.id, 10);
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;

    if (!Number.isFinite(compraId) || compraId <= 0) {
      return res.status(400).json({ error: 'ID de compra inválido' });
    }
    if (!empresaId) {
      return res.status(400).json({ error: 'Usuario sin empresa asociada' });
    }

    const compraAnulada = anularCompra({ compraId, empresaId });

    registrarAuditoria({
      usuario: req.usuario,
      accion: 'COMPRA_ANULADA',
      entidad: 'compra',
      entidadId: compraId,
      detalle: { origen: 'compras', motivo: 'anulacion_manual' },
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    return res.json({ ok: true, message: 'Compra anulada y stock revertido correctamente.', compra: compraAnulada });
  } catch (err) {
    logger.error('Error anulando compra', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      user: req.usuario ? req.usuario.id : null,
      compraId: req.params.id,
    });

    const status = err && err.tipo === 'VALIDACION' ? 400 : 500;
    return res.status(status).json({
      error: err.message || 'Error al anular compra',
      code: err.code || 'COMPRA_ANULAR_ERROR',
    });
  }
});

module.exports = router;
