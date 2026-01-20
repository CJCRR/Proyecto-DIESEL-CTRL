const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const { buildNotaHTML } = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template.js'));

router.get('/:id', (req, res) => {
  const ventaId = req.params.id;

  const venta = db.prepare(`
    SELECT * FROM ventas WHERE id = ?
  `).get(ventaId);

  if (!venta) {
    return res.status(404).send('Venta no encontrada');
  }

  const detalles = db.prepare(`
    SELECT vd.cantidad, vd.precio_usd, vd.subtotal_bs, p.descripcion, p.codigo
    FROM venta_detalle vd
    JOIN productos p ON p.id = vd.producto_id
    WHERE vd.venta_id = ?
  `).all(ventaId);

  const html = buildNotaHTML({ venta, detalles });
  res.send(html);
});

module.exports = router;