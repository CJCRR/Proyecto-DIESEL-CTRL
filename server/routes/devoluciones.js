const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

const MAX_ITEMS = 200;
const MAX_TEXT = 120;
const MAX_DOC = 40;
const MAX_REF = 120;
const MAX_MOTIVO = 240;

function safeStr(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function getDevolucionPolicy() {
  const row = db.prepare(`SELECT valor FROM config WHERE clave='devolucion_politica'`).get();
  const def = { habilitado: true, dias_max: 30, requiere_referencia: true, recargo_restock_pct: 0 };
  if (!row || !row.valor) return def;
  try {
    const parsed = JSON.parse(row.valor);
    return { ...def, ...(parsed || {}) };
  } catch (err) {
    return def;
  }
}

function obtenerDevueltosPrevios(ventaId) {
  const rows = db.prepare(`
    SELECT dd.producto_id, SUM(dd.cantidad) as devuelto
    FROM devolucion_detalle dd
    JOIN devoluciones d ON d.id = dd.devolucion_id
    WHERE d.venta_original_id = ?
    GROUP BY dd.producto_id
  `).all(ventaId);
  const map = new Map();
  rows.forEach(r => map.set(r.producto_id, Number(r.devuelto || 0)));
  return map;
}

// Registrar una devolución de productos
router.post('/', requireAuth, (req, res) => {
  const {
    items,
    cliente,
    cedula = '',
    telefono = '',
    tasa_bcv,
    referencia = '',
    motivo = '',
    venta_original_id = null,
    usuario_id = null,
  } = req.body;

  const policy = getDevolucionPolicy();
  if (!policy.habilitado) {
    return res.status(400).json({ error: 'Las devoluciones están deshabilitadas por configuración.' });
  }

  if (!items || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'La devolución no contiene productos.' });
  }
  if (items.length > MAX_ITEMS) {
    return res.status(400).json({ error: 'Demasiados items en la devolución.' });
  }
  const clienteSafe = safeStr(cliente, MAX_TEXT);
  if (!clienteSafe) {
    return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
  }
  const cedulaSafe = safeStr(cedula, MAX_DOC);
  const telefonoSafe = safeStr(telefono, MAX_DOC);
  const referenciaSafe = safeStr(referencia, MAX_REF);
  const motivoSafe = safeStr(motivo, MAX_MOTIVO);
  if (venta_original_id !== null && venta_original_id !== undefined) {
    const idNum = parseInt(venta_original_id, 10);
    if (Number.isNaN(idNum) || idNum <= 0) return res.status(400).json({ error: 'Venta original inválida.' });
  }
  const tasa = parseFloat(tasa_bcv);
  if (!tasa || Number.isNaN(tasa) || tasa <= 0) {
    return res.status(400).json({ error: 'Tasa BCV inválida.' });
  }
  try {
    const fecha = new Date().toISOString();
    let totalBs = 0;
    let totalUsd = 0;

    const tx = db.transaction(() => {
      const info = db.prepare(`
          INSERT INTO devoluciones (fecha, cliente, cliente_doc, telefono, tasa_bcv, referencia, motivo, venta_original_id, total_bs, total_usd, usuario_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
        `).run(fecha, clienteSafe, cedulaSafe, telefonoSafe, tasa, referenciaSafe, motivoSafe, venta_original_id, usuario_id);

      const devId = info.lastInsertRowid;

        let originalDetalles = [];
        let devueltosPrevios = new Map();
        let ventaOriginal = null;
        if (venta_original_id) {
          ventaOriginal = db.prepare('SELECT id, fecha FROM ventas WHERE id = ?').get(venta_original_id);
          if (!ventaOriginal) throw new Error('VENTA_ORIGINAL_NO_ENCONTRADA');
          if (policy && policy.dias_max && policy.dias_max > 0) {
            const diffDias = (new Date(fecha).getTime() - new Date(ventaOriginal.fecha).getTime()) / 86400000;
            if (diffDias > policy.dias_max) {
              throw new Error(`La devolución supera el límite de ${policy.dias_max} días`);
            }
          }
          originalDetalles = db.prepare('SELECT producto_id, cantidad, precio_usd, subtotal_bs FROM venta_detalle WHERE venta_id = ?').all(venta_original_id);
          devueltosPrevios = obtenerDevueltosPrevios(venta_original_id);
        }

      for (const item of items) {
        const codigo = safeStr(item.codigo, 64);
        const cantidad = Math.abs(parseInt(item.cantidad, 10));
        if (!codigo || !cantidad || Number.isNaN(cantidad) || cantidad <= 0 || cantidad > 100000) {
          throw new Error('Producto o cantidad inválida en la devolución');
        }
        const producto = db.prepare('SELECT id, precio_usd, stock FROM productos WHERE codigo = ?').get(codigo);
        if (!producto) {
          throw new Error(`El producto ${codigo} no existe`);
        }

        if (venta_original_id) {
          const orig = originalDetalles.find(o => o.producto_id === producto.id);
          if (!orig) throw new Error(`El producto ${codigo} no pertenece a la venta original`);
          const yaDev = devueltosPrevios.get(producto.id) || 0;
          if (cantidad + yaDev > orig.cantidad) {
            throw new Error(`Cantidad a devolver de ${codigo} excede lo vendido (vendido ${orig.cantidad}, devuelto ${yaDev})`);
          }
        }

        const basePrecioUsd = (venta_original_id && originalDetalles.find(o => o.producto_id === producto.id)?.precio_usd != null)
          ? originalDetalles.find(o => o.producto_id === producto.id).precio_usd
          : (producto.precio_usd || 0);
        const subtotalUsd = basePrecioUsd * cantidad;
        const subtotalBs = (venta_original_id && originalDetalles.find(o => o.producto_id === producto.id)?.subtotal_bs)
          ? (originalDetalles.find(o => o.producto_id === producto.id).subtotal_bs / (originalDetalles.find(o => o.producto_id === producto.id).cantidad || 1)) * cantidad
          : subtotalUsd * tasa;
        totalUsd += subtotalUsd;
        totalBs += subtotalBs;

        db.prepare(`
          INSERT INTO devolucion_detalle (devolucion_id, producto_id, cantidad, precio_usd, subtotal_bs)
          VALUES (?, ?, ?, ?, ?)
        `).run(devId, producto.id, cantidad, producto.precio_usd || 0, subtotalBs);

        // Devolución regresa el stock al inventario
        db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(cantidad, producto.id);
      }

      db.prepare('UPDATE devoluciones SET total_bs = ?, total_usd = ? WHERE id = ?').run(totalBs, totalUsd, devId);
      return devId;
    });

    const devId = tx();
    res.json({ message: 'Devolución registrada', devolucionId: devId, total_bs: totalBs, total_usd: totalUsd });
  } catch (err) {
    console.error('Error registrando devolución:', err.message);
    if (err.message && err.message.includes('límite')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(400).json({ error: err.message || 'Error al registrar devolución' });
  }
});

// Historial de devoluciones (por cliente y rango opcional)
router.get('/historial', requireAuth, (req, res) => {
  try {
    const { cliente = '', cedula = '', limit = 10, desde = '', hasta = '' } = req.query;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const where = [];
    const params = [];
    if (cliente) { where.push('cliente LIKE ?'); params.push(`%${cliente}%`); }
    if (cedula) { where.push('cliente_doc LIKE ?'); params.push(`%${cedula}%`); }
    if (desde) { where.push("date(fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(fecha) <= date(?)"); params.push(hasta); }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT id, fecha, cliente, cliente_doc, referencia, motivo, total_bs, total_usd, venta_original_id
      FROM devoluciones
      ${whereSQL}
      ORDER BY fecha DESC
      LIMIT ?
    `).all(...params, lim);

    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo historial de devoluciones:', err.message);
    res.status(500).json({ error: 'Error al obtener devoluciones' });
  }
});

module.exports = router;
