import { apiFetchJson } from './app-api.js';
import { formatNumber } from './format-utils.js';

(async () => {
  if (!window.showToast) {
    try {
      const mod = await import('./app-utils.js');
      window.showToast = window.showToast || mod.showToast;
    } catch (_err) {
      // fallback silencioso
    }
  }
})();

const summaryEl = document.getElementById('sus-summary');
const chartEl = document.getElementById('sus-chart');
const puntualidadEl = document.getElementById('sus-puntualidad-list');
const empresasEl = document.getElementById('sus-empresas-list');
const actividadEl = document.getElementById('sus-actividad-list');
const updatedEl = document.getElementById('sus-meta-updated');
const topMessageEl = document.getElementById('sus-top-message');
const btnRecargar = document.getElementById('btn-recargar-suscripciones');
const brandMainTitleEl = document.getElementById('brand-main-title');
const drawerAppNameEl = document.getElementById('drawer-app-name');

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatUsd(value) {
  return `$${formatNumber(Number(value || 0) || 0, 2)}`;
}

function formatFechaCorta(iso) {
  if (!iso) return '—';
  const simpleMatch = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
  const date = simpleMatch
    ? (() => {
        const [year, month, day] = String(iso).split('-').map(Number);
        return new Date(year, month - 1, day);
      })()
    : new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso).slice(0, 10) || '—';
  try {
    return date.toLocaleDateString('es-VE');
  } catch (_err) {
    return String(iso).slice(0, 10) || '—';
  }
}

function formatFechaHora(iso) {
  if (!iso) return 'sin registro';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  try {
    return date.toLocaleString('es-VE');
  } catch (_err) {
    return date.toISOString();
  }
}

function formatAntiguedad(value) {
  if (!Number.isFinite(Number(value))) return 'Sin histórico';
  const months = Number(value);
  if (months <= 0) return 'Primer mes';
  return `${months} ${months === 1 ? 'mes' : 'meses'}`;
}

function getPuntualidadTheme(key) {
  const themes = {
    al_dia: {
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      card: 'border-emerald-200 bg-emerald-50/70',
      bar: 'bg-emerald-500',
      label: 'Al día',
    },
    en_gracia: {
      badge: 'border-amber-200 bg-amber-50 text-amber-700',
      card: 'border-amber-200 bg-amber-50/70',
      bar: 'bg-amber-500',
      label: 'En gracia',
    },
    atrasada: {
      badge: 'border-rose-200 bg-rose-50 text-rose-700',
      card: 'border-rose-200 bg-rose-50/70',
      bar: 'bg-rose-500',
      label: 'Atrasada',
    },
    suspendida: {
      badge: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
      card: 'border-fuchsia-200 bg-fuchsia-50/70',
      bar: 'bg-fuchsia-500',
      label: 'Suspendida',
    },
    sin_corte: {
      badge: 'border-slate-200 bg-slate-50 text-slate-600',
      card: 'border-slate-200 bg-slate-50/70',
      bar: 'bg-slate-400',
      label: 'Sin corte',
    },
  };
  return themes[key] || themes.sin_corte;
}

function setBusy(isBusy) {
  if (!btnRecargar) return;
  btnRecargar.disabled = !!isBusy;
  btnRecargar.classList.toggle('opacity-70', !!isBusy);
  btnRecargar.classList.toggle('cursor-not-allowed', !!isBusy);
}

function renderSummary(resumen = {}) {
  if (!summaryEl) return;
  const puntualidad = resumen.puntualidad || {};
  const cards = [
    {
      label: 'Generado total',
      value: formatUsd(resumen.total_recaudado_usd),
      hint: 'Pagos aplicados acumulados',
      cardClass: 'border-slate-900/10 bg-slate-900 text-white shadow-slate-900/20',
      labelClass: 'text-slate-300/70',
      valueClass: 'text-white',
      hintClass: 'text-slate-300/80',
      iconWrap: 'bg-white/10 text-white ring-1 ring-white/10',
      icon: 'fa-sack-dollar',
    },
    {
      label: 'Ingresos del mes',
      value: formatUsd(resumen.ingresos_mes_usd),
      hint: `${Number(resumen.pagos_aplicados || 0)} pagos aplicados`,
      cardClass: 'border-cyan-200 bg-cyan-50',
      labelClass: 'text-cyan-700/80',
      valueClass: 'text-cyan-950',
      hintClass: 'text-cyan-700',
      iconWrap: 'bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200',
      icon: 'fa-calendar-dollar',
    },
    {
      label: 'Pendientes',
      value: String(Number(resumen.pagos_pendientes || 0)),
      hint: 'Solicitudes esperando revisión',
      cardClass: 'border-amber-200 bg-amber-50',
      labelClass: 'text-amber-700/80',
      valueClass: 'text-amber-950',
      hintClass: 'text-amber-700',
      iconWrap: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
      icon: 'fa-bell',
    },
    {
      label: 'MRR estimado',
      value: formatUsd(resumen.mrr_estimado_usd),
      hint: `${Number(resumen.empresas_pagando || 0)} empresas con pagos aplicados`,
      cardClass: 'border-emerald-200 bg-emerald-50',
      labelClass: 'text-emerald-700/80',
      valueClass: 'text-emerald-950',
      hintClass: 'text-emerald-700',
      iconWrap: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
      icon: 'fa-chart-line',
    },
    {
      label: 'ARR estimado',
      value: formatUsd(resumen.arr_estimado_usd),
      hint: `${Number(puntualidad.al_dia || 0)} empresas al día`,
      cardClass: 'border-indigo-200 bg-indigo-50',
      labelClass: 'text-indigo-700/80',
      valueClass: 'text-indigo-950',
      hintClass: 'text-indigo-700',
      iconWrap: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200',
      icon: 'fa-arrow-trend-up',
    },
    {
      label: 'En riesgo',
      value: String(Number(puntualidad.en_gracia || 0) + Number(puntualidad.atrasada || 0) + Number(puntualidad.suspendida || 0)),
      hint: 'Empresas fuera del flujo ideal',
      cardClass: 'border-rose-200 bg-rose-50',
      labelClass: 'text-rose-700/80',
      valueClass: 'text-rose-950',
      hintClass: 'text-rose-700',
      iconWrap: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200',
      icon: 'fa-triangle-exclamation',
    },
  ];

  summaryEl.innerHTML = cards.map((card) => `
    <article class="rounded-[24px] border ${card.cardClass} p-4 shadow-sm shadow-slate-200/40">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[11px] font-black uppercase tracking-[0.24em] ${card.labelClass}">${card.label}</p>
          <div class="mt-3 text-3xl font-black tracking-tight ${card.valueClass}">${card.value}</div>
          <p class="mt-2 text-xs ${card.hintClass}">${card.hint}</p>
        </div>
        <span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl ${card.iconWrap}">
          <i class="fas ${card.icon}"></i>
        </span>
      </div>
    </article>
  `).join('');
}

function renderSerieMensual(series = []) {
  if (!chartEl) return;
  if (!Array.isArray(series) || !series.length) {
    chartEl.innerHTML = '<div class="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-400">No hay ingresos aplicados para construir la serie.</div>';
    return;
  }

  const maxValue = Math.max(...series.map((item) => Number(item.total_usd || 0) || 0), 1);
  chartEl.innerHTML = series.map((item) => {
    const total = Number(item.total_usd || 0) || 0;
    const heightPct = Math.max(10, Math.round((total / maxValue) * 100));
    return `
      <article class="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 shadow-sm shadow-slate-200/30">
        <div class="flex h-32 items-end rounded-[20px] bg-white/80 p-3 ring-1 ring-slate-100">
          <div class="w-full rounded-[14px] bg-gradient-to-t from-cyan-500 via-sky-500 to-emerald-400" style="height:${heightPct}%"></div>
        </div>
        <div class="mt-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400">${escapeText(item.label || item.periodo || 'Periodo')}</div>
        <div class="mt-1 text-lg font-black tracking-tight text-slate-900">${formatUsd(total)}</div>
      </article>
    `;
  }).join('');
}

function renderPuntualidad(puntualidad = {}) {
  if (!puntualidadEl) return;
  const items = [
    { key: 'al_dia', value: Number(puntualidad.al_dia || 0) || 0 },
    { key: 'en_gracia', value: Number(puntualidad.en_gracia || 0) || 0 },
    { key: 'atrasada', value: Number(puntualidad.atrasada || 0) || 0 },
    { key: 'suspendida', value: Number(puntualidad.suspendida || 0) || 0 },
    { key: 'sin_corte', value: Number(puntualidad.sin_corte || 0) || 0 },
  ];
  const total = items.reduce((accumulator, item) => accumulator + item.value, 0) || 1;

  puntualidadEl.innerHTML = items.map((item) => {
    const theme = getPuntualidadTheme(item.key);
    const width = Math.max(item.value > 0 ? 8 : 0, Math.round((item.value / total) * 100));
    return `
      <article class="rounded-[22px] border ${theme.card} p-4 shadow-sm shadow-slate-200/20">
        <div class="flex items-center justify-between gap-3">
          <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${theme.badge}">${theme.label}</span>
          <span class="text-lg font-black tracking-tight text-slate-900">${item.value}</span>
        </div>
        <div class="mt-3 h-2.5 rounded-full bg-white/90 ring-1 ring-white/80">
          <div class="h-full rounded-full ${theme.bar}" style="width:${width}%"></div>
        </div>
      </article>
    `;
  }).join('');
}

function renderEmpresas(empresas = []) {
  if (!empresasEl) return;
  if (!Array.isArray(empresas) || !empresas.length) {
    empresasEl.innerHTML = '<div class="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-400">No hay empresas con historial de suscripción todavía.</div>';
    return;
  }

  empresasEl.innerHTML = empresas.slice(0, 12).map((empresa) => {
    const puntualidadTheme = getPuntualidadTheme(empresa.puntualidad_estado);
    const plan = escapeText(empresa.plan || 'Sin plan');
    const nombre = escapeText(empresa.nombre || 'Empresa sin nombre');
    const codigo = escapeText(empresa.codigo || 'SIN-CODIGO');
    const href = `/pages/admin-empresas.html?focus=${encodeURIComponent(String(empresa.id || ''))}`;
    return `
      <article class="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 shadow-sm shadow-slate-200/30">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-sm font-black tracking-tight text-slate-900">${nombre}</h4>
              <span class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">${codigo}</span>
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${puntualidadTheme.badge}">${escapeText(empresa.puntualidad_label || 'Sin corte')}</span>
            </div>
            <div class="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-xs text-slate-500">
              <div><strong class="text-slate-700">Plan:</strong> ${plan}</div>
              <div><strong class="text-slate-700">Total:</strong> ${formatUsd(empresa.total_pagado_usd)}</div>
              <div><strong class="text-slate-700">Mes:</strong> ${formatUsd(empresa.ingresos_mes_usd)}</div>
              <div><strong class="text-slate-700">Ticket:</strong> ${empresa.ticket_promedio_usd ? formatUsd(empresa.ticket_promedio_usd) : '—'}</div>
              <div><strong class="text-slate-700">Antigüedad:</strong> ${formatAntiguedad(empresa.antiguedad_meses)}</div>
              <div><strong class="text-slate-700">Pendientes:</strong> ${Number(empresa.pagos_pendientes || 0)}</div>
              <div><strong class="text-slate-700">Último pago:</strong> ${formatFechaCorta(empresa.ultimo_pago_aplicado_en)}</div>
              <div><strong class="text-slate-700">Próximo cobro:</strong> ${formatFechaCorta(empresa.proximo_cobro)}</div>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <div class="rounded-[18px] border border-slate-200 bg-white px-3 py-2 text-right">
              <div class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">MRR ref.</div>
              <div class="mt-1 text-sm font-black text-slate-900">${empresa.monto_mensual ? formatUsd(empresa.monto_mensual) : '—'}</div>
            </div>
            <a href="${href}" class="inline-flex h-10 items-center justify-center rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800">Abrir</a>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderActividad(items = []) {
  if (!actividadEl) return;
  if (!Array.isArray(items) || !items.length) {
    actividadEl.innerHTML = '<div class="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-400">No hay actividad reciente de pagos.</div>';
    return;
  }

  actividadEl.innerHTML = items.map((item) => {
    const estado = String(item.estado || '').toLowerCase();
    const isPending = estado === 'pendiente';
    const tone = isPending
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : estado === 'aplicado'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-rose-200 bg-rose-50 text-rose-700';
    const href = `/admin-empresas?focus=${encodeURIComponent(String(item.empresa_id || ''))}`;
    return `
      <article class="rounded-[20px] border border-slate-200 bg-slate-50/80 px-3.5 py-3 shadow-sm shadow-slate-200/25">
        <div class="flex items-start justify-between gap-2.5">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <h4 class="text-[13px] font-black tracking-tight text-slate-900">${escapeText(item.empresa_nombre || `Empresa #${item.empresa_id || 'N/D'}`)}</h4>
              <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] ${tone}">${escapeText(estado || 'sin estado')}</span>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span><strong class="text-slate-700">Monto:</strong> ${formatUsd(item.monto_usd)}</span>
              <span><strong class="text-slate-700">Tipo:</strong> ${escapeText(item.tipo || 'No especificado')}</span>
              <span><strong class="text-slate-700">Plan:</strong> ${escapeText(item.plan || 'Sin plan')}</span>
            </div>
            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span><strong class="text-slate-700">Referencia:</strong> ${escapeText(item.referencia || 'Sin referencia')}</span>
              <span><strong class="text-slate-700">Fecha:</strong> ${formatFechaHora(item.creado_en || item.fecha)}</span>
            </div>
          </div>
          <a href="${href}" class="inline-flex h-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50">Revisar</a>
        </div>
      </article>
    `;
  }).join('');
}

function renderLoadingState() {
  if (summaryEl) {
    summaryEl.innerHTML = Array.from({ length: 4 }).map(() => '<div class="animate-pulse rounded-[24px] border border-slate-200 bg-slate-100 p-5 h-32"></div>').join('');
  }
  if (chartEl) {
    chartEl.innerHTML = Array.from({ length: 6 }).map(() => '<div class="animate-pulse rounded-[24px] border border-slate-200 bg-slate-100 p-4 h-48"></div>').join('');
  }
  if (puntualidadEl) {
    puntualidadEl.innerHTML = Array.from({ length: 5 }).map(() => '<div class="animate-pulse rounded-[22px] border border-slate-200 bg-slate-100 p-4 h-24"></div>').join('');
  }
  if (empresasEl) {
    empresasEl.innerHTML = Array.from({ length: 4 }).map(() => '<div class="animate-pulse rounded-[24px] border border-slate-200 bg-slate-100 p-5 h-40"></div>').join('');
  }
  if (actividadEl) {
    actividadEl.innerHTML = Array.from({ length: 3 }).map(() => '<div class="animate-pulse rounded-[20px] border border-slate-200 bg-slate-100 p-3 h-24"></div>').join('');
  }
}

function applyBrandingEnVista(branding = {}) {
  const titulo = (branding.titulo || 'Nexa CTRL').toString().trim() || 'Nexa CTRL';
  const drawerNombre = (branding.drawer_nombre || branding.titulo || 'Nexa CTRL').toString().trim() || titulo;

  if (brandMainTitleEl) {
    brandMainTitleEl.textContent = titulo;
  }
  if (drawerAppNameEl) {
    drawerAppNameEl.textContent = drawerNombre;
  }

  const footerEl = document.getElementById('global-footer-branding');
  if (footerEl) {
    footerEl.textContent = `© ${new Date().getFullYear()} ${titulo}. Sistema de gestión de ventas.`;
  }

  if (typeof document !== 'undefined' && document.title) {
    document.title = document.title.replace(/Nexa\s*CTRL|Diesel\s*-?\s*CTRL/gi, titulo);
  }
}

async function cargarBranding() {
  try {
    const data = await apiFetchJson('/admin/ajustes/branding');
    applyBrandingEnVista(data || {});
  } catch (_err) {
    applyBrandingEnVista({ titulo: 'Nexa CTRL', drawer_nombre: 'Nexa CTRL' });
  }
}

async function cargarMetricas() {
  renderLoadingState();
  setBusy(true);
  if (updatedEl) {
    updatedEl.textContent = 'Actualizando métricas...';
  }

  try {
    const data = await apiFetchJson('/admin/empresas/licencia-metricas');
    const resumen = data && data.resumen ? data.resumen : {};
    renderSummary(resumen);
    renderSerieMensual(Array.isArray(data && data.serie_mensual) ? data.serie_mensual : []);
    renderPuntualidad(resumen.puntualidad || {});
    renderEmpresas(Array.isArray(data && data.empresas) ? data.empresas : []);
    renderActividad(Array.isArray(data && data.actividad_reciente) ? data.actividad_reciente : []);

    if (updatedEl) {
      updatedEl.textContent = `Actualizado: ${formatFechaHora(new Date().toISOString())}`;
    }
    if (topMessageEl) {
      topMessageEl.textContent = `Este mes has generado ${formatUsd(resumen.ingresos_mes_usd)} en suscripciones, con ${Number(resumen.pagos_pendientes || 0)} pago(s) pendiente(s) y un MRR estimado de ${formatUsd(resumen.mrr_estimado_usd)}.`;
    }
  } catch (err) {
    if (updatedEl) {
      updatedEl.textContent = 'No se pudo actualizar el tablero.';
    }
    if (topMessageEl) {
      topMessageEl.textContent = err && err.message
        ? err.message
        : 'No fue posible construir el dashboard de suscripciones.';
    }
    if (window.showToast) {
      window.showToast(err.message || 'Error cargando métricas de suscripciones', 'error');
    }
  } finally {
    setBusy(false);
  }
}

if (btnRecargar) {
  btnRecargar.addEventListener('click', () => {
    cargarMetricas();
  });
}

cargarBranding();
cargarMetricas();