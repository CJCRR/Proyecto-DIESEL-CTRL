const db = require('../db');
// @ts-check

// Helpers internos

function classifyABC(rows, valueKey, aThresh = 0.8, bThresh = 0.95) {
  const total = rows.reduce((s, r) => s + Number(r[valueKey] || 0), 0);
  let acc = 0;
  return rows.map((r) => {
    const val = Number(r[valueKey] || 0);
    acc += val;
    const share = total ? val / total : 0;
    const cumulative = total ? acc / total : 0;
    const clase = cumulative <= aThresh ? 'A' : cumulative <= bThresh ? 'B' : 'C';
    return { ...r, share, cumulative, clase };
  });
}

function parseAB({ a_pct, b_pct }) {
  const toFrac = (v, def) => {
    let n = parseFloat(v);
    if (Number.isNaN(n)) return def;
    if (n > 1) n = n / 100; // permitir 80/95
    return Math.min(Math.max(n, 0.5), 0.99);
  };
  let a = toFrac(a_pct, 0.8);
  let b = toFrac(b_pct, 0.95);
  if (b <= a) b = Math.min(0.99, a + 0.05);
  return { a, b };
}

/**
 * Añade filtros de fecha comunes sobre un alias de tabla de ventas.
 * Modifica in-place los arrays `where` y `params`.
 *
 * @param {string[]} where
 * @param {Array<string|number>} params
 * @param {{desde?:string,hasta?:string,alias?:string,campo?:string}} opts
 */
function appendFechaFilters(where, params, { desde, hasta, alias = 'v', campo = 'fecha' } = {}) {
  if (desde) { where.push(`date(${alias}.${campo}) >= date(?)`); params.push(desde); }
  if (hasta) { where.push(`date(${alias}.${campo}) <= date(?)`); params.push(hasta); }
}

/**
 * Añade filtro por empresa sobre una tabla de ventas aliased como `alias`.
 * Espera que ventas.usuario_id apunte a usuarios.id.
 *
 * @param {string[]} where
 * @param {Array<string|number>} params
 * @param {{alias?:string,empresaId?:number|null}} opts
 */
function appendEmpresaFilter(where, params, { alias = 'v', empresaId } = {}) {
  if (empresaId !== undefined && empresaId !== null) {
    where.push(`EXISTS (SELECT 1 FROM usuarios u WHERE u.id = ${alias}.usuario_id AND u.empresa_id = ?)`);
    params.push(empresaId);
  }
}

function queryVentasRango({ desde, hasta, cliente, vendedor, metodo, limit = 500, empresaId }) {
  const where = [];
  const params = [];
  appendFechaFilters(where, params, { desde, hasta, alias: 'v', campo: 'fecha' });
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  if (cliente) { where.push("(v.cliente LIKE ? OR v.cedula LIKE ? OR v.telefono LIKE ?)"); params.push('%' + cliente + '%', '%' + cliente + '%', '%' + cliente + '%'); }
  if (vendedor) { where.push("v.vendedor LIKE ?"); params.push('%' + vendedor + '%'); }
  if (metodo) { where.push("v.metodo_pago = ?"); params.push(metodo); }
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const rows = db.prepare(`
    SELECT v.id, v.fecha, v.cliente, v.vendedor, v.metodo_pago, v.referencia,
           v.tasa_bcv, v.descuento, v.iva_pct, v.total_bs_iva, v.total_usd_iva,
           COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), v.total_bs, 0) AS total_bs,
           COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) / NULLIF(v.tasa_bcv,0),
                    SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),
                    v.total_bs) AS total_usd,
           COALESCE(SUM(vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)), 0) AS bruto_bs,
           COALESCE(SUM(vd.precio_usd * vd.cantidad), 0) AS bruto_usd,
           COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)), 0) AS costo_bs,
           COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad), 0) AS costo_usd,
           COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), v.total_bs, 0)
             - COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)), 0) AS margen_bs,
           COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) / NULLIF(v.tasa_bcv,0),
                    SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),
                    v.total_bs) - COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad),0) AS margen_usd
    FROM ventas v
    JOIN venta_detalle vd ON vd.venta_id = v.id
    JOIN productos p ON p.id = vd.producto_id
    ${whereSQL}
    GROUP BY v.id
    ORDER BY v.fecha DESC
    LIMIT ?
  `).all(...params, limit);

  return rows.map((r) => {
    const tasa = Number(r.tasa_bcv || 0) || 0;
    const baseBs = Number(r.total_bs || 0);
    const baseUsd = r.total_usd != null
      ? Number(r.total_usd)
      : (tasa ? baseBs / tasa : baseBs);
    const ivaPct = Number(r.iva_pct || 0) || 0;
    const hasStoredIva = r.total_bs_iva != null && r.total_usd_iva != null && (Number(r.total_bs_iva) !== 0 || Number(r.total_usd_iva) !== 0);
    const totalBsIva = hasStoredIva ? Number(r.total_bs_iva) : baseBs;
    const totalUsdIva = hasStoredIva ? Number(r.total_usd_iva) : baseUsd;
    return {
      ...r,
      iva_pct: ivaPct,
      total_bs_iva: totalBsIva,
      total_usd_iva: totalUsdIva,
    };
  });
}

/**
 * Devuelve las últimas ventas que no tienen devoluciones asociadas, con
 * totales normalizados (incluyendo IVA cuando está disponible).
 * @returns {Array<import('../types').Venta>}
 */
function getVentasSinDevolucion(empresaId) {
  const where = [];
  const params = [];
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  where.push('NOT EXISTS (SELECT 1 FROM devoluciones d WHERE d.venta_original_id = v.id)');
  const whereSQL = 'WHERE ' + where.join(' AND ');

  const rows = db.prepare(`
    SELECT v.id, v.fecha, v.cliente, v.vendedor, v.cedula, v.telefono,
           v.total_bs, v.tasa_bcv, v.descuento, v.metodo_pago, v.referencia,
           v.iva_pct, v.total_bs_iva, v.total_usd_iva
    FROM ventas v
    ${whereSQL}
    ORDER BY v.fecha DESC
    LIMIT 100
  `).all(...params);

  return rows.map((v) => {
    const tasa = Number(v.tasa_bcv || 0) || 0;
    const baseBs = Number(v.total_bs || 0);
    const baseUsd = tasa ? baseBs / tasa : baseBs;
    const ivaPct = Number(v.iva_pct || 0) || 0;
    const hasStoredIva = v.total_bs_iva != null && v.total_usd_iva != null && (Number(v.total_bs_iva) !== 0 || Number(v.total_usd_iva) !== 0);
    const totalBsIva = hasStoredIva ? Number(v.total_bs_iva) : baseBs;
    const totalUsdIva = hasStoredIva ? Number(v.total_usd_iva) : baseUsd;
    return {
      ...v,
      iva_pct: ivaPct,
      total_bs_iva: totalBsIva,
      total_usd_iva: totalUsdIva,
    };
  });
}

/**
 * Obtiene ventas agregadas por cabecera en un rango de fechas, con filtros
 * opcionales por cliente, vendedor y método de pago.
 *
 * @param {{desde?:string,hasta?:string,cliente?:string,vendedor?:string,metodo?:string,limit?:number}} params
 * @returns {Array<import('../types').Venta>}
 */
function getVentasRango(params, empresaId) {
  return queryVentasRango({ ...params, empresaId });
}

/**
 * Construye un CSV (separado por `;`) a partir del resultado de ventas rango.
 * La primera línea incluye encabezados y el archivo agrega BOM UTF-8.
 *
 * @param {{desde?:string,hasta?:string,cliente?:string,vendedor?:string,metodo?:string,limit?:number}} params
 * @returns {string}
 */
function buildVentasRangoCsv(params, empresaId) {
  const rows = queryVentasRango({ ...params, empresaId });
  const header = ['fecha','cliente','vendedor','metodo_pago','referencia','tasa_bcv','descuento','total_bs','total_bs_iva','total_usd','total_usd_iva','bruto_bs','bruto_usd','costo_bs','costo_usd','margen_bs','margen_usd'];
  const toCsv = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (/[",\n\r;]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const lines = rows.map(r => header.map(h => toCsv(r[h])).join(';'));
  const csv = '\uFEFF' + header.join(';') + '\r\n' + lines.join('\r\n');
  return csv;
}

/**
 * KPIs simples de ventas para el dashboard: cantidad de ventas de hoy,
 * de la última semana y montos totales aproximados en Bs y USD.
 * @returns {{ventasHoy:number,ventasSemana:number,totalBs:number,totalUsd:number}}
 */
function getKpis(empresaId) {
  const where = [];
  const params = [];
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('AND ' + where.join(' AND ')) : '';

  const ventasHoyRow = db.prepare(`
      SELECT COUNT(*) as count FROM ventas v
      WHERE date(v.fecha) = date('now','localtime') ${whereSQL ? whereSQL.replace('AND ', 'AND ') : ''}
    `).get(...params);

  const ventasSemanaRow = db.prepare(`
      SELECT COUNT(*) as count FROM ventas v
      WHERE date(v.fecha) >= date('now','localtime','-6 days') ${whereSQL ? whereSQL.replace('AND ', 'AND ') : ''}
    `).get(...params);

  const totalWhere = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const totalBsRow = db.prepare(`
      SELECT COALESCE(SUM(v.total_bs), 0) as total_bs FROM ventas v
      ${totalWhere}
    `).get(...params);

  const totalUsdRow = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN COALESCE(v.tasa_bcv,0) != 0 THEN v.total_bs / v.tasa_bcv ELSE v.total_bs END), 0) as total_usd FROM ventas v
      ${totalWhere}
    `).get(...params);

  return {
    ventasHoy: ventasHoyRow.count || 0,
    ventasSemana: ventasSemanaRow.count || 0,
    totalBs: totalBsRow.total_bs || 0,
    totalUsd: totalUsdRow.total_usd || 0,
  };
}

/**
 * Top de productos por cantidad vendida.
 * @param {number} limit
 * @returns {Array<{codigo:string,descripcion:string,total_qty:number,total_bs:number,total_usd:number,costo_bs:number,costo_usd:number,margen_bs:number,margen_usd:number}>}
 */
function getTopProductos(limit, empresaId) {
  const where = [];
  const params = [];
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  return db.prepare(`
      SELECT p.codigo, p.descripcion,
        SUM(vd.cantidad) as total_qty,
        COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0) as total_bs,
        COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)))/NULLIF(v.tasa_bcv,0),
                 SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0) as total_usd,
        COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)),0) as costo_bs,
        COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad),0) as costo_usd,
        COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0)
          - COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)),0) as margen_bs,
        COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)))/NULLIF(v.tasa_bcv,0),
                 SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0)
          - COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad),0) as margen_usd
      FROM venta_detalle vd
      JOIN ventas v ON v.id = vd.venta_id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY p.id
      ORDER BY total_qty DESC
      LIMIT ?
    `).all(...params, limit);
}

/**
 * Ranking de productos ordenados por margen bruto en USD en un rango opcional.
 * @param {{desde?:string,hasta?:string,limit:number}} params
 * @returns {Array<{codigo:string,descripcion:string,total_qty:number,total_bs:number,total_usd:number,costo_bs:number,costo_usd:number,margen_bs:number,margen_usd:number}>}
 */
function getMargenProductos({ desde, hasta, limit, empresaId }) {
  const where = [];
  const params = [];
  appendFechaFilters(where, params, { desde, hasta, alias: 'v', campo: 'fecha' });
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  return db.prepare(`
      SELECT p.codigo, p.descripcion,
        SUM(vd.cantidad) AS total_qty,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costo_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad) AS costo_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM venta_detalle vd
      JOIN ventas v ON v.id = vd.venta_id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY p.id
      ORDER BY margen_usd DESC
      LIMIT ?
    `).all(...params, limit);
}

/**
 * Clasificación ABC de productos según su facturación en USD.
 * @param {{desde?:string,hasta?:string,a_pct?:number|string,b_pct?:number|string}} params
 * @returns {Array<{codigo:string,descripcion:string,total_qty:number,total_bs:number,total_usd:number,share:number,cumulative:number,clase:"A"|"B"|"C">>}
 */
function getAbcProductos({ desde, hasta, a_pct, b_pct, empresaId }) {
  const { a, b } = parseAB({ a_pct, b_pct });
  const where = [];
  const params = [];
  appendFechaFilters(where, params, { desde, hasta, alias: 'v', campo: 'fecha' });
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const rows = db.prepare(`
      SELECT p.codigo, p.descripcion,
        SUM(vd.cantidad) AS total_qty,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd
      FROM venta_detalle vd
      JOIN ventas v ON v.id = vd.venta_id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY p.id
      ORDER BY total_usd DESC
    `).all(...params);

  return classifyABC(rows, 'total_usd', a, b);
}

/**
 * Reporte resumido de inventario con totales en USD y Bs usando una tasa
 * de cambio derivada de la configuración o de la última venta.
 *
 * @returns {{items:Array<{codigo:string,descripcion:string,precio_usd:number,stock:number,total_usd:number}>,totals:{totalUsd:number,totalBs:number,tasa:number}}}
 */
function getInventario(empresaId) {
  const cfgTasaRow = db.prepare(`SELECT valor FROM config WHERE clave='tasa_bcv'`).get();
  const cfgTasa = cfgTasaRow && cfgTasaRow.valor ? parseFloat(cfgTasaRow.valor) : null;
  const ventaTasaRow = db.prepare(`SELECT tasa_bcv FROM ventas WHERE tasa_bcv IS NOT NULL ORDER BY fecha DESC LIMIT 1`).get();
  const ventaTasa = ventaTasaRow && ventaTasaRow.tasa_bcv ? ventaTasaRow.tasa_bcv : null;
  const tasa = (!Number.isNaN(cfgTasa) && cfgTasa > 0)
      ? cfgTasa
      : (!Number.isNaN(ventaTasa) && ventaTasa > 0 ? ventaTasa : 1);

  const params = [];
  let where = '';
  if (empresaId) {
    where = 'WHERE empresa_id = ?';
    params.push(empresaId);
  }

  const productos = db.prepare(`
      SELECT codigo, descripcion, precio_usd, stock, (stock * COALESCE(precio_usd,0)) as total_usd
      FROM productos
      ${where}
      ORDER BY codigo
    `).all(...params);

  const totalUsd = productos.reduce((s,p) => s + (p.total_usd || 0), 0);
  const totalBs = totalUsd * tasa;

  return { items: productos, totals: { totalUsd, totalBs, tasa } };
}

/**
 * Devuelve una venta específica junto con su lista de detalles.
 * @param {number|string} id
 * @returns {{venta: import('../types').Venta, detalles: import('../types').VentaDetalle[]}|null}
 */
function getVentaConDetalles(id, empresaId) {
  const where = [];
  const params = [id];
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('AND ' + where.join(' AND ')) : '';

  const venta = db.prepare(`
    SELECT v.* FROM ventas v WHERE v.id = ? ${whereSQL}
  `).get(...params);

  if (!venta) return null;

  const detalles = db.prepare(`
    SELECT p.codigo, p.descripcion, vd.cantidad, vd.precio_usd, vd.subtotal_bs
    FROM venta_detalle vd
    JOIN productos p ON p.id = vd.producto_id
    WHERE vd.venta_id = ?
  `).all(id);

  return { venta, detalles };
}

function getBajoStock(umbral) {
  const override = parseInt(umbral);
  const row = db.prepare(`SELECT valor FROM config WHERE clave='stock_minimo'`).get();
  const conf = row && row.valor ? parseInt(row.valor) : 3;
  const min = Number.isFinite(override) ? Math.max(0, override) : conf;
  const items = db.prepare(`
      SELECT codigo, descripcion, stock, precio_usd,
             (COALESCE(precio_usd,0) * stock) AS total_usd
      FROM productos
      WHERE CAST(stock AS INTEGER) <= ?
      ORDER BY CAST(stock AS INTEGER) ASC, codigo
      LIMIT 100
    `).all(min);
  return { min, items };
}

function getSeriesVentasDiarias(dias, empresaId) {
  const where = [];
  const params = [];
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  where.push("date(v.fecha) >= date('now','localtime', ?)");
  const whereSQL = 'WHERE ' + where.join(' AND ');

  return db.prepare(`
      SELECT date(v.fecha) AS dia,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY dia
      ORDER BY dia ASC
    `).all(...params, `-${dias-1} days`);
}

function getSeriesVentasMensuales(meses, empresaId) {
  const where = [];
  const params = [];
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  where.push("date(v.fecha) >= date('now','localtime', ?)");
  const whereSQL = 'WHERE ' + where.join(' AND ');

  return db.prepare(`
      SELECT strftime('%Y-%m', v.fecha) AS mes,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY mes
      ORDER BY mes ASC
    `).all(...params, `-${meses*30} days`);
}

function getTendenciasMensuales(meses, empresaId) {
  const rows = getSeriesVentasMensuales(meses, empresaId);
  const enhanced = rows.map((row, idx) => {
    const prev = idx > 0 ? rows[idx - 1] : null;
    const delta = (curr, prevVal) => {
      const c = Number(curr || 0);
      const p = Number(prevVal || 0);
      const abs = c - p;
      const pct = p !== 0 ? abs / p : null;
      return { abs, pct };
    };
    return {
      ...row,
      delta_total_usd: delta(row.total_usd, prev?.total_usd),
      delta_margen_usd: delta(row.margen_usd, prev?.margen_usd),
    };
  });
  return enhanced;
}

function getTopClientes({ desde, hasta, limit, empresaId }) {
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  return db.prepare(`
      SELECT COALESCE(v.cliente, 'Sin nombre') AS cliente,
        COUNT(DISTINCT v.id) AS ventas,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      ${whereSQL}
      GROUP BY cliente
      ORDER BY total_usd DESC
      LIMIT ?
    `).all(...params, limit);
}

function getAbcClientes({ desde, hasta, a_pct, b_pct, empresaId }) {
  const { a, b } = parseAB({ a_pct, b_pct });
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const rows = db.prepare(`
      SELECT COALESCE(v.cliente, 'Sin nombre') AS cliente,
        COUNT(DISTINCT v.id) AS ventas,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      ${whereSQL}
      GROUP BY cliente
      ORDER BY total_usd DESC
    `).all(...params);

  return classifyABC(rows, 'total_usd', a, b);
}

function getVendedoresComparativa({ desde, hasta, empresaId }) {
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  return db.prepare(`
      SELECT COALESCE(v.vendedor, '—') AS vendedor,
        COUNT(DISTINCT v.id) AS ventas,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS total_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS total_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY vendedor
      ORDER BY total_usd DESC
      LIMIT 50
    `).all(...params);
}

function getVendedoresRoi({ desde, hasta, empresaId }) {
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const rows = db.prepare(`
      SELECT COALESCE(v.vendedor, '—') AS vendedor,
        COUNT(DISTINCT v.id) AS ventas,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad) AS costos_usd,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS margen_bs,
        SUM((vd.precio_usd - COALESCE(vd.costo_usd, p.costo_usd, 0)) * vd.cantidad) AS margen_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY vendedor
      ORDER BY ingresos_usd DESC
      LIMIT 100
    `).all(...params);

  return rows.map((r) => {
    const ingresos = Number(r.ingresos_usd || 0);
    const margen = Number(r.margen_usd || 0);
    const costos = Number(r.costos_usd || 0);
    return {
      ...r,
      margen_pct: ingresos !== 0 ? margen / ingresos : null,
      roi: costos !== 0 ? margen / costos : null,
    };
  });
}

function getMargenActual(empresaId) {
  const where = [];
  const params = [];
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  where.push("date(v.fecha) = date('now','localtime')");
  const whereSQLHoy = 'WHERE ' + where.join(' AND ');

  const hoy = db.prepare(`
      SELECT 
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad) AS costos_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQLHoy}
    `).get(...params);

  const whereMes = [];
  const paramsMes = [];
  appendEmpresaFilter(whereMes, paramsMes, { alias: 'v', empresaId });
  whereMes.push("strftime('%Y-%m', v.fecha) = strftime('%Y-%m', 'now','localtime')");
  const whereSQLMes = 'WHERE ' + whereMes.join(' AND ');

  const mes = db.prepare(`
      SELECT 
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad) AS costos_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQLMes}
    `).get(...paramsMes);

  const calc = (x) => ({
    ingresos_bs: Number(x.ingresos_bs || 0),
    ingresos_usd: Number(x.ingresos_usd || 0),
    costos_bs: Number(x.costos_bs || 0),
    costos_usd: Number(x.costos_usd || 0),
    margen_bs: Number((x.ingresos_bs || 0) - (x.costos_bs || 0)),
    margen_usd: Number((x.ingresos_usd || 0) - (x.costos_usd || 0)),
  });

  return { hoy: calc(hoy || {}), mes: calc(mes || {}) };
}

function getVendedoresRanking({ desde, hasta, empresaId }) {
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const rows = db.prepare(`
      SELECT COALESCE(v.vendedor, '—') as vendedor,
             COUNT(DISTINCT v.id) as ventas,
             COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), 0) as total_bs,
             COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)))/NULLIF(v.tasa_bcv,0),
                      SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))),0) as total_usd,
             COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)),0) as costo_bs,
             COALESCE(SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad),0) as costo_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY vendedor
      ORDER BY total_usd DESC
      LIMIT 100
    `).all(...params);

  return rows.map(r => ({
    ...r,
    margen_bs: Number(r.total_bs || 0) - Number(r.costo_bs || 0),
    margen_usd: Number(r.total_usd || 0) - Number(r.costo_usd || 0),
  }));
}

function getHistorialCliente({ q, limit, empresaId }) {
  if (!q || !q.trim()) return [];
  const lim = parseInt(limit) || 100;
  const like = `%${q}%`;
  const where = ["(v.cliente LIKE ? OR v.cedula LIKE ? OR v.telefono LIKE ?)"];
  const params = [like, like, like];
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = 'WHERE ' + where.join(' AND ');
  return db.prepare(`
      SELECT v.id, v.fecha, v.cliente, v.vendedor, v.metodo_pago, v.tasa_bcv,
             COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), v.total_bs, 0) as total_bs,
             COALESCE(SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)))/NULLIF(v.tasa_bcv,0),
                      SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))), v.total_bs) as total_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      ${whereSQL}
      GROUP BY v.id
      ORDER BY v.fecha DESC
      LIMIT ?
    `).all(...params, lim);
}

function getRentabilidadCategorias({ desde, hasta, empresaId }) {
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const rows = db.prepare(`
      SELECT COALESCE(NULLIF(TRIM(p.categoria), ''), 'Sin categoría') AS categoria,
        SUM(vd.cantidad) AS total_qty,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad) AS costos_usd
      FROM venta_detalle vd
      JOIN ventas v ON v.id = vd.venta_id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
      GROUP BY categoria
      ORDER BY ingresos_usd DESC
    `).all(...params);

  return rows.map((r) => {
    const ingresosUsd = Number(r.ingresos_usd || 0);
    const costosUsd = Number(r.costos_usd || 0);
    const margenUsd = ingresosUsd - costosUsd;
    const ingresosBs = Number(r.ingresos_bs || 0);
    const costosBs = Number(r.costos_bs || 0);
    const margenBs = ingresosBs - costosBs;
    return {
      ...r,
      ingresos_bs: ingresosBs,
      ingresos_usd: ingresosUsd,
      costos_bs: costosBs,
      costos_usd: costosUsd,
      margen_bs: margenBs,
      margen_usd: margenUsd,
      margen_pct: ingresosUsd !== 0 ? margenUsd / ingresosUsd : null,
    };
  });
}

function getRentabilidadProveedores({ desde, hasta, empresaId }) {
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const rows = db.prepare(`
      SELECT COALESCE(pr.nombre, 'Sin proveedor') AS proveedor,
        pr.id AS proveedor_id,
        SUM(vd.cantidad) AS total_qty,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd, 0) * vd.cantidad) AS costos_usd
      FROM venta_detalle vd
      JOIN ventas v ON v.id = vd.venta_id
      JOIN productos p ON p.id = vd.producto_id
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      ${whereSQL}
      GROUP BY proveedor_id, proveedor
      ORDER BY ingresos_usd DESC
    `).all(...params);

  return rows.map((r) => {
    const ingresosUsd = Number(r.ingresos_usd || 0);
    const costosUsd = Number(r.costos_usd || 0);
    const margenUsd = ingresosUsd - costosUsd;
    const ingresosBs = Number(r.ingresos_bs || 0);
    const costosBs = Number(r.costos_bs || 0);
    const margenBs = ingresosBs - costosBs;
    return {
      ...r,
      ingresos_bs: ingresosBs,
      ingresos_usd: ingresosUsd,
      costos_bs: costosBs,
      costos_usd: costosUsd,
      margen_bs: margenBs,
      margen_usd: margenUsd,
      margen_pct: ingresosUsd !== 0 ? margenUsd / ingresosUsd : null,
    };
  });
}

function getResumenFinanciero({ desde, hasta, empresaId }) {
  const where = [];
  const params = [];
  if (desde) { where.push("date(v.fecha) >= date(?)"); params.push(desde); }
  if (hasta) { where.push("date(v.fecha) <= date(?)"); params.push(hasta); }
  appendEmpresaFilter(where, params, { alias: 'v', empresaId });
  const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

  const row = db.prepare(`
      SELECT 
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1))) AS ingresos_bs,
        SUM(COALESCE(vd.subtotal_bs, vd.precio_usd * vd.cantidad * COALESCE(v.tasa_bcv,1)) / COALESCE(NULLIF(v.tasa_bcv,0),1)) AS ingresos_usd,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad * COALESCE(v.tasa_bcv,1)) AS costos_bs,
        SUM(COALESCE(vd.costo_usd, p.costo_usd,0) * vd.cantidad) AS costos_usd
      FROM ventas v
      JOIN venta_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      ${whereSQL}
    `).get(...params) || {};

  const ingresosBs = Number(row.ingresos_bs || 0);
  const ingresosUsd = Number(row.ingresos_usd || 0);
  const costosBs = Number(row.costos_bs || 0);
  const costosUsd = Number(row.costos_usd || 0);
  const margenBs = ingresosBs - costosBs;
  const margenUsd = ingresosUsd - costosUsd;

  return {
    ingresos_bs: ingresosBs,
    ingresos_usd: ingresosUsd,
    costos_bs: costosBs,
    costos_usd: costosUsd,
    margen_bs: margenBs,
    margen_usd: margenUsd,
    margen_pct: ingresosUsd !== 0 ? margenUsd / ingresosUsd : null,
  };
}

function buildRentabilidadCategoriasCsv(params, empresaId) {
  const rows = getRentabilidadCategorias({ ...params, empresaId });
  const header = ['categoria','total_qty','ingresos_bs','ingresos_usd','costos_bs','costos_usd','margen_bs','margen_usd','margen_pct'];
  const toCsv = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (/[",\n\r;]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const lines = rows.map(r => header.map(h => toCsv(r[h])).join(';'));
  const csv = '\uFEFF' + header.join(';') + '\r\n' + lines.join('\r\n');
  return csv;
}

function buildRentabilidadProveedoresCsv(params, empresaId) {
  const rows = getRentabilidadProveedores({ ...params, empresaId });
  const header = ['proveedor_id','proveedor','total_qty','ingresos_bs','ingresos_usd','costos_bs','costos_usd','margen_bs','margen_usd','margen_pct'];
  const toCsv = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (/[",\n\r;]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const lines = rows.map(r => header.map(h => toCsv(r[h])).join(';'));
  const csv = '\uFEFF' + header.join(';') + '\r\n' + lines.join('\r\n');
  return csv;
}

module.exports = {
  getVentasSinDevolucion,
  getVentasRango,
  buildVentasRangoCsv,
  getKpis,
  getTopProductos,
  getMargenProductos,
  getAbcProductos,
  getInventario,
  getVentaConDetalles,
  getBajoStock,
  getSeriesVentasDiarias,
  getSeriesVentasMensuales,
  getTendenciasMensuales,
  getTopClientes,
  getAbcClientes,
  getVendedoresComparativa,
  getVendedoresRoi,
  getMargenActual,
  getVendedoresRanking,
  getHistorialCliente,
  getRentabilidadCategorias,
  getRentabilidadProveedores,
  getResumenFinanciero,
  buildRentabilidadCategoriasCsv,
  buildRentabilidadProveedoresCsv,
};
