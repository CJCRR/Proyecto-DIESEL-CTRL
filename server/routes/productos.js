const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// GET /productos - lista (paginada) de productos
router.get('/', requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    try {
        const productos = db.prepare(`
            SELECT codigo, descripcion, precio_usd, stock
            FROM productos
            ORDER BY stock ASC, codigo ASC
            LIMIT ?
        `).all(limit);

        res.json(productos);
    } catch (err) {
        console.error('Error obteniendo productos:', err);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

router.get('/:codigo', requireAuth, (req, res) => {
    const { codigo } = req.params;

    const producto = db
        .prepare('SELECT * FROM productos WHERE codigo = ?')
        .get(codigo);

    if (!producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(producto);
});

module.exports = router;