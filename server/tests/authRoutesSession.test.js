const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const authRoutes = require(path.join('..', 'routes', 'auth'));
const { signJwt } = require(path.join('..', 'middleware', 'jwt'));
const { requireAuth } = authRoutes;

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.get('/privado', requireAuth, (req, res) => {
    res.json({ ok: true, usuarioId: req.usuario?.id || null });
  });
  return app;
}

function insertUser(username, password = 'testpass') {
  return db.prepare(
    'INSERT INTO usuarios (username, password, rol, activo) VALUES (?, ?, ?, 1)'
  ).run(username, password, 'admin').lastInsertRowid;
}

function cleanupAuthFixtures() {
  db.prepare('DELETE FROM sesiones').run();
  db.prepare("DELETE FROM usuarios WHERE username LIKE 'auth_test_%'").run();
}

describe('Rutas HTTP /auth sesiones', () => {
  beforeEach(() => {
    cleanupAuthFixtures();
  });

  test('POST /auth/login crea una sesión persistente alineada con la política larga', async () => {
    const app = buildApp();
    const username = `auth_test_login_${Date.now()}`;
    const password = 'clave123';
    insertUser(username, password);

    const res = await request(app)
      .post('/auth/login')
      .send({ username, password });

    expect(res.status).toBe(200);
    const sesion = db.prepare('SELECT expira_en FROM sesiones WHERE token = ?').get(res.body.token);
    expect(sesion).toBeTruthy();

    const remainingMs = new Date(sesion.expira_en).getTime() - Date.now();
    expect(remainingMs).toBeGreaterThan(300 * 24 * 60 * 60 * 1000);
    expect((res.headers['set-cookie'] || []).join(';')).toMatch(/Max-Age=31536000/i);
  });

  test('GET /auth/verificar no renueva la sesión si aún está lejos de vencer', async () => {
    const app = buildApp();
    const username = `auth_test_far_${Date.now()}`;
    const userId = insertUser(username);
    const token = `tok_far_${Date.now()}`;
    const expiraEn = new Date(Date.now() + (100 * 24 * 60 * 60 * 1000)).toISOString();
    db.prepare('INSERT INTO sesiones (usuario_id, token, expira_en) VALUES (?, ?, ?)').run(userId, token, expiraEn);

    const jwtToken = signJwt({ id: userId, username, rol: 'admin' });
    const res = await request(app)
      .get('/auth/verificar')
      .set('Cookie', [`auth_token=${token}`, `jwt_token=${jwtToken}`]);

    expect(res.status).toBe(200);
    const sesion = db.prepare('SELECT expira_en FROM sesiones WHERE token = ?').get(token);
    expect(sesion.expira_en).toBe(expiraEn);
  });

  test('GET /auth/verificar renueva la sesión si está cerca de vencer', async () => {
    const app = buildApp();
    const username = `auth_test_near_${Date.now()}`;
    const userId = insertUser(username);
    const token = `tok_near_${Date.now()}`;
    const expiraEn = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)).toISOString();
    db.prepare('INSERT INTO sesiones (usuario_id, token, expira_en) VALUES (?, ?, ?)').run(userId, token, expiraEn);

    const jwtToken = signJwt({ id: userId, username, rol: 'admin' });
    const res = await request(app)
      .get('/auth/verificar')
      .set('Cookie', [`auth_token=${token}`, `jwt_token=${jwtToken}`]);

    expect(res.status).toBe(200);
    const sesion = db.prepare('SELECT expira_en FROM sesiones WHERE token = ?').get(token);
    const remainingMs = new Date(sesion.expira_en).getTime() - Date.now();
    expect(new Date(sesion.expira_en).getTime()).toBeGreaterThan(new Date(expiraEn).getTime());
    expect(remainingMs).toBeGreaterThan(300 * 24 * 60 * 60 * 1000);
    expect((res.headers['set-cookie'] || []).join(';')).toMatch(/Max-Age=31536000/i);
  });

  test('JWT válido sin sesión activa ya no pasa /auth/verificar ni middleware protegido', async () => {
    const app = buildApp();
    const username = `auth_test_jwt_only_${Date.now()}`;
    const userId = insertUser(username);
    const token = `tok_missing_${Date.now()}`;
    const jwtToken = signJwt({ id: userId, username, rol: 'admin' });

    const verifyRes = await request(app)
      .get('/auth/verificar')
      .set('Cookie', [`auth_token=${token}`, `jwt_token=${jwtToken}`]);

    expect(verifyRes.status).toBe(401);
    expect(verifyRes.body.code).toBe('SESION_INVALIDA');

    const protectedRes = await request(app)
      .get('/privado')
      .set('Cookie', [`auth_token=${token}`, `jwt_token=${jwtToken}`]);

    expect(protectedRes.status).toBe(401);
    expect(protectedRes.body.code).toBe('SESION_INVALIDA');
  });
});