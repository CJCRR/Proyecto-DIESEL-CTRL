const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const cobranzasRoutes = require(path.join('..', 'routes', 'cobranzas'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetCobranzasData() {
  db.prepare('DELETE FROM pagos_cc').run();
  db.prepare('DELETE FROM cuentas_cobrar').run();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/cobranzas', cobranzasRoutes);
  return app;
}

describe('Rutas HTTP /cobranzas', () => {
  beforeEach(() => {
    resetCobranzasData();
  });

  test('POST /cobranzas crea cuenta válida y responde 200', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    const payload = {
      cliente_nombre: 'Cliente HTTP CC',
      cliente_doc: 'V-12345678',
      total_usd: 100,
      tasa_bcv: 10,
      fecha_vencimiento: '2030-01-01',
      notas: 'Cuenta prueba',
    };

    const res = await request(app)
      .post('/cobranzas')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('saldo_usd');
    expect(res.body.saldo_usd).toBeCloseTo(100);
  });

  test('POST /cobranzas con total inválido retorna 400', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    const payload = {
      cliente_nombre: 'Cliente HTTP CC',
      total_usd: 0,
      tasa_bcv: 10,
    };

    const res = await request(app)
      .post('/cobranzas')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /cobranzas/:id/pago registra pago y reduce saldo', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    // Crear cuenta base directamente via servicio HTTP
    const createRes = await request(app)
      .post('/cobranzas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cliente_nombre: 'Cliente Pago',
        total_usd: 50,
        tasa_bcv: 10,
        fecha_vencimiento: '2030-01-01',
      });

    expect(createRes.status).toBe(200);
    const cuentaId = createRes.body.id;

    const pagoRes = await request(app)
      .post(`/cobranzas/${cuentaId}/pago`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: 50, moneda: 'USD', tasa_bcv: 10 });

    expect(pagoRes.status).toBe(200);
    expect(pagoRes.body).toHaveProperty('cuenta');
    expect(pagoRes.body.cuenta.saldo_usd).toBeCloseTo(0);
  });
});
