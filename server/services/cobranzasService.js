const db = require('../db');
// @ts-check

const MAX_TEXT = 120;
const MAX_DOC = 40;
const MAX_REF = 120;
const MAX_NOTAS = 400;

function safeStr(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function isValidDateString(val) {
  if (!val) return false;
  const d = new Date(val);
  return !Number.isNaN(d.getTime());
}

// Umbral para considerar una cuenta como saldada aunque quede
// una pequeña diferencia por redondeos (
// por ejemplo pagos en Bs convertidos a USD).
const SALDO_EPSILON = 0.01;

function computeEstado(row) {
  let saldo = Number(row.saldo_usd || 0);
  if (Math.abs(saldo) < SALDO_EPSILON) saldo = 0;
  const total = Number(row.total_usd || 0);
  const vencimiento = row.fecha_vencimiento ? new Date(row.fecha_vencimiento) : null;
  const hoy = new Date();
  let estado = 'pendiente';
  if (saldo <= 0.00001) estado = 'cancelado';
  else if (saldo < total) estado = 'parcial';
  if (estado !== 'cancelado' && vencimiento && vencimiento < hoy) estado = 'vencido';
  return estado;
}

function mapCuenta(row) {
  const estado_calc = computeEstado(row);
  let dias_mora = 0;
  if (row.fecha_vencimiento) {
    const fv = new Date(row.fecha_vencimiento);
    const hoy = new Date();
    if (!Number.isNaN(fv.getTime())) {
      const diffMs = hoy.getTime() - fv.getTime();
      if (diffMs > 0) {
        dias_mora = Math.floor(diffMs / 86400000);
        if (dias_mora < 0) dias_mora = 0;
      }
    }
  }
  return { ...row, estado_calc, dias_mora };
}

/**
 * Devuelve un resumen agregado de cuentas por cobrar agrupadas por estado,
 * filtrado por empresa vía la venta asociada cuando aplica y, opcionalmente,
 * por rango de fecha de vencimiento.
 * @param {number|null} empresaId
 * @param {{desde_venc?:string,hasta_venc?:string}} [filtros]
 * @returns {Array<{estado:string,cantidad:number,saldo_usd:number}>}
 */
function getResumenCuentas(empresaId, { desde_venc, hasta_venc } = {}) {
  const where = [];
  const params = [];

  if (empresaId == null) {
    // Instalación mononegocio o sin multiempresa activo
    // Filtro por rango de fecha de VENCIMIENTO, no de emisión
    if (desde_venc) { where.push('date(fecha_vencimiento) >= date(?)'); params.push(desde_venc); }
    if (hasta_venc) { where.push('date(fecha_vencimiento) <= date(?)'); params.push(hasta_venc); }
    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(`
        SELECT estado, COUNT(*) as cantidad, SUM(saldo_usd) as saldo_usd
        FROM cuentas_cobrar
        ${whereSQL}
        GROUP BY estado
      `).all(...params);
    return rows;
  }

  // Filtro por rango de fecha de VENCIMIENTO, no de emisión
  if (desde_venc) { where.push('date(cc.fecha_vencimiento) >= date(?)'); params.push(desde_venc); }
  if (hasta_venc) { where.push('date(cc.fecha_vencimiento) <= date(?)'); params.push(hasta_venc); }
  where.push('cc.venta_id IS NOT NULL');
  where.push('u.empresa_id = ?');
  params.push(empresaId);
  const whereSQL = 'WHERE ' + where.join(' AND ');

  const rows = db.prepare(`
      SELECT cc.estado, COUNT(*) as cantidad, SUM(cc.saldo_usd) as saldo_usd
      FROM cuentas_cobrar cc
      LEFT JOIN ventas v ON v.id = cc.venta_id
      LEFT JOIN usuarios u ON u.id = v.usuario_id
      ${whereSQL}
      GROUP BY cc.estado
    `).all(...params);
  return rows;
}

/**
 * Lista cuentas por cobrar aplicando filtros opcionales por cliente,
 * estado, rango de días de mora y rango de fecha de vencimiento.
 *
 * @param {{cliente?:string,estado?:string,mora_min?:number|string,mora_max?:number|string,desde_venc?:string,hasta_venc?:string,empresaId?:number|null}} [filtros]
 * @returns {import('../types').CuentaPorCobrar[]}
 */
function listCuentas({ cliente, estado, mora_min, mora_max, desde_venc, hasta_venc, empresaId } = {}) {
  const hasCliente = !!(cliente && String(cliente).trim());
  const lc = hasCliente ? String(cliente).trim().toLowerCase() : null;
  const where = [];
  const params = [];

  // Filtros comunes por fecha de vencimiento y cliente se aplican en SQL
  if (desde_venc) {
    where.push('date(cc.fecha_vencimiento) >= date(?)');
    params.push(desde_venc);
  }
  if (hasta_venc) {
    where.push('date(cc.fecha_vencimiento) <= date(?)');
    params.push(hasta_venc);
  }
  if (hasCliente && lc) {
    where.push('(LOWER(cc.cliente_nombre) LIKE ? OR LOWER(cc.cliente_doc) LIKE ?)');
    const like = `%${lc}%`;
    params.push(like, like);
  }

  let rows;
  if (empresaId == null) {
    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
    rows = db.prepare(`
        SELECT cc.*,
          CASE WHEN cc.venta_id IS NOT NULL THEN cc.venta_id ELSE NULL END AS nro_seq
        FROM cuentas_cobrar cc
        ${whereSQL}
        ORDER BY date(cc.fecha_vencimiento) ASC, cc.id ASC
      `).all(...params);
  } else {
    // Multiempresa: restringir por empresa y ventas asociadas, más filtros de fecha/cliente
    const whereEmpresa = ['cc.venta_id IS NOT NULL', 'u.empresa_id = ?'];
    const paramsEmpresa = [empresaId];
    const whereAll = whereEmpresa.concat(where);
    const paramsAll = paramsEmpresa.concat(params);
    const whereSQL = 'WHERE ' + whereAll.join(' AND ');

    rows = db.prepare(`
        SELECT cc.*,
          CASE WHEN cc.venta_id IS NOT NULL THEN (
            SELECT COUNT(*) FROM ventas v2
            JOIN usuarios u2 ON u2.id = v2.usuario_id
            WHERE u2.empresa_id = ? AND v2.id <= cc.venta_id
          ) ELSE NULL END AS nro_seq
        FROM cuentas_cobrar cc
        LEFT JOIN ventas v ON v.id = cc.venta_id
        LEFT JOIN usuarios u ON u.id = v.usuario_id
        ${whereSQL}
        ORDER BY date(cc.fecha_vencimiento) ASC, cc.id ASC
      `).all(empresaId, ...paramsAll);
  }

  // Normalizar estado calculado y número de nota amigable
  rows = rows.map((row) => {
    const mapped = mapCuenta(row);
    if (row.nro_seq && Number(row.nro_seq) > 0) {
      mapped.nro_nota = `VENTA-${Number(row.nro_seq)}`;
    } else if (!empresaId && row.venta_id != null) {
      mapped.nro_nota = `VENTA-${row.venta_id}`;
    }
    return mapped;
  });

  if (estado) {
    rows = rows.filter(r => r.estado_calc === estado);
  }
  const min = mora_min !== undefined && mora_min !== '' ? Number(mora_min) : null;
  const max = mora_max !== undefined && mora_max !== '' ? Number(mora_max) : null;
  if (min !== null && Number.isFinite(min)) {
    rows = rows.filter(r => Number(r.dias_mora || 0) >= min);
  }
  if (max !== null && Number.isFinite(max)) {
    rows = rows.filter(r => Number(r.dias_mora || 0) <= max);
  }
  return rows;
}

/**
 * Obtiene una cuenta por cobrar y su historial de pagos.
 * @param {number|string} id
 * @param {number|null} empresaId
 * @returns {{cuenta: import('../types').CuentaPorCobrar, pagos: import('../types').PagoCuentaCobrar[]}|null}
 */
function getCuentaConPagos(id, empresaId) {
  const cuenta = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(id);
  if (!cuenta) return null;

  if (empresaId != null) {
    if (!cuenta.venta_id) {
      return null;
    }
    const venta = db.prepare('SELECT v.usuario_id, u.empresa_id FROM ventas v JOIN usuarios u ON u.id = v.usuario_id WHERE v.id = ?').get(cuenta.venta_id);
    if (!venta || venta.empresa_id !== empresaId) {
      return null;
    }
  }

  const pagos = db.prepare('SELECT * FROM pagos_cc WHERE cuenta_id = ? ORDER BY date(fecha) DESC, id DESC').all(id);

  let items = [];
  if (cuenta.venta_id) {
    items = db.prepare(`
     SELECT vd.id, vd.producto_id,
       p.codigo AS codigo,
       p.descripcion AS descripcion,
       vd.cantidad, vd.precio_usd, vd.subtotal_bs
        FROM venta_detalle vd
        LEFT JOIN productos p ON p.id = vd.producto_id
        WHERE vd.venta_id = ?
        ORDER BY vd.id ASC
      `).all(cuenta.venta_id);
  }

  return { cuenta: mapCuenta(cuenta), pagos, items };
}

/**
 * Crea una nueva cuenta por cobrar a partir de los datos de una venta
 * o de un saldo pendiente manual.
 *
 * @param {{cliente_nombre?:string,cliente_doc?:string,venta_id?:number,total_usd:number,tasa_bcv?:number,fecha_vencimiento?:string,notas?:string,empresaId?:number|null}} payload
 * @returns {import('../types').CuentaPorCobrar}
 */
function crearCuenta(payload = {}) {
  const {
    cliente_nombre,
    cliente_doc,
    venta_id,
    total_usd,
    tasa_bcv,
    fecha_vencimiento,
    notas,
    empresaId,
  } = payload;

  const total = Number(total_usd || 0);
  if (!total || Number.isNaN(total) || total <= 0) {
    throw new Error('Total inválido');
  }
  const tasa = Number(tasa_bcv || 1) || 1;
  if (!Number.isFinite(tasa) || tasa <= 0 || tasa > 1e9) {
    throw new Error('Tasa inválida');
  }
  if (fecha_vencimiento && !isValidDateString(fecha_vencimiento)) {
    throw new Error('Fecha de vencimiento inválida');
  }

  const hoy = new Date();
  const fv = fecha_vencimiento ? new Date(fecha_vencimiento) : new Date(hoy.getTime() + 21 * 24 * 3600 * 1000);
  const fvISO = fv.toISOString().slice(0, 10);
  const nombreSafe = safeStr(cliente_nombre || 'Cliente', MAX_TEXT);
  const docSafe = safeStr(cliente_doc || '', MAX_DOC);
  const notasSafe = safeStr(notas || '', MAX_NOTAS);

  const stmt = db.prepare(`
      INSERT INTO cuentas_cobrar (cliente_nombre, cliente_doc, venta_id, total_usd, tasa_bcv, saldo_usd, fecha_emision, fecha_vencimiento, estado, notas, creado_en, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, datetime('now'), datetime('now'))
    `);

  const info = stmt.run(nombreSafe, docSafe, venta_id || null, total, tasa, total, hoy.toISOString(), fvISO, notasSafe);
  const creada = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(info.lastInsertRowid);
  return mapCuenta(creada);
}

/**
 * Registra un pago contra una cuenta por cobrar existente.
 *
 * @param {number|string} id
 * @param {number|null} empresaId
 * @param {{monto:number,moneda?:"USD"|"BS",tasa_bcv?:number,metodo?:string,referencia?:string,notas?:string,usuario?:string}} payload
 * @returns {{cuenta: import('../types').CuentaPorCobrar, pagos: import('../types').PagoCuentaCobrar[]}|null}
 */
function registrarPago(id, empresaId, payload = {}) {
  const cuenta = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(id);
  if (!cuenta) return null;

  if (empresaId != null) {
    if (!cuenta.venta_id) {
      return null;
    }
    const venta = db.prepare('SELECT v.usuario_id, u.empresa_id FROM ventas v JOIN usuarios u ON u.id = v.usuario_id WHERE v.id = ?').get(cuenta.venta_id);
    if (!venta || venta.empresa_id !== empresaId) {
      return null;
    }
  }

  const { monto, moneda = 'USD', tasa_bcv, metodo, referencia, notas, usuario } = payload;
  const m = Number(monto || 0);
  if (!m || Number.isNaN(m) || m <= 0) {
    throw new Error('Monto inválido');
  }
  if (!['USD', 'BS'].includes(moneda)) {
    throw new Error('Moneda inválida');
  }
  const tasa = Number(tasa_bcv || cuenta.tasa_bcv || 1) || 1;
  if (!Number.isFinite(tasa) || tasa <= 0 || tasa > 1e9) {
    throw new Error('Tasa inválida');
  }

  const monto_usd = moneda === 'BS' ? m / tasa : m;
  const fecha = new Date().toISOString();
  const metodoSafe = safeStr(metodo || '', MAX_TEXT);
  const referenciaSafe = safeStr(referencia || '', MAX_REF);
  const notasSafe = safeStr(notas || '', MAX_NOTAS);
  const usuarioSafe = safeStr(usuario || '', MAX_TEXT);

  db.prepare(`
      INSERT INTO pagos_cc (cuenta_id, fecha, monto_usd, moneda, tasa_bcv, monto_moneda, metodo, referencia, notas, usuario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cuenta.id, fecha, monto_usd, moneda, tasa, m, metodoSafe || null, referenciaSafe || null, notasSafe || null, usuarioSafe || null);

  const saldoActual = Number(cuenta.saldo_usd || 0);
  let nuevoSaldo = saldoActual - monto_usd;
  // Ajustar por redondeos: si el saldo queda muy cercano a 0,
  // considerarlo cancelado y guardar 0 exacto.
  if (Math.abs(nuevoSaldo) < SALDO_EPSILON) {
    nuevoSaldo = 0;
  }
  if (nuevoSaldo < 0) nuevoSaldo = 0;
  const estado = computeEstado({ ...cuenta, saldo_usd: nuevoSaldo });
  db.prepare('UPDATE cuentas_cobrar SET saldo_usd = ?, estado = ?, actualizado_en = ? WHERE id = ?')
    .run(nuevoSaldo, estado, fecha, cuenta.id);

  const updated = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(cuenta.id);
  const pagos = db.prepare('SELECT * FROM pagos_cc WHERE cuenta_id = ? ORDER BY date(fecha) DESC, id DESC').all(cuenta.id);
  return { cuenta: mapCuenta(updated), pagos };
}

/**
 * Actualiza campos básicos de una cuenta por cobrar (fecha de vencimiento,
 * notas y estado) con validaciones mínimas.
 *
 * @param {number|string} id
 * @param {number|null} empresaId
 * @param {{fecha_vencimiento?:string,notas?:string,estado?:string}} payload
 * @returns {import('../types').CuentaPorCobrar|null}
 */
function actualizarCuenta(id, empresaId, payload = {}) {
  const { fecha_vencimiento, notas, estado } = payload;
  const cuenta = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(id);
  if (!cuenta) return null;

  if (empresaId != null) {
    if (!cuenta.venta_id) {
      return null;
    }
    const venta = db.prepare('SELECT v.usuario_id, u.empresa_id FROM ventas v JOIN usuarios u ON u.id = v.usuario_id WHERE v.id = ?').get(cuenta.venta_id);
    if (!venta || venta.empresa_id !== empresaId) {
      return null;
    }
  }

  if (fecha_vencimiento && !isValidDateString(fecha_vencimiento)) {
    throw new Error('Fecha inválida');
  }
  const fv = fecha_vencimiento ? new Date(fecha_vencimiento).toISOString().slice(0, 10) : cuenta.fecha_vencimiento;
  const est = estado || cuenta.estado;
  if (!['pendiente', 'parcial', 'cancelado', 'vencido'].includes(est)) {
    throw new Error('Estado inválido');
  }
  const notasSafe = safeStr(notas ?? cuenta.notas, MAX_NOTAS);

  db.prepare('UPDATE cuentas_cobrar SET fecha_vencimiento = ?, notas = ?, estado = ?, actualizado_en = datetime("now") WHERE id = ?')
    .run(fv, notasSafe, est, cuenta.id);

  const updated = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(cuenta.id);
  return mapCuenta(updated);
}

module.exports = {
  getResumenCuentas,
  listCuentas,
  getCuentaConPagos,
  crearCuenta,
  registrarPago,
  actualizarCuenta,
};
