const db = require('../db');

const MAX_TEXT = 400;

function safeStr(v, max = MAX_TEXT) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function mapProveedor(row) {
  if (!row) return null;
  return {
    id: row.id,
    nombre: row.nombre,
    rif: row.rif || '',
    telefono: row.telefono || '',
    email: row.email || '',
    direccion: row.direccion || '',
    notas: row.notas || '',
    activo: row.activo !== 0,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en,
  };
}

function listProveedores({ q, soloActivos } = {}) {
  const where = [];
  const params = [];

  if (soloActivos) {
    where.push('p.activo = 1');
  }
  if (q) {
    where.push('(LOWER(p.nombre) LIKE ? OR LOWER(p.rif) LIKE ?)');
    const like = `%${String(q).toLowerCase()}%`;
    params.push(like, like);
  }

  const sql = `
    SELECT p.*
    FROM proveedores p
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.activo DESC, p.nombre ASC
    LIMIT 200
  `;
  const rows = db.prepare(sql).all(...params);
  return rows.map(mapProveedor);
}

function getProveedor(id) {
  const row = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
  return mapProveedor(row);
}

function createProveedor(payload = {}) {
  const nombre = safeStr(payload.nombre, 160);
  if (!nombre) {
    const err = new Error('Nombre de proveedor requerido');
    err.tipo = 'VALIDACION';
    throw err;
  }

  const rif = safeStr(payload.rif, 80);
  const telefono = safeStr(payload.telefono, 80);
  const email = safeStr(payload.email, 120);
  const direccion = safeStr(payload.direccion, 240);
  const notas = safeStr(payload.notas, MAX_TEXT);

  const stmt = db.prepare(`
    INSERT INTO proveedores (nombre, rif, telefono, email, direccion, notas, activo)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const info = stmt.run(nombre, rif, telefono, email, direccion, notas);
  return getProveedor(info.lastInsertRowid);
}

function updateProveedor(id, payload = {}) {
  const prov = getProveedor(id);
  if (!prov) return null;

  const nombre = payload.nombre !== undefined ? safeStr(payload.nombre, 160) : prov.nombre;
  if (!nombre) {
    const err = new Error('Nombre de proveedor requerido');
    err.tipo = 'VALIDACION';
    throw err;
  }
  const rif = payload.rif !== undefined ? safeStr(payload.rif, 80) : prov.rif;
  const telefono = payload.telefono !== undefined ? safeStr(payload.telefono, 80) : prov.telefono;
  const email = payload.email !== undefined ? safeStr(payload.email, 120) : prov.email;
  const direccion = payload.direccion !== undefined ? safeStr(payload.direccion, 240) : prov.direccion;
  const notas = payload.notas !== undefined ? safeStr(payload.notas, MAX_TEXT) : prov.notas;
  const activo = payload.activo !== undefined ? (payload.activo ? 1 : 0) : (prov.activo ? 1 : 0);

  db.prepare(`
    UPDATE proveedores
    SET nombre = ?, rif = ?, telefono = ?, email = ?, direccion = ?, notas = ?, activo = ?, actualizado_en = datetime('now')
    WHERE id = ?
  `).run(nombre, rif, telefono, email, direccion, notas, activo, id);

  return getProveedor(id);
}

function toggleProveedorActivo(id, activo) {
  const prov = getProveedor(id);
  if (!prov) return null;
  const val = activo ? 1 : 0;
  db.prepare('UPDATE proveedores SET activo = ?, actualizado_en = datetime(\'now\') WHERE id = ?').run(val, id);
  return getProveedor(id);
}

module.exports = {
  listProveedores,
  getProveedor,
  createProveedor,
  updateProveedor,
  toggleProveedorActivo,
};
