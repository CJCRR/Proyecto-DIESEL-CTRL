const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');


router.get('/', requireAuth, (req, res) => {
  const rawQ = (req.query.q || '').trim();

  if (!rawQ || rawQ.length < 2) {
    return res.json([]);
  }

  // Normalizar término de búsqueda para hacerla tolerante a mayúsculas,
  // ñ / Ñ y ü / Ü (cigueñal vs CIGÜEÑAL, etc.)
  const normQ = rawQ
    .toLowerCase()
    .replace(/[ñÑ]/g, 'n')
    .replace(/[üÜ]/g, 'u');
  const like = `%${normQ}%`;

  const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
  const params = [like, like];
  let sql = `
   SELECT 
     p.codigo,
     p.descripcion,
     COALESCE((
       SELECT SUM(sd.cantidad)
       FROM stock_por_deposito sd
       WHERE sd.producto_id = p.id
     ), p.stock) AS stock,
     p.precio_usd,
     p.marca
   FROM productos p
   WHERE (
     REPLACE(REPLACE(REPLACE(REPLACE(lower(p.codigo),'ñ','n'),'Ñ','n'),'ü','u'),'Ü','u') LIKE ?
     OR REPLACE(REPLACE(REPLACE(REPLACE(lower(p.descripcion),'ñ','n'),'Ñ','n'),'ü','u'),'Ü','u') LIKE ?
   )`;
    if (empresaId) {
      sql += ' AND p.empresa_id = ?';
      params.push(empresaId);
    }

    // Mostrar todos los productos coincidentes, ordenados alfabéticamente
    sql += ' ORDER BY lower(p.descripcion) ASC, p.codigo ASC';

    const resultados = db.prepare(sql).all(...params);

    res.json(resultados);
});

module.exports = router;
