const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/:id', (req, res) => {
  const ventaId = req.params.id;

  const venta = db.prepare(`
    SELECT * FROM ventas WHERE id = ?
  `).get(ventaId);

  if (!venta) {
    return res.status(404).send('Venta no encontrada');
  }

  const detalles = db.prepare(`
    SELECT vd.cantidad, vd.precio_usd, vd.subtotal_bs, p.descripcion
    FROM venta_detalle vd
    JOIN productos p ON p.id = vd.producto_id
    WHERE vd.venta_id = ?
  `).all(ventaId);

  let filas = '';
  detalles.forEach(d => {
    filas += `
      <tr>
        <td>${d.descripcion}</td>
        <td>${d.cantidad}</td>
        <td>$${d.precio_usd}</td>
        <td>${d.subtotal_bs.toFixed(2)} Bs</td>
      </tr>
    `;
  });

  res.send(`
    <html>
    <head>
      <title>Nota de Entrega</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        td, th { border: 1px solid #000; padding: 6px; }
        th { background: #eee; }
      </style>
    </head>
    <body>
      <h2>NOTA DE ENTREGA</h2>
      <p><strong>Cliente:</strong> ${venta.cliente}</p>
      <p><strong>Fecha:</strong> ${venta.fecha}</p>
      <p><strong>Tasa BCV:</strong> ${venta.tasa_bcv}</p>

      <table>
        <tr>
          <th>Producto</th>
          <th>Cantidad</th>
          <th>Precio USD</th>
          <th>Subtotal Bs</th>
        </tr>
        ${filas}
      </table>

      <h3>Total: ${venta.total_bs.toFixed(2)} Bs</h3>

      <script>
        window.print();
      </script>
    </body>
    </html>
  `);
});

module.exports = router;