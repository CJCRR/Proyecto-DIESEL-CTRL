// Utilidades compartidas de formato numérico y de moneda para el frontend
// Pensado para uso ligero sin dependencias externas.

/** Convierte un valor a número finito, devolviendo 0 en caso de NaN/null/undefined. */
export function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

/** Formatea un número con decimales fijos (por defecto, 2). */
export function formatNumber(value, decimals = 2) {
  return toNumber(value).toFixed(decimals);
}

/** Formatea un monto en dólares como "$123.45". */
export function formatMoneyUsd(value) {
  return `$${formatNumber(value, 2)}`;
}

/** Formatea un monto en bolívares como "123.45 Bs". */
export function formatMoneyBs(value) {
  return `${formatNumber(value, 2)} Bs`;
}

/** Formatea una tasa de cambio con 2 decimales. */
export function formatTasa(value) {
  return formatNumber(value, 2);
}

/**
 * Calcula IVA a partir de un monto base y un porcentaje.
 * Devuelve base normalizada, iva y total.
 */
export function calcularIva(base, ivaPct) {
  const b = toNumber(base);
  const pct = Math.max(0, Math.min(100, Number(ivaPct || 0)));
  const iva = b * (pct / 100);
  return { base: b, iva, total: b + iva, ivaPct: pct };
}
