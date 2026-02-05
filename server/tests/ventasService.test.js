const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const { registrarVenta } = require(path.join('..', 'services', 'ventasService'));

function resetVentasData() {
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
    const insertProducto = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock) VALUES (?,?,?,?,?)'
    );

    const prod = insertProducto.run('COD-1', 'Producto Test', 10, 5, 5);

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
    const insertProducto = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock) VALUES (?,?,?,?,?)'
    );

    insertProducto.run('COD-2', 'Producto Credito', 50, 20, 10);

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
});
