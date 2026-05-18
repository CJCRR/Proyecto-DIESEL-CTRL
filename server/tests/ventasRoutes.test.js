const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const ventasRoutes = require(path.join('..', 'routes', 'ventas'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetVentasData() {
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM depositos').run();
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM cuentas_cobrar').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare("DELETE FROM config WHERE clave = 'empresa_config' OR clave LIKE 'empresa_config:empresa:%'").run();
}

describe('Rutas HTTP /ventas', () => {
  beforeEach(() => {
    resetVentasData();
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/ventas', ventasRoutes);
    return app;
  }

  test('POST /ventas crea venta válida y responde 200', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?,?,?,?,1)'
      )
      .run(empresaId, 'Dep Ventas HTTP', 'DVH1', 1);
    const depositoId = depInfo.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id, deposito_id) VALUES (?,?,?,?,?,?,?)'
      )
      .run('COD-HTTP', 'Producto HTTP', 10, 5, 5, empresaId, depositoId);

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?,?,?,?)'
    ).run(empresaId, prodInfo.lastInsertRowid, depositoId, 5);

    const res = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ codigo: 'COD-HTTP', cantidad: 2 }],
        cliente: 'Cliente HTTP',
        vendedor: 'Tester',
        tasa_bcv: 10,
        descuento: 0,
        metodo_pago: 'EFECTIVO',
        iva_pct: 0,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ventaId');
    expect(res.body).toHaveProperty('message');
    expect(String(res.body.message)).toMatch(/Venta registrada/i);
  });

  test('POST /ventas con mismo id_global no crea una venta duplicada', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?,?,?,?,1)'
      )
      .run(empresaId, 'Dep Ventas Dedupe', 'DVD1', 1);
    const depositoId = depInfo.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id, deposito_id) VALUES (?,?,?,?,?,?,?)'
      )
      .run('COD-DEDUPE', 'Producto Dedupe', 10, 5, 5, empresaId, depositoId);

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?,?,?,?)'
    ).run(empresaId, prodInfo.lastInsertRowid, depositoId, 5);

    const payload = {
      id_global: 'VENTA-HTTP-DEDUPE-001',
      items: [{ codigo: 'COD-DEDUPE', cantidad: 2 }],
      cliente: 'Cliente HTTP Dedupe',
      vendedor: 'Tester',
      tasa_bcv: 10,
      descuento: 0,
      metodo_pago: 'EFECTIVO',
      iva_pct: 0,
    };

    const primera = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    const segunda = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(segunda.body.ventaId).toBe(primera.body.ventaId);

    const ventas = db.prepare('SELECT id FROM ventas WHERE id_global = ?').all(payload.id_global);
    expect(ventas).toHaveLength(1);

    const producto = db
      .prepare('SELECT * FROM productos WHERE id = ?')
      .get(prodInfo.lastInsertRowid);
    expect(producto.stock).toBe(3);
  });

  test('POST /ventas con carrito vacío retorna 400 y mensaje de error', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    const res = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [],
        cliente: 'Cliente HTTP',
        tasa_bcv: 10,
        metodo_pago: 'EFECTIVO',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /ventas rechaza superadmin con 403', async () => {
    const { token } = createTestUserAndToken({ rol: 'superadmin' });
    const app = buildApp();

    const res = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [], cliente: 'X' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /ventas bloquea registro cuando la empresa está suspendida por pago', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    db.prepare("UPDATE empresas SET estado = 'suspendida' WHERE id = ?").run(empresaId);

    const res = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ codigo: 'NO-IMPORTA', cantidad: 1 }],
        cliente: 'Cliente bloqueado',
        tasa_bcv: 10,
        metodo_pago: 'EFECTIVO',
      });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'LICENCIA_SUSPENDIDA');
  });

  test('DELETE /ventas/:id bloquea la anulación cuando la función está desactivada', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    const res = await request(app)
      .delete('/ventas/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'VENTA_ANULAR_DESHABILITADA');
  });
});
