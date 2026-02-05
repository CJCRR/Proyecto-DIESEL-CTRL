const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const ajustesService = require(path.join('..', 'services', 'ajustesService'));

function resetAjustesData() {
  db.prepare('DELETE FROM ajustes_stock').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare("DELETE FROM config WHERE clave = 'tasa_bcv'").run();
}

describe('ajustesService', () => {
  beforeEach(() => {
    resetAjustesData();
  });

  test('ajustarStock modifica el stock y registra ajuste', () => {
    const insertProducto = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock) VALUES (?,?,?,?,?)'
    );

    insertProducto.run('AJ-1', 'Producto Ajuste', 10, 5, 5);

    ajustesService.ajustarStock({
      codigo: 'AJ-1',
      diferencia: -2,
      motivo: 'Ajuste prueba',
    });

    const prod = db.prepare('SELECT * FROM productos WHERE codigo = ?').get('AJ-1');
    expect(prod.stock).toBe(3);

    const ajustes = db.prepare('SELECT * FROM ajustes_stock WHERE producto_id = ?').all(prod.id);
    expect(ajustes.length).toBe(1);
    expect(ajustes[0].diferencia).toBe(-2);
  });

  test('obtener y guardar tasa BCV usan config', () => {
    const resGuardar = ajustesService.guardarTasaBcv(123.45);
    expect(resGuardar.ok).toBe(true);

    const { tasa_bcv } = ajustesService.obtenerTasaBcv();
    expect(tasa_bcv).toBeCloseTo(123.45);
  });

  test('obtenerConfigGeneral devuelve estructura por defecto sin config previa', () => {
    const cfg = ajustesService.obtenerConfigGeneral();
    expect(cfg.empresa).toBeDefined();
    expect(cfg.devolucion).toBeDefined();
    expect(cfg.nota).toBeDefined();
  });
});
