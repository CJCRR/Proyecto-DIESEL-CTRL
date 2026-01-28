const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const { requireAuth } = require('./auth');
const tplCompact = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template-compact.js'));
const tplStandard = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template.js'));

router.get('/:id', requireAuth, async (req, res) => {
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

  try {
    // Leer configuración para escoger plantilla (compact/standard)
    const cfgRow = db.prepare(`SELECT valor FROM config WHERE clave='nota_config'`).get();
    let layout = 'compact';
    if (cfgRow && cfgRow.valor) {
      try { layout = JSON.parse(cfgRow.valor).layout || 'compact'; } catch {}
    }
    const tpl = layout === 'standard' ? tplStandard : tplCompact;
    const html = tpl && tpl.buildNotaHTML
      ? await tpl.buildNotaHTML({ venta, detalles })
      : '<html><body><pre>Plantilla no disponible</pre></body></html>';

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html || '<html><body><pre>Nota vacía</pre></body></html>');
  } catch (err) {
    console.error('Error construyendo nota:', err);
    res.status(500).send('Error generando la nota');
  }
});

module.exports = router;