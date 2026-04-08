'use strict';

/**
 * Crea un Error de validación con tipado y código opcional.
 * No altera el mensaje para mantener compatibilidad con lógica existente.
 *
 * @param {string} message
 * @param {string} [code]
 * @returns {Error & { tipo?: string, code?: string }}
 */
function validationError(message, code) {
  const err = new Error(String(message || 'Validación inválida'));
  // Marcar tipo de validación para middlewares/rutas que ya usan err.tipo === 'VALIDACION'
  err.tipo = 'VALIDACION';
  if (code) err.code = String(code);
  return err;
}

module.exports = {
  validationError,
};
