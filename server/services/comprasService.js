const db = require('../db');
const { appendEmpresaIdFilter } = require('./empresaUtils');

const { validationError } = require('./validationUtils');
const MAX_TEXT = 400;

function safeStr(v, max = MAX_TEXT) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function normalizeMarca(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().toUpperCase();
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

function listCompras({ limit = 100, proveedor_id, empresaId } = {}) {
  const params = [];
  const where = [];
  appendEmpresaIdFilter(where, params, { alias: 'c', empresaId });
  if (proveedor_id) {
    where.push('c.proveedor_id = ?');
    params.push(proveedor_id);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT c.*, p.nombre AS proveedor_nombre
    FROM compras c
    LEFT JOIN proveedores p ON p.id = c.proveedor_id
    ${whereSql}
    ORDER BY c.fecha DESC, c.id DESC
    LIMIT ?
  `).all(...params, limit);
  return rows.map(mapCompra);
}

function getCompra(id, empresaId) {
  const stmt = db.prepare(`
    SELECT c.*, p.nombre AS proveedor_nombre
    FROM compras c
    LEFT JOIN proveedores p ON p.id = c.proveedor_id
    WHERE c.id = ? ${empresaId ? 'AND c.empresa_id = ?' : ''}
  `);
  const cab = empresaId ? stmt.get(id, empresaId) : stmt.get(id);
  if (!cab) return null;
  const detalles = db.prepare(`
    SELECT d.*, pr.codigo AS producto_codigo_db, pr.descripcion AS producto_descripcion_db, pr.marca AS producto_marca_db
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
    throw validationError('Se requieren items para registrar una compra', 'COMPRA_SIN_ITEMS');
  }

  const tasa = parseFloat(tasa_bcv) || 1;
  const fechaStr = safeStr(fecha || new Date().toISOString(), 40);
  const numeroStr = safeStr(numero, 60);
  const notasStr = safeStr(notas, MAX_TEXT);
  const usuarioId = usuario?.id || null;
  const empresaId = usuario?.empresa_id || null;

  if (!empresaId) {
    throw validationError('Usuario sin empresa asociada', 'COMPRA_SIN_EMPRESA');
  }

  const tx = db.transaction(() => {
    let totalUsd = 0;
    let totalBs = 0;

    const info = db.prepare(`
      INSERT INTO compras (proveedor_id, fecha, numero, tasa_bcv, total_bs, total_usd, estado, notas, usuario_id, empresa_id)
      VALUES (?, ?, ?, ?, 0, 0, 'recibida', ?, ?, ?)
    `).run(proveedor_id || null, fechaStr, numeroStr, tasa, notasStr, usuarioId, empresaId);

    const compraId = info.lastInsertRowid;

    const insertDet = db.prepare(`
      INSERT INTO compra_detalle (compra_id, producto_id, codigo, descripcion, marca, cantidad, costo_usd, subtotal_bs, lote, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const selectProd = db.prepare('SELECT id, descripcion, marca, stock, deposito_id, empresa_id, costo_usd, precio_usd FROM productos WHERE codigo = ? AND empresa_id = ?');
    const selectStockDep = db.prepare(`
      SELECT cantidad FROM stock_por_deposito
      WHERE producto_id = ? AND deposito_id = ?
    `);
    const updateStockDepAdd = db.prepare(`
      UPDATE stock_por_deposito
      SET cantidad = cantidad + ?, actualizado_en = datetime('now')
      WHERE producto_id = ? AND deposito_id = ?
    `);
    const insertStockDep = db.prepare(`
      INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad)
      VALUES (?, ?, ?, ?)
    `);
    const selectStockDepMarca = db.prepare(`
      SELECT cantidad FROM stock_por_deposito_marca
      WHERE producto_id = ? AND deposito_id = ? AND marca = ?
    `);
    const updateStockDepMarcaAdd = db.prepare(`
      UPDATE stock_por_deposito_marca
      SET cantidad = cantidad + ?, actualizado_en = datetime('now')
      WHERE producto_id = ? AND deposito_id = ? AND marca = ?
    `);
    const insertStockDepMarca = db.prepare(`
      INSERT INTO stock_por_deposito_marca (empresa_id, producto_id, deposito_id, marca, cantidad)
      VALUES (?, ?, ?, ?, ?)
    `);
    const updateProdStock = db.prepare(`
      UPDATE productos
      SET stock = ?,
          costo_usd = ?,
          marca = COALESCE(NULLIF(?, ''), marca),
          precio_usd = COALESCE(?, precio_usd)
      WHERE id = ?
    `);

    for (const raw of items) {
      const codigo = safeStr(raw.codigo, 80);
      const cantidad = parseInt(raw.cantidad, 10) || 0;
      const lote = safeStr(raw.lote, 80);
      const obs = safeStr(raw.observaciones, MAX_TEXT);

      if (!codigo || cantidad <= 0) {
        throw validationError('Cada item requiere código y cantidad > 0', 'COMPRA_ITEM_CANTIDAD');
      }

      const prod = selectProd.get(codigo, empresaId);
      if (!prod) {
        throw validationError(`Producto no encontrado para código ${codigo}`, 'COMPRA_PRODUCTO_NO_ENCONTRADO');
      }

      // Si el costo viene null/undefined/"", usamos el costo anterior del producto
      const costoField = raw.costo_usd;
      let costo;
      if (costoField === null || costoField === undefined || costoField === '') {
        const costoProd = typeof prod.costo_usd === 'number' ? prod.costo_usd : 0;
        costo = costoProd || 0;
      } else {
        const costoParsed = parseFloat(costoField);
        costo = Number.isNaN(costoParsed) ? 0 : costoParsed;
      }

      if (costo < 0) {
        throw validationError('Cada item requiere código, cantidad > 0 y costo_usd >= 0', 'COMPRA_COSTO_INVALIDO');
      }

      // Precio de venta opcional: solo se actualiza si viene un valor
      const precioVentaField = raw.precio_venta_usd;
      let precioParaActualizar = null;
      if (precioVentaField !== null && precioVentaField !== undefined && precioVentaField !== '') {
        const precioParsed = parseFloat(precioVentaField);
        if (Number.isNaN(precioParsed) || precioParsed < 0) {
          throw validationError('El precio de venta debe ser >= 0 cuando se envía', 'COMPRA_PRECIO_VENTA_INVALIDO');
        }
        precioParaActualizar = precioParsed;
      }

      const marca = safeStr(raw.marca || prod.marca, 80);
      const marcaNorm = normalizeMarca(marca);
      const subtotalUsd = costo * cantidad;
      const subtotalBs = subtotalUsd * tasa;
      totalUsd += subtotalUsd;
      totalBs += subtotalBs;

      insertDet.run(
        compraId,
        prod.id,
        codigo,
        prod.descripcion,
        marca,
        cantidad,
        costo,
        subtotalBs,
        lote,
        obs,
      );

      // Actualizar stock total del producto y existencias en el depósito asignado
      const nuevoStockTotal = (prod.stock || 0) + cantidad;
      // Si el usuario no envió costo explícito, mantenemos el costo actual del producto
      const costoParaActualizar = (costoField === null || costoField === undefined || costoField === '')
        ? (typeof prod.costo_usd === 'number' ? prod.costo_usd : costo)
        : costo;
      updateProdStock.run(nuevoStockTotal, costoParaActualizar, marca, precioParaActualizar, prod.id);

      // Permitir que cada item de compra indique explícitamente el depósito destino.
      // Si no viene depósito en el payload, conservar el comportamiento anterior
      // usando el deposito_id del producto.
      const itemDepositoId = raw.deposito_id != null ? parseInt(raw.deposito_id, 10) || null : null;
      const depositoId = itemDepositoId || prod.deposito_id;
      if (depositoId) {
        const rowDep = selectStockDep.get(prod.id, depositoId);
        if (rowDep) {
          updateStockDepAdd.run(cantidad, prod.id, depositoId);
        } else {
          insertStockDep.run(prod.empresa_id || empresaId, prod.id, depositoId, cantidad);
        }

        // Actualizar desglose por marca dentro del depósito
        if (marcaNorm) {
          const rowDepMarca = selectStockDepMarca.get(prod.id, depositoId, marcaNorm);
          if (rowDepMarca) {
            updateStockDepMarcaAdd.run(cantidad, prod.id, depositoId, marcaNorm);
          } else {
            insertStockDepMarca.run(prod.empresa_id || empresaId, prod.id, depositoId, marcaNorm, cantidad);
          }
        }
      }
    }

    db.prepare('UPDATE compras SET total_bs = ?, total_usd = ?, actualizado_en = datetime(\'now\') WHERE id = ?')
      .run(totalBs, totalUsd, compraId);

    return compraId;
  });

  const compraId = tx();
  return getCompra(compraId, empresaId);
}

module.exports = {
  listCompras,
  getCompra,
  crearCompra,
};
