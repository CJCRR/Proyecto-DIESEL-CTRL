const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const cobranzasService = require(path.join('..', 'services', 'cobranzasService'));

function resetCobranzasData() {
  db.prepare('DELETE FROM pagos_cc').run();
  db.prepare('DELETE FROM cuentas_cobrar').run();
}

describe('cobranzasService cuentas por cobrar', () => {
  beforeEach(() => {
    resetCobranzasData();
  });

  test('crearCuenta inicializa saldo y estado correctamente', () => {
    const cuenta = cobranzasService.crearCuenta({
      cliente_nombre: 'Cliente Test',
      cliente_doc: 'V-12345678',
      total_usd: 100,
      tasa_bcv: 10,
      notas: 'Prueba',
    });

    expect(cuenta).toBeDefined();
    expect(cuenta.total_usd).toBeCloseTo(100);
    expect(cuenta.saldo_usd).toBeCloseTo(100);
    expect(cuenta.estado_calc).toBe('pendiente');
  });

  test('registrarPago reduce saldo y marca cancelado con pago completo', () => {
    const cuenta = cobranzasService.crearCuenta({
      cliente_nombre: 'Cliente Test',
      total_usd: 50,
      tasa_bcv: 10,
    });

    const { cuenta: cuentaActualizada, pagos } = cobranzasService.registrarPago(
      cuenta.id,
      {
        monto: 50,
        moneda: 'USD',
        tasa_bcv: 10,
        metodo: 'EFECTIVO',
      }
    );

    expect(pagos.length).toBe(1);
    expect(cuentaActualizada.saldo_usd).toBeCloseTo(0);
    expect(cuentaActualizada.estado_calc).toBe('cancelado');
  });

  test('listCuentas filtra por cliente', () => {
    cobranzasService.crearCuenta({
      cliente_nombre: 'Juan Perez',
      total_usd: 10,
      tasa_bcv: 10,
    });
    cobranzasService.crearCuenta({
      cliente_nombre: 'Maria Lopez',
      total_usd: 20,
      tasa_bcv: 10,
    });

    const lista = cobranzasService.listCuentas({ cliente: 'juan' });
    expect(lista.length).toBe(1);
    expect(lista[0].cliente_nombre).toContain('Juan');
  });
});
