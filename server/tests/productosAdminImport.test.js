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

describe('Importación CSV /admin/productos/import (modos reconteo/adicional)', () => {
  beforeEach(() => {
    resetInventarioProductos();
  });

  test('mode=adicional suma stock al total y al depósito objetivo', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    // Depósito principal y secundario
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

    // Producto con stock repartido en dos depósitos: 7 en principal, 3 en secundario (total 10)
    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        'MULTI',
        'Producto Multi',
        10,
        5,
        10,
        'CAT',
        'MAR',
        empresaId,
        depPrincipalId
      );
    const prodId = prodInfo.lastInsertRowid;

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depPrincipalId, 7);
    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depSecundarioId, 3);

    // CSV: incremento de 5 unidades en depósito secundario (DEP2)
    const csv = [
      'codigo;descripcion;precio_usd;costo_usd;stock;categoria;marca;deposito_codigo',
      'MULTI;Producto Multi;10;5;5;CAT;MAR;DEP2',
    ].join('\r\n');

    const res = await request(app)
      .post('/admin/productos/import?mode=adicional')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');

    const prod = db
      .prepare('SELECT stock, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?')
      .get('MULTI', empresaId);
    // Stock total: 10 + 5 = 15
    expect(Number(prod.stock)).toBe(15);
    // El depósito objetivo pasa a ser el secundario
    expect(prod.deposito_id).toBe(depSecundarioId);

    const stockRows = db
      .prepare(
        'SELECT deposito_id, cantidad FROM stock_por_deposito WHERE producto_id = ? ORDER BY deposito_id'
      )
      .all(prodId);
    const depPrincipal = stockRows.find((r) => r.deposito_id === depPrincipalId);
    const depSecundario = stockRows.find((r) => r.deposito_id === depSecundarioId);

    // Principal se mantiene igual, secundario suma el incremento
    expect(Number(depPrincipal.cantidad)).toBe(7);
    expect(Number(depSecundario.cantidad)).toBe(8);
  });

  test('mode=reconteo reemplaza stock del depósito objetivo y recalcula total', async () => {
    const empresaId = 2;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const depPrincipalInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep A', 'DA', 1);
    const depSecundarioInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep B', 'DB', 0);

    const depAId = depPrincipalInfo.lastInsertRowid;
    const depBId = depSecundarioInfo.lastInsertRowid;

    // Producto con 5 en A y 7 en B (total 12)
    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('MULTI2', 'Producto Multi 2', 20, 10, 12, 'CAT', 'MAR', empresaId, depAId);
    const prodId = prodInfo.lastInsertRowid;

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depAId, 5);
    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depBId, 7);

    // CSV: reconteo de depósito B a 10 unidades
    const csv = [
      'codigo;descripcion;precio_usd;costo_usd;stock;categoria;marca;deposito_codigo',
      'MULTI2;Producto Multi 2;20;10;10;CAT;MAR;DB',
    ].join('\r\n');

    const res = await request(app)
      .post('/admin/productos/import?mode=reconteo')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(csv);

    expect(res.status).toBe(200);

    const prod = db
      .prepare('SELECT stock, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?')
      .get('MULTI2', empresaId);

    // Total = otros depósitos (A:5) + nuevo valor en B (10) = 15
    expect(Number(prod.stock)).toBe(15);
    // El depósito principal del producto pasa a ser B, el objetivo del reconteo
    expect(prod.deposito_id).toBe(depBId);

    const stockRows = db
      .prepare(
        'SELECT deposito_id, cantidad FROM stock_por_deposito WHERE producto_id = ? ORDER BY deposito_id'
      )
      .all(prodId);
    const depA = stockRows.find((r) => r.deposito_id === depAId);
    const depB = stockRows.find((r) => r.deposito_id === depBId);

    // A mantiene sus 5 unidades, B queda exactamente en 10
    expect(Number(depA.cantidad)).toBe(5);
    expect(Number(depB.cantidad)).toBe(10);
  });

  test('modo legacy sin mode: un solo depósito interpreta el stock como total nuevo', async () => {
    const empresaId = 3;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const depPrincipalInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep Legacy', 'DL', 1);
    const depId = depPrincipalInfo.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('LEG1', 'Producto Legacy', 10, 5, 10, 'CAT', 'MAR', empresaId, depId);
    const prodId = prodInfo.lastInsertRowid;

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depId, 10);

    const csv = [
      'codigo;descripcion;precio_usd;costo_usd;stock;categoria;marca;deposito_codigo',
      'LEG1;Producto Legacy;10;5;7;CAT;MAR;',
    ].join('\r\n');

    const res = await request(app)
      .post('/admin/productos/import') // sin mode => legacy
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(csv);

    expect(res.status).toBe(200);

    const prod = db
      .prepare('SELECT stock, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?')
      .get('LEG1', empresaId);
    expect(Number(prod.stock)).toBe(7);
    expect(prod.deposito_id).toBe(depId);

    const row = db
      .prepare('SELECT cantidad FROM stock_por_deposito WHERE producto_id = ? AND deposito_id = ?')
      .get(prodId, depId);
    expect(Number(row.cantidad)).toBe(7);
  });

  test('modo legacy sin mode con multi-depósitos y depósito en CSV suma solo en ese depósito', async () => {
    const empresaId = 4;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const depAInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep A', 'DLA', 1);
    const depBInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaId, 'Dep B', 'DLB', 0);

    const depAId = depAInfo.lastInsertRowid;
    const depBId = depBInfo.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('LEG2', 'Producto Legacy 2', 10, 5, 10, 'CAT', 'MAR', empresaId, depAId);
    const prodId = prodInfo.lastInsertRowid;

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depAId, 7);
    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaId, prodId, depBId, 3);

    // CSV indica 4 unidades adicionales para el depósito B (DLB)
    const csv = [
      'codigo;descripcion;precio_usd;costo_usd;stock;categoria;marca;deposito_codigo',
      'LEG2;Producto Legacy 2;10;5;4;CAT;MAR;DLB',
    ].join('\r\n');

    const res = await request(app)
      .post('/admin/productos/import') // sin mode => legacy
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(csv);

    expect(res.status).toBe(200);

    const prod = db
      .prepare('SELECT stock, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?')
      .get('LEG2', empresaId);

    // Total = stock actual (10) + 4 unidades adicionales
    expect(Number(prod.stock)).toBe(14);
    // El depósito principal del producto pasa a ser el indicado en CSV
    expect(prod.deposito_id).toBe(depBId);

    const stockRows = db
      .prepare(
        'SELECT deposito_id, cantidad FROM stock_por_deposito WHERE producto_id = ? ORDER BY deposito_id'
      )
      .all(prodId);
    const depA = stockRows.find((r) => r.deposito_id === depAId);
    const depB = stockRows.find((r) => r.deposito_id === depBId);

    expect(Number(depA.cantidad)).toBe(7);
    expect(Number(depB.cantidad)).toBe(7); // 3 + 4 adicionales
  });

  test('importar en una empresa no modifica productos de otra (multiempresa)', async () => {
    const empresaA = 5;
    const empresaB = 6;

    const { token } = createTestUserAndToken({ rol: 'admin', empresaId: empresaA });
    const app = buildApp();

    // Depósitos por empresa
    const depAInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaA, 'Dep A EmpA', 'DAA', 1);
    const depBInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
      )
      .run(empresaB, 'Dep B EmpB', 'DBB', 1);

    const depAId = depAInfo.lastInsertRowid;
    const depBId = depBInfo.lastInsertRowid;

    // Producto existente solo en empresa B
    const prodBInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('MX', 'Multi Empresa', 10, 5, 20, 'CAT', 'MAR', empresaB, depBId);
    const prodBId = prodBInfo.lastInsertRowid;

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)'
    ).run(empresaB, prodBId, depBId, 20);

    const csv = [
      'codigo;descripcion;precio_usd;costo_usd;stock;categoria;marca;deposito_codigo',
      'MX;Multi Empresa;10;5;7;CAT;MAR;DAA',
      // segunda fila con otro código para forzar al menos una inserción en empresa A
      'MX2;Otro Prod;10;5;3;CAT;MAR;DAA',
    ].join('\r\n');

    const res = await request(app)
      .post('/admin/productos/import?mode=reconteo')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(csv);

    expect(res.status).toBe(200);

    // Producto original de empresa B permanece igual
    const prodB = db
      .prepare('SELECT stock, empresa_id, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?')
      .get('MX', empresaB);
    expect(prodB).toBeDefined();
    expect(Number(prodB.stock)).toBe(20);

    // Se crea un nuevo producto homónimo para empresa A
    // No se debe haber creado un producto MX en empresa A porque el código ya existía en empresa B
    const prodA_mx = db
      .prepare('SELECT stock, empresa_id, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?')
      .get('MX', empresaA);
    expect(prodA_mx).toBeUndefined();

    // Pero sí se crea MX2 para empresa A, sin afectar los productos de empresa B
    const prodA_mx2 = db
      .prepare('SELECT stock, empresa_id, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?')
      .get('MX2', empresaA);
    expect(prodA_mx2).toBeDefined();
    expect(Number(prodA_mx2.stock)).toBe(3);
    expect(prodA_mx2.empresa_id).toBe(empresaA);
    expect(prodA_mx2.deposito_id).toBe(depAId);
  });
});
