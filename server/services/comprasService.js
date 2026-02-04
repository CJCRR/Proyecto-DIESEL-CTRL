const db = require('../db');

const MAX_TEXT = 400;

function safeStr(v, max = MAX_TEXT) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function mapCompra(row) {
  if (!row) return null;
  return {
    id: row.id,
    proveedor_id: row.proveedor_id,
    proveedor_nombre: row.proveedor_nombre || null,
    fecha: row.fecha,
    numero: row.numero || '',
    tasa_bcv: row.tasa_bcv || 1,
    total_bs: row.total_bs || 0,
    total_usd: row.total_usd || 0,
    estado: row.estado || 'recibida',
    notas: row.notas || '',
    usuario_id: row.usuario_id || null,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en,
  };
}

function listCompras({ limit = 100, proveedor_id } = {}) {
  const params = [];
  let where = '';
  if (proveedor_id) {
    where = 'WHERE c.proveedor_id = ?';
    params.push(proveedor_id);
  }
  const rows = db.prepare(`
    SELECT c.*, p.nombre AS proveedor_nombre
    FROM compras c
    LEFT JOIN proveedores p ON p.id = c.proveedor_id
    ${where}
    ORDER BY c.fecha DESC, c.id DESC
    LIMIT ?
  `).all(...params, limit);
  return rows.map(mapCompra);
}

function getCompra(id) {
  const cab = db.prepare(`
    SELECT c.*, p.nombre AS proveedor_nombre
    FROM compras c
    LEFT JOIN proveedores p ON p.id = c.proveedor_id
    WHERE c.id = ?
  `).get(id);
  if (!cab) return null;
  const detalles = db.prepare(`
    SELECT d.*, pr.codigo AS producto_codigo_db, pr.descripcion AS producto_descripcion_db
    FROM compra_detalle d
    LEFT JOIN productos pr ON pr.id = d.producto_id
    WHERE d.compra_id = ?
    ORDER BY d.id ASC
  `).all(id);
  return {
    compra: mapCompra(cab),
    detalles,
  };
}

function crearCompra(payload = {}, usuario) {
  const { proveedor_id, fecha, numero, tasa_bcv, notas, items } = payload;

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Se requieren items para registrar una compra');
    err.tipo = 'VALIDACION';
    throw err;
  }

  const tasa = parseFloat(tasa_bcv) || 1;
  const fechaStr = safeStr(fecha || new Date().toISOString(), 40);
  const numeroStr = safeStr(numero, 60);
  const notasStr = safeStr(notas, MAX_TEXT);
  const usuarioId = usuario?.id || null;

  const tx = db.transaction(() => {
    let totalUsd = 0;
    let totalBs = 0;

    const info = db.prepare(`
      INSERT INTO compras (proveedor_id, fecha, numero, tasa_bcv, total_bs, total_usd, estado, notas, usuario_id)
      VALUES (?, ?, ?, ?, 0, 0, 'recibida', ?, ?)
    `).run(proveedor_id || null, fechaStr, numeroStr, tasa, notasStr, usuarioId);

    const compraId = info.lastInsertRowid;

    const insertDet = db.prepare(`
      INSERT INTO compra_detalle (compra_id, producto_id, codigo, descripcion, cantidad, costo_usd, subtotal_bs, lote, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateProdStock = db.prepare('UPDATE productos SET stock = stock + ?, costo_usd = ? WHERE id = ?');

    for (const raw of items) {
      const codigo = safeStr(raw.codigo, 80);
      const cantidad = parseInt(raw.cantidad, 10) || 0;
      const costo = parseFloat(raw.costo_usd) || 0;
      const lote = safeStr(raw.lote, 80);
      const obs = safeStr(raw.observaciones, MAX_TEXT);

      if (!codigo || cantidad <= 0 || costo <= 0) {
        const err = new Error('Cada item requiere código, cantidad > 0 y costo_usd > 0');
        err.tipo = 'VALIDACION';
        throw err;
      }

      const prod = db.prepare('SELECT id, descripcion FROM productos WHERE codigo = ?').get(codigo);
      if (!prod) {
        const err = new Error(`Producto no encontrado para código ${codigo}`);
        err.tipo = 'VALIDACION';
        throw err;
      }

      const subtotalUsd = costo * cantidad;
      const subtotalBs = subtotalUsd * tasa;
      totalUsd += subtotalUsd;
      totalBs += subtotalBs;

      insertDet.run(
        compraId,
        prod.id,
        codigo,
        prod.descripcion,
        cantidad,
        costo,
        subtotalBs,
        lote,
        obs,
      );

      updateProdStock.run(cantidad, costo, prod.id);
    }

    db.prepare('UPDATE compras SET total_bs = ?, total_usd = ?, actualizado_en = datetime(\'now\') WHERE id = ?')
      .run(totalBs, totalUsd, compraId);

    return compraId;
  });

  const compraId = tx();
  return getCompra(compraId);
}

module.exports = {
  listCompras,
  getCompra,
  crearCompra,
};
