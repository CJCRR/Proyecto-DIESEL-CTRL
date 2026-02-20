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

// GET /productos/:codigo - detalle de producto + existencias por depósito
router.get('/:codigo', requireAuth, (req, res) => {
    const { codigo } = req.params;
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;

    let producto;
    if (empresaId) {
        producto = db
            .prepare(`
                SELECT p.*, d.nombre AS deposito_nombre
                FROM productos p
                LEFT JOIN depositos d ON d.id = p.deposito_id
                WHERE p.codigo = ? AND p.empresa_id = ?
            `)
            .get(codigo, empresaId);
    } else {
        producto = db
            .prepare(`
                SELECT p.*, d.nombre AS deposito_nombre
                FROM productos p
                LEFT JOIN depositos d ON d.id = p.deposito_id
                WHERE p.codigo = ?
            `)
            .get(codigo);
    }

    if (!producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
    }

    try {
        const existencias = db.prepare(`
            SELECT sd.deposito_id, d.nombre AS deposito_nombre, sd.cantidad
            FROM stock_por_deposito sd
            JOIN depositos d ON d.id = sd.deposito_id
            WHERE sd.producto_id = ?
            ORDER BY d.nombre ASC
        `).all(producto.id);
        producto.existencias_por_deposito = existencias;
    } catch (err) {
        // Si la tabla aún no existe por alguna razón, simplemente ignorar
        console.warn('No se pudieron obtener existencias por depósito:', err.message);
    }

    res.json(producto);
});

module.exports = router;