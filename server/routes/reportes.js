const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/ventas', (req, res) => {
    const ventas = db.prepare(`
    SELECT id, fecha, cliente, total_bs, tasa_bcv
    FROM ventas
    ORDER BY fecha DESC
    LIMIT 100
  `).all();

    res.json(ventas);
});

router.get('/ventas/:id', (req, res) => {
    const venta = db.prepare(`
    SELECT * FROM ventas WHERE id = ?
  `).get(req.params.id);

    if (!venta) {
        return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const detalles = db.prepare(`
    SELECT p.descripcion, vd.cantidad, vd.precio_usd, vd.subtotal_bs
    FROM venta_detalle vd
    JOIN productos p ON p.id = vd.producto_id
    WHERE vd.venta_id = ?
  `).all(req.params.id);

    res.json({ venta, detalles });
});

module.exports = router;
