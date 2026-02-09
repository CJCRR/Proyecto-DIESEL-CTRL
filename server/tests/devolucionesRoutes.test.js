const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const devolucionesRoutes = require(path.join('..', 'routes', 'devoluciones'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetDevolucionesData() {
  db.prepare('DELETE FROM devolucion_detalle').run();
  db.prepare('DELETE FROM devoluciones').run();
  db.prepare("DELETE FROM config WHERE clave = 'devolucion_politica'").run();
   db.prepare('DELETE FROM venta_detalle').run();
   db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM productos').run();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/devoluciones', devolucionesRoutes);
  return app;
}

describe('Rutas HTTP /devoluciones', () => {
  beforeEach(() => {
    resetDevolucionesData();
  });

  test('POST /devoluciones registra devolución simple y responde 200', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    // Crear producto base
    db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock) VALUES (?,?,?,?,?)'
    ).run('DEV-1', 'Producto Devolución', 10, 5, 0);

    const payload = {
      cliente: 'Cliente HTTP Dev',
      cedula: 'V-11111111',
      telefono: '0414-0000000',
      tasa_bcv: 10,
      items: [
        {
          codigo: 'DEV-1',
          cantidad: 2,
        },
      ],
      referencia: 'REF-DEV-1',
      motivo: 'Prueba HTTP',
    };

    const res = await request(app)
      .post('/devoluciones')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('devolucionId');
    expect(res.body.total_usd).toBeCloseTo(20);
    expect(res.body.total_bs).toBeCloseTo(200);
  });

  test('POST /devoluciones con devoluciones deshabilitadas retorna 400', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    // Deshabilitar devoluciones vía config
    const policy = { habilitado: false };
    db.prepare(
      "INSERT OR REPLACE INTO config (clave, valor, actualizado_en) VALUES ('devolucion_politica', ?, datetime('now'))"
    ).run(JSON.stringify(policy));

    const payload = {
      cliente: 'Cliente HTTP Dev',
      tasa_bcv: 10,
      items: [
        { codigo: 'DEV-1', cantidad: 1 },
      ],
    };

    const res = await request(app)
      .post('/devoluciones')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /devoluciones/historial responde 200 y array JSON', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    const res = await request(app)
      .get('/devoluciones/historial?limit=5')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /devoluciones rechaza superadmin con 403', async () => {
    const { token } = createTestUserAndToken({ rol: 'superadmin', empresaId: null });
    const app = buildApp();

    const res = await request(app)
      .post('/devoluciones')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /devoluciones/historial solo devuelve devoluciones de la empresa del usuario', async () => {
    const app = buildApp();

    // Reset específico para este escenario
    resetDevolucionesData();

    const empresaAId = 1;
    const infoEmpB = db
      .prepare("INSERT INTO empresas (nombre, codigo, estado) VALUES ('Empresa Dev B', 'EMPDEV', 'activa')")
      .run();
    const empresaBId = infoEmpB.lastInsertRowid;

    const { userId: userAId, token: tokenA } = createTestUserAndToken({ rol: 'admin', empresaId: empresaAId });
    const { userId: userBId, token: tokenB } = createTestUserAndToken({ rol: 'admin', empresaId: empresaBId });

    // Crear productos compartidos
    const prod = db
      .prepare('INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock) VALUES (?,?,?,?,?)')
      .run('DEV-MULTI', 'Prod Dev Multi', 10, 5, 0);

    // Ventas por empresa
    const ventaA = db
      .prepare(`INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
                VALUES (datetime('now'), 'Cliente Dev A', 'Vend A', 'EFECTIVO', 100, 10, ?)`)
      .run(userAId);

    const ventaB = db
      .prepare(`INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
                VALUES (datetime('now'), 'Cliente Dev B', 'Vend B', 'EFECTIVO', 200, 10, ?)`)
      .run(userBId);

    // Detalles de ventas
    db
      .prepare('INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs) VALUES (?,?,?,?,?,?)')
      .run(ventaA.lastInsertRowid, prod.lastInsertRowid, 1, 10, 5, 100);

    db
      .prepare('INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs) VALUES (?,?,?,?,?,?)')
      .run(ventaB.lastInsertRowid, prod.lastInsertRowid, 2, 10, 5, 200);

    // Devoluciones ligadas a cada venta
    db
      .prepare(`INSERT INTO devoluciones (fecha, cliente, cliente_doc, telefono, tasa_bcv, referencia, motivo, venta_original_id, total_bs, total_usd, usuario_id)
                VALUES (datetime('now'), 'Cliente Dev A', 'V-300', '', 10, 'REF-A', 'Motivo A', ?, 50, 5, ?)`)
      .run(ventaA.lastInsertRowid, userAId);

    db
      .prepare(`INSERT INTO devoluciones (fecha, cliente, cliente_doc, telefono, tasa_bcv, referencia, motivo, venta_original_id, total_bs, total_usd, usuario_id)
                VALUES (datetime('now'), 'Cliente Dev B', 'V-400', '', 10, 'REF-B', 'Motivo B', ?, 60, 6, ?)`)
      .run(ventaB.lastInsertRowid, userBId);

    const resA = await request(app)
      .get('/devoluciones/historial?limit=10')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(200);
    expect(Array.isArray(resA.body)).toBe(true);
    const clientesA = resA.body.map((r) => r.cliente);
    expect(clientesA).toContain('Cliente Dev A');
    expect(clientesA).not.toContain('Cliente Dev B');

    const resB = await request(app)
      .get('/devoluciones/historial?limit=10')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(Array.isArray(resB.body)).toBe(true);
    const clientesB = resB.body.map((r) => r.cliente);
    expect(clientesB).toContain('Cliente Dev B');
    expect(clientesB).not.toContain('Cliente Dev A');
  });
});
