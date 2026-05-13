const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const productosAdminRoutes = require(path.join('..', 'routes', 'productos_admin'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetInventarioProductos() {
  db.prepare('DELETE FROM auditoria').run();
  db.prepare('DELETE FROM movimientos_deposito').run();
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM ajustes_stock').run();
  db.prepare('DELETE FROM compra_detalle').run();
  db.prepare('DELETE FROM compras').run();
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
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

  test('DELETE /admin/productos/:codigo desactiva producto con historial y limpia stock actual', async () => {
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
    expect(String(res.body.message)).toMatch(/Producto desactivado/i);

    const prod = db
      .prepare('SELECT * FROM productos WHERE id = ?')
      .get(prodId);
    expect(prod).toBeDefined();
    expect(Number(prod.activo)).toBe(0);
    expect(Number(prod.stock)).toBe(0);

    const stockCount = db
      .prepare('SELECT COUNT(*) AS c FROM stock_por_deposito WHERE producto_id = ?')
      .get(prodId);
    expect(Number(stockCount.c)).toBe(0);

    const ajustesCount = db
      .prepare('SELECT COUNT(*) AS c FROM ajustes_stock WHERE producto_id = ?')
      .get(prodId);
    expect(Number(ajustesCount.c)).toBe(1);

    const movsCount = db
      .prepare('SELECT COUNT(*) AS c FROM movimientos_deposito WHERE producto_id = ?')
      .get(prodId);
    expect(Number(movsCount.c)).toBe(1);
  });

  test('POST /admin/productos/stock-depositos ajusta multi-depósito sin depender del depósito principal', async () => {
    const empresaId = 12;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const dep1Id = db.prepare(
      'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
    ).run(empresaId, 'Dep 1', 'D1', 1).lastInsertRowid;
    const dep2Id = db.prepare(
      'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
    ).run(empresaId, 'Dep 2', 'D2', 0).lastInsertRowid;

    const prodId = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('MDP1', 'Producto Multi', 10, 5, 5, 'CAT', 'MAR', empresaId, dep1Id).lastInsertRowid;

    db.prepare('INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)')
      .run(empresaId, prodId, dep1Id, 1);
    db.prepare('INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)')
      .run(empresaId, prodId, dep2Id, 4);

    const res = await request(app)
      .post('/admin/productos/stock-depositos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'MDP1',
        motivo: 'Conteo físico',
        deposito_principal_id: dep2Id,
        stock_por_deposito: [
          { deposito_id: dep1Id, cantidad: 1 },
          { deposito_id: dep2Id, cantidad: 2 },
        ],
      });

    expect(res.status).toBe(200);
    expect(String(res.body.message)).toMatch(/actualizado/i);
    expect(Number(res.body.stock_nuevo)).toBe(3);

    const prod = db.prepare('SELECT stock, deposito_id FROM productos WHERE id = ?').get(prodId);
    expect(Number(prod.stock)).toBe(3);
    expect(Number(prod.deposito_id)).toBe(dep2Id);

    const rows = db.prepare(
      'SELECT deposito_id, cantidad FROM stock_por_deposito WHERE producto_id = ? ORDER BY deposito_id'
    ).all(prodId);
    expect(rows).toEqual([
      { deposito_id: dep1Id, cantidad: 1 },
      { deposito_id: dep2Id, cantidad: 2 },
    ]);

    const ajuste = db.prepare(
      'SELECT diferencia, motivo FROM ajustes_stock WHERE producto_id = ? ORDER BY id DESC LIMIT 1'
    ).get(prodId);
    expect(Number(ajuste.diferencia)).toBe(-2);
    expect(String(ajuste.motivo)).toMatch(/Conteo físico/i);
  });

  test('GET /admin/productos/trazabilidad devuelve historial combinado del producto', async () => {
    const empresaId = 13;
    const { token, userId } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    const dep1Id = db.prepare(
      'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
    ).run(empresaId, 'Dep 1', 'D1', 1).lastInsertRowid;
    const dep2Id = db.prepare(
      'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?, ?, ?, ?, 1)'
    ).run(empresaId, 'Dep 2', 'D2', 0).lastInsertRowid;

    const prodId = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('TRZ1', 'Producto Traza', 10, 5, 7, 'CAT', 'MAR', empresaId, dep1Id).lastInsertRowid;

    db.prepare('INSERT INTO compras (proveedor_id, fecha, numero, tasa_bcv, total_bs, total_usd, estado, notas, usuario_id, empresa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(null, '2026-05-10T10:00:00.000Z', 'C-1', 40, 200, 5, 'recibida', '', userId, empresaId);
    const compraId = db.prepare('SELECT id FROM compras ORDER BY id DESC LIMIT 1').get().id;
    db.prepare('INSERT INTO compra_detalle (compra_id, producto_id, codigo, descripcion, marca, cantidad, costo_usd, subtotal_bs, lote, observaciones) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(compraId, prodId, 'TRZ1', 'Producto Traza', 'MAR', 5, 5, 200, 'L1', 'Compra inicial');

    db.prepare('INSERT INTO ventas (fecha, cliente, vendedor, cedula, telefono, tasa_bcv, descuento, metodo_pago, referencia, total_bs, iva_pct, total_bs_iva, total_usd_iva, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('2026-05-11T11:00:00.000Z', 'Cliente Demo', 'Vendedor', '', '', 40, 0, 'efectivo', '', 80, 0, 80, 2, userId);
    const ventaId = db.prepare('SELECT id FROM ventas ORDER BY id DESC LIMIT 1').get().id;
    db.prepare('INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs, deposito_id, marca) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ventaId, prodId, 2, 10, 5, 80, dep1Id, 'MAR');

    db.prepare('INSERT INTO ajustes_stock (producto_id, diferencia, motivo, fecha) VALUES (?, ?, ?, ?)')
      .run(prodId, -1, 'Conteo', '2026-05-12T08:00:00.000Z');
    db.prepare('INSERT INTO movimientos_deposito (empresa_id, producto_id, deposito_origen_id, deposito_destino_id, cantidad, motivo, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(empresaId, prodId, dep1Id, dep2Id, 1, 'Reubicación', '2026-05-12T09:00:00.000Z');
    db.prepare('INSERT INTO auditoria (usuario_id, empresa_id, accion, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, empresaId, 'AJUSTE_STOCK_DEPOSITOS', 'producto', prodId, JSON.stringify({
        codigo: 'TRZ1',
        motivo: 'Conteo por depósito',
        stock_anterior: 8,
        stock_nuevo: 7,
        antes: [{ deposito_id: dep1Id, cantidad: 6 }, { deposito_id: dep2Id, cantidad: 2 }],
        despues: [{ deposito_id: dep1Id, cantidad: 5 }, { deposito_id: dep2Id, cantidad: 2 }],
      }));
    db.prepare('INSERT INTO auditoria (usuario_id, empresa_id, accion, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, empresaId, 'REBUILD_STOCK_PRODUCTO', 'producto', prodId, JSON.stringify({
        codigo: 'TRZ1',
        motivo: 'Rebuild manual desde inventario',
        stock_anterior: 9,
        stock_nuevo: 7,
      }));

    const res = await request(app)
      .get('/admin/productos/trazabilidad?codigo=TRZ1&limit=20')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    const tipos = res.body.items.map((item) => item.tipo);
    expect(tipos).toContain('compra');
    expect(tipos).toContain('venta');
    expect(tipos).toContain('ajuste');
    expect(tipos).toContain('movimiento');
    expect(tipos).toContain('correccion_stock_depositos');
    expect(tipos).toContain('rebuild_stock');
  });
});
