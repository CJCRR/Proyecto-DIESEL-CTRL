const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/:codigo', (req, res) => {
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