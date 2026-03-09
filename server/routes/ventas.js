const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const logger = require('../services/logger');
const db = require('../db');
const { registrarVenta } = require('../services/ventasService');

// El superadmin no debe registrar ventas de ninguna empresa
function forbidSuperadmin(req, res, next) {
    if (req.usuario && req.usuario.rol === 'superadmin') {
        return res.status(403).json({ error: 'Superadmin no puede registrar ventas' });
    }
    next();
}

router.post('/', requireAuth, forbidSuperadmin, (req, res) => {
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

module.exports = router;
