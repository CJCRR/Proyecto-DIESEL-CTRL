const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const devolucionesService = require(path.join('..', 'services', 'devolucionesService'));

function resetDevolucionesData() {
  db.prepare('DELETE FROM devolucion_detalle').run();
  db.prepare('DELETE FROM devoluciones').run();
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare("DELETE FROM config WHERE clave = 'devolucion_politica'").run();
}

describe('devolucionesService.registrarDevolucion', () => {
  beforeEach(() => {
    resetDevolucionesData();
  });

  test('registra devolución simple sin venta original, suma stock y totales', () => {
    const insertProducto = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, stock) VALUES (?,?,?,?)'
    );

    const prodInfo = insertProducto.run('DEV-1', 'Producto Devolución', 10, 0);

    const { devolucionId, total_bs, total_usd } =
      devolucionesService.registrarDevolucion({
        items: [{ codigo: 'DEV-1', cantidad: 2 }],
        cliente: 'Cliente Dev',
        cedula: 'V-9999999',
        telefono: '0414-0000000',
        tasa_bcv: 10,
        referencia: 'DEV-REF',
        motivo: 'Prueba',
      });

    expect(devolucionId).toBeDefined();
    expect(total_usd).toBeCloseTo(20); // 2 * 10
    expect(total_bs).toBeCloseTo(200); // 20 * 10

    const dev = db
      .prepare('SELECT * FROM devoluciones WHERE id = ?')
      .get(devolucionId);
    expect(dev.total_usd).toBeCloseTo(20);
    expect(dev.total_bs).toBeCloseTo(200);

    const detalle = db
      .prepare('SELECT * FROM devolucion_detalle WHERE devolucion_id = ?')
      .all(devolucionId);
    expect(detalle.length).toBe(1);
    expect(detalle[0].cantidad).toBe(2);

    const prod = db
      .prepare('SELECT * FROM productos WHERE id = ?')
      .get(prodInfo.lastInsertRowid);
    expect(prod.stock).toBe(2); // 0 + 2
  });

  test('respeta política deshabilitada en config.devolucion_politica', () => {
    resetDevolucionesData();

    const policy = { habilitado: false };
    db.prepare(
      'INSERT INTO config (clave, valor, actualizado_en) VALUES (?,?,?)'
    ).run('devolucion_politica', JSON.stringify(policy), new Date().toISOString());

    expect(() => {
      devolucionesService.registrarDevolucion({
        items: [{ codigo: 'X', cantidad: 1 }],
        cliente: 'Prueba',
        tasa_bcv: 10,
      });
    }).toThrow(/deshabilitadas/);
  });
});
