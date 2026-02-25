const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const depositosRoutes = require(path.join('..', 'routes', 'depositos'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetInventarioDepositos() {
  db.prepare('DELETE FROM movimientos_deposito').run();
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM ajustes_stock').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare('DELETE FROM depositos').run();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/depositos', depositosRoutes);
  return app;
}

describe('Rutas HTTP /depositos (multi-depósito)', () => {
  beforeEach(() => {
    resetInventarioDepositos();
  });

  test('POST /depositos/mover mueve stock entre depósitos y registra movimiento', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    // Crear depósitos de prueba
    const depPrincipalInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep Principal', 'DEP1', 1);
    const depSecundarioInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep Secundario', 'DEP2', 0);

    const depPrincipalId = depPrincipalInfo.lastInsertRowid;
    const depSecundarioId = depSecundarioInfo.lastInsertRowid;

    // Producto con stock en depósito principal
    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        'P-MULTI',
        'Producto Multi-Depósito',
        10,
        5,
        10,
        'TEST',
        'MARCA',
        empresaId,
        depPrincipalId
      );

    const prodId = prodInfo.lastInsertRowid;

    // Distribución inicial: 10 unidades en depósito principal
    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depPrincipalId, 10);

    const res = await request(app)
      .post('/depositos/mover')
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'P-MULTI',
        deposito_origen_id: depPrincipalId,
        deposito_destino_id: depSecundarioId,
        cantidad: 4,
        motivo: 'Prueba movimiento',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(String(res.body.message)).toMatch(/Movimiento de stock registrado/i);

    // Verificar distribución en stock_por_deposito
    const stockRows = db
      .prepare(
        'SELECT deposito_id, cantidad FROM stock_por_deposito WHERE producto_id = ? ORDER BY deposito_id'
      )
      .all(prodId);

    expect(stockRows.length).toBe(2);
    const origen = stockRows.find((r) => r.deposito_id === depPrincipalId);
    const destino = stockRows.find((r) => r.deposito_id === depSecundarioId);
    expect(Number(origen.cantidad)).toBe(6);
    expect(Number(destino.cantidad)).toBe(4);

    // El stock total del producto no cambia con el movimiento entre depósitos
    const prod = db.prepare('SELECT stock FROM productos WHERE id = ?').get(prodId);
    expect(Number(prod.stock)).toBe(10);

    // Verificar que se registró el movimiento y que /depositos/movimientos lo devuelve filtrando por código
    const movsRes = await request(app)
      .get('/depositos/movimientos?limit=10&codigo=P-MULTI')
      .set('Authorization', `Bearer ${token}`);

    expect(movsRes.status).toBe(200);
    expect(Array.isArray(movsRes.body)).toBe(true);
    expect(movsRes.body.length).toBeGreaterThanOrEqual(1);
    const mov = movsRes.body[0];
    expect(mov).toHaveProperty('producto_codigo', 'P-MULTI');
    expect(Number(mov.cantidad)).toBe(4);
  });

  test('POST /depositos/mover infiere depósito origen cuando no se envía y solo hay uno con stock', async () => {
    const empresaId = 2;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const depPrincipalInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep A', 'A1', 1);
    const depSecundarioInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep B', 'B1', 0);

    const depAId = depPrincipalInfo.lastInsertRowid;
    const depBId = depSecundarioInfo.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('P-INF', 'Producto Inferido', 10, 5, 8, 'TEST', 'MARCA', empresaId, depAId);

    const prodId = prodInfo.lastInsertRowid;

    // Solo un depósito con stock positivo
    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depAId, 8);

    const res = await request(app)
      .post('/depositos/mover')
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'P-INF',
        deposito_destino_id: depBId,
        cantidad: 3,
        motivo: 'Inferir origen',
      });

    expect(res.status).toBe(200);

    const stockRows = db
      .prepare(
        'SELECT deposito_id, cantidad FROM stock_por_deposito WHERE producto_id = ? ORDER BY deposito_id'
      )
      .all(prodId);

    expect(stockRows.length).toBe(2);
    const depA = stockRows.find((r) => r.deposito_id === depAId);
    const depB = stockRows.find((r) => r.deposito_id === depBId);
    expect(Number(depA.cantidad)).toBe(5);
    expect(Number(depB.cantidad)).toBe(3);

    const prod = db.prepare('SELECT stock, deposito_id FROM productos WHERE id = ?').get(prodId);
    expect(Number(prod.stock)).toBe(8);
    // Como no se movió todo el stock, el deposito_id del producto se mantiene
    expect(prod.deposito_id).toBe(depAId);
  });

  test('POST /depositos/mover rechaza usuario sin empresa (superadmin global)', async () => {
    const { token } = createTestUserAndToken({ rol: 'superadmin', empresaId: null });
    const app = buildApp();

    const res = await request(app)
      .post('/depositos/mover')
      .set('Authorization', `Bearer ${token}`)
      .send({ codigo: 'X', deposito_destino_id: 1, cantidad: 1 });

    // El middleware de rol bloquea primero al superadmin global
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
    expect(String(res.body.error)).toMatch(/Permisos insuficientes/i);
  });

  test('GET /depositos/movimientos respeta empresa_id y no muestra movimientos de otras empresas', async () => {
    const empresaA = 20;
    const empresaB = 21;

    const { token } = createTestUserAndToken({ rol: 'admin', empresaId: empresaA });
    const app = buildApp();

    // Crear depósitos y producto solo para empresa B
    const depB1Info = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaB, 'Dep B1', 'DB1', 1);
    const depB2Info = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaB, 'Dep B2', 'DB2', 0);

    const depB1Id = depB1Info.lastInsertRowid;
    const depB2Id = depB2Info.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('CROSS', 'Producto Otra Empresa', 10, 5, 5, 'CAT', 'MAR', empresaB, depB1Id);
    const prodId = prodInfo.lastInsertRowid;

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaB, prodId, depB1Id, 5);

    db.prepare(
      'INSERT INTO movimientos_deposito (empresa_id, producto_id, deposito_origen_id, deposito_destino_id, cantidad, motivo) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(empresaB, prodId, depB1Id, depB2Id, 2, 'Mov otra empresa');

    const res = await request(app)
      .get('/depositos/movimientos?limit=10&codigo=CROSS')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Usuario de empresa A no debe ver movimientos de empresa B
    expect(res.body.length).toBe(0);
  });
});

