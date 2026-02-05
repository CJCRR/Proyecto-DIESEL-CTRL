const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

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
});
