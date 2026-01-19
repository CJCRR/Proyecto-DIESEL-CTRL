const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /admin/ajustes - Ajustar Stock (Entrada/Salida manual)
router.post('/', (req, res) => {
  const { codigo, diferencia, motivo } = req.body;
  const diff = parseInt(diferencia);

  if (!codigo || isNaN(diff) || diff === 0 || !motivo) {
    return res.status(400).json({ error: 'Datos inválidos. Se requiere código, diferencia distinta de 0 y motivo.' });
  }

  try {
    // Usamos una transacción para asegurar que el inventario no cambie 
    // sin que quede registrado el log en ajustes_stock.
    db.transaction(() => {
      const producto = db.prepare('SELECT id, stock FROM productos WHERE codigo = ?').get(codigo);

      if (!producto) throw new Error('PRODUCTO_NO_ENCONTRADO');

      // Evitar stock negativo
      const nuevoStock = producto.stock + diff;
      if (nuevoStock < 0) throw new Error('STOCK_NEGATIVO');

      // 1. Actualizar Producto
      db.prepare('UPDATE productos SET stock = ? WHERE id = ?').run(nuevoStock, producto.id);

      // 2. Registrar Auditoría
      db.prepare(`
                INSERT INTO ajustes_stock (producto_id, diferencia, motivo, fecha)
                VALUES (?, ?, ?, ?)
            `).run(producto.id, diff, motivo, new Date().toISOString());

    })(); // Ejecutar transacción inmediatamente

    res.json({ message: 'Ajuste de inventario procesado correctamente.' });

  } catch (err) {
    console.error('Error en ajuste:', err.message);
    if (err.message === 'PRODUCTO_NO_ENCONTRADO') return res.status(404).json({ error: 'Producto no encontrado.' });
    if (err.message === 'STOCK_NEGATIVO') return res.status(400).json({ error: 'El ajuste dejaría el stock en negativo.' });
    res.status(500).json({ error: 'Error interno al procesar ajuste.' });
  }
});

module.exports = router;