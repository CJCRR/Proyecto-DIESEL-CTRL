const db = require('../db');
const { getComisionesVendedores } = require('./reportesService');

const MAX_TEXT = 120;
const MAX_NOTAS = 400;
const MAX_IDEMPOTENCY_KEY = 120;
const SALDO_EPSILON = 0.01;

function safeStr(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function isValidDateString(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function normalizeScopeValue(value) {
  return safeStr(value, MAX_TEXT);
}

function normalizeEmpresaId(empresaId) {
  return empresaId === undefined ? null : empresaId;
}

function parseCalendarDateParts(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  const raw = safeStr(value, 40);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function getMonthRangeFromDate(dateValue) {
  const parts = parseCalendarDateParts(dateValue);
  if (!parts) return null;
  const start = new Date(parts.year, parts.month - 1, 1);
  const end = new Date(parts.year, parts.month, 0);
  const format = (value) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  return {
    desde: format(start),
    hasta: format(end),
  };
}

function isExactMonthlyPeriod(desde, hasta) {
  if (!isValidDateString(desde) || !isValidDateString(hasta)) return false;
  const range = getMonthRangeFromDate(desde);
  return !!range && range.desde === safeStr(desde, 20) && range.hasta === safeStr(hasta, 20);
}

function getMonthlyOnlySql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `date(${prefix}periodo_desde) = date(${prefix}periodo_desde, 'start of month')
    AND date(${prefix}periodo_hasta) = date(${prefix}periodo_desde, 'start of month', '+1 month', '-1 day')`;
}

function computeEstado(row) {
  let saldo = Number(row.saldo_usd || 0);
  if (Math.abs(saldo) < SALDO_EPSILON) saldo = 0;
  const total = Number(row.total_comision_usd || 0);
  if (saldo <= 0.00001) return 'cancelado';
  if (saldo < total) return 'parcial';
  return 'pendiente';
}

function mapCuenta(row) {
  return {
    ...row,
    estado_calc: computeEstado(row),
  };
}

function getCuentaById(id, empresaId) {
  if (empresaId == null) {
    return db.prepare('SELECT * FROM cuentas_comision WHERE id = ?').get(id);
  }
  return db.prepare('SELECT * FROM cuentas_comision WHERE id = ? AND empresa_id = ?').get(id, empresaId);
}

function getCuentaByScope({ empresaId, usuarioId, periodoDesde, periodoHasta, filtroCliente, filtroMetodo }) {
  if (empresaId == null) {
    return db.prepare(`
      SELECT * FROM cuentas_comision
      WHERE empresa_id IS NULL
        AND usuario_id = ?
        AND periodo_desde = ?
        AND periodo_hasta = ?
        AND COALESCE(filtro_cliente, '') = ?
        AND COALESCE(filtro_metodo, '') = ?
    `).get(usuarioId, periodoDesde, periodoHasta, filtroCliente, filtroMetodo);
  }

  return db.prepare(`
    SELECT * FROM cuentas_comision
    WHERE empresa_id = ?
      AND usuario_id = ?
      AND periodo_desde = ?
      AND periodo_hasta = ?
      AND COALESCE(filtro_cliente, '') = ?
      AND COALESCE(filtro_metodo, '') = ?
  `).get(empresaId, usuarioId, periodoDesde, periodoHasta, filtroCliente, filtroMetodo);
}

function listExistingScopedCuentas({ empresaId, periodoDesde, periodoHasta, filtroCliente, filtroMetodo }) {
  if (empresaId == null) {
    return db.prepare(`
      SELECT * FROM cuentas_comision
      WHERE empresa_id IS NULL
        AND periodo_desde = ?
        AND periodo_hasta = ?
        AND COALESCE(filtro_cliente, '') = ?
        AND COALESCE(filtro_metodo, '') = ?
    `).all(periodoDesde, periodoHasta, filtroCliente, filtroMetodo);
  }

  return db.prepare(`
    SELECT * FROM cuentas_comision
    WHERE empresa_id = ?
      AND periodo_desde = ?
      AND periodo_hasta = ?
      AND COALESCE(filtro_cliente, '') = ?
      AND COALESCE(filtro_metodo, '') = ?
  `).all(empresaId, periodoDesde, periodoHasta, filtroCliente, filtroMetodo);
}

function recalcSaldoCuenta(cuentaId) {
  const cuenta = db.prepare('SELECT * FROM cuentas_comision WHERE id = ?').get(cuentaId);
  if (!cuenta) return null;

  const pagos = db.prepare('SELECT COALESCE(SUM(monto_usd), 0) AS pagado_usd FROM pagos_comision WHERE cuenta_comision_id = ?').get(cuentaId);
  const total = Number(cuenta.total_comision_usd || 0);
  const pagado = Number(pagos && pagos.pagado_usd ? pagos.pagado_usd : 0);
  const saldo = Math.max(0, total - pagado);
  const estado = saldo <= SALDO_EPSILON ? 'cancelado' : (saldo < total ? 'parcial' : 'pendiente');

  db.prepare(`
    UPDATE cuentas_comision
    SET saldo_usd = ?, estado = ?, actualizado_en = datetime('now')
    WHERE id = ?
  `).run(saldo, estado, cuentaId);

  return db.prepare('SELECT * FROM cuentas_comision WHERE id = ?').get(cuentaId);
}

function buildCuentaPagoResponse(cuentaId) {
  const cuenta = recalcSaldoCuenta(cuentaId);
  if (!cuenta) return null;
  const pagos = db.prepare('SELECT * FROM pagos_comision WHERE cuenta_comision_id = ? ORDER BY date(fecha) DESC, id DESC').all(cuentaId);
  return { cuenta: mapCuenta(cuenta), pagos };
}

function clearCuentaWithoutComision(cuenta) {
  if (!cuenta || !cuenta.id) return;
  const pagos = db.prepare('SELECT COUNT(*) AS total FROM pagos_comision WHERE cuenta_comision_id = ?').get(cuenta.id);
  const totalPagos = Number((pagos && pagos.total) || 0);

  if (totalPagos > 0) {
    db.prepare(`
      UPDATE cuentas_comision
      SET total_ventas_bs = 0,
          total_ventas_usd = 0,
          total_comision_bs = 0,
          total_comision_usd = 0,
          saldo_usd = 0,
          estado = 'cancelado',
          actualizado_en = datetime('now')
      WHERE id = ?
    `).run(cuenta.id);
    return;
  }

  db.prepare('DELETE FROM cuentas_comision WHERE id = ?').run(cuenta.id);
}

function getResumenPagos(empresaId, { desde, hasta, cliente, vendedor, metodo } = {}) {
  const where = [];
  const params = [];

  where.push(getMonthlyOnlySql());

  if (desde && hasta) {
    where.push('date(periodo_desde) = date(?)');
    where.push('date(periodo_hasta) = date(?)');
    params.push(desde, hasta);
  } else {
    if (desde) {
      where.push('date(periodo_desde) >= date(?)');
      params.push(desde);
    }
    if (hasta) {
      where.push('date(periodo_hasta) <= date(?)');
      params.push(hasta);
    }
  }
  if (cliente && String(cliente).trim()) {
    where.push("LOWER(COALESCE(filtro_cliente, '')) LIKE ?");
    params.push(`%${String(cliente).trim().toLowerCase()}%`);
  }
  if (metodo && String(metodo).trim()) {
    where.push("LOWER(COALESCE(filtro_metodo, '')) = ?");
    params.push(String(metodo).trim().toLowerCase());
  }
  if (vendedor && String(vendedor).trim()) {
    where.push("LOWER(COALESCE(vendedor_nombre, '')) LIKE ?");
    params.push(`%${String(vendedor).trim().toLowerCase()}%`);
  }

  if (empresaId == null) {
    where.push('empresa_id IS NULL');
  } else {
    where.push('empresa_id = ?');
    params.push(empresaId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT estado, COUNT(*) AS cantidad, COALESCE(SUM(saldo_usd), 0) AS saldo_usd
    FROM cuentas_comision
    ${whereSql}
    GROUP BY estado
  `).all(...params);
}

function listCuentasPagos({ cliente, vendedor, metodo, estado, desde, hasta, empresaId } = {}) {
  const where = [];
  const params = [];

  where.push(getMonthlyOnlySql('cc'));

  if (empresaId == null) {
    where.push('cc.empresa_id IS NULL');
  } else {
    where.push('cc.empresa_id = ?');
    params.push(empresaId);
  }
  if (desde && hasta) {
    where.push('date(cc.periodo_desde) = date(?)');
    where.push('date(cc.periodo_hasta) = date(?)');
    params.push(desde, hasta);
  } else {
    if (desde) {
      where.push('date(cc.periodo_desde) >= date(?)');
      params.push(desde);
    }
    if (hasta) {
      where.push('date(cc.periodo_hasta) <= date(?)');
      params.push(hasta);
    }
  }
  if (vendedor && String(vendedor).trim()) {
    const like = `%${String(vendedor).trim().toLowerCase()}%`;
    where.push('(LOWER(cc.vendedor_nombre) LIKE ? OR LOWER(COALESCE(u.username, "")) LIKE ?)');
    params.push(like, like);
  }
  if (cliente && String(cliente).trim()) {
    where.push("LOWER(COALESCE(cc.filtro_cliente, '')) LIKE ?");
    params.push(`%${String(cliente).trim().toLowerCase()}%`);
  }
  if (metodo && String(metodo).trim()) {
    where.push("LOWER(COALESCE(cc.filtro_metodo, '')) = ?");
    params.push(String(metodo).trim().toLowerCase());
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  let rows = db.prepare(`
    SELECT cc.*, u.username
    FROM cuentas_comision cc
    LEFT JOIN usuarios u ON u.id = cc.usuario_id
    ${whereSql}
    ORDER BY date(cc.periodo_hasta) DESC, LOWER(COALESCE(cc.vendedor_nombre, u.username, '')) ASC, cc.id DESC
  `).all(...params);

  rows = rows.map((row) => mapCuenta(row));
  if (estado) {
    rows = rows.filter((row) => row.estado_calc === estado);
  }
  return rows;
}

function getCuentaConPagos(id, empresaId) {
  const cuenta = getCuentaById(id, empresaId);
  if (!cuenta) return null;
  const pagos = db.prepare('SELECT * FROM pagos_comision WHERE cuenta_comision_id = ? ORDER BY date(fecha) DESC, id DESC').all(id);
  return { cuenta: mapCuenta(recalcSaldoCuenta(id)), pagos };
}

function generarCuentasDesdeReporte(payload = {}) {
  const empresaId = normalizeEmpresaId(payload.empresaId);
  const desde = safeStr(payload.desde, 20);
  const hasta = safeStr(payload.hasta, 20);
  const cliente = normalizeScopeValue(payload.cliente);
  const vendedor = normalizeScopeValue(payload.vendedor);
  const metodo = normalizeScopeValue(payload.metodo);
  const usuarioIdFilter = payload.usuarioId != null ? Number(payload.usuarioId) : null;

  if (!isValidDateString(desde) || !isValidDateString(hasta)) {
    throw new Error('Rango inválido');
  }

  let rows = getComisionesVendedores({ desde, hasta, cliente, vendedor, metodo, empresaId });
  if (Number.isFinite(usuarioIdFilter) && usuarioIdFilter > 0) {
    rows = rows.filter((row) => Number(row.usuario_id || 0) === usuarioIdFilter);
  }
  const filtroCliente = cliente;
  const filtroMetodo = metodo;

  const transaction = db.transaction(() => {
    const results = [];
    let created = 0;
    let updated = 0;
    const seenUserIds = new Set();
    const existingScoped = listExistingScopedCuentas({
      empresaId,
      periodoDesde: desde,
      periodoHasta: hasta,
      filtroCliente,
      filtroMetodo,
    });

    rows.forEach((row) => {
      const usuarioId = Number(row.usuario_id || 0);
      if (!usuarioId) return;
      seenUserIds.add(usuarioId);

      const vendedorNombre = safeStr(row.nombre_completo || row.username || `Vendedor ${usuarioId}`, MAX_TEXT);
      const totalVentasUsd = Number(row.total_usd || 0);
      const totalVentasBs = Number(row.total_bs || 0);
      const totalComisionUsd = Number(row.comision_usd || 0);
      const totalComisionBs = Number(row.comision_bs || 0);
      const comisionPct = Number(row.comision_pct || 0);

      let cuenta = getCuentaByScope({
        empresaId,
        usuarioId,
        periodoDesde: desde,
        periodoHasta: hasta,
        filtroCliente,
        filtroMetodo,
      });

      if (cuenta) {
        db.prepare(`
          UPDATE cuentas_comision
          SET vendedor_nombre = ?,
              rol = ?,
              comision_pct = ?,
              total_ventas_bs = ?,
              total_ventas_usd = ?,
              total_comision_bs = ?,
              total_comision_usd = ?,
              actualizado_en = datetime('now')
          WHERE id = ?
        `).run(
          vendedorNombre,
          safeStr(row.rol, MAX_TEXT),
          comisionPct,
          totalVentasBs,
          totalVentasUsd,
          totalComisionBs,
          totalComisionUsd,
          cuenta.id
        );
        cuenta = recalcSaldoCuenta(cuenta.id);
        updated += 1;
      } else {
        const result = db.prepare(`
          INSERT INTO cuentas_comision (
            empresa_id, usuario_id, vendedor_nombre, rol, comision_pct,
            total_ventas_bs, total_ventas_usd, total_comision_bs, total_comision_usd,
            saldo_usd, periodo_desde, periodo_hasta, filtro_cliente, filtro_metodo, notas,
            estado, creado_en, actualizado_en
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'pendiente', datetime('now'), datetime('now'))
        `).run(
          empresaId,
          usuarioId,
          vendedorNombre,
          safeStr(row.rol, MAX_TEXT),
          comisionPct,
          totalVentasBs,
          totalVentasUsd,
          totalComisionBs,
          totalComisionUsd,
          totalComisionUsd,
          desde,
          hasta,
          filtroCliente,
          filtroMetodo
        );
        cuenta = db.prepare('SELECT * FROM cuentas_comision WHERE id = ?').get(result.lastInsertRowid);
        created += 1;
      }

      results.push(mapCuenta(cuenta));
    });

    existingScoped.forEach((cuenta) => {
      const usuarioId = Number(cuenta.usuario_id || 0);
      if (!usuarioId || seenUserIds.has(usuarioId)) return;
      clearCuentaWithoutComision(cuenta);
    });

    return { created, updated, rows: results };
  });

  return transaction();
}

function syncCuentasMensualesPeriodo({ empresaId, desde, hasta, vendedor = '' } = {}) {
  if (!isExactMonthlyPeriod(desde, hasta)) {
    return null;
  }

  return generarCuentasDesdeReporte({
    empresaId,
    desde,
    hasta,
    vendedor,
  });
}

function reconcileComisionMensualParaFecha({ empresaId, usuarioId, fecha } = {}) {
  if (!empresaId || !usuarioId || !fecha) return null;
  const range = getMonthRangeFromDate(fecha);
  if (!range) return null;

  return generarCuentasDesdeReporte({
    empresaId,
    usuarioId,
    desde: range.desde,
    hasta: range.hasta,
  });
}

function registrarPago(cuentaId, empresaId, payload = {}) {
  const cuenta = getCuentaById(cuentaId, empresaId);
  if (!cuenta) return null;

  const monto = Number(payload.monto || 0);
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error('Monto inválido');
  }

  const moneda = safeStr(payload.moneda || 'USD', 10).toUpperCase();
  if (moneda !== 'USD' && moneda !== 'BS') {
    throw new Error('Moneda inválida');
  }

  const tasa = Number(payload.tasa_bcv || 1);
  if (!Number.isFinite(tasa) || tasa <= 0 || tasa > 1e9) {
    throw new Error('Tasa inválida');
  }

  const idempotencyKey = safeStr(payload.idempotency_key, MAX_IDEMPOTENCY_KEY);
  if (idempotencyKey) {
    const existing = db.prepare(
      'SELECT id FROM pagos_comision WHERE cuenta_comision_id = ? AND idempotency_key = ?'
    ).get(cuentaId, idempotencyKey);
    if (existing) {
      return buildCuentaPagoResponse(cuentaId);
    }
  }

  const montoUsd = moneda === 'BS' ? (monto / tasa) : monto;
  const montoMoneda = moneda === 'BS' ? monto : montoUsd;

  db.prepare(`
    INSERT INTO pagos_comision (
      cuenta_comision_id, idempotency_key, fecha, monto_usd, moneda, tasa_bcv,
      monto_moneda, metodo, referencia, notas, usuario, creado_en
    ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    cuentaId,
    idempotencyKey || null,
    montoUsd,
    moneda,
    tasa,
    montoMoneda,
    safeStr(payload.metodo, MAX_TEXT),
    safeStr(payload.referencia, MAX_TEXT),
    safeStr(payload.notas, MAX_NOTAS),
    safeStr(payload.usuario, MAX_TEXT)
  );

  return buildCuentaPagoResponse(cuentaId);
}

module.exports = {
  getResumenPagos,
  listCuentasPagos,
  getCuentaConPagos,
  generarCuentasDesdeReporte,
  syncCuentasMensualesPeriodo,
  reconcileComisionMensualParaFecha,
  registrarPago,
};