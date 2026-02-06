const db = require('../db');

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

function registrarDevolucion(payload = {}) {
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
  } = payload;

  const policy = getDevolucionPolicy();
  if (!policy.habilitado) {
    const error = new Error('Las devoluciones están deshabilitadas por configuración.');
    error.tipo = 'VALIDACION';
    throw error;
  }

  if (!items || !Array.isArray(items) || !items.length) {
    const error = new Error('La devolución no contiene productos.');
    error.tipo = 'VALIDACION';
    throw error;
  }
  if (items.length > MAX_ITEMS) {
    const error = new Error('Demasiados items en la devolución.');
    error.tipo = 'VALIDACION';
    throw error;
  }
  const clienteSafe = safeStr(cliente, MAX_TEXT);
  if (!clienteSafe) {
    const error = new Error('El nombre del cliente es obligatorio.');
    error.tipo = 'VALIDACION';
    throw error;
  }
  const cedulaSafe = safeStr(cedula, MAX_DOC);
  const telefonoSafe = safeStr(telefono, MAX_DOC);
  const referenciaSafe = safeStr(referencia, MAX_REF);
  const motivoSafe = safeStr(motivo, MAX_MOTIVO);
  if (venta_original_id !== null && venta_original_id !== undefined) {
    const idNum = parseInt(venta_original_id, 10);
    if (Number.isNaN(idNum) || idNum <= 0) {
      const error = new Error('Venta original inválida.');
      error.tipo = 'VALIDACION';
      throw error;
    }
  }
  const tasa = parseFloat(tasa_bcv);
  if (!tasa || Number.isNaN(tasa) || tasa <= 0) {
    const error = new Error('Tasa BCV inválida.');
    error.tipo = 'VALIDACION';
    throw error;
  }

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
      if (!ventaOriginal) {
        const error = new Error('VENTA_ORIGINAL_NO_ENCONTRADA');
        error.tipo = 'VALIDACION';
        throw error;
      }
      if (policy && policy.dias_max && policy.dias_max > 0) {
        const diffDias = (new Date(fecha).getTime() - new Date(ventaOriginal.fecha).getTime()) / 86400000;
        if (diffDias > policy.dias_max) {
          const error = new Error(`La devolución supera el límite de ${policy.dias_max} días`);
          error.tipo = 'LIMITE_DIAS';
          throw error;
        }
      }
      originalDetalles = db.prepare('SELECT producto_id, cantidad, precio_usd, subtotal_bs FROM venta_detalle WHERE venta_id = ?').all(venta_original_id);
      devueltosPrevios = obtenerDevueltosPrevios(venta_original_id);
    }

    for (const item of items) {
      const codigo = safeStr(item.codigo, 64);
      const cantidad = Math.abs(parseInt(item.cantidad, 10));
      if (!codigo || !cantidad || Number.isNaN(cantidad) || cantidad <= 0 || cantidad > 100000) {
        const error = new Error('Producto o cantidad inválida en la devolución');
        error.tipo = 'VALIDACION';
        throw error;
      }
      const producto = db.prepare('SELECT id, precio_usd, stock FROM productos WHERE codigo = ?').get(codigo);
      if (!producto) {
        const error = new Error(`El producto ${codigo} no existe`);
        error.tipo = 'VALIDACION';
        throw error;
      }

      if (venta_original_id) {
        const orig = originalDetalles.find(o => o.producto_id === producto.id);
        if (!orig) {
          const error = new Error(`El producto ${codigo} no pertenece a la venta original`);
          error.tipo = 'VALIDACION';
          throw error;
        }
        const yaDev = devueltosPrevios.get(producto.id) || 0;
        if (cantidad + yaDev > orig.cantidad) {
          const error = new Error(`Cantidad a devolver de ${codigo} excede lo vendido (vendido ${orig.cantidad}, devuelto ${yaDev})`);
          error.tipo = 'VALIDACION';
          throw error;
        }
      }

      const detalleOriginal = venta_original_id
        ? originalDetalles.find(o => o.producto_id === producto.id)
        : null;

      const basePrecioUsd = (detalleOriginal && detalleOriginal.precio_usd != null)
        ? detalleOriginal.precio_usd
        : (producto.precio_usd || 0);

      const subtotalUsd = basePrecioUsd * cantidad;
      const subtotalBs = (detalleOriginal && detalleOriginal.subtotal_bs)
        ? (detalleOriginal.subtotal_bs / (detalleOriginal.cantidad || 1)) * cantidad
        : subtotalUsd * tasa;

      totalUsd += subtotalUsd;
      totalBs += subtotalBs;

      db.prepare(`
          INSERT INTO devolucion_detalle (devolucion_id, producto_id, cantidad, precio_usd, subtotal_bs)
          VALUES (?, ?, ?, ?, ?)
        `).run(devId, producto.id, cantidad, producto.precio_usd || 0, subtotalBs);

      db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(cantidad, producto.id);
    }

    db.prepare('UPDATE devoluciones SET total_bs = ?, total_usd = ? WHERE id = ?').run(totalBs, totalUsd, devId);
    return devId;
  });

  const devolucionId = tx();
  return { devolucionId, total_bs: totalBs, total_usd: totalUsd };
}

function getHistorialDevoluciones(query = {}) {
  const { cliente = '', cedula = '', limit = 10, desde = '', hasta = '', empresaId = null } = query;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const where = [];
  const params = [];
  if (cliente) { where.push('cliente LIKE ?'); params.push(`%${cliente}%`); }
  if (cedula) { where.push('cliente_doc LIKE ?'); params.push(`%${cedula}%`); }
  if (desde) { where.push("date(fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(fecha) <= date(?)"); params.push(hasta); }
  if (empresaId != null) {
    where.push(`EXISTS (
      SELECT 1 FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.id = devoluciones.venta_original_id AND u.empresa_id = ?
    )`);
    params.push(empresaId);
  }
  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
      SELECT id, fecha, cliente, cliente_doc, referencia, motivo, total_bs, total_usd, venta_original_id
      FROM devoluciones
      ${whereSQL}
      ORDER BY fecha DESC
      LIMIT ?
    `).all(...params, lim);

  return rows;
}

module.exports = {
  registrarDevolucion,
  getHistorialDevoluciones,
};
