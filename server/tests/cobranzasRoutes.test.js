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

  test('GET /cobranzas rechaza superadmin con 403', async () => {
    const { token } = createTestUserAndToken({ rol: 'superadmin', empresaId: null });
    const app = buildApp();

    const res = await request(app)
      .get('/cobranzas')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /cobranzas solo devuelve cuentas vinculadas a la empresa del usuario', async () => {
    const app = buildApp();

    // Limpiar datos previos
    resetCobranzasData();
    db.prepare('DELETE FROM ventas').run();

    // Empresa A (id=1) y empresa B
    const empresaAId = 1;
    const infoEmpB = db
      .prepare("INSERT INTO empresas (nombre, codigo, estado) VALUES ('Empresa Cob B', 'EMPCOB', 'activa')")
      .run();
    const empresaBId = infoEmpB.lastInsertRowid;

    // Usuarios para cada empresa
    const { userId: userAId, token: tokenA } = createTestUserAndToken({ rol: 'admin', empresaId: empresaAId });
    const { userId: userBId, token: tokenB } = createTestUserAndToken({ rol: 'admin', empresaId: empresaBId });

    // Ventas para cada empresa
    const ventaA = db
      .prepare(`INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
                VALUES (datetime('now'), 'Cliente Cob A', 'Vend A', 'EFECTIVO', 100, 10, ?)`)
      .run(userAId);

    const ventaB = db
      .prepare(`INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
                VALUES (datetime('now'), 'Cliente Cob B', 'Vend B', 'EFECTIVO', 200, 10, ?)`)
      .run(userBId);

    // Cuentas por cobrar ligadas a cada venta
    db
      .prepare(`INSERT INTO cuentas_cobrar (cliente_nombre, cliente_doc, venta_id, total_usd, tasa_bcv, saldo_usd, fecha_emision, fecha_vencimiento, estado, notas, creado_en, actualizado_en)
                VALUES ('Cliente Cob A', 'V-100', ?, 10, 10, 10, datetime('now'), datetime('now','+30 day'), 'pendiente', 'CC A', datetime('now'), datetime('now'))`)
      .run(ventaA.lastInsertRowid);

    db
      .prepare(`INSERT INTO cuentas_cobrar (cliente_nombre, cliente_doc, venta_id, total_usd, tasa_bcv, saldo_usd, fecha_emision, fecha_vencimiento, estado, notas, creado_en, actualizado_en)
                VALUES ('Cliente Cob B', 'V-200', ?, 20, 10, 20, datetime('now'), datetime('now','+30 day'), 'pendiente', 'CC B', datetime('now'), datetime('now'))`)
      .run(ventaB.lastInsertRowid);

    const resA = await request(app)
      .get('/cobranzas')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(200);
    expect(Array.isArray(resA.body)).toBe(true);
    const clientesA = resA.body.map((c) => c.cliente_nombre);
    expect(clientesA).toContain('Cliente Cob A');
    expect(clientesA).not.toContain('Cliente Cob B');

    const resB = await request(app)
      .get('/cobranzas')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(Array.isArray(resB.body)).toBe(true);
    const clientesB = resB.body.map((c) => c.cliente_nombre);
    expect(clientesB).toContain('Cliente Cob B');
    expect(clientesB).not.toContain('Cliente Cob A');
  });
});
