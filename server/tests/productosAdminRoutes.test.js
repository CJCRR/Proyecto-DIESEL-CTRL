const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const productosAdminRoutes = require(path.join('..', 'routes', 'productos_admin'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetInventarioProductos() {
  db.prepare('DELETE FROM movimientos_deposito').run();
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM ajustes_stock').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare('DELETE FROM depositos').run();
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ type: ['text/*', 'application/csv'], limit: '10mb' }));
  app.use('/admin/productos', productosAdminRoutes);
  return app;
}

describe('Rutas HTTP /admin/productos (inventario multi-depósito)', () => {
  beforeEach(() => {
    resetInventarioProductos();
  });

  test('POST /admin/productos crea producto con stock_por_deposito inicial', async () => {
    const empresaId = 10;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep Principal', 'DPR', 1);
    const depId = depInfo.lastInsertRowid;

    const res = await request(app)
      .post('/admin/productos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'NEWP',
        descripcion: 'Nuevo Producto',
        precio_usd: 10,
        costo_usd: 5,
        stock: 9,
        categoria: 'CAT',
        marca: 'MAR',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('codigo', 'NEWP');

    const prod = db
      .prepare('SELECT id, stock, empresa_id, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?')
      .get('NEWP', empresaId);
    expect(prod).toBeDefined();
    expect(prod.deposito_id).toBe(depId);
    expect(Number(prod.stock)).toBe(9);

    const row = db
      .prepare('SELECT cantidad FROM stock_por_deposito WHERE producto_id = ? AND deposito_id = ?')
      .get(prod.id, depId);
    expect(row).toBeDefined();
    expect(Number(row.cantidad)).toBe(9);
  });

  test('DELETE /admin/productos/:codigo borra producto y tablas auxiliares relacionadas', async () => {
    const empresaId = 11;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const dep1Info = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep 1', 'D1', 1);
    const dep2Info = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep 2', 'D2', 0);

    const dep1Id = dep1Info.lastInsertRowid;
    const dep2Id = dep2Info.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('DEL1', 'Producto Borrar', 10, 5, 5, 'CAT', 'MAR', empresaId, dep1Id);
    const prodId = prodInfo.lastInsertRowid;

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, dep1Id, 5);

    // La tabla ajustes_stock en este esquema no lleva empresa_id
    db.prepare(
      'INSERT INTO ajustes_stock (producto_id, diferencia, motivo) VALUES (?, ?, ?)'
    ).run(prodId, -1, 'Test ajuste');

    db.prepare(
      'INSERT INTO movimientos_deposito (empresa_id, producto_id, deposito_origen_id, deposito_destino_id, cantidad, motivo) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(empresaId, prodId, dep1Id, dep2Id, 2, 'Test mov');

    const res = await request(app)
      .delete('/admin/productos/DEL1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(String(res.body.message)).toMatch(/Producto eliminado/i);

    const prod = db
      .prepare('SELECT * FROM productos WHERE id = ?')
      .get(prodId);
    expect(prod).toBeUndefined();

    const stockCount = db
      .prepare('SELECT COUNT(*) AS c FROM stock_por_deposito WHERE producto_id = ?')
      .get(prodId);
    expect(Number(stockCount.c)).toBe(0);

    const ajustesCount = db
      .prepare('SELECT COUNT(*) AS c FROM ajustes_stock WHERE producto_id = ?')
      .get(prodId);
    expect(Number(ajustesCount.c)).toBe(0);

    const movsCount = db
      .prepare('SELECT COUNT(*) AS c FROM movimientos_deposito WHERE producto_id = ?')
      .get(prodId);
    expect(Number(movsCount.c)).toBe(0);
  });
});
