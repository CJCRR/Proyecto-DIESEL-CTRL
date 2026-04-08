const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const { registrarVenta, anularVenta, cambiarVendedorVenta } = require(path.join('..', 'services', 'ventasService'));

function resetVentasData() {
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM depositos').run();
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM cuentas_cobrar').run();
  db.prepare('DELETE FROM productos').run();
}

describe('ventasService.registrarVenta', () => {
  beforeEach(() => {
    resetVentasData();
  });

  test('registra una venta de contado y descuenta stock', () => {
    const empresaId = 1;

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?,?,?,?,1)'
      )
      .run(empresaId, 'Dep Ventas', 'DV1', 1);
    const depositoId = depInfo.lastInsertRowid;

    const insertProducto = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id, deposito_id) VALUES (?,?,?,?,?,?,?)'
    );

    const prod = insertProducto.run('COD-1', 'Producto Test', 10, 5, 5, empresaId, depositoId);

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?,?,?,?)'
    ).run(empresaId, prod.lastInsertRowid, depositoId, 5);

    const { ventaId, cuentaCobrarId } = registrarVenta({
      items: [{ codigo: 'COD-1', cantidad: 2 }],
      cliente: 'Cliente Contado',
      vendedor: 'Vendedor 1',
      tasa_bcv: 10,
      descuento: 0,
      metodo_pago: 'EFECTIVO',
      usuario_id: null,
      credito: false,
      iva_pct: 0,
      empresa_id: empresaId,
    });

    expect(ventaId).toBeDefined();
    expect(cuentaCobrarId).toBeNull();

    const venta = db
      .prepare('SELECT * FROM ventas WHERE id = ?')
      .get(ventaId);
    expect(venta).toBeDefined();
    expect(Number(venta.total_bs)).toBeCloseTo(200); // 2 * 10 * tasa 10

    const detalle = db
      .prepare('SELECT * FROM venta_detalle WHERE venta_id = ?')
      .all(ventaId);
    expect(detalle.length).toBe(1);
    expect(detalle[0].cantidad).toBe(2);

    const producto = db
      .prepare('SELECT * FROM productos WHERE id = ?')
      .get(prod.lastInsertRowid);
    expect(producto.stock).toBe(3); // 5 - 2
  });

  test('registra una venta a crédito y crea cuenta por cobrar', () => {
    const empresaId = 1;

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?,?,?,?,1)'
      )
      .run(empresaId, 'Dep Ventas 2', 'DV2', 1);
    const depositoId = depInfo.lastInsertRowid;

    const insertProducto = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id, deposito_id) VALUES (?,?,?,?,?,?,?)'
    );

    const prod = insertProducto.run('COD-2', 'Producto Credito', 50, 20, 10, empresaId, depositoId);

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?,?,?,?)'
    ).run(empresaId, prod.lastInsertRowid, depositoId, 10);

    const { ventaId, cuentaCobrarId } = registrarVenta({
      items: [{ codigo: 'COD-2', cantidad: 1 }],
      cliente: 'Cliente Crédito',
      vendedor: 'Vendedor 2',
      tasa_bcv: 10,
      descuento: 0,
      metodo_pago: 'EFECTIVO',
      usuario_id: null,
      credito: true,
      dias_vencimiento: 30,
      iva_pct: 0,
      cliente_doc: 'V-12345678',
      empresa_id: empresaId,
    });

    expect(ventaId).toBeDefined();
    expect(cuentaCobrarId).toBeDefined();

    const cuenta = db
      .prepare('SELECT * FROM cuentas_cobrar WHERE id = ?')
      .get(cuentaCobrarId);
    expect(cuenta).toBeDefined();
    expect(cuenta.venta_id).toBe(ventaId);
    expect(Number(cuenta.total_usd)).toBeCloseTo(50);
    expect(Number(cuenta.saldo_usd)).toBeCloseTo(50);
  });

  test('lanza error si el carrito está vacío', () => {
    expect(() => {
      registrarVenta({
        items: [],
        cliente: 'Sin items',
        tasa_bcv: 10,
        metodo_pago: 'EFECTIVO',
      });
    }).toThrow(/carrito está vacío/i);
  });

  test('anularVenta impide anular ventas de otra empresa', () => {
    const empresaAId = 1;
    const empresaBId = 2;

    const userA = db.prepare(`
      INSERT INTO usuarios (username, password, rol, empresa_id, activo)
      VALUES ('user_venta_A', 'x', 'admin', ?, 1)
    `).run(empresaAId);

    const userB = db.prepare(`
      INSERT INTO usuarios (username, password, rol, empresa_id, activo)
      VALUES ('user_venta_B', 'x', 'admin', ?, 1)
    `).run(empresaBId);

    const ventaB = db.prepare(`
      INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
      VALUES (datetime('now'), 'Cliente B', 'Vend B', 'EFECTIVO', 100, 10, ?)
    `).run(userB.lastInsertRowid);

    expect(() => {
      anularVenta({ ventaId: ventaB.lastInsertRowid, empresaId: empresaAId });
    }).toThrow(/otra empresa/i);
  });

  test('cambiarVendedorVenta impide asignar vendedor de otra empresa', () => {
    const empresaAId = 1;
    const empresaBId = 2;

    const userOrigen = db.prepare(`
      INSERT INTO usuarios (username, password, rol, empresa_id, activo)
      VALUES ('user_origen', 'x', 'vendedor', ?, 1)
    `).run(empresaAId);

    const userDestinoMisma = db.prepare(`
      INSERT INTO usuarios (username, password, rol, empresa_id, activo, comision_pct)
      VALUES ('user_destino_A', 'x', 'vendedor', ?, 1, 5)
    `).run(empresaAId);

    const userDestinoOtra = db.prepare(`
      INSERT INTO usuarios (username, password, rol, empresa_id, activo)
      VALUES ('user_destino_B', 'x', 'vendedor', ?, 1)
    `).run(empresaBId);

    const venta = db.prepare(`
      INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
      VALUES (datetime('now'), 'Cliente Venta', 'Vend Orig', 'EFECTIVO', 100, 10, ?)
    `).run(userOrigen.lastInsertRowid);

    // Cambio válido dentro de la misma empresa (no debe lanzar)
    const resultadoOk = cambiarVendedorVenta({
      ventaId: venta.lastInsertRowid,
      nuevoUsuarioId: userDestinoMisma.lastInsertRowid,
      empresaId: empresaAId,
    });
    expect(resultadoOk).toBeDefined();
    expect(resultadoOk.usuario_id).toBe(userDestinoMisma.lastInsertRowid);

    // Intento de asignar vendedor de otra empresa debe fallar
    expect(() => {
      cambiarVendedorVenta({
        ventaId: venta.lastInsertRowid,
        nuevoUsuarioId: userDestinoOtra.lastInsertRowid,
        empresaId: empresaAId,
      });
    }).toThrow(/otra empresa/i);
  });
});
