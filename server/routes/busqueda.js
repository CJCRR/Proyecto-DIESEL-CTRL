const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
    const q = req.query.q;

    if (!q || q.length < 2) {
        return res.json([]);
    }

    const resultados = db.prepare(`
    SELECT codigo, descripcion, stock, precio_usd
    FROM productos
    WHERE codigo LIKE ?
       OR descripcion LIKE ?
    LIMIT 10
  `).all(`%${q}%`, `%${q}%`);

    res.json(resultados);
});

module.exports = router;
