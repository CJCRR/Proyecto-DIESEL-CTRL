const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const empresasAdminRoutes = require(path.join('..', 'routes', 'empresas_admin'));
const { createTestUserAndToken } = require('./testAuthUtils');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/empresas', empresasAdminRoutes);
  return app;
}

describe('Rutas HTTP /admin/empresas (panel master)', () => {
  test('GET /admin/empresas requiere superadmin (admin normal recibe 403)', async () => {
    const app = buildApp();

    // Usuario admin de empresa
    const { token: tokenAdmin } = createTestUserAndToken({ rol: 'admin', empresaId: 1 });
    const resAdmin = await request(app)
      .get('/admin/empresas')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resAdmin.status).toBe(403);

    // Usuario superadmin global (sin empresa_id específica)
    const { token: tokenSuper } = createTestUserAndToken({ rol: 'superadmin', empresaId: null });
    const resSuper = await request(app)
      .get('/admin/empresas')
      .set('Authorization', `Bearer ${tokenSuper}`);

    expect(resSuper.status).toBe(200);
    expect(Array.isArray(resSuper.body)).toBe(true);
  });
});
