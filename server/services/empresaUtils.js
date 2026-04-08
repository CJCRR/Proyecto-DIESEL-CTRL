'use strict';

/**
 * Normaliza un empresaId recibido (string/number/null) a un entero positivo
 * o devuelve null si no es válido. No lanza errores para no cambiar
 * el comportamiento actual de servicios que tratan empresaId opcional.
 *
 * @param {number|string|null|undefined} empresaId
 * @returns {number|null}
 */
function normalizeEmpresaId(empresaId) {
  if (empresaId === null || empresaId === undefined) return null;
  const eid = Number(empresaId);
  if (!Number.isFinite(eid) || eid <= 0) return null;
  return eid;
}

/**
 * Añade de forma segura un filtro "alias.empresa_id = ?" al array de where/params
 * cuando exista un empresaId válido. Si alias es falsy, usa solo "empresa_id".
 *
 * No lanza errores si empresaId es inválido; simplemente no agrega la cláusula,
 * imitando el patrón actual de muchos servicios.
 *
 * @param {string[]} whereParts
 * @param {Array<string|number>} params
 * @param {{alias?:string|null,empresaId?:number|string|null}} opts
 * @returns {number|null} empresaId normalizado aplicado o null si no se aplicó
 */
function appendEmpresaIdFilter(whereParts, params, { alias = null, empresaId } = {}) {
  const eid = normalizeEmpresaId(empresaId);
  if (eid === null) return null;
  const prefix = alias ? `${alias}.` : '';
  whereParts.push(`${prefix}empresa_id = ?`);
  params.push(eid);
  return eid;
}

module.exports = {
  normalizeEmpresaId,
  appendEmpresaIdFilter,
};
