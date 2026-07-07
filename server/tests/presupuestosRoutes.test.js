const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const presupuestosRoutes = require(path.join('..', 'routes', 'presupuestos'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetPresupuestosData() {
  db.prepare('DELETE FROM presupuesto_detalle').run();
  db.prepare('DELETE FROM presupuestos').run();
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM depositos').run();
  db.prepare('DELETE FROM productos').run();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/presupuestos', presupuestosRoutes);
  return app;
}

describe('Rutas HTTP /presupuestos', () => {
  beforeEach(() => {
    resetPresupuestosData();
  });

  test('POST /presupuestos trata descuento como monto fijo en USD y la nota muestra el total correcto', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id) VALUES (?,?,?,?,?,?)'
    ).run('PRES-1', 'Producto Presupuesto', 865, 400, 10, empresaId);

    const createRes = await request(app)
      .post('/presupuestos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ codigo: 'PRES-1', cantidad: 1, precio_usd: 865 }],
        cliente: 'Cliente Presupuesto',
        cedula: 'V-12345678',
        telefono: '0412-0000000',
        tasa_bcv: 10,
        descuento: 15,
        notas: 'Prueba descuento fijo'
      });

    expect(createRes.status).toBe(200);
    expect(createRes.body).toHaveProperty('presupuestoId');

    const presupuesto = db.prepare('SELECT descuento, total_usd, total_bs, total_usd_iva, total_bs_iva FROM presupuestos WHERE id = ?').get(createRes.body.presupuestoId);

    expect(Number(presupuesto.descuento)).toBeCloseTo(15, 2);
    expect(Number(presupuesto.total_usd)).toBeCloseTo(850, 2);
    expect(Number(presupuesto.total_bs)).toBeCloseTo(8500, 2);
    expect(Number(presupuesto.total_usd_iva)).toBeCloseTo(850, 2);
    expect(Number(presupuesto.total_bs_iva)).toBeCloseTo(8500, 2);

    const notaRes = await request(app)
      .get(`/presupuestos/nota/${createRes.body.presupuestoId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(notaRes.status).toBe(200);
    expect(notaRes.text).toContain('$850.00 / Bs 8500.00');
    expect(notaRes.text).toContain('$15.00 / Bs 150.00');
  });

  test('POST /presupuestos acepta productos con stock 0 cuando no se envía deposito_id', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id, deposito_id) VALUES (?,?,?,?,?,?,?)'
    ).run('PRES-0', 'Producto sin stock', 25, 10, 0, empresaId, null);

    const createRes = await request(app)
      .post('/presupuestos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ codigo: 'PRES-0', cantidad: 1, precio_usd: 25, deposito_id: null }],
        cliente: 'Cliente Stock Cero',
        cedula: 'V-11111111',
        telefono: '0412-1111111',
        tasa_bcv: 10,
        descuento: 0,
        notas: 'Prueba stock cero'
      });

    expect(createRes.status).toBe(200);
    expect(createRes.body).toHaveProperty('presupuestoId');

    const detalle = db.prepare('SELECT codigo, cantidad, deposito_id FROM presupuesto_detalle WHERE presupuesto_id = ?').get(createRes.body.presupuestoId);
    expect(detalle).toMatchObject({ codigo: 'PRES-0', cantidad: 1, deposito_id: null });
  });
});