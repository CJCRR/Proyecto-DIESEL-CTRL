const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const ventasRoutes = require(path.join('..', 'routes', 'ventas'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetVentasData() {
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM cuentas_cobrar').run();
  db.prepare('DELETE FROM productos').run();
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
    const { token } = createTestUserAndToken();
    const app = buildApp();

    db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock) VALUES (?,?,?,?,?)'
    ).run('COD-HTTP', 'Producto HTTP', 10, 5, 5);

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
});
