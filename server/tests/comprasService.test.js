const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const comprasService = require(path.join('..', 'services', 'comprasService'));

function resetComprasData() {
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
    const user = db
      .prepare(
        'INSERT INTO usuarios (username, password, rol, activo) VALUES (?,?,?,1)'
      )
      .run('compras_tester', 'testpass', 'admin');

    const prov = db
      .prepare(
        'INSERT INTO proveedores (nombre, rif, telefono, email, direccion, notas, activo) VALUES (?,?,?,?,?,?,1)'
      )
      .run('Proveedor Test', 'J-123', '', '', '', '');

    const prod = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, proveedor_id) VALUES (?,?,?,?,?,?)'
      )
      .run('CP-1', 'Producto Compra', 0, 0, 0, prov.lastInsertRowid);

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
      { id: user.lastInsertRowid }
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
});
