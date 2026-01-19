const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /admin/productos - Crear nuevo producto
router.post('/', (req, res) => {
    // 1. Saneamiento de entrada
    let { codigo, descripcion, precio_usd, stock } = req.body;

    // Normalización (Mayúsculas para códigos)
    codigo = codigo ? codigo.trim().toUpperCase() : '';
    descripcion = descripcion ? descripcion.trim() : '';
    precio_usd = parseFloat(precio_usd);
    stock = parseInt(stock) || 0;

    // 2. Validaciones
    if (!codigo || codigo.length < 3) {
        return res.status(400).json({ error: 'El código debe tener al menos 3 caracteres.' });
    }
    if (!descripcion) {
        return res.status(400).json({ error: 'La descripción es obligatoria.' });
    }
    if (isNaN(precio_usd) || precio_usd <= 0) {
        return res.status(400).json({ error: 'El precio debe ser un número positivo.' });
    }

    try {
        // 3. Verificación de duplicados (Optimización: SQLite lanza error en UNIQUE constraint, 
        // pero consultar antes permite dar un mensaje más amigable).
        const existe = db.prepare('SELECT id FROM productos WHERE codigo = ?').get(codigo);
        if (existe) {
            return res.status(409).json({ error: `El código ${codigo} ya existe en el inventario.` });
        }

        // 4. Inserción
        const info = db.prepare(`
            INSERT INTO productos (codigo, descripcion, precio_usd, stock)
            VALUES (?, ?, ?, ?)
        `).run(codigo, descripcion, precio_usd, stock);

        res.status(201).json({
            message: 'Producto creado exitosamente',
            id: info.lastInsertRowid,
            codigo
        });

    } catch (err) {
        console.error('Error creando producto:', err);
        res.status(500).json({ error: 'Error interno de base de datos.' });
    }
});

module.exports = router;
