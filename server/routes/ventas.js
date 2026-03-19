const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./auth');
const { body, validate } = require('../middleware/validation');
const logger = require('../services/logger');
const db = require('../db');
const { registrarVenta, cambiarVendedorVenta, anularVenta } = require('../services/ventasService');
const { registrarAuditoria } = require('../services/auditLogService');

// El superadmin no debe registrar ventas de ninguna empresa
function forbidSuperadmin(req, res, next) {
    if (req.usuario && req.usuario.rol === 'superadmin') {
        return res.status(403).json({ error: 'Superadmin no puede registrar ventas' });
    }
    next();
}

router.post(
    '/',
    requireAuth,
    forbidSuperadmin,
    validate([
        body('items')
            .isArray({ min: 1 })
            .withMessage('Debe enviar al menos un ítem en la venta'),
        body('items.*.cantidad')
            .optional()
            .isFloat({ gt: 0 })
            .withMessage('Cantidad de ítem inválida'),
        body('tasa_bcv')
            .notEmpty()
            .withMessage('La tasa BCV es obligatoria')
            .bail()
            .isFloat({ gt: 0 })
            .withMessage('La tasa BCV debe ser un número mayor a 0'),
        body('metodo_pago')
            .optional()
            .isString()
            .isLength({ max: 100 })
            .withMessage('Método de pago inválido'),
        body('cliente')
            .optional()
            .isString()
            .isLength({ max: 200 })
            .withMessage('Nombre de cliente demasiado largo'),
    ]),
    (req, res) => {
    try {
        // Asegurar que siempre se pase usuario_id de la sesión si no viene en el payload
        const payload = {
            ...req.body,
            usuario_id: (req.body && req.body.usuario_id != null)
                ? req.body.usuario_id
                : (req.usuario ? req.usuario.id : null),
            // Pasar siempre empresa_id de la sesión para que el servicio filtre por empresa
            empresa_id: req.body && req.body.empresa_id != null
                ? req.body.empresa_id
                : (req.usuario ? req.usuario.empresa_id : null),
        };
        const { ventaId, cuentaCobrarId } = registrarVenta(payload);

        // Calcular un número correlativo por empresa para el NRO de la nota
        // usando la misma lógica que en la ruta de /nota.
        const empresaId = payload.empresa_id != null
            ? payload.empresa_id
            : (req.usuario && req.usuario.empresa_id != null ? req.usuario.empresa_id : null);

        let idGlobal = null;
        if (empresaId != null && ventaId != null) {
            const filaSeq = db.prepare(`
        SELECT COUNT(*) AS n
        FROM ventas v2
        JOIN usuarios u2 ON u2.id = v2.usuario_id
        WHERE u2.empresa_id = ? AND v2.id <= ?
      `).get(empresaId, ventaId);
            const correlativo = filaSeq && filaSeq.n ? Number(filaSeq.n) : Number(ventaId);
            idGlobal = `VENTA-${correlativo}`;
        } else if (ventaId != null) {
            idGlobal = `VENTA-${ventaId}`;
        }

    res.json({ message: 'Venta registrada con éxito', ventaId, cuentaCobrarId, idGlobal });
    } catch (error) {
        // Log estructurado para diagnóstico, manteniendo respuesta 400 con el mensaje
        logger.error('Error procesando la venta', {
            message: error.message,
            stack: error.stack,
            url: req.originalUrl,
            method: req.method,
            user: req.usuario ? req.usuario.id : null,
            items: Array.isArray(req.body?.items) ? req.body.items.length : 0,
            cliente: req.body?.cliente || null
        });
        res.status(400).json({
            error: error.message,
            code: error.code || 'VENTA_ERROR'
        });
    }
});

// DELETE /ventas/:id - Anular una venta (solo admins de empresa)
router.delete('/:id', requireAuth, requireRole('admin', 'admin_empresa'), (req, res) => {
    try {
        const ventaId = parseInt(req.params.id, 10);
        const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;

        if (!Number.isFinite(ventaId) || ventaId <= 0) {
            return res.status(400).json({ error: 'ID de venta inválido' });
        }
        if (!empresaId) {
            return res.status(400).json({ error: 'Usuario sin empresa asociada' });
        }

        const result = anularVenta({ ventaId, empresaId });

        registrarAuditoria({
            usuario: req.usuario,
            accion: 'VENTA_ANULADA',
            entidad: 'venta',
            entidadId: ventaId,
            detalle: { origen: 'reportes', motivo: 'anulacion_manual' },
            ip: req.ip,
            userAgent: req.get('user-agent') || null,
        });

        return res.json({ ok: true, ...result, message: 'Venta anulada y revertida correctamente.' });
    } catch (error) {
        logger.error('Error anulando venta', {
            message: error.message,
            stack: error.stack,
            url: req.originalUrl,
            method: req.method,
            user: req.usuario ? req.usuario.id : null,
            ventaId: req.params.id,
        });
        return res.status(400).json({
            error: error.message || 'Error al anular la venta',
            code: error.code || 'VENTA_ANULAR_ERROR',
        });
    }
});

// PATCH /ventas/:id/vendedor - Cambiar el vendedor/usuario asignado a una venta (solo admin de empresa)
router.patch('/:id/vendedor', requireAuth, requireRole('admin', 'admin_empresa'), (req, res) => {
    try {
        const ventaId = parseInt(req.params.id, 10);
        const nuevoUsuarioId = req.body && req.body.usuario_id != null ? Number(req.body.usuario_id) : null;
        const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;

        if (!Number.isFinite(ventaId) || ventaId <= 0) {
            return res.status(400).json({ error: 'ID de venta inválido' });
        }

        if (!nuevoUsuarioId || !Number.isFinite(nuevoUsuarioId) || nuevoUsuarioId <= 0) {
            return res.status(400).json({ error: 'Debe indicar el ID del nuevo vendedor' });
        }

        if (!empresaId) {
            return res.status(400).json({ error: 'Usuario sin empresa asociada' });
        }

        const ventaActualizada = cambiarVendedorVenta({
            ventaId,
            nuevoUsuarioId,
            empresaId,
        });

        return res.json({ ok: true, venta: ventaActualizada });
    } catch (error) {
        logger.error('Error cambiando vendedor de venta', {
            message: error.message,
            stack: error.stack,
            url: req.originalUrl,
            method: req.method,
            user: req.usuario ? req.usuario.id : null,
            ventaId: req.params.id,
        });
        return res.status(400).json({
            error: error.message || 'Error al cambiar el vendedor de la venta',
            code: error.code || 'VENTA_CAMBIO_VENDEDOR_ERROR',
        });
    }
});

module.exports = router;
