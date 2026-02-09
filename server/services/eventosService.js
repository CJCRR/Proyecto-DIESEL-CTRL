const db = require('../db');
const logger = require('./logger');

/**
 * Construye un objeto de evento de negocio con un UID simple.
 * @param {Object} params
 * @param {string} params.tipo - Tipo de evento (ej: 'venta_registrada', 'usuario_creado').
 * @param {string} params.entidad - Nombre lógico de la entidad (ej: 'venta', 'usuario', 'empresa').
 * @param {number|string|null} [params.entidadId] - ID local de la entidad relacionada.
 * @param {Object} [params.payload] - Datos adicionales del evento (se serializan como JSON).
 * @param {string} [params.origen] - Origen lógico del evento (ej: 'pos-local', 'panel-master', 'backend').
 */
function buildEventoNegocio({ tipo, entidad, entidadId = null, payload = {}, origen = 'backend' }) {
  const eventoUid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    evento_uid: eventoUid,
    tipo: String(tipo),
    entidad: String(entidad),
    entidad_id_local: entidadId,
    origen: String(origen),
    payload: payload || {},
  };
}

/**
 * Registra un evento de negocio directamente en sync_inbox, reutilizando el mismo
 * esquema que /sync/push. No lanza errores al flujo llamador: loguea y continúa.
 * @param {number} empresaId
 * @param {Object} eventoParams - Parámetros para buildEventoNegocio.
 * @returns {{ status: 'ok'|'duplicado'|'error', evento_uid: string }}
 */
function registrarEventoNegocio(empresaId, eventoParams) {
  if (!empresaId) {
    return { status: 'error', evento_uid: null };
  }

  try {
    const ev = buildEventoNegocio(eventoParams);

    const insertInbox = db.prepare(`
      INSERT OR IGNORE INTO sync_inbox (empresa_id, origen, evento_uid, tipo, entidad, payload_original)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const info = insertInbox.run(
      empresaId,
      ev.origen,
      String(ev.evento_uid),
      String(ev.tipo),
      String(ev.entidad),
      JSON.stringify(ev.payload || {})
    );

    if (info.changes > 0) {
      return { status: 'ok', evento_uid: ev.evento_uid };
    }

    // Evento duplicado (mismo evento_uid)
    return { status: 'duplicado', evento_uid: ev.evento_uid };
  } catch (err) {
    logger.error('Error registrando evento de negocio', {
      message: err.message,
      stack: err.stack,
      empresaId,
      eventoParams,
    });
    return { status: 'error', evento_uid: null };
  }
}

module.exports = {
  buildEventoNegocio,
  registrarEventoNegocio,
};
