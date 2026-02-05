const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));

function createTestUserAndToken() {
  const username = `test_${Math.random().toString(36).slice(2, 8)}`;
  const password = 'testpass';

  const userInfo = db
    .prepare(
      "INSERT INTO usuarios (username, password, rol, activo) VALUES (?, ?, 'admin', 1)"
    )
    .run(username, password);

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
