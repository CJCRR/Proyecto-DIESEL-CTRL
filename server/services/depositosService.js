const db = require('../db');

function mapDeposito(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    nombre: row.nombre,
    codigo: row.codigo || null,
    es_principal: row.es_principal === 1,
    activo: row.activo !== 0,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en,
  };
}

function listDepositos(empresaId, { soloActivos } = {}) {
  if (!empresaId) return [];
  const where = ['empresa_id = ?'];
  const params = [empresaId];
  if (soloActivos) {
    where.push('activo = 1');
  }
  const sql = `
    SELECT *
    FROM depositos
    WHERE ${where.join(' AND ')}
    ORDER BY es_principal DESC, nombre ASC
  `;
  const rows = db.prepare(sql).all(...params);
  return rows.map(mapDeposito);
}

function getDeposito(id, empresaId) {
  const row = db.prepare('SELECT * FROM depositos WHERE id = ? AND empresa_id = ?').get(id, empresaId);
  return mapDeposito(row);
}

function createDeposito(empresaId, payload = {}) {
  if (!empresaId) {
    const err = new Error('Usuario sin empresa asociada');
    err.tipo = 'VALIDACION';
    throw err;
  }
  const nombre = (payload.nombre || '').toString().trim().slice(0, 160);
  if (!nombre) {
    const err = new Error('Nombre de depósito requerido');
    err.tipo = 'VALIDACION';
    throw err;
  }
  const codigo = (payload.codigo || '').toString().trim().slice(0, 80) || null;
  const esPrincipal = payload.es_principal ? 1 : 0;

  const tx = db.transaction(() => {
    // si se marca como principal, limpiar otros principales de esta empresa
    if (esPrincipal) {
      db.prepare('UPDATE depositos SET es_principal = 0 WHERE empresa_id = ?').run(empresaId);
    }
    const info = db.prepare(`
      INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo)
      VALUES (?, ?, ?, ?, 1)
    `).run(empresaId, nombre, codigo, esPrincipal);
    return info.lastInsertRowid;
  });

  const id = tx();
  return getDeposito(id, empresaId);
}

function updateDeposito(id, empresaId, payload = {}) {
  const actual = getDeposito(id, empresaId);
  if (!actual) return null;

  const nombre = payload.nombre !== undefined
    ? (payload.nombre || '').toString().trim().slice(0, 160)
    : actual.nombre;
  if (!nombre) {
    const err = new Error('Nombre de depósito requerido');
    err.tipo = 'VALIDACION';
    throw err;
  }
  const codigo = payload.codigo !== undefined
    ? ((payload.codigo || '').toString().trim().slice(0, 80) || null)
    : actual.codigo;
  const activo = payload.activo !== undefined ? (payload.activo ? 1 : 0) : (actual.activo ? 1 : 0);
  const esPrincipal = payload.es_principal !== undefined
    ? (payload.es_principal ? 1 : 0)
    : (actual.es_principal ? 1 : 0);

  const tx = db.transaction(() => {
    if (esPrincipal) {
      db.prepare('UPDATE depositos SET es_principal = 0 WHERE empresa_id = ?').run(empresaId);
    }
    db.prepare(`
      UPDATE depositos
      SET nombre = ?, codigo = ?, es_principal = ?, activo = ?, actualizado_en = datetime('now')
      WHERE id = ? AND empresa_id = ?
    `).run(nombre, codigo, esPrincipal, activo, id, empresaId);
  });

  tx();
  return getDeposito(id, empresaId);
}

module.exports = {
  listDepositos,
  getDeposito,
  createDeposito,
  updateDeposito,
};
