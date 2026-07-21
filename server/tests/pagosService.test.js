const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const pagosService = require(path.join('..', 'services', 'pagosService'));

function resetPagosData() {
  db.prepare('DELETE FROM pagos_comision').run();
  db.prepare('DELETE FROM cuentas_comision').run();
  db.prepare('DELETE FROM devolucion_detalle').run();
  db.prepare('DELETE FROM devoluciones').run();
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare("DELETE FROM usuarios WHERE username LIKE 'pagos_test_%'").run();
}

describe('pagosService comisiones', () => {
  beforeEach(() => {
    resetPagosData();
  });

  test('genera cuentas de comisión desde el reporte y registra pago parcial', () => {
    const usuario = db.prepare(`
      INSERT INTO usuarios (username, password, nombre_completo, rol, comision_pct, activo, empresa_id)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run('pagos_test_vendedor', '1234', 'Vendedor Pago', 'vendedor', 10, 1);

    const producto = db.prepare(`
      INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('PAG-001', 'Producto pago', 10, 5, 50, 1);

    const venta = db.prepare(`
      INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('2026-07-10', 'Cliente Comisión', 'Vendedor Pago', 'EFECTIVO', 100, 10, usuario.lastInsertRowid);

    db.prepare(`
      INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(venta.lastInsertRowid, producto.lastInsertRowid, 1, 10, 5, 100);

    const generated = pagosService.generarCuentasDesdeReporte({
      empresaId: 1,
      desde: '2026-07-01',
      hasta: '2026-07-31',
    });

    expect(generated.created).toBe(1);
    expect(generated.rows).toHaveLength(1);
    expect(generated.rows[0].total_comision_usd).toBeCloseTo(1);
    expect(generated.rows[0].saldo_usd).toBeCloseTo(1);
    expect(generated.rows[0].estado_calc).toBe('pendiente');

    const paid = pagosService.registrarPago(generated.rows[0].id, 1, {
      monto: 0.4,
      moneda: 'USD',
      tasa_bcv: 10,
      metodo: 'EFECTIVO',
      usuario: 'admin',
    });

    expect(paid.pagos).toHaveLength(1);
    expect(paid.cuenta.saldo_usd).toBeCloseTo(0.6);
    expect(paid.cuenta.estado_calc).toBe('parcial');
  });

  test('listCuentasPagos ignora periodos legacy no mensuales y conserva el mensual exacto', () => {
    const usuario = db.prepare(`
      INSERT INTO usuarios (username, password, nombre_completo, rol, comision_pct, activo, empresa_id)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run('pagos_test_periodo', '1234', 'Vendedor Periodo', 'vendedor', 10, 1);

    const producto = db.prepare(`
      INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('PAG-002', 'Producto periodo', 10, 5, 50, 1);

    const venta = db.prepare(`
      INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('2026-03-15', 'Cliente Periodo', 'Vendedor Periodo', 'EFECTIVO', 100, 10, usuario.lastInsertRowid);

    db.prepare(`
      INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(venta.lastInsertRowid, producto.lastInsertRowid, 1, 10, 5, 100);

    pagosService.generarCuentasDesdeReporte({ empresaId: 1, desde: '2026-01-20', hasta: '2026-03-31' });
    pagosService.generarCuentasDesdeReporte({ empresaId: 1, desde: '2026-02-01', hasta: '2026-03-31' });
    pagosService.generarCuentasDesdeReporte({ empresaId: 1, desde: '2026-03-01', hasta: '2026-03-31' });

    const legacy = pagosService.listCuentasPagos({ empresaId: 1, desde: '2026-01-20', hasta: '2026-03-31' });
    expect(legacy).toHaveLength(0);

    const mensuales = pagosService.listCuentasPagos({ empresaId: 1, desde: '2026-03-01', hasta: '2026-03-31' });
    expect(mensuales).toHaveLength(1);
    expect(mensuales[0].periodo_desde).toBe('2026-03-01');
    expect(mensuales[0].periodo_hasta).toBe('2026-03-31');
  });

  test('getResumenPagos ignora cuentas legacy no mensuales en el histórico', () => {
    const usuarioLegacy = db.prepare(`
      INSERT INTO usuarios (username, password, nombre_completo, rol, activo, empresa_id)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run('pagos_test_legacy', '1234', 'Legacy', 'vendedor', 1);

    const usuarioMensual = db.prepare(`
      INSERT INTO usuarios (username, password, nombre_completo, rol, activo, empresa_id)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run('pagos_test_mensual', '1234', 'Mensual', 'vendedor', 1);

    db.prepare(`
      INSERT INTO cuentas_comision (
        empresa_id, usuario_id, vendedor_nombre, periodo_desde, periodo_hasta,
        total_comision_usd, saldo_usd, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, usuarioLegacy.lastInsertRowid, 'Legacy', '2026-01-20', '2026-03-31', 999, 999, 'pendiente');

    db.prepare(`
      INSERT INTO cuentas_comision (
        empresa_id, usuario_id, vendedor_nombre, periodo_desde, periodo_hasta,
        total_comision_usd, saldo_usd, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, usuarioMensual.lastInsertRowid, 'Mensual', '2026-03-01', '2026-03-31', 100, 100, 'pendiente');

    const resumen = pagosService.getResumenPagos(1);
    const pendiente = resumen.find((row) => row.estado === 'pendiente');

    expect(Number(pendiente?.saldo_usd || 0)).toBeCloseTo(100);
    expect(Number(pendiente?.cantidad || 0)).toBe(1);
  });
});