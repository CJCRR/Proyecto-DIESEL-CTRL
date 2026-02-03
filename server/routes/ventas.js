const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { registrarVenta } = require('../services/ventasService');

router.post('/', requireAuth, (req, res) => {
    try {
        const { ventaId, cuentaCobrarId } = registrarVenta(req.body);
        res.json({ message: 'Venta registrada con éxito', ventaId, cuentaCobrarId });
    } catch (error) {
        console.error('Error procesando la venta:', error.message);
        // Mantener el mismo comportamiento previo: responder 400 con el mensaje de error
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
