const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// GET /productos - lista (paginada) de productos
router.get('/', requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    try {
        let productos;
        if (empresaId) {
            productos = db.prepare(`
                SELECT codigo, descripcion, precio_usd, stock
                FROM productos
                WHERE empresa_id = ?
                ORDER BY stock ASC, codigo ASC
                LIMIT ?
            `).all(empresaId, limit);
        } else {
            productos = db.prepare(`
                SELECT codigo, descripcion, precio_usd, stock
                FROM productos
                ORDER BY stock ASC, codigo ASC
                LIMIT ?
            `).all(limit);
        }

        res.json(productos);
    } catch (err) {
        console.error('Error obteniendo productos:', err);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

router.get('/:codigo', requireAuth, (req, res) => {
    const { codigo } = req.params;
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;

    let producto;
    if (empresaId) {
        producto = db
            .prepare('SELECT * FROM productos WHERE codigo = ? AND empresa_id = ?')
            .get(codigo, empresaId);
    } else {
        producto = db
            .prepare('SELECT * FROM productos WHERE codigo = ?')
            .get(codigo);
    }

    if (!producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(producto);
});

module.exports = router;