const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const reportesRoutes = require(path.join('..', 'routes', 'reportes'));
const { createTestUserAndToken } = require('./testAuthUtils');

function buildApp() {
  const app = express();
  app.use('/reportes', reportesRoutes);
  return app;
}

describe('Rutas HTTP /reportes', () => {
  test('GET /reportes/ventas-rango responde 200 y array JSON', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    const res = await request(app)
      .get('/reportes/ventas-rango?desde=2024-01-01&hasta=2024-01-02')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /reportes/rentabilidad/categorias responde 200 y array JSON', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    const res = await request(app)
      .get('/reportes/rentabilidad/categorias?desde=2024-01-01&hasta=2024-01-02')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /reportes/ventas devuelve número de venta por empresa', async () => {
    const app = buildApp();
    db.prepare('DELETE FROM venta_detalle').run();
    db.prepare('DELETE FROM ventas').run();

    const empresaAId = 1;
    const empresaBCode = `EMPB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const infoEmpB = db
      .prepare('INSERT INTO empresas (nombre, codigo, estado) VALUES (?, ?, ?)')
      .run('Empresa Test B', empresaBCode, 'activa');
    const empresaBId = infoEmpB.lastInsertRowid;

    const { userId: userAId, token: tokenA } = createTestUserAndToken({ rol: 'admin', empresaId: empresaAId });
    const { userId: userBId, token: tokenB } = createTestUserAndToken({ rol: 'admin', empresaId: empresaBId });

    const prodA = db
      .prepare('INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id) VALUES (?,?,?,?,?,?)')
      .run('DEV-01', 'Producto Dev A', 10, 5, 100, empresaAId);
    const prodB = db
      .prepare('INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id) VALUES (?,?,?,?,?,?)')
      .run('DEV-02', 'Producto Dev B', 12, 6, 100, empresaBId);

    const ventaA = db
      .prepare(`INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
                VALUES (datetime('now'), 'Cliente A', 'Vend A', 'EFECTIVO', 100, 10, ?)`)
      .run(userAId);
    db
      .prepare('INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs) VALUES (?,?,?,?,?,?)')
      .run(ventaA.lastInsertRowid, prodA.lastInsertRowid, 1, 10, 5, 100);

    const ventaB = db
      .prepare(`INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
                VALUES (datetime('now'), 'Cliente B', 'Vend B', 'EFECTIVO', 200, 10, ?)`)
      .run(userBId);
    db
      .prepare('INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs) VALUES (?,?,?,?,?,?)')
      .run(ventaB.lastInsertRowid, prodB.lastInsertRowid, 2, 12, 6, 200);

    const resA = await request(app)
      .get('/reportes/ventas')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resA.status).toBe(200);
    expect(Array.isArray(resA.body)).toBe(true);
    expect(resA.body.length).toBeGreaterThan(0);
    expect(resA.body[0]).toHaveProperty('nro_nota');
    expect(resA.body[0].nro_nota).toMatch(/^VENTA-/);
    expect(resA.body[0].cliente).toBe('Cliente A');
    expect(resA.body.some((row) => row.cliente === 'Cliente B')).toBe(false);

    const resB = await request(app)
      .get('/reportes/ventas')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(resB.status).toBe(200);
    expect(Array.isArray(resB.body)).toBe(true);
    expect(resB.body.length).toBeGreaterThan(0);
    expect(resB.body[0]).toHaveProperty('nro_nota');
    expect(resB.body[0].cliente).toBe('Cliente B');
    expect(resB.body.some((row) => row.cliente === 'Cliente A')).toBe(false);
  });

  test('GET /reportes/ventas-rango solo devuelve ventas de la empresa del usuario', async () => {
    const app = buildApp();

    // Limpiar ventas previas para este test
    db.prepare('DELETE FROM venta_detalle').run();
    db.prepare('DELETE FROM ventas').run();

    // Asegurar que exista al menos la empresa LOCAL (id=1) y crear otra empresa de prueba
    const empresaAId = 1;
    const infoEmpB = db
      .prepare("INSERT INTO empresas (nombre, codigo, estado) VALUES ('Empresa Test B', 'EMPB', 'activa')")
      .run();
    const empresaBId = infoEmpB.lastInsertRowid;

    // Crear usuarios para cada empresa
    const { userId: userAId, token: tokenA } = createTestUserAndToken({ rol: 'admin', empresaId: empresaAId });
    const { userId: userBId, token: tokenB } = createTestUserAndToken({ rol: 'admin', empresaId: empresaBId });

    // Producto compartido (no es crítico el empresa_id del producto aquí)
    const prod = db
      .prepare('INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id) VALUES (?,?,?,?,?,?)')
      .run('RPT-1', 'Prod Reporte', 10, 5, 100, empresaAId);

    // Venta empresa A
    const ventaA = db
      .prepare(`INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
                VALUES (datetime('now'), 'Cliente A', 'Vend A', 'EFECTIVO', 100, 10, ?)`)
      .run(userAId);
    db
      .prepare('INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs) VALUES (?,?,?,?,?,?)')
      .run(ventaA.lastInsertRowid, prod.lastInsertRowid, 1, 10, 5, 100);

    // Venta empresa B
    const ventaB = db
      .prepare(`INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
                VALUES (datetime('now'), 'Cliente B', 'Vend B', 'EFECTIVO', 200, 10, ?)`)
      .run(userBId);
    db
      .prepare('INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs) VALUES (?,?,?,?,?,?)')
      .run(ventaB.lastInsertRowid, prod.lastInsertRowid, 2, 10, 5, 200);

    const query = '/reportes/ventas-rango?desde=2024-01-01&hasta=2030-01-01';

    const resA = await request(app)
      .get(query)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(200);
    expect(Array.isArray(resA.body)).toBe(true);
    const clientesA = resA.body.map((r) => r.cliente);
    expect(clientesA).toContain('Cliente A');
    expect(clientesA).not.toContain('Cliente B');

    const resB = await request(app)
      .get(query)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(Array.isArray(resB.body)).toBe(true);
    const clientesB = resB.body.map((r) => r.cliente);
    expect(clientesB).toContain('Cliente B');
    expect(clientesB).not.toContain('Cliente A');
  });
});
