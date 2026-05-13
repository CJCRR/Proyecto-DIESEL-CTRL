const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const ajustesRoutes = require(path.join('..', 'routes', 'ajustes'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetAjustesRouteData() {
  db.prepare('DELETE FROM auditoria').run();
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare('DELETE FROM depositos').run();
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/admin/ajustes', ajustesRoutes);
  return app;
}

describe('Rutas HTTP /admin/ajustes', () => {
  beforeEach(() => {
    resetAjustesRouteData();
  });

  test('POST /admin/ajustes/rebuild-stock guarda auditoría detallada por producto corregido', async () => {
    const empresaId = 31;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const depId = db.prepare(
      'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
    ).run(empresaId, 'Depósito Principal', 'DP', 1).lastInsertRowid;

    const prod1Id = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('RB1', 'Producto Rebuild 1', 10, 5, 9, 'CAT', 'MAR', empresaId, depId).lastInsertRowid;
    const prod2Id = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('RB2', 'Producto Rebuild 2', 10, 5, 4, 'CAT', 'MAR', empresaId, depId).lastInsertRowid;

    db.prepare('INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)')
      .run(empresaId, prod1Id, depId, 6);
    db.prepare('INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)')
      .run(empresaId, prod2Id, depId, 4);

    const res = await request(app)
      .post('/admin/ajustes/rebuild-stock')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.actualizados).toBe(1);
    expect(Array.isArray(res.body.mismatches)).toBe(true);
    expect(res.body.mismatches[0]).toMatchObject({ codigo: 'RB1', stock_anterior: 9, stock_nuevo: 6 });

    const globalAudit = db.prepare(
      "SELECT accion, detalle FROM auditoria WHERE accion = 'REBUILD_STOCK_EMPRESA' ORDER BY id DESC LIMIT 1"
    ).get();
    expect(globalAudit).toBeDefined();

    const productAudit = db.prepare(
      "SELECT accion, entidad, entidad_id, detalle FROM auditoria WHERE accion = 'REBUILD_STOCK_PRODUCTO' AND entidad_id = ? ORDER BY id DESC LIMIT 1"
    ).get(prod1Id);
    expect(productAudit).toBeDefined();
    expect(productAudit.entidad).toBe('producto');

    const payload = JSON.parse(productAudit.detalle);
    expect(payload.codigo).toBe('RB1');
    expect(payload.stock_anterior).toBe(9);
    expect(payload.stock_nuevo).toBe(6);
    expect(payload.motivo).toMatch(/Rebuild manual/i);
  });
});