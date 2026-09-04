const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const db = require(path.join('..', 'server', 'db'));
const { analizarReconciliacionStockEmpresa, reconciliarStockEmpresa } = require(path.join('..', 'server', 'services', 'ajustesService'));

function parseArgs(argv) {
  const args = {
    empresaId: 1,
    all: false,
    apply: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i] || '').trim();
    if (!raw) continue;

    if (raw === '--apply') {
      args.apply = true;
      continue;
    }
    if (raw === '--preview') {
      args.apply = false;
      continue;
    }
    if (raw === '--json') {
      args.json = true;
      continue;
    }
    if (raw === '--help' || raw === '-h') {
      args.help = true;
      continue;
    }
    if (raw === '--all') {
      args.all = true;
      continue;
    }
    if (raw.startsWith('--empresa=')) {
      args.empresaId = Number(raw.slice('--empresa='.length));
      continue;
    }
    if (raw === '--empresa') {
      args.empresaId = Number(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function printUsage() {
  console.log('Uso: node scripts/rebuild-stock.js [--empresa 1 | --all] [--preview] [--apply] [--json]');
  console.log('  --preview   Muestra el diagnostico sin modificar productos.stock (default)');
  console.log('  --apply     Aplica la reconciliacion usando stock_por_deposito como fuente de verdad');
  console.log('  --empresa   ID de empresa a revisar o corregir');
  console.log('  --all       Recorre todas las empresas registradas en la base');
  console.log('  --json      Imprime el resultado completo en JSON');
}

function printHumanSummary(result, applyMode) {
  const actionLabel = applyMode ? 'Reconciliacion aplicada' : 'Vista previa de reconciliacion';
  console.log(`\n${actionLabel} para empresa ${result.empresa_id}`);
  console.log(`Productos revisados: ${result.totalProductos}`);
  console.log(`Desajustes detectados: ${result.mismatches.length}`);
  console.log(`Productos corregidos: ${result.actualizados}`);
  if (!applyMode) {
    console.log(`Productos que se corregirian: ${result.candidatosActualizacion}`);
  }
  console.log(`Sin stock por deposito: ${result.sinStockPorDeposito.length}`);
  console.log(`Negativos en detalle por deposito: ${result.negativos.length}`);

  if (result.mismatches.length) {
    console.log('\nPrimeros desajustes:');
    result.mismatches.slice(0, 10).forEach((item) => {
      console.log(`- ${item.codigo}: stock=${item.stock_anterior} -> depositos=${item.stock_nuevo}`);
    });
  }

  if (result.sinStockPorDeposito.length) {
    console.log('\nProductos sin detalle por deposito:');
    result.sinStockPorDeposito.slice(0, 10).forEach((item) => {
      console.log(`- ${item.codigo}: stock actual ${item.stock_actual}`);
    });
  }
}

function getEmpresaIds(args) {
  if (args.all) {
    return db.prepare('SELECT id FROM empresas ORDER BY id').all().map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
  }
  return [args.empresaId];
}

function buildAggregate(results) {
  return results.reduce((acc, result) => {
    acc.empresas += 1;
    acc.totalProductos += Number(result.totalProductos || 0);
    acc.actualizados += Number(result.actualizados || 0);
    acc.candidatosActualizacion += Number(result.candidatosActualizacion || 0);
    acc.desajustes += Array.isArray(result.mismatches) ? result.mismatches.length : 0;
    acc.sinStockPorDeposito += Array.isArray(result.sinStockPorDeposito) ? result.sinStockPorDeposito.length : 0;
    acc.negativos += Array.isArray(result.negativos) ? result.negativos.length : 0;
    return acc;
  }, {
    empresas: 0,
    totalProductos: 0,
    actualizados: 0,
    candidatosActualizacion: 0,
    desajustes: 0,
    sinStockPorDeposito: 0,
    negativos: 0,
  });
}

function printAggregateSummary(aggregate, applyMode) {
  const actionLabel = applyMode ? 'Resumen general de aplicacion' : 'Resumen general de vista previa';
  console.log(`\n${actionLabel}`);
  console.log(`Empresas revisadas: ${aggregate.empresas}`);
  console.log(`Productos revisados: ${aggregate.totalProductos}`);
  console.log(`Desajustes detectados: ${aggregate.desajustes}`);
  console.log(`Productos corregidos: ${aggregate.actualizados}`);
  if (!applyMode) {
    console.log(`Productos que se corregirian: ${aggregate.candidatosActualizacion}`);
  }
  console.log(`Sin stock por deposito: ${aggregate.sinStockPorDeposito}`);
  console.log(`Negativos en detalle por deposito: ${aggregate.negativos}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!Number.isFinite(args.empresaId) || args.empresaId <= 0) {
    throw new Error('Debe indicar un --empresa valido');
  }

  const empresaIds = getEmpresaIds(args);
  if (!empresaIds.length) {
    throw new Error('No se encontraron empresas para procesar');
  }

  const results = empresaIds.map((empresaId) => (
    args.apply
      ? reconciliarStockEmpresa(empresaId)
      : analizarReconciliacionStockEmpresa(empresaId, { applyUpdates: false })
  ));

  if (args.json) {
    if (args.all) {
      console.log(JSON.stringify({ empresas: results, resumen: buildAggregate(results) }, null, 2));
      return;
    }
    console.log(JSON.stringify(results[0], null, 2));
    return;
  }

  results.forEach((result) => printHumanSummary(result, args.apply));
  if (args.all) {
    printAggregateSummary(buildAggregate(results), args.apply);
  }
}

try {
  main();
} catch (err) {
  console.error('Error ejecutando mantenimiento de stock:', err && err.message ? err.message : err);
  process.exitCode = 1;
}