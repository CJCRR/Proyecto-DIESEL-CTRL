const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const usuariosRoutes = require(path.join('..', 'routes', 'usuarios'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetUsuariosData() {
  db.prepare('DELETE FROM sesiones').run();
  db.prepare("DELETE FROM usuarios WHERE username LIKE 'u_emp_%'").run();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/usuarios', usuariosRoutes);
  return app;
}

describe('Rutas HTTP /admin/usuarios multiempresa', () => {
  beforeEach(() => {
    resetUsuariosData();
  });

  test('GET /admin/usuarios solo lista usuarios de la misma empresa', async () => {
    const app = buildApp();

    // Asegurar existencia de empresa LOCAL (id=1) y crear empresa B
    const empresaAId = 1;
    const infoEmpB = db
      .prepare("INSERT INTO empresas (nombre, codigo, estado) VALUES ('Empresa Test Usuarios B', 'EMPUB', 'activa')")
      .run();
    const empresaBId = infoEmpB.lastInsertRowid;

    // Admins de cada empresa
    const { userId: adminAId, token: tokenA } = createTestUserAndToken({ rol: 'admin', empresaId: empresaAId });
    const { userId: adminBId, token: tokenB } = createTestUserAndToken({ rol: 'admin', empresaId: empresaBId });

    // Usuarios normales en cada empresa
    db.prepare('INSERT INTO usuarios (username, password, rol, activo, empresa_id) VALUES (?,?,?,?,?)')
      .run('u_emp_a1', 'x', 'vendedor', 1, empresaAId);
    db.prepare('INSERT INTO usuarios (username, password, rol, activo, empresa_id) VALUES (?,?,?,?,?)')
      .run('u_emp_a2', 'x', 'lectura', 1, empresaAId);
    db.prepare('INSERT INTO usuarios (username, password, rol, activo, empresa_id) VALUES (?,?,?,?,?)')
      .run('u_emp_b1', 'x', 'vendedor', 1, empresaBId);

    const resA = await request(app)
      .get('/admin/usuarios')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(200);
    const usernamesA = resA.body.map((u) => u.username);
    expect(usernamesA).toEqual(expect.arrayContaining(['u_emp_a1', 'u_emp_a2']));
    expect(usernamesA).not.toContain('u_emp_b1');

    const resB = await request(app)
      .get('/admin/usuarios')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    const usernamesB = resB.body.map((u) => u.username);
    expect(usernamesB).toEqual(expect.arrayContaining(['u_emp_b1']));
    expect(usernamesB).not.toContain('u_emp_a1');
    expect(usernamesB).not.toContain('u_emp_a2');
  });
});
