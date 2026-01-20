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

// GET /admin/productos - Listar productos (paginado opcional)
router.get('/', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    try {
        const productos = db.prepare(`
            SELECT id, codigo, descripcion, precio_usd, stock
            FROM productos
            ORDER BY codigo ASC
            LIMIT ? OFFSET ?
        `).all(limit, offset);

        // También devolver el conteo total para permitir paginación en el cliente
        const countRow = db.prepare('SELECT COUNT(*) as total FROM productos').get();

        res.json({ items: productos, total: countRow.total || 0 });
    } catch (err) {
        console.error('Error listando productos:', err);
        res.status(500).json({ error: 'Error al listar productos' });
    }
});

// PUT /admin/productos/:codigo - Actualizar producto por código
router.put('/:codigo', (req, res) => {
    let codigo = req.params.codigo ? req.params.codigo.trim().toUpperCase() : '';
    let { descripcion, precio_usd, stock } = req.body;

    descripcion = descripcion ? descripcion.trim() : '';
    precio_usd = precio_usd !== undefined ? parseFloat(precio_usd) : null;
    stock = stock !== undefined ? parseInt(stock) : null;

    if (!codigo) return res.status(400).json({ error: 'Código inválido' });

    try {
        const existing = db.prepare('SELECT id FROM productos WHERE codigo = ?').get(codigo);
        if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

        const updates = [];
        const params = [];
        if (descripcion) { updates.push('descripcion = ?'); params.push(descripcion); }
        if (precio_usd !== null && !isNaN(precio_usd)) { updates.push('precio_usd = ?'); params.push(precio_usd); }
        if (stock !== null && !isNaN(stock)) { updates.push('stock = ?'); params.push(stock); }

        if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

        params.push(codigo);
        const sql = `UPDATE productos SET ${updates.join(', ')} WHERE codigo = ?`;
        db.prepare(sql).run(...params);

        res.json({ message: 'Producto actualizado', codigo });
    } catch (err) {
        console.error('Error actualizando producto:', err);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// DELETE /admin/productos/:codigo - Eliminar producto por código
router.delete('/:codigo', (req, res) => {
    const codigo = req.params.codigo ? req.params.codigo.trim().toUpperCase() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido' });

    try {
        const info = db.prepare('DELETE FROM productos WHERE codigo = ?').run(codigo);
        if (info.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json({ message: 'Producto eliminado', codigo });
    } catch (err) {
        console.error('Error eliminando producto:', err);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

module.exports = router;
