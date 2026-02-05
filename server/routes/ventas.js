const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const logger = require('../services/logger');
const { registrarVenta } = require('../services/ventasService');

router.post('/', requireAuth, (req, res) => {
    try {
        const { ventaId, cuentaCobrarId } = registrarVenta(req.body);
        res.json({ message: 'Venta registrada con éxito', ventaId, cuentaCobrarId });
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
