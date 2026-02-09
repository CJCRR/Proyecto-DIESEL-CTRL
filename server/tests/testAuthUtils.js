const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));

/**
 * Crea un usuario de prueba y una sesión asociada.
 * Permite opcionalmente especificar rol y empresa_id para pruebas multiempresa.
 *
 * @param {{rol?: string, empresaId?: number|null}} [opts]
 * @returns {{userId:number, username:string, token:string}}
 */
function createTestUserAndToken(opts = {}) {
  const { rol = 'admin', empresaId = undefined } = opts;

  const username = `test_${Math.random().toString(36).slice(2, 8)}`;
  const password = 'testpass';

  let userInfo;
  if (empresaId !== undefined) {
    userInfo = db
      .prepare(
        'INSERT INTO usuarios (username, password, rol, activo, empresa_id) VALUES (?, ?, ?, 1, ?)' 
      )
      .run(username, password, rol, empresaId);
  } else {
    userInfo = db
      .prepare(
        'INSERT INTO usuarios (username, password, rol, activo) VALUES (?, ?, ?, 1)'
      )
      .run(username, password, rol);
  }

  const userId = userInfo.lastInsertRowid;
  const token = `token_${Math.random().toString(36).slice(2, 10)}`;
  const expiraEn = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO sesiones (usuario_id, token, expira_en) VALUES (?, ?, ?)'
  ).run(userId, token, expiraEn);

  return { userId, username, token };
}

module.exports = {
  createTestUserAndToken,
};
