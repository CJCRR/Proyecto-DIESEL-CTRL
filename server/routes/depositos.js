const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./auth');
const db = require('../db');
const {
  listDepositos,
  getDeposito,
  createDeposito,
  updateDeposito,
} = require('../services/depositosService');

// GET /depositos?soloActivos=1
router.get('/', requireAuth, (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const { soloActivos } = req.query || {};
    const items = listDepositos(empresaId, {
      soloActivos: soloActivos === '1' || soloActivos === 'true',
    });
    res.json(items);
  } catch (err) {
    console.error('Error listando depósitos:', err.message);
    res.status(500).json({ error: 'Error al listar depósitos' });
  }
});

// POST /depositos/mover - mover stock entre depósitos (total o parcial)
// Permitido para admin y vendedor de la empresa
router.post('/mover', requireAuth, requireRole('admin', 'admin_empresa', 'vendedor'), (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    let { codigo, deposito_origen_id, deposito_destino_id, cantidad, motivo } = req.body || {};
    codigo = (codigo || '').toString().trim().toUpperCase();
    const destId = deposito_destino_id ? parseInt(deposito_destino_id, 10) : NaN;
    const origenIdRaw = deposito_origen_id ? parseInt(deposito_origen_id, 10) : null;
    const cantidadNum = cantidad !== undefined && cantidad !== null ? parseFloat(cantidad) : null;

    if (!empresaId) return res.status(400).json({ error: 'Usuario sin empresa' });
    if (!codigo) return res.status(400).json({ error: 'Código de producto requerido' });
    if (!destId || Number.isNaN(destId)) return res.status(400).json({ error: 'Depósito destino inválido' });

    // Producto dentro de la empresa
    const prod = db.prepare('SELECT id, stock, deposito_id FROM productos WHERE empresa_id = ? AND codigo = ?').get(empresaId, codigo);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado en esta empresa' });

    let origenId;
    if (origenIdRaw && !Number.isNaN(origenIdRaw)) {
      origenId = origenIdRaw;
    } else {
      // Si no se envía depósito origen explícito, intentar inferirlo desde stock_por_deposito
      const stockRows = db.prepare(`
        SELECT deposito_id, cantidad
        FROM stock_por_deposito
        WHERE producto_id = ?
      `).all(prod.id);
      const rowsConStock = stockRows.filter(r => Number(r.cantidad || 0) > 0);
      if (rowsConStock.length === 1) {
        // Solo un depósito con stock positivo: usarlo como origen real
        origenId = rowsConStock[0].deposito_id;
      } else {
        // Varios depósitos o ninguno con stock: caer al deposito_id del producto
        origenId = prod.deposito_id || null;
      }
    }
    if (!origenId) {
      return res.status(400).json({ error: 'Depósito origen no definido para el producto' });
    }

    if (origenId === destId) {
      return res.status(400).json({ error: 'El depósito origen y destino no pueden ser el mismo' });
    }

    // Depósitos válidos de la empresa
    const depOrigen = db.prepare('SELECT id FROM depositos WHERE empresa_id = ? AND id = ?').get(empresaId, origenId);
    if (!depOrigen) return res.status(400).json({ error: 'Depósito origen no pertenece a la empresa o no existe' });
    const depDestino = db.prepare('SELECT id FROM depositos WHERE empresa_id = ? AND id = ?').get(empresaId, destId);
    if (!depDestino) return res.status(400).json({ error: 'Depósito destino no pertenece a la empresa o no existe' });

    const tx = db.transaction(() => {
      // Stock disponible en el depósito origen
      const stockDepOrigenRow = db.prepare(`
        SELECT cantidad FROM stock_por_deposito
        WHERE producto_id = ? AND deposito_id = ?
      `).get(prod.id, origenId);
      const stockOrigen = stockDepOrigenRow ? Number(stockDepOrigenRow.cantidad || 0) : 0;

      let moverCantidad;
      if (cantidadNum !== null && !Number.isNaN(cantidadNum)) {
        if (cantidadNum <= 0) {
          const err = new Error('La cantidad a mover debe ser mayor a 0');
          err.tipo = 'VALIDACION';
          throw err;
        }
        moverCantidad = cantidadNum;
      } else {
        // Si no se envía cantidad, mover todo el stock disponible en el depósito origen
        moverCantidad = stockOrigen;
      }

      if (stockOrigen <= 0) {
        const err = new Error('No hay stock disponible en el depósito origen para este producto');
        err.tipo = 'VALIDACION';
        throw err;
      }

      if (moverCantidad > stockOrigen) {
        const err = new Error('Stock insuficiente en el depósito origen para la cantidad solicitada');
        err.tipo = 'VALIDACION';
        throw err;
      }

      // Actualizar stock en depósito origen
      db.prepare(`
        UPDATE stock_por_deposito
        SET cantidad = cantidad - ?, actualizado_en = datetime('now')
        WHERE producto_id = ? AND deposito_id = ?
      `).run(moverCantidad, prod.id, origenId);

      // Sumar stock en depósito destino (upsert básico)
      const stockDepDestinoRow = db.prepare(`
        SELECT cantidad FROM stock_por_deposito
        WHERE producto_id = ? AND deposito_id = ?
      `).get(prod.id, destId);
      if (stockDepDestinoRow) {
        db.prepare(`
          UPDATE stock_por_deposito
          SET cantidad = cantidad + ?, actualizado_en = datetime('now')
          WHERE producto_id = ? AND deposito_id = ?
        `).run(moverCantidad, prod.id, destId);
      } else {
        db.prepare(`
          INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad)
          VALUES (?, ?, ?, ?)
        `).run(empresaId, prod.id, destId, moverCantidad);
      }

      // Si todo el stock del depósito origen se movió y era el depósito actual del producto,
      // actualizar deposito_id del producto para que apunte al destino.
      const stockOrigenRestanteRow = db.prepare(`
        SELECT cantidad FROM stock_por_deposito
        WHERE producto_id = ? AND deposito_id = ?
      `).get(prod.id, origenId);
      const stockOrigenRestante = stockOrigenRestanteRow ? Number(stockOrigenRestanteRow.cantidad || 0) : 0;
      if ((prod.deposito_id || null) === origenId && stockOrigenRestante <= 0) {
        db.prepare('UPDATE productos SET deposito_id = ? WHERE id = ?').run(destId, prod.id);
      }

      // Registrar movimiento (no cambia el stock total del producto)
      db.prepare(`
        INSERT INTO movimientos_deposito (empresa_id, producto_id, deposito_origen_id, deposito_destino_id, cantidad, motivo)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(empresaId, prod.id, origenId, destId, moverCantidad, motivo || null);
    });

    tx();
    res.json({ message: 'Movimiento de stock registrado', codigo });
  } catch (err) {
    console.error('Error moviendo producto entre depósitos:', err.message);
    if (err.tipo === 'VALIDACION') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Error al mover producto entre depósitos' });
  }
});

// GET /depositos/movimientos?limit=20 - historial reciente de movimientos por empresa
// Permitido para admin y vendedor de la empresa
router.get('/movimientos', requireAuth, requireRole('admin', 'admin_empresa', 'vendedor'), (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    if (!empresaId) return res.status(400).json({ error: 'Usuario sin empresa' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const rows = db.prepare(`
      SELECT m.id, m.creado_en, m.cantidad, m.motivo,
             p.codigo AS producto_codigo,
             p.descripcion AS producto_descripcion,
             d1.nombre AS deposito_origen_nombre,
             d2.nombre AS deposito_destino_nombre
      FROM movimientos_deposito m
      JOIN productos p ON p.id = m.producto_id
      LEFT JOIN depositos d1 ON d1.id = m.deposito_origen_id
      LEFT JOIN depositos d2 ON d2.id = m.deposito_destino_id
      WHERE m.empresa_id = ?
      ORDER BY m.creado_en DESC, m.id DESC
      LIMIT ?
    `).all(empresaId, limit);
    res.json(rows);
  } catch (err) {
    console.error('Error listando movimientos de depósito:', err.message);
    res.status(500).json({ error: 'Error al listar movimientos de depósito' });
  }
});

// GET /depositos/:id
router.get('/:id', requireAuth, (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const id = parseInt(req.params.id, 10);
    const dep = getDeposito(id, empresaId);
    if (!dep) return res.status(404).json({ error: 'Depósito no encontrado' });
    res.json(dep);
  } catch (err) {
    console.error('Error obteniendo depósito:', err.message);
    res.status(500).json({ error: 'Error al obtener depósito' });
  }
});

// POST /depositos (solo admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const dep = createDeposito(empresaId, req.body || {});
    res.status(201).json(dep);
  } catch (err) {
    console.error('Error creando depósito:', err.message);
    if (err.tipo === 'VALIDACION') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Error al crear depósito' });
  }
});

// PATCH /depositos/:id (solo admin)
router.patch('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const id = parseInt(req.params.id, 10);
    const dep = updateDeposito(id, empresaId, req.body || {});
    if (!dep) return res.status(404).json({ error: 'Depósito no encontrado' });
    res.json(dep);
  } catch (err) {
    console.error('Error actualizando depósito:', err.message);
    if (err.tipo === 'VALIDACION') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Error al actualizar depósito' });
  }
});

// DELETE /depositos/:id (solo admin)
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    if (!empresaId) return res.status(400).json({ error: 'Usuario sin empresa' });

    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: 'ID de depósito inválido' });
    }

    const dep = db.prepare('SELECT * FROM depositos WHERE id = ? AND empresa_id = ?').get(id, empresaId);
    if (!dep) return res.status(404).json({ error: 'Depósito no encontrado' });

    const force = req.query.force === '1' || req.query.force === 'true';

    const stockRows = db.prepare(`
      SELECT producto_id, cantidad
      FROM stock_por_deposito
      WHERE empresa_id = ? AND deposito_id = ?
    `).all(empresaId, id);

    if (stockRows.length > 0 && !force) {
      const productos = new Set(stockRows.map(r => r.producto_id)).size;
      const totalCantidad = stockRows.reduce((acc, r) => acc + Number(r.cantidad || 0), 0);
      return res.status(409).json({
        error: 'El depósito tiene productos/stock asociados.',
        code: 'DEPOSITO_TIENE_STOCK',
        productos,
        totalCantidad,
      });
    }

    const tx = db.transaction(() => {
      if (stockRows.length > 0) {
        const getProd = db.prepare('SELECT stock FROM productos WHERE id = ? AND empresa_id = ?');
        const updProd = db.prepare('UPDATE productos SET stock = ? WHERE id = ? AND empresa_id = ?');
        for (const row of stockRows) {
          const cant = Number(row.cantidad || 0);
          if (cant <= 0) continue;
          const prod = getProd.get(row.producto_id, empresaId);
          const actualStock = prod ? Number(prod.stock || 0) : 0;
          const nuevoStock = actualStock - cant;
          const nuevoSafe = nuevoStock < 0 ? 0 : nuevoStock;
          updProd.run(nuevoSafe, row.producto_id, empresaId);
        }

        db.prepare('DELETE FROM stock_por_deposito WHERE empresa_id = ? AND deposito_id = ?')
          .run(empresaId, id);
      }

      // Limpiar referencia de depósito en productos de esta empresa
      db.prepare('UPDATE productos SET deposito_id = NULL WHERE empresa_id = ? AND deposito_id = ?')
        .run(empresaId, id);

      // Finalmente eliminar el depósito
      db.prepare('DELETE FROM depositos WHERE empresa_id = ? AND id = ?')
        .run(empresaId, id);
    });

    tx();
    res.json({ message: 'Depósito eliminado' });
  } catch (err) {
    console.error('Error eliminando depósito:', err.message);
    res.status(500).json({ error: 'Error al eliminar depósito' });
  }
});

module.exports = router;
