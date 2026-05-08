const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const empresasAdminRoutes = require(path.join('..', 'routes', 'empresas_admin'));
const { createTestUserAndToken } = require('./testAuthUtils');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/empresas', empresasAdminRoutes);
  return app;
}

describe('Rutas HTTP /admin/empresas (panel master)', () => {
  beforeEach(() => {
    db.prepare("DELETE FROM config WHERE clave = 'empresa_config' OR clave LIKE 'empresa_config:empresa:%'").run();
  });

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

  test('PATCH /admin/empresas/:id permite activar permitir_anular_venta', async () => {
    const app = buildApp();
    const { token } = createTestUserAndToken({ rol: 'superadmin', empresaId: null });

    const patchRes = await request(app)
      .patch('/admin/empresas/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ permitir_anular_venta: true });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toHaveProperty('empresa');
    expect(patchRes.body.empresa).toHaveProperty('permitir_anular_venta', true);

    const listRes = await request(app)
      .get('/admin/empresas')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const empresaLocal = listRes.body.find((empresa) => Number(empresa.id) === 1);
    expect(empresaLocal).toBeDefined();
    expect(empresaLocal.permitir_anular_venta).toBe(true);
  });
});
