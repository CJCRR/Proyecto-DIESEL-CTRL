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
});
