const db = require('../db');
const logger = require('./logger');

/**
 * Registra una acción de auditoría en la tabla auditoria.
 * No lanza errores hacia arriba: en caso de fallo solo hace log y sigue.
 *
 * @param {object} options
 * @param {object} [options.usuario] - Objeto de usuario injectado en req.usuario
 * @param {string} options.accion - Nombre corto de la acción (ej: 'EMPRESA_ACTUALIZADA')
 * @param {string} [options.entidad] - Tipo de entidad afectada (ej: 'empresa', 'usuario')
 * @param {number} [options.entidadId] - ID de la entidad afectada
 * @param {object} [options.detalle] - Objeto con más información, se serializa a JSON
 * @param {string} [options.ip]
 * @param {string} [options.userAgent]
 */
function registrarAuditoria({ usuario, accion, entidad, entidadId, detalle, ip, userAgent }) {
  if (!accion) return;

  try {
    const usuarioId = usuario && usuario.id ? usuario.id : null;
    const empresaId = usuario && usuario.empresa_id ? usuario.empresa_id : null;
    const payload = detalle ? JSON.stringify(detalle) : null;

    db.prepare(`
      INSERT INTO auditoria (usuario_id, empresa_id, accion, entidad, entidad_id, detalle, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(usuarioId, empresaId, accion, entidad || null, entidadId || null, payload, ip || null, userAgent || null);
  } catch (err) {
    // No interrumpir el flujo de negocio por fallos de auditoría
    logger.warn('Fallo registrando auditoría', { message: err.message });
  }
}

module.exports = {
  registrarAuditoria,
};
