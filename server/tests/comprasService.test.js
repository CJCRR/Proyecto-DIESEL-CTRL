const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const comprasService = require(path.join('..', 'services', 'comprasService'));

function resetComprasData() {
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM depositos').run();
  db.prepare('DELETE FROM compra_detalle').run();
  db.prepare('DELETE FROM compras').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare('DELETE FROM proveedores').run();
}

describe('comprasService.crearCompra', () => {
  beforeEach(() => {
    resetComprasData();
  });

  test('crea compra, detalle y actualiza stock/costo', () => {
    const empresaId = 1;

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?,?,?,?,1)'
      )
      .run(empresaId, 'Dep Compras', 'DC1', 1);
    const depositoId = depInfo.lastInsertRowid;

    const user = db
      .prepare(
        'INSERT INTO usuarios (username, password, rol, activo, empresa_id) VALUES (?,?,?,?,?)'
      )
      .run('compras_tester', 'testpass', 'admin', 1, empresaId);

    const prov = db
      .prepare(
        'INSERT INTO proveedores (nombre, rif, telefono, email, direccion, notas, activo) VALUES (?,?,?,?,?,?,1)'
      )
      .run('Proveedor Test', 'J-123', '', '', '', '');

    const prod = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, proveedor_id, empresa_id, deposito_id) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run('CP-1', 'Producto Compra', 0, 0, 0, prov.lastInsertRowid, empresaId, depositoId);

    // Inicializar stock_por_deposito en 0 (comprasService sumará sobre este depósito)
    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?,?,?,?)'
    ).run(empresaId, prod.lastInsertRowid, depositoId, 0);

    const result = comprasService.crearCompra(
      {
        proveedor_id: prov.lastInsertRowid,
        fecha: '2024-01-01',
        numero: 'OC-001',
        tasa_bcv: 10,
        notas: 'Prueba compra',
        items: [
          {
            codigo: 'CP-1',
            cantidad: 3,
            costo_usd: 20,
            lote: 'L1',
            observaciones: 'Obs',
          },
        ],
      },
      { id: user.lastInsertRowid, empresa_id: empresaId }
    );

    expect(result).toBeDefined();
    expect(result.compra.total_usd).toBeCloseTo(60); // 3 * 20
    expect(result.compra.total_bs).toBeCloseTo(600); // * 10

    const detalles = result.detalles;
    expect(detalles.length).toBe(1);
    expect(detalles[0].cantidad).toBe(3);

    const prodDb = db.prepare('SELECT * FROM productos WHERE id = ?').get(prod.lastInsertRowid);
    expect(prodDb.stock).toBe(3);
    expect(prodDb.costo_usd).toBeCloseTo(20);
  });

  test('calcula correlativo de compra por empresa aunque los ids globales se intercalen', () => {
    const empresaA = 101;
    const empresaB = 202;

    const userA = db
      .prepare(
        'INSERT INTO usuarios (username, password, rol, activo, empresa_id) VALUES (?,?,?,?,?)'
      )
      .run('compras_seq_a', 'testpass', 'admin', 1, empresaA);

    const userB = db
      .prepare(
        'INSERT INTO usuarios (username, password, rol, activo, empresa_id) VALUES (?,?,?,?,?)'
      )
      .run('compras_seq_b', 'testpass', 'admin', 1, empresaB);

    const insertCompra = db.prepare(
      'INSERT INTO compras (proveedor_id, fecha, numero, tasa_bcv, total_bs, total_usd, estado, notas, usuario_id, empresa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const compraA1 = insertCompra.run(null, '2026-05-18T10:00:00.000Z', '', 1, 10, 10, 'recibida', '', userA.lastInsertRowid, empresaA).lastInsertRowid;
    const compraB1 = insertCompra.run(null, '2026-05-18T10:01:00.000Z', '', 1, 20, 20, 'recibida', '', userB.lastInsertRowid, empresaB).lastInsertRowid;
    const compraA2 = insertCompra.run(null, '2026-05-18T10:02:00.000Z', '', 1, 30, 30, 'recibida', '', userA.lastInsertRowid, empresaA).lastInsertRowid;

    const comprasEmpresaA = comprasService.listCompras({ limit: 10, empresaId: empresaA });
    expect(comprasEmpresaA).toHaveLength(2);
    expect(comprasEmpresaA.map((compra) => compra.id)).toEqual([compraA2, compraA1]);
    expect(comprasEmpresaA.map((compra) => compra.correlativo_empresa)).toEqual([2, 1]);

    const detalleCompraEmpresaB = comprasService.getCompra(compraB1, empresaB);
    expect(detalleCompraEmpresaB).toBeDefined();
    expect(detalleCompraEmpresaB.compra.correlativo_empresa).toBe(1);
  });
});
