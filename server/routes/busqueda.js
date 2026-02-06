const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

router.get('/', requireAuth, (req, res) => {
    const q = req.query.q;

    if (!q || q.length < 2) {
        return res.json([]);
    }

    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const params = [`%${q}%`, `%${q}%`];
    let sql = `
     SELECT codigo, descripcion, stock, precio_usd, marca
     FROM productos
     WHERE (codigo LIKE ? OR descripcion LIKE ?)`;
    if (empresaId) {
      sql += ' AND empresa_id = ?';
      params.push(empresaId);
    }
    sql += ' LIMIT 10';

    const resultados = db.prepare(sql).all(...params);

    res.json(resultados);
});

module.exports = router;
