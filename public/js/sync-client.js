import { apiFetchJson } from './app-api.js';

function calcularTotalesVenta(venta) {
  const items = Array.isArray(venta.items) ? venta.items : [];
  const tasa = Number(venta.tasa_bcv || 0) || 0;

  let totalBs = 0;
  let totalUsd = 0;

  for (const it of items) {
    const cantidad = Number(it.cantidad || 0) || 0;
    const precioUsd = Number(it.precio_usd || 0) || 0;
    const subBs = it.subtotal_bs != null
      ? Number(it.subtotal_bs || 0)
      : (tasa > 0 ? cantidad * precioUsd * tasa : 0);

    totalBs += subBs;
    totalUsd += (precioUsd * cantidad);
  }

  if ((!totalUsd || totalUsd <= 0) && tasa > 0 && totalBs > 0) {
    totalUsd = totalBs / tasa;
  }

  return { total_bs: totalBs, total_usd: totalUsd };
}

function buildVentaEvent(venta) {
  const eventoUid = venta.id_global || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const totales = calcularTotalesVenta(venta);
  return {
    evento_uid: eventoUid,
    tipo: 'venta_registrada',
    entidad: 'venta',
    entidad_id_local: venta.id_global || null,
    payload: {
      id_global: venta.id_global,
      fecha: venta.fecha,
      cliente: venta.cliente,
      cedula: venta.cedula,
      telefono: venta.telefono,
      tasa_bcv: venta.tasa_bcv,
      descuento: venta.descuento,
      metodo_pago: venta.metodo_pago,
      referencia: venta.referencia,
      credito: venta.credito,
      dias_vencimiento: venta.dias_vencimiento,
      fecha_vencimiento: venta.fecha_vencimiento,
      iva_pct: venta.iva_pct,
      total_bs: totales.total_bs,
      total_usd: totales.total_usd,
      items: venta.items || []
    }
  };
}

export async function enviarVentaASync(venta) {
  if (!venta) return;
  if (!navigator.onLine) return; // por ahora solo sincronizamos cuando hay internet

  const evento = buildVentaEvent(venta);

  try {
    await apiFetchJson('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origen: 'pos-local', eventos: [evento] })
    });
  } catch (err) {
    // No rompemos el flujo de la venta si falla la sync; se podrá reintentar en fases posteriores
    console.warn('Error enviando venta a /sync/push:', err.message || err);
  }
}

export async function enviarEventosSync(eventos, origen = 'pos-local') {
  if (!Array.isArray(eventos) || eventos.length === 0) return;
  if (!navigator.onLine) return;

  try {
    await apiFetchJson('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origen, eventos })
    });
  } catch (err) {
    console.warn('Error enviando eventos de sync:', err.message || err);
  }
}
