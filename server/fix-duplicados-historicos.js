// Script de mantenimiento para detectar y limpiar duplicados historicos
// de pagos de cobranzas y ventas creados antes de las barreras de idempotencia.
//
// Modo seguro por defecto: solo reporta candidatos, no borra nada.
//
// Uso desde la raiz del proyecto:
//   node server/fix-duplicados-historicos.js
//   node server/fix-duplicados-historicos.js --target pagos
//   node server/fix-duplicados-historicos.js --target ventas --window-seconds 180
//   node server/fix-duplicados-historicos.js --apply --yes --target pagos
//   node server/fix-duplicados-historicos.js --apply --yes --target ventas --empresa 3

const db = require('./db');
const { anularVenta } = require('./services/ventasService');

const DEFAULT_WINDOW_SECONDS = 120;
const SALDO_EPSILON = 0.01;

function parseArgs(argv) {
  const options = {
    apply: false,
    confirm: false,
    target: 'all',
    windowSeconds: DEFAULT_WINDOW_SECONDS,
    empresaId: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--yes' || arg === '--confirm') {
      options.confirm = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--target') {
      options.target = String(argv[index + 1] || '').trim().toLowerCase();
      index += 1;
    } else if (arg.startsWith('--target=')) {
      options.target = String(arg.split('=').slice(1).join('=') || '').trim().toLowerCase();
    } else if (arg === '--window-seconds') {
      options.windowSeconds = Number(argv[index + 1] || DEFAULT_WINDOW_SECONDS);
      index += 1;
    } else if (arg.startsWith('--window-seconds=')) {
      options.windowSeconds = Number(arg.split('=').slice(1).join('=') || DEFAULT_WINDOW_SECONDS);
    } else if (arg === '--empresa') {
      const value = Number(argv[index + 1]);
      options.empresaId = Number.isFinite(value) && value > 0 ? value : null;
      index += 1;
    } else if (arg.startsWith('--empresa=')) {
      const value = Number(arg.split('=').slice(1).join('='));
      options.empresaId = Number.isFinite(value) && value > 0 ? value : null;
    }
  }

  if (!['all', 'ventas', 'pagos'].includes(options.target)) {
    throw new Error('Target invalido. Use all, ventas o pagos.');
  }
  if (!Number.isFinite(options.windowSeconds) || options.windowSeconds <= 0) {
    throw new Error('window-seconds invalido. Debe ser un numero > 0.');
  }

  return options;
}

function printHelp() {
  console.log('Uso: node server/fix-duplicados-historicos.js [opciones]');
  console.log('');
  console.log('Opciones:');
  console.log('  --target ventas|pagos|all     Que tipo de duplicados revisar. Default: all');
  console.log('  --window-seconds N            Ventana maxima entre duplicados. Default: 120');
  console.log('  --empresa ID                  Filtra por empresa_id');
  console.log('  --apply --yes                 Aplica la limpieza en vez de solo reportar');
  console.log('  --help                        Muestra esta ayuda');
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeNumber(value, decimals = 4) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  return num.toFixed(decimals);
}

function parseDateMs(value) {
  if (!value) return NaN;
  const raw = String(value).trim();
  if (!raw) return NaN;

  let parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();

  if (raw.includes(' ') && !raw.includes('T')) {
    parsed = new Date(`${raw.replace(' ', 'T')}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }

  return NaN;
}

function groupByFingerprintWithWindow(rows, getFingerprint, windowMs) {
  const map = new Map();

  rows.forEach((row) => {
    const fingerprint = getFingerprint(row);
    if (!map.has(fingerprint)) {
      map.set(fingerprint, []);
    }
    map.get(fingerprint).push(row);
  });

  const clusters = [];

  for (const rowsByKey of map.values()) {
    rowsByKey.sort((left, right) => {
      const leftTime = Number.isFinite(left.fechaMs) ? left.fechaMs : Number.MAX_SAFE_INTEGER;
      const rightTime = Number.isFinite(right.fechaMs) ? right.fechaMs : Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return Number(left.id || 0) - Number(right.id || 0);
    });

    let currentCluster = [];
    let anchorTime = null;

    for (const row of rowsByKey) {
      if (!currentCluster.length) {
        currentCluster = [row];
        anchorTime = Number.isFinite(row.fechaMs) ? row.fechaMs : null;
        continue;
      }

      const rowTime = Number.isFinite(row.fechaMs) ? row.fechaMs : null;
      const withinWindow = anchorTime != null && rowTime != null && Math.abs(rowTime - anchorTime) <= windowMs;
      if (withinWindow) {
        currentCluster.push(row);
        continue;
      }

      if (currentCluster.length > 1) {
        clusters.push(currentCluster);
      }
      currentCluster = [row];
      anchorTime = rowTime;
    }

    if (currentCluster.length > 1) {
      clusters.push(currentCluster);
    }
  }

  return clusters;
}

function computeEstadoCuenta(cuenta, saldo) {
  let saldoNorm = Number(saldo || 0);
  if (Math.abs(saldoNorm) < SALDO_EPSILON) saldoNorm = 0;

  const total = Number(cuenta.total_usd || 0);
  const vencimiento = cuenta.fecha_vencimiento ? new Date(cuenta.fecha_vencimiento) : null;
  const hoy = new Date();
  let estado = 'pendiente';

  if (saldoNorm <= 0.00001) estado = 'cancelado';
  else if (saldoNorm < total) estado = 'parcial';
  if (estado !== 'cancelado' && vencimiento && !Number.isNaN(vencimiento.getTime()) && vencimiento < hoy) {
    estado = 'vencido';
  }
  return estado;
}

function loadPaymentRows(empresaId) {
  const params = [];
  const where = [];

  if (empresaId != null) {
    where.push('COALESCE(p.empresa_id, cc.empresa_id, u.empresa_id) = ?');
    params.push(empresaId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return db.prepare(`
    SELECT
      p.id,
      p.cuenta_id,
      COALESCE(p.empresa_id, cc.empresa_id, u.empresa_id) AS empresa_id,
      p.fecha,
      p.creado_en,
      p.monto_usd,
      p.moneda,
      p.tasa_bcv,
      p.monto_moneda,
      p.metodo,
      p.referencia,
      p.notas,
      p.usuario,
      cc.cliente_nombre,
      cc.total_usd,
      cc.saldo_usd
    FROM pagos_cc p
    LEFT JOIN cuentas_cobrar cc ON cc.id = p.cuenta_id
    LEFT JOIN ventas v ON v.id = cc.venta_id
    LEFT JOIN usuarios u ON u.id = v.usuario_id
    ${whereSql}
    ORDER BY empresa_id, p.cuenta_id, p.fecha, p.id
  `).all(...params).map((row) => ({
    ...row,
    fechaMs: parseDateMs(row.fecha || row.creado_en),
  }));
}

function detectDuplicatePayments(options) {
  const rows = loadPaymentRows(options.empresaId);
  const windowMs = Number(options.windowSeconds) * 1000;

  const clusters = groupByFingerprintWithWindow(rows, (row) => [
    row.empresa_id || 'sin-empresa',
    row.cuenta_id,
    normalizeNumber(row.monto_usd),
    normalizeText(row.moneda),
    normalizeNumber(row.tasa_bcv, 6),
    normalizeNumber(row.monto_moneda),
    normalizeText(row.metodo),
    normalizeText(row.referencia),
    normalizeText(row.notas),
    normalizeText(row.usuario),
  ].join('|'), windowMs);

  const groups = clusters.map((cluster) => {
    const keep = cluster[0];
    const duplicates = cluster.slice(1).map((row) => ({ ...row, canAutoDelete: true, reason: null }));
    return { keep, duplicates };
  });

  return {
    totalRows: rows.length,
    groups,
    duplicateCount: groups.reduce((acc, group) => acc + group.duplicates.length, 0),
  };
}

function loadSaleRows(empresaId) {
  const params = [];
  const where = [];

  if (empresaId != null) {
    where.push('u.empresa_id = ?');
    params.push(empresaId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const ventas = db.prepare(`
    SELECT
      v.id,
      v.id_global,
      v.fecha,
      v.cliente,
      v.vendedor,
      v.cedula,
      v.telefono,
      v.tasa_bcv,
      v.descuento,
      v.metodo_pago,
      v.referencia,
      v.total_bs,
      v.iva_pct,
      v.igtf_pct,
      v.total_bs_iva,
      v.total_usd_iva,
      v.usuario_id,
      u.empresa_id
    FROM ventas v
    LEFT JOIN usuarios u ON u.id = v.usuario_id
    ${whereSql}
    ORDER BY u.empresa_id, v.fecha, v.id
  `).all(...params);

  if (!ventas.length) return [];

  const details = db.prepare(`
    SELECT
      vd.venta_id,
      COALESCE(p.codigo, CAST(vd.producto_id AS TEXT), '') AS codigo,
      vd.cantidad,
      vd.precio_usd,
      COALESCE(vd.deposito_id, 0) AS deposito_id,
      COALESCE(vd.marca, '') AS marca
    FROM venta_detalle vd
    LEFT JOIN productos p ON p.id = vd.producto_id
    ORDER BY vd.venta_id, codigo, vd.id
  `).all();

  const detailMap = new Map();
  details.forEach((detail) => {
    const key = Number(detail.venta_id);
    if (!detailMap.has(key)) detailMap.set(key, []);
    detailMap.get(key).push([
      normalizeText(detail.codigo),
      normalizeNumber(detail.cantidad, 3),
      normalizeNumber(detail.precio_usd),
      String(detail.deposito_id || 0),
      normalizeText(detail.marca),
    ].join(':'));
  });

  const devoluciones = db.prepare(`
    SELECT venta_original_id AS venta_id, COUNT(*) AS total
    FROM devoluciones
    WHERE venta_original_id IS NOT NULL
    GROUP BY venta_original_id
  `).all();
  const devolucionMap = new Map(devoluciones.map((row) => [Number(row.venta_id), Number(row.total || 0)]));

  const cuentas = db.prepare(`
    SELECT cc.venta_id, COUNT(DISTINCT cc.id) AS cuentas_count, COUNT(p.id) AS pagos_count
    FROM cuentas_cobrar cc
    LEFT JOIN pagos_cc p ON p.cuenta_id = cc.id
    WHERE cc.venta_id IS NOT NULL
    GROUP BY cc.venta_id
  `).all();
  const cuentaMap = new Map(cuentas.map((row) => [Number(row.venta_id), {
    cuentasCount: Number(row.cuentas_count || 0),
    pagosCount: Number(row.pagos_count || 0),
  }]));

  return ventas.map((venta) => {
    const saleId = Number(venta.id);
    const cuentaInfo = cuentaMap.get(saleId) || { cuentasCount: 0, pagosCount: 0 };
    return {
      ...venta,
      fechaMs: parseDateMs(venta.fecha),
      itemFingerprint: (detailMap.get(saleId) || []).join('|'),
      devolucionesCount: devolucionMap.get(saleId) || 0,
      cuentasCount: cuentaInfo.cuentasCount,
      pagosCount: cuentaInfo.pagosCount,
    };
  });
}

function chooseSaleKeeper(cluster) {
  const ordered = [...cluster].sort((left, right) => {
    const leftScore = (left.pagosCount > 0 ? 4 : 0) + (left.devolucionesCount > 0 ? 2 : 0) + (left.cuentasCount > 0 ? 1 : 0);
    const rightScore = (right.pagosCount > 0 ? 4 : 0) + (right.devolucionesCount > 0 ? 2 : 0) + (right.cuentasCount > 0 ? 1 : 0);
    if (leftScore !== rightScore) return rightScore - leftScore;

    const leftTime = Number.isFinite(left.fechaMs) ? left.fechaMs : Number.MAX_SAFE_INTEGER;
    const rightTime = Number.isFinite(right.fechaMs) ? right.fechaMs : Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return Number(left.id || 0) - Number(right.id || 0);
  });
  return ordered[0];
}

function detectDuplicateSales(options) {
  const rows = loadSaleRows(options.empresaId);
  const windowMs = Number(options.windowSeconds) * 1000;

  const clusters = groupByFingerprintWithWindow(rows, (row) => [
    row.empresa_id || 'sin-empresa',
    row.usuario_id || 'sin-usuario',
    normalizeText(row.cliente),
    normalizeText(row.vendedor),
    normalizeText(row.cedula),
    normalizeText(row.telefono),
    normalizeNumber(row.tasa_bcv, 6),
    normalizeNumber(row.descuento),
    normalizeText(row.metodo_pago),
    normalizeText(row.referencia),
    normalizeNumber(row.total_bs),
    normalizeNumber(row.iva_pct),
    normalizeNumber(row.igtf_pct),
    normalizeNumber(row.total_bs_iva),
    normalizeNumber(row.total_usd_iva),
    row.itemFingerprint,
  ].join('|'), windowMs);

  const groups = clusters.map((cluster) => {
    const keep = chooseSaleKeeper(cluster);
    const duplicates = cluster
      .filter((row) => row.id !== keep.id)
      .map((row) => {
        let reason = null;
        if (!row.empresa_id) reason = 'sin empresa_id asociada';
        else if (row.devolucionesCount > 0) reason = 'tiene devoluciones asociadas';
        else if (row.pagosCount > 0) reason = 'tiene pagos asociados';

        return {
          ...row,
          canAutoDelete: reason == null,
          reason,
        };
      });

    return { keep, duplicates };
  });

  return {
    totalRows: rows.length,
    groups,
    duplicateCount: groups.reduce((acc, group) => acc + group.duplicates.length, 0),
    autoDeleteCount: groups.reduce((acc, group) => acc + group.duplicates.filter((dup) => dup.canAutoDelete).length, 0),
  };
}

function printPaymentReport(report) {
  console.log('');
  console.log('=== POSIBLES PAGOS DUPLICADOS ===');
  console.log('Pagos revisados:', report.totalRows);
  console.log('Grupos detectados:', report.groups.length);
  console.log('Pagos duplicados candidatos:', report.duplicateCount);

  report.groups.forEach((group, index) => {
    console.log('');
    console.log(`Grupo pago #${index + 1}`);
    console.log(`  Mantener pago ${group.keep.id} | cuenta ${group.keep.cuenta_id} | fecha ${group.keep.fecha} | monto ${group.keep.monto_usd} ${group.keep.moneda}`);
    group.duplicates.forEach((dup) => {
      console.log(`  Eliminar pago ${dup.id} | cuenta ${dup.cuenta_id} | fecha ${dup.fecha} | monto ${dup.monto_usd} ${dup.moneda}`);
    });
  });
}

function printSaleReport(report) {
  console.log('');
  console.log('=== POSIBLES VENTAS DUPLICADAS ===');
  console.log('Ventas revisadas:', report.totalRows);
  console.log('Grupos detectados:', report.groups.length);
  console.log('Ventas duplicadas candidatas:', report.duplicateCount);
  console.log('Ventas auto-eliminables:', report.autoDeleteCount);

  report.groups.forEach((group, index) => {
    console.log('');
    console.log(`Grupo venta #${index + 1}`);
    console.log(`  Mantener venta ${group.keep.id} | empresa ${group.keep.empresa_id || 'N/A'} | fecha ${group.keep.fecha} | cliente ${group.keep.cliente || 'N/A'} | total_bs ${group.keep.total_bs}`);
    group.duplicates.forEach((dup) => {
      const status = dup.canAutoDelete ? 'auto-eliminable' : `revision manual: ${dup.reason}`;
      console.log(`  Duplicada ${dup.id} | empresa ${dup.empresa_id || 'N/A'} | fecha ${dup.fecha} | total_bs ${dup.total_bs} | ${status}`);
    });
  });
}

function recalculateCuenta(cuentaId) {
  const cuenta = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(cuentaId);
  if (!cuenta) return;

  const pagos = db.prepare('SELECT COALESCE(SUM(monto_usd), 0) AS total FROM pagos_cc WHERE cuenta_id = ?').get(cuentaId);
  let nuevoSaldo = Number(cuenta.total_usd || 0) - Number((pagos && pagos.total) || 0);
  if (Math.abs(nuevoSaldo) < SALDO_EPSILON) nuevoSaldo = 0;
  if (nuevoSaldo < 0) nuevoSaldo = 0;
  const estado = computeEstadoCuenta(cuenta, nuevoSaldo);

  db.prepare("UPDATE cuentas_cobrar SET saldo_usd = ?, estado = ?, actualizado_en = datetime('now') WHERE id = ?")
    .run(nuevoSaldo, estado, cuentaId);
}

function applyDuplicatePayments(report) {
  const idsToDelete = [];
  const cuentasAfectadas = new Set();

  report.groups.forEach((group) => {
    group.duplicates.forEach((dup) => {
      idsToDelete.push(Number(dup.id));
      cuentasAfectadas.add(Number(dup.cuenta_id));
    });
  });

  if (!idsToDelete.length) {
    return { deletedCount: 0, cuentasRecalculadas: 0 };
  }

  const deletePago = db.prepare('DELETE FROM pagos_cc WHERE id = ?');
  const tx = db.transaction(() => {
    idsToDelete.forEach((id) => deletePago.run(id));
    Array.from(cuentasAfectadas).forEach((cuentaId) => recalculateCuenta(cuentaId));
  });
  tx();

  return { deletedCount: idsToDelete.length, cuentasRecalculadas: cuentasAfectadas.size };
}

function applyDuplicateSales(report) {
  let deletedCount = 0;
  const skipped = [];

  report.groups.forEach((group) => {
    group.duplicates.forEach((dup) => {
      if (!dup.canAutoDelete) {
        skipped.push({ id: dup.id, reason: dup.reason || 'no auto-eliminable' });
        return;
      }

      try {
        anularVenta({ ventaId: Number(dup.id), empresaId: Number(dup.empresa_id) });
        deletedCount += 1;
      } catch (error) {
        skipped.push({ id: dup.id, reason: error.message || 'error desconocido' });
      }
    });
  });

  return { deletedCount, skipped };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log('Modo:', options.apply ? 'APLICAR CAMBIOS' : 'SOLO REPORTE');
  console.log('Target:', options.target);
  console.log('Ventana de deteccion (segundos):', options.windowSeconds);
  console.log('Empresa filtrada:', options.empresaId != null ? options.empresaId : 'todas');

  const shouldCheckSales = options.target === 'all' || options.target === 'ventas';
  const shouldCheckPayments = options.target === 'all' || options.target === 'pagos';

  let salesReport = null;
  let paymentsReport = null;

  if (shouldCheckSales) {
    salesReport = detectDuplicateSales(options);
    printSaleReport(salesReport);
  }

  if (shouldCheckPayments) {
    paymentsReport = detectDuplicatePayments(options);
    printPaymentReport(paymentsReport);
  }

  if (!options.apply) {
    console.log('');
    console.log('Reporte completado. No se borro ningun registro.');
    console.log('Para aplicar cambios usa: --apply --yes');
    return;
  }

  if (!options.confirm) {
    console.log('');
    console.log('Falta confirmacion explicita. Repite con --apply --yes para ejecutar la limpieza.');
    return;
  }

  console.log('');
  console.log('Aplicando limpieza segura...');

  if (shouldCheckSales && salesReport) {
    const resultSales = applyDuplicateSales(salesReport);
    console.log('Ventas duplicadas eliminadas:', resultSales.deletedCount);
    if (resultSales.skipped.length) {
      console.log('Ventas omitidas para revision manual:', resultSales.skipped.length);
      resultSales.skipped.forEach((item) => {
        console.log(`  Venta ${item.id}: ${item.reason}`);
      });
    }
  }

  if (shouldCheckPayments) {
    paymentsReport = detectDuplicatePayments(options);
    const resultPayments = applyDuplicatePayments(paymentsReport);
    console.log('Pagos duplicados eliminados:', resultPayments.deletedCount);
    console.log('Cuentas recalculadas:', resultPayments.cuentasRecalculadas);
  }

  console.log('');
  console.log('Limpieza finalizada. Haz backup antes de usar --apply en produccion y valida ventas/cobranzas luego.');
}

try {
  main();
} catch (error) {
  console.error('Error ejecutando fix-duplicados-historicos:', error.message || error);
  process.exitCode = 1;
}