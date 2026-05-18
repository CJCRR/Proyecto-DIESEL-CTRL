import { apiFetchJson } from './app-api.js';
import { formatNumber } from './format-utils.js';
import { upsertEmpresaFirebase } from './firebase-sync.js';
import { initCustomSelect } from './modules/ui.js';

// Intentar cargar utilidades centralizadas para toasts si no están disponibles
(async () => {
  if (!window.showToast) {
    try {
      const m = await import('./app-utils.js');
      window.showToast = window.showToast || m.showToast;
    } catch (e) {
      // fallback a alert
    }
  }
})();

const tbody = document.getElementById('empresas-tbody');
const resumenEmpresas = document.getElementById('empresas-resumen');
const filtroEstado = document.getElementById('filtro-estado');
const inputBusqueda = document.getElementById('busqueda');
const btnBuscar = document.getElementById('btn-buscar');
const btnNuevaEmpresa = document.getElementById('btn-nueva-empresa');
const modalNueva = document.getElementById('modal-nueva-empresa');
const formNueva = document.getElementById('form-nueva-empresa');
const neNombre = document.getElementById('ne-nombre');
const neRif = document.getElementById('ne-rif');
const neTelefono = document.getElementById('ne-telefono');
const neDireccion = document.getElementById('ne-direccion');
const nePlan = document.getElementById('ne-plan');
const neMonto = document.getElementById('ne-monto');
const neCancelar = document.getElementById('ne-cancelar');

// Modal usuario admin de empresa
const modalAdminEmp = document.getElementById('modal-admin-empresa');
const formAdminEmp = document.getElementById('form-admin-empresa');
const uaEmpresaInfo = document.getElementById('ua-empresa-info');
const uaUsername = document.getElementById('ua-username');
const uaPassword = document.getElementById('ua-password');
const uaNombre = document.getElementById('ua-nombre');
const uaCancelar = document.getElementById('ua-cancelar');
let uaEmpresaId = null;

// Modal confirmación genérica de acción sobre empresa
const modalConfirm = document.getElementById('modal-confirm-empresa');
const mcTitle = document.getElementById('mc-title');
const mcMessage = document.getElementById('mc-message');
const mcCancelar = document.getElementById('mc-cancelar');
const mcConfirmar = document.getElementById('mc-confirmar');
let currentConfirmAction = null;

// Modal plan / monto
const modalPlan = document.getElementById('modal-plan-empresa');
const formPlan = document.getElementById('form-plan-empresa');
const mpPlan = document.getElementById('mp-plan');
const mpMonto = document.getElementById('mp-monto');
const mpCancelar = document.getElementById('mp-cancelar');
let mpEmpresaId = null;

// Modal registrar pago
const modalPago = document.getElementById('modal-pago-empresa');
const formPago = document.getElementById('form-pago-empresa');
const rpFecha = document.getElementById('rp-fecha');
const rpMeses = document.getElementById('rp-meses');
const rpCancelar = document.getElementById('rp-cancelar');
let rpEmpresaId = null;

// Modal pagos de licencia por empresa
const modalPagosLic = document.getElementById('modal-pagos-licencia');
const plEmpresaInfo = document.getElementById('pl-empresa-info');
const plList = document.getElementById('pl-list');
const plCerrar = document.getElementById('pl-cerrar');
let plEmpresaId = null;

// Modal días de gracia de la empresa
const modalCiclo = document.getElementById('modal-ciclo-empresa');
const formCiclo = document.getElementById('form-ciclo-empresa');
const ecGracia = document.getElementById('ec-gracia');
const ecCancelar = document.getElementById('ec-cancelar');
let ecEmpresaId = null;

// Branding del panel superadmin
const brandTituloInput = document.getElementById('brand-titulo');
const brandDrawerInput = document.getElementById('brand-drawer');
const btnGuardarBranding = document.getElementById('btn-guardar-branding');
const brandMainTitleEl = document.getElementById('brand-main-title');
const drawerAppNameEl = document.getElementById('drawer-app-name');

const DEFAULT_BRAND_TITULO = 'DIESEL CTRL';
const DEFAULT_BRAND_DRAWER = 'Diesel Ctrl';

let empresas = [];

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStatePanel(message, tone = 'slate') {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-500',
    rose: 'border-rose-200 bg-rose-50 text-rose-600',
  };
  const toneClass = tones[tone] || tones.slate;
  return `<div class="rounded-[28px] border ${toneClass} px-6 py-10 text-center text-sm font-medium shadow-sm">${escapeText(message)}</div>`;
}

function renderLoadingEmpresas() {
  if (resumenEmpresas) {
    resumenEmpresas.innerHTML = Array.from({ length: 4 }).map(() => `
      <div class="animate-pulse rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
        <div class="h-3 w-24 rounded-full bg-slate-200"></div>
        <div class="mt-4 h-8 w-16 rounded-2xl bg-slate-200"></div>
        <div class="mt-3 h-3 w-36 rounded-full bg-slate-100"></div>
      </div>
    `).join('');
  }

  if (tbody) {
    tbody.innerHTML = Array.from({ length: 3 }).map(() => `
      <article class="animate-pulse rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
        <div class="h-1.5 w-full rounded-full bg-slate-100"></div>
        <div class="mt-5 flex items-start gap-3">
          <div class="h-12 w-12 rounded-2xl bg-slate-100"></div>
          <div class="flex-1">
            <div class="h-5 w-40 rounded-full bg-slate-200"></div>
            <div class="mt-3 h-3 w-28 rounded-full bg-slate-100"></div>
            <div class="mt-4 h-3 w-3/4 rounded-full bg-slate-100"></div>
          </div>
        </div>
        <div class="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          <div class="h-24 rounded-[22px] bg-slate-50"></div>
          <div class="h-24 rounded-[22px] bg-slate-50"></div>
          <div class="h-24 rounded-[22px] bg-slate-50"></div>
          <div class="h-24 rounded-[22px] bg-slate-50"></div>
        </div>
        <div class="mt-5 grid gap-3 2xl:grid-cols-3">
          <div class="h-36 rounded-[22px] bg-slate-50"></div>
          <div class="h-36 rounded-[22px] bg-slate-50"></div>
          <div class="h-36 rounded-[22px] bg-slate-50"></div>
        </div>
      </article>
    `).join('');
  }
}

function renderResumenEmpresas(items = []) {
  if (!resumenEmpresas) return;

  const counts = items.reduce((acc, empresa) => {
    const estado = calcularEstadoLicencia(empresa);
    acc.total += 1;
    if (estado === 'activa') acc.activa += 1;
    if (estado === 'morosa') acc.morosa += 1;
    if (estado === 'suspendida') acc.suspendida += 1;
    if (empresa.plan && String(empresa.plan).toUpperCase().startsWith('TRIAL')) acc.trial += 1;
    return acc;
  }, { total: 0, activa: 0, morosa: 0, suspendida: 0, trial: 0 });

  const cards = [
    {
      label: 'Total empresas',
      value: counts.total,
      hint: `${counts.trial} en periodo de prueba`,
      cardClass: 'border-slate-900/10 bg-slate-900 text-white shadow-slate-900/20',
      labelClass: 'text-slate-300/70',
      valueClass: 'text-white',
      hintClass: 'text-slate-300/80',
      iconWrap: 'bg-white/10 text-white ring-1 ring-white/10',
      icon: 'fa-layer-group',
    },
    {
      label: 'Activas',
      value: counts.activa,
      hint: 'Licencias al día',
      cardClass: 'border-emerald-200 bg-emerald-50',
      labelClass: 'text-emerald-700/80',
      valueClass: 'text-emerald-900',
      hintClass: 'text-emerald-700',
      iconWrap: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
      icon: 'fa-circle-check',
    },
    {
      label: 'Morosas',
      value: counts.morosa,
      hint: 'Dentro de la gracia',
      cardClass: 'border-amber-200 bg-amber-50',
      labelClass: 'text-amber-700/80',
      valueClass: 'text-amber-900',
      hintClass: 'text-amber-700',
      iconWrap: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
      icon: 'fa-hourglass-half',
    },
    {
      label: 'Suspendidas',
      value: counts.suspendida,
      hint: 'Requieren reactivación',
      cardClass: 'border-rose-200 bg-rose-50',
      labelClass: 'text-rose-700/80',
      valueClass: 'text-rose-900',
      hintClass: 'text-rose-700',
      iconWrap: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200',
      icon: 'fa-ban',
    },
  ];

  resumenEmpresas.innerHTML = cards.map((card) => `
    <article class="rounded-[24px] border ${card.cardClass} p-4 shadow-sm shadow-slate-200/50">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-[11px] font-black uppercase tracking-[0.24em] ${card.labelClass}">${card.label}</div>
          <div class="mt-3 text-3xl font-black tracking-tight ${card.valueClass}">${card.value}</div>
        </div>
        <span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl ${card.iconWrap}">
          <i class="fas ${card.icon}"></i>
        </span>
      </div>
      <p class="mt-2 text-xs ${card.hintClass}">${card.hint}</p>
    </article>
  `).join('');
}

function getEstadoVisual(estado) {
  const themes = {
    activa: {
      card: 'border-emerald-200/80',
      accent: 'from-emerald-500 via-emerald-400 to-teal-400',
      iconWrap: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80',
      summary: 'border-emerald-100 bg-emerald-50/80',
      summaryLabel: 'text-emerald-700',
      icon: 'fa-circle-check',
    },
    morosa: {
      card: 'border-amber-200/80',
      accent: 'from-amber-500 via-amber-400 to-orange-400',
      iconWrap: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/80',
      summary: 'border-amber-100 bg-amber-50/80',
      summaryLabel: 'text-amber-700',
      icon: 'fa-hourglass-half',
    },
    suspendida: {
      card: 'border-rose-200/80',
      accent: 'from-rose-500 via-rose-400 to-pink-400',
      iconWrap: 'bg-rose-100 text-rose-700 ring-1 ring-rose-200/80',
      summary: 'border-rose-100 bg-rose-50/80',
      summaryLabel: 'text-rose-700',
      icon: 'fa-ban',
    },
  };
  return themes[estado] || themes.activa;
}

function renderInfoTile({ label, value, hint, icon, tone = 'slate' }) {
  const tones = {
    slate: {
      card: 'border-slate-200 bg-slate-50/70',
      label: 'text-slate-400',
      value: 'text-slate-900',
      hint: 'text-slate-500',
      iconWrap: 'bg-white text-slate-600 ring-1 ring-slate-200',
    },
    sky: {
      card: 'border-sky-200 bg-sky-50/80',
      label: 'text-sky-700/80',
      value: 'text-sky-950',
      hint: 'text-sky-700',
      iconWrap: 'bg-white text-sky-700 ring-1 ring-sky-200',
    },
    indigo: {
      card: 'border-indigo-200 bg-indigo-50/80',
      label: 'text-indigo-700/80',
      value: 'text-indigo-950',
      hint: 'text-indigo-700',
      iconWrap: 'bg-white text-indigo-700 ring-1 ring-indigo-200',
    },
    amber: {
      card: 'border-amber-200 bg-amber-50/80',
      label: 'text-amber-700/80',
      value: 'text-amber-950',
      hint: 'text-amber-700',
      iconWrap: 'bg-white text-amber-700 ring-1 ring-amber-200',
    },
    rose: {
      card: 'border-rose-200 bg-rose-50/80',
      label: 'text-rose-700/80',
      value: 'text-rose-950',
      hint: 'text-rose-700',
      iconWrap: 'bg-white text-rose-700 ring-1 ring-rose-200',
    },
  };
  const theme = tones[tone] || tones.slate;
  return `
    <div class="rounded-[22px] border ${theme.card} p-4 shadow-sm shadow-slate-200/40">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-[11px] font-black uppercase tracking-[0.22em] ${theme.label}">${escapeText(label)}</div>
          <div class="mt-2.5 text-base font-black tracking-tight ${theme.value}">${escapeText(value)}</div>
        </div>
        <span class="inline-flex h-10 w-10 items-center justify-center rounded-2xl ${theme.iconWrap}">
          <i class="fas ${icon}"></i>
        </span>
      </div>
      <p class="mt-2.5 text-xs leading-relaxed ${theme.hint}">${escapeText(hint)}</p>
    </div>
  `;
}

function renderActionButton({ label, icon, tone = 'slate', onClick }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    rose: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
    slate: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100',
    blue: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
  };
  const toneClass = tones[tone] || tones.slate;
  return `<button type="button" class="inline-flex min-h-[46px] w-full items-center justify-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-center text-[12px] font-semibold leading-tight shadow-sm transition ${toneClass}" onclick="${onClick}"><i class="fas ${icon} text-[11px]"></i><span>${escapeText(label)}</span></button>`;
}

function renderCompactActionButton({ label, icon, tone = 'slate', onClick }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    rose: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    slate: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100',
  };
  const toneClass = tones[tone] || tones.slate;
  return `<button type="button" class="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold leading-none shadow-sm transition ${toneClass}" onclick="${onClick}"><i class="fas ${icon} text-[10px]"></i><span>${escapeText(label)}</span></button>`;
}

function aplicarBrandingEnVista(branding) {
  const titulo = (branding && branding.titulo ? String(branding.titulo).trim() : '') || DEFAULT_BRAND_TITULO;
  const drawerNombre = (branding && branding.drawer_nombre ? String(branding.drawer_nombre).trim() : '') || DEFAULT_BRAND_DRAWER;

  if (brandMainTitleEl) {
    brandMainTitleEl.textContent = titulo;
  }
  if (drawerAppNameEl) {
    drawerAppNameEl.textContent = drawerNombre;
  }

  if (typeof document !== 'undefined' && document.title) {
    document.title = `Empresas (Master) — ${titulo}`;
  }
}

async function cargarBranding() {
  if (!brandTituloInput || !btnGuardarBranding) return;
  try {
    const data = await apiFetchJson('/admin/ajustes/branding');
    const branding = data && data.branding ? data.branding : data;
    const titulo = (branding && branding.titulo) || DEFAULT_BRAND_TITULO;
    const drawerNombre = (branding && branding.drawer_nombre) || branding.titulo || DEFAULT_BRAND_DRAWER;

    brandTituloInput.value = titulo;
    if (brandDrawerInput) brandDrawerInput.value = drawerNombre;

    aplicarBrandingEnVista({ titulo, drawer_nombre: drawerNombre });
  } catch (err) {
    console.warn('No se pudo cargar branding del panel', err && err.message ? err.message : err);
    brandTituloInput.value = DEFAULT_BRAND_TITULO;
    if (brandDrawerInput) brandDrawerInput.value = DEFAULT_BRAND_DRAWER;
    aplicarBrandingEnVista({ titulo: DEFAULT_BRAND_TITULO, drawer_nombre: DEFAULT_BRAND_DRAWER });
  }
}

async function cargarEmpresas() {
  try {
    renderLoadingEmpresas();
    const params = new URLSearchParams();
    if (filtroEstado.value) params.set('estado', filtroEstado.value);
    if (inputBusqueda.value.trim()) params.set('q', inputBusqueda.value.trim());

    const url = params.toString() ? `/admin/empresas?${params.toString()}` : '/admin/empresas';
    empresas = await apiFetchJson(url);
    renderEmpresas();
  } catch (err) {
    console.error(err);
    const msg = (err && err.message) || 'Error cargando empresas';
    if (String(msg).includes('403') || String(msg).toLowerCase().includes('forbidden')) {
      if (window.showToast) {
        window.showToast('No tienes permisos para acceder a esta página (solo superadmin).', 'error');
      } else {
        alert('No tienes permisos para acceder a esta página (solo superadmin).');
      }
      window.location.href = '/login';
      return;
    }
    renderResumenEmpresas([]);
    tbody.innerHTML = renderStatePanel('Error cargando empresas', 'rose');
  }
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function formatFechaCortaLocal(iso) {
  if (!iso) return '—';
  const simpleMatch = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
  const d = simpleMatch
    ? (() => {
        const [y, m, day] = String(iso).split('-').map(Number);
        return new Date(y, m - 1, day);
      })()
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10) || '—';
  try {
    return d.toLocaleDateString('es-VE');
  } catch {
    return String(iso).slice(0, 10) || '—';
  }
}

function parseFechaLocal(iso) {
  if (!iso) return null;
  const simpleMatch = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
  const d = simpleMatch
    ? (() => {
        const [y, m, day] = String(iso).split('-').map(Number);
        return new Date(y, m - 1, day);
      })()
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function calcularEstadoLicencia(empresa) {
  const estadoBase = empresa.estado || 'activa';

  // Si está suspendida manualmente, siempre manda
  if (estadoBase === 'suspendida') return 'suspendida';

  // Si no hay próximo cobro configurado, usamos el estado base
  if (!empresa.proximo_cobro) return estadoBase;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaCobro = parseFechaLocal(empresa.proximo_cobro);
  if (!fechaCobro) return estadoBase;

  const diasGracia = Number.isFinite(Number(empresa.dias_gracia)) ? Number(empresa.dias_gracia) : 0;
  const limiteGracia = addDays(fechaCobro, diasGracia);

  if (hoy <= fechaCobro) return 'activa';
  if (hoy <= limiteGracia) return 'morosa';
  return 'suspendida';
}

function badgeEstado(estado) {
  if (estado === 'activa') return '<span class="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">Activa</span>';
  if (estado === 'morosa') return '<span class="px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">Morosa</span>';
  if (estado === 'suspendida') return '<span class="px-2 py-1 rounded-full bg-rose-100 text-rose-700 text-xs font-semibold">Suspendida</span>';
  return estado || '';
}

function renderEmpresas() {
  renderResumenEmpresas(empresas);

  if (!Array.isArray(empresas) || empresas.length === 0) {
    tbody.innerHTML = renderStatePanel('No hay empresas registradas');
    return;
  }

  let html = '';

  empresas.forEach(e => {
    const estadoLicencia = calcularEstadoLicencia(e);
    const visual = getEstadoVisual(estadoLicencia);
    const esTrial = e.plan && String(e.plan).toUpperCase().startsWith('TRIAL');
    const esLocal = e.id === 1 || e.codigo === 'LOCAL';
    const permitirAnularVenta = !!e.permitir_anular_venta;
    const planBase = (e.plan || '—') + (e.monto_mensual ? ` / $${formatNumber(e.monto_mensual, 2)}` : '');
    const planTexto = esTrial ? `${planBase} · TRIAL` : planBase;
    const textoGracia = `${e.dias_gracia || 0} días de gracia`;
    const proximo = e.proximo_cobro ? formatFechaCortaLocal(e.proximo_cobro) : '—';
    const ultimoPago = e.ultimo_pago_en ? formatFechaCortaLocal(e.ultimo_pago_en) : '—';
    const notaInterna = e.nota_interna
      ? escapeText(e.nota_interna)
      : (esLocal
        ? 'Empresa local base. Use este espacio para referencia interna del panel.'
        : 'Sin nota interna registrada para esta empresa.');
    const resumenCobro = proximo === '—'
      ? 'Sin próximo cobro configurado'
      : `${proximo}${esTrial ? ' · fin de prueba' : ''}`;

    const accionesEstado = [];
    if (estadoLicencia !== 'activa') {
      accionesEstado.push({ label: 'Activar', icon: 'fa-check', tone: 'emerald', onClick: `window.__activarEmpresa(${e.id})` });
    }
    if (estadoLicencia !== 'suspendida') {
      accionesEstado.push({ label: 'Suspender', icon: 'fa-ban', tone: 'rose', onClick: `window.__suspenderEmpresa(${e.id})` });
    }
    if (estadoLicencia === 'activa') {
      accionesEstado.push({ label: 'Marcar morosa', icon: 'fa-triangle-exclamation', tone: 'amber', onClick: `window.__marcarMorosa(${e.id})` });
    }

    const accionesEstadoHeaderHtml = accionesEstado.length
      ? `<div class="mt-4 flex flex-wrap gap-2">${accionesEstado.map((action) => renderCompactActionButton(action)).join('')}</div>`
      : '';

    const accionesFacturacion = [
      renderActionButton({ label: 'Plan y monto', icon: 'fa-wallet', tone: 'sky', onClick: `window.__editarPlan(${e.id})` }),
      renderActionButton({ label: 'Registrar pago', icon: 'fa-credit-card', tone: 'indigo', onClick: `window.__registrarPago(${e.id})` }),
      renderActionButton({ label: 'Historial pagos', icon: 'fa-receipt', tone: 'emerald', onClick: `window.__verPagosLicencia(${e.id})` }),
      renderActionButton({ label: 'Días de gracia', icon: 'fa-calendar-plus', tone: 'slate', onClick: `window.__editarCiclo(${e.id})` }),
    ].join('');

    const accionesControl = [
      renderActionButton({
        label: permitirAnularVenta ? 'Anulación ventas ON' : 'Anulación ventas OFF',
        icon: permitirAnularVenta ? 'fa-toggle-on' : 'fa-toggle-off',
        tone: permitirAnularVenta ? 'rose' : 'slate',
        onClick: `window.__toggleAnularVenta(${e.id}, ${permitirAnularVenta ? 'false' : 'true'})`,
      }),
    ];

    if (!esLocal) {
      accionesControl.push(renderActionButton({ label: 'Usuario admin', icon: 'fa-user-shield', tone: 'blue', onClick: `window.__abrirCrearAdmin(${e.id})` }));
      accionesControl.push(renderActionButton({ label: 'Eliminar empresa', icon: 'fa-trash', tone: 'rose', onClick: `window.__eliminarEmpresa(${e.id})` }));
    }

    const controlExtra = esLocal
      ? '<div class="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-4 text-center text-[12px] text-slate-400">Empresa protegida: no se muestran acciones destructivas.</div>'
      : `<div class="grid gap-2 md:grid-cols-2">${accionesControl.slice(1).join('')}</div>`;

    html += `
      <article class="relative overflow-hidden rounded-[28px] border ${visual.card} bg-white shadow-sm shadow-slate-200/60">
        <div class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${visual.accent}"></div>
        <div class="p-5 sm:p-6">
          <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-4">
                <span class="mt-1 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${visual.iconWrap}">
                  <i class="fas ${visual.icon} text-lg"></i>
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="text-lg font-black tracking-tight text-slate-900">${escapeText(e.nombre || 'Empresa sin nombre')}</h3>
                    ${badgeEstado(estadoLicencia)}
                    ${esTrial ? '<span class="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-sky-700">Trial</span>' : ''}
                    ${esLocal ? '<span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">Local</span>' : ''}
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <span class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                      <i class="fas fa-hashtag text-[10px]"></i>
                      ${escapeText(e.codigo || 'SIN-CODIGO')}
                    </span>
                    <span class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      <i class="fas fa-fingerprint text-[10px]"></i>
                      ID ${e.id}
                    </span>
                  </div>
                  <p class="mt-3 max-w-2xl text-sm leading-relaxed ${e.nota_interna ? 'text-slate-500' : 'text-slate-400'}">${notaInterna}</p>
                  ${accionesEstadoHeaderHtml}
                </div>
              </div>
            </div>

            <aside class="rounded-[22px] border ${visual.summary} px-4 py-4 lg:w-[210px] lg:shrink-0">
              <div class="text-[11px] font-black uppercase tracking-[0.22em] ${visual.summaryLabel}">Resumen rápido</div>
              <div class="mt-3 text-2xl font-black tracking-tight text-slate-900">${e.monto_mensual ? `$${formatNumber(e.monto_mensual, 2)}` : 'Sin monto'}</div>
              <div class="mt-1 text-sm font-semibold text-slate-700">${escapeText(e.plan || 'Plan sin definir')}</div>
              <p class="mt-3 text-xs leading-relaxed text-slate-500">${escapeText(resumenCobro)}</p>
            </aside>
          </div>

          <div class="mt-5 grid gap-3 md:grid-cols-2">
            ${renderInfoTile({ label: 'Plan actual', value: planTexto, hint: esTrial ? 'Empresa en periodo de prueba' : 'Configuración de facturación activa', icon: 'fa-wallet', tone: 'sky' })}
            ${renderInfoTile({ label: 'Próximo cobro', value: proximo, hint: ultimoPago === '—' ? 'Sin pagos registrados' : `Último pago: ${ultimoPago}`, icon: 'fa-calendar-days', tone: 'indigo' })}
            ${renderInfoTile({ label: 'Días de gracia', value: textoGracia, hint: estadoLicencia === 'morosa' ? 'Está consumiendo la ventana de gracia' : estadoLicencia === 'suspendida' ? 'La gracia ya expiró' : 'Todavía no entra en mora', icon: 'fa-hourglass-half', tone: 'amber' })}
            ${renderInfoTile({ label: 'Control de ventas', value: permitirAnularVenta ? 'Anulación habilitada' : 'Anulación bloqueada', hint: permitirAnularVenta ? 'Los admins podrán anular desde reportes' : 'La anulación está protegida por licencia', icon: 'fa-shield-halved', tone: permitirAnularVenta ? 'rose' : 'slate' })}
          </div>

          <div class="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(250px,0.9fr)]">
            <section class="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
              <div class="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                <i class="fas fa-file-invoice-dollar text-[10px]"></i>
                Facturación
              </div>
              <p class="mt-2 text-xs text-slate-500">Plan, cobro, historial y ventana de gracia.</p>
              <div class="mt-4 grid gap-2 md:grid-cols-2">${accionesFacturacion}</div>
            </section>

            <section class="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
              <div class="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                <i class="fas fa-lock text-[10px]"></i>
                Control
              </div>
              <p class="mt-2 text-xs text-slate-500">Permisos sensibles y acciones administrativas.</p>
              <div class="mt-4 grid gap-2">${accionesControl[0]}${controlExtra}</div>
            </section>
          </div>
        </div>
      </article>
    `;
  });

  tbody.innerHTML = html;
}

// Modernizar selects básicos
try {
  initCustomSelect('filtro-estado');
} catch {}

async function patchEmpresa(id, payload, successMessage) {
  try {
    await apiFetchJson(`/admin/empresas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (window.showToast) {
      window.showToast(successMessage || 'Empresa actualizada', 'success');
    } else {
      alert(successMessage || 'Empresa actualizada');
    }
    await cargarEmpresas();
  } catch (err) {
    console.error(err);
    if (window.showToast) {
      window.showToast(err.message || 'Error al actualizar empresa', 'error');
    } else {
      alert(err.message || 'Error al actualizar empresa');
    }
  }
}

async function cargarPagosLicenciaEmpresa(id) {
  if (!plList) return;
  plList.innerHTML = '<div class="py-2 text-slate-400">Cargando pagos...</div>';
  try {
    const pagos = await apiFetchJson(`/admin/empresas/${id}/pagos-licencia`);
    if (!Array.isArray(pagos) || !pagos.length) {
      plList.innerHTML = '<div class="py-2 text-slate-400">No hay pagos registrados para esta empresa.</div>';
      return;
    }
    let html = '';
    pagos.forEach((p) => {
      const fecha = formatFechaCortaLocal(p.fecha);
      const monto = typeof p.monto_usd === 'number' && !Number.isNaN(p.monto_usd) ? `$${formatNumber(p.monto_usd, 2)}` : '—';
      const estado = (p.estado || '').toString().toLowerCase();
      const estadoBadge = estado === 'pendiente'
        ? '<span class="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">Pendiente</span>'
        : estado === 'aplicado'
          ? '<span class="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">Aplicado</span>'
          : estado === 'rechazado'
            ? '<span class="ml-2 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-semibold">Rechazado</span>'
            : '';
      const tipo = p.tipo || '—';
      const ref = p.referencia || '—';
      const notas = p.notas || '';
      const compLink = p.comprobante_url
        ? `<a href="${p.comprobante_url}" target="_blank" rel="noopener" class="text-xs text-sky-600 hover:underline">Ver captura</a>`
        : '<span class="text-xs text-slate-400">Sin captura</span>';

      html += `<div class="py-2 flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <div class="text-xs text-slate-600">${fecha} · ${monto}${estadoBadge}</div>
          <div class="text-xs text-slate-500">Tipo: ${tipo}</div>
        </div>
        <div class="text-xs text-slate-500">Ref: ${ref}</div>
        <div class="flex items-center justify-between gap-2">
          <div class="text-[11px] text-slate-500 truncate">${p.descripcion || ''}</div>
          <div>${compLink}</div>
        </div>`;

      if (notas) {
        html += `<div class="text-[11px] text-slate-500">Notas: ${notas}</div>`;
      }

      if (estado === 'pendiente') {
        html += `<div class="mt-1 flex flex-wrap gap-2">
          <button class="px-2 py-1 rounded bg-emerald-600 text-white text-[11px]" data-pl-accion="aplicar" data-pl-id="${p.id}">Marcar recibido (+1 mes)</button>
          <button class="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px]" data-pl-accion="rechazar" data-pl-id="${p.id}">Rechazar</button>
        </div>`;
      }

      html += '</div>';
    });

    plList.innerHTML = html;

    plList.querySelectorAll('[data-pl-accion]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const accion = btn.getAttribute('data-pl-accion');
        const idPago = btn.getAttribute('data-pl-id');
        if (!plEmpresaId || !idPago) return;
        const nuevoEstado = accion === 'aplicar' ? 'aplicado' : 'rechazado';
        const meses = accion === 'aplicar' ? 1 : 0;
        try {
          await apiFetchJson(`/admin/empresas/${plEmpresaId}/pagos-licencia/${idPago}/estado`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado, meses_pagados: meses }),
          });
          if (window.showToast) window.showToast('Estado de pago actualizado', 'success');
          await cargarPagosLicenciaEmpresa(plEmpresaId);
          await cargarEmpresas();
        } catch (err) {
          console.error(err);
          if (window.showToast) window.showToast(err.message || 'Error actualizando pago', 'error');
        }
      });
    });
  } catch (err) {
    console.error(err);
    plList.innerHTML = '<div class="py-2 text-rose-500">Error cargando pagos de licencia.</div>';
  }
}

window.__verPagosLicencia = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa || !modalPagosLic || !plEmpresaInfo) return;
  plEmpresaId = id;
  plEmpresaInfo.textContent = `Empresa: ${empresa.nombre} (código ${empresa.codigo})`;
  modalPagosLic.classList.remove('hidden');
  modalPagosLic.classList.add('flex');
  cargarPagosLicenciaEmpresa(id);
};

if (plCerrar && modalPagosLic) {
  plCerrar.addEventListener('click', () => {
    modalPagosLic.classList.add('hidden');
    modalPagosLic.classList.remove('flex');
    plEmpresaId = null;
  });
}

window.__activarEmpresa = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!modalConfirm) {
    patchEmpresa(id, { estado: 'activa' }, 'Empresa activada');
    return;
  }
  mcTitle.textContent = 'Activar empresa';
  mcMessage.textContent = `¿Activar la empresa "${empresa.nombre}"?`;
  currentConfirmAction = () => {
    patchEmpresa(id, { estado: 'activa' }, 'Empresa activada');
  };
  modalConfirm.classList.remove('hidden');
  modalConfirm.classList.add('flex');
};

window.__suspenderEmpresa = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!modalConfirm) {
    patchEmpresa(id, { estado: 'suspendida' }, 'Empresa suspendida');
    return;
  }
  mcTitle.textContent = 'Suspender empresa';
  mcMessage.textContent = `¿Suspender la empresa "${empresa.nombre}"? Esto bloqueará el acceso de sus usuarios hasta que se reactive.`;
  currentConfirmAction = () => {
    patchEmpresa(id, { estado: 'suspendida' }, 'Empresa suspendida');
  };
  modalConfirm.classList.remove('hidden');
  modalConfirm.classList.add('flex');
};

window.__marcarMorosa = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!modalConfirm) {
    patchEmpresa(id, { estado: 'morosa' }, 'Empresa marcada como morosa');
    return;
  }
  mcTitle.textContent = 'Marcar empresa morosa';
  mcMessage.textContent = `¿Marcar la empresa "${empresa.nombre}" como morosa?`;
  currentConfirmAction = () => {
    patchEmpresa(id, { estado: 'morosa' }, 'Empresa marcada como morosa');
  };
  modalConfirm.classList.remove('hidden');
  modalConfirm.classList.add('flex');
};

window.__editarPlan = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!modalPlan) {
    const planActual = empresa.plan || '';
    const montoActual = Number(empresa.monto_mensual || 0);
    const nuevoPlan = window.prompt('Nombre del plan (Ej: Mensual, Pro, Multi-sucursal):', planActual);
    if (nuevoPlan === null) return;
    const nuevoMontoStr = window.prompt('Monto mensual en USD:', montoActual > 0 ? String(montoActual) : '0');
    if (nuevoMontoStr === null) return;
    const nuevoMonto = Number(nuevoMontoStr);
    if (Number.isNaN(nuevoMonto) || nuevoMonto < 0) {
      if (window.showToast) window.showToast('Monto inválido (debe ser un número positivo).', 'error'); else alert('Monto inválido (debe ser un número positivo).');
      return;
    }
    patchEmpresa(id, { plan: nuevoPlan, monto_mensual: nuevoMonto }, 'Plan y monto actualizados');
    return;
  }

  mpEmpresaId = id;
  mpPlan.value = empresa.plan || '';
  const montoActual = Number(empresa.monto_mensual || 0);
  mpMonto.value = Number.isNaN(montoActual) ? '' : String(montoActual);
  modalPlan.classList.remove('hidden');
  modalPlan.classList.add('flex');
  setTimeout(() => mpPlan.focus(), 50);
};

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonths(date, months) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

window.__registrarPago = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!modalPago) {
    const hoy = new Date();
    const fechaDefault = formatDateInput(hoy);
    const fechaPagoStr = window.prompt('Fecha del pago (YYYY-MM-DD):', fechaDefault);
    if (fechaPagoStr === null) return;
    const fechaPago = parseFechaLocal(fechaPagoStr);
    if (!fechaPago) {
      if (window.showToast) window.showToast('Fecha de pago inválida.', 'error'); else alert('Fecha de pago inválida.');
      return;
    }
    const mesesStr = window.prompt('Meses pagados (1 = mensual, 3 = trimestral, etc.):', '1');
    if (mesesStr === null) return;
    const meses = parseInt(mesesStr, 10);
    if (Number.isNaN(meses) || meses <= 0 || meses > 24) {
      if (window.showToast) window.showToast('Cantidad de meses inválida (1-24).', 'error'); else alert('Cantidad de meses inválida (1-24).');
      return;
    }
    const proximoCobroDate = addMonths(fechaPago, meses);
    const proximoCobroStr = formatDateInput(proximoCobroDate);
    patchEmpresa(id, {
      ultimo_pago_en: fechaPagoStr,
      proximo_cobro: proximoCobroStr,
      estado: 'activa'
    }, 'Pago registrado y próximo cobro actualizado');
    return;
  }

  rpEmpresaId = id;
  const hoy = new Date();
  rpFecha.value = formatDateInput(hoy);
  rpMeses.value = '1';
  modalPago.classList.remove('hidden');
  modalPago.classList.add('flex');
  setTimeout(() => rpFecha.focus(), 50);
};

window.__editarCiclo = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!modalCiclo) {
    const actualGracia = empresa.dias_gracia || 7;
    const nuevoGraciaStr = window.prompt('Días de gracia (0-60):', String(actualGracia));
    if (nuevoGraciaStr === null) return;
    const nuevoGracia = parseInt(nuevoGraciaStr, 10);
    if (Number.isNaN(nuevoGracia) || nuevoGracia < 0 || nuevoGracia > 60) {
      if (window.showToast) window.showToast('Valor de días de gracia inválido (0-60).', 'error'); else alert('Valor de días de gracia inválido (0-60).');
      return;
    }
    patchEmpresa(id, { dias_gracia: nuevoGracia }, 'Días de gracia actualizados');
    return;
  }

  ecEmpresaId = id;
  const actualGracia = empresa.dias_gracia || 7;
  ecGracia.value = String(actualGracia);
  modalCiclo.classList.remove('hidden');
  modalCiclo.classList.add('flex');
  setTimeout(() => ecGracia.focus(), 50);
};

window.__toggleAnularVenta = function (id, habilitar) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;

  const activar = !!habilitar;
  const titulo = activar ? 'Habilitar anulación de ventas' : 'Desactivar anulación de ventas';
  const mensaje = activar
    ? `¿Habilitar la anulación total de ventas para "${empresa.nombre}"? Esto mostrará el botón de anular venta en reportes a los administradores de esa empresa.`
    : `¿Desactivar la anulación total de ventas para "${empresa.nombre}"? El botón dejará de mostrarse y la API rechazará nuevas anulaciones.`;
  const okMessage = activar
    ? 'Anulación total de ventas habilitada.'
    : 'Anulación total de ventas desactivada.';

  if (!modalConfirm) {
    patchEmpresa(id, { permitir_anular_venta: activar }, okMessage);
    return;
  }

  mcTitle.textContent = titulo;
  mcMessage.textContent = mensaje;
  currentConfirmAction = () => {
    patchEmpresa(id, { permitir_anular_venta: activar }, okMessage);
  };
  modalConfirm.classList.remove('hidden');
  modalConfirm.classList.add('flex');
};

btnBuscar.addEventListener('click', () => {
  cargarEmpresas();
});

filtroEstado.addEventListener('change', () => {
  cargarEmpresas();
});

inputBusqueda.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') cargarEmpresas();
});

function abrirModalNuevaEmpresa() {
  if (!modalNueva) return;
  neNombre.value = '';
  neRif.value = '';
  neTelefono.value = '';
  neDireccion.value = '';
  nePlan.value = 'Mensual';
  neMonto.value = '0';
  modalNueva.classList.remove('hidden');
  modalNueva.classList.add('flex');
  neNombre.focus();
}

function cerrarModalNuevaEmpresa() {
  if (!modalNueva) return;
  modalNueva.classList.add('hidden');
  modalNueva.classList.remove('flex');
}

btnNuevaEmpresa.addEventListener('click', () => {
  abrirModalNuevaEmpresa();
});

neCancelar.addEventListener('click', () => {
  cerrarModalNuevaEmpresa();
});

formNueva.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const nombreTrim = (neNombre.value || '').trim();
    if (!nombreTrim || nombreTrim.length < 3) {
      if (window.showToast) window.showToast('El nombre debe tener al menos 3 caracteres.', 'error');
      else alert('El nombre debe tener al menos 3 caracteres.');
      neNombre.focus();
      return;
    }

    const rifTrim = (neRif.value || '').trim();
    const codigoBase = rifTrim || nombreTrim.toUpperCase().replace(/\s+/g, '-');
    const codigoTrim = codigoBase.slice(0, 20).toUpperCase();
    if (!codigoTrim || codigoTrim.length < 2) {
      if (window.showToast) window.showToast('No se pudo generar un código válido para la empresa.', 'error');
      else alert('No se pudo generar un código válido para la empresa.');
      return;
    }

    const montoStr = (neMonto.value || '').trim();
    let monto = null;
    if (montoStr !== '') {
      monto = Number(montoStr);
      if (Number.isNaN(monto) || monto < 0) {
        if (window.showToast) window.showToast('Monto inválido (debe ser un número positivo).', 'error');
        else alert('Monto inválido (debe ser un número positivo).');
        return;
      }
    }

    const resp = await apiFetchJson('/admin/empresas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombreTrim,
        codigo: codigoTrim,
        plan: (nePlan.value || '').trim() || null,
        monto_mensual: monto,
        rif: rifTrim || null,
        telefono: (neTelefono.value || '').trim() || null,
        direccion: (neDireccion.value || '').trim() || null
      })
    });

    // Registrar también la empresa en Firebase (colección "empresas/{codigo}")
    try {
      const empresa = resp && (resp.empresa || resp);
      if (empresa && empresa.codigo) {
        await upsertEmpresaFirebase(empresa);
      }
    } catch (syncErr) {
      console.error('No se pudo registrar la empresa en Firebase:', syncErr);
    }

    if (window.showToast) window.showToast('Empresa creada correctamente.', 'success');
    else alert('Empresa creada correctamente.');

    cerrarModalNuevaEmpresa();
    await cargarEmpresas();
  } catch (err) {
    console.error(err);
    const msg = err && err.message ? err.message : 'Error al crear empresa';
    if (window.showToast) window.showToast(msg, 'error'); else alert(msg);
  }
});

// --- Modal usuario admin empresa ---
function abrirModalAdminEmpresa(empresa) {
  if (!modalAdminEmp) return;
  uaEmpresaId = empresa.id;
  uaEmpresaInfo.textContent = `Empresa: ${empresa.nombre} (código ${empresa.codigo})`;
  uaUsername.value = '';
  uaPassword.value = '';
  uaNombre.value = empresa.nombre ? `${empresa.nombre} (admin)` : '';
  modalAdminEmp.classList.remove('hidden');
  modalAdminEmp.classList.add('flex');
  setTimeout(() => uaUsername.focus(), 50);
}

function cerrarModalAdminEmpresa() {
  if (!modalAdminEmp) return;
  modalAdminEmp.classList.add('hidden');
  modalAdminEmp.classList.remove('flex');
  uaEmpresaId = null;
}

uaCancelar.addEventListener('click', () => {
  cerrarModalAdminEmpresa();
});

formAdminEmp.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!uaEmpresaId) return;
  try {
    const username = (uaUsername.value || '').trim();
    const password = uaPassword.value || '';
    const nombre = (uaNombre.value || '').trim();

    if (!username || username.length < 3) {
      if (window.showToast) window.showToast('El username debe tener al menos 3 caracteres.', 'error');
      else alert('El username debe tener al menos 3 caracteres.');
      uaUsername.focus();
      return;
    }
    if (!password || password.length < 6) {
      if (window.showToast) window.showToast('La contraseña debe tener al menos 6 caracteres.', 'error');
      else alert('La contraseña debe tener al menos 6 caracteres.');
      uaPassword.focus();
      return;
    }

    await apiFetchJson(`/admin/empresas/${uaEmpresaId}/crear-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, nombre_completo: nombre || username })
    });

    if (window.showToast) window.showToast('Usuario admin creado correctamente.', 'success');
    else alert('Usuario admin creado correctamente.');

    cerrarModalAdminEmpresa();
  } catch (err) {
    console.error(err);
    const msg = err && err.message ? err.message : 'Error al crear usuario admin';
    if (window.showToast) window.showToast(msg, 'error'); else alert(msg);
  }
});

// --- Eventos modales extra ---

// Confirmación genérica
if (mcCancelar && modalConfirm) {
  mcCancelar.addEventListener('click', () => {
    modalConfirm.classList.add('hidden');
    modalConfirm.classList.remove('flex');
    currentConfirmAction = null;
  });
}

if (mcConfirmar && modalConfirm) {
  mcConfirmar.addEventListener('click', () => {
    try {
      if (typeof currentConfirmAction === 'function') {
        currentConfirmAction();
      }
    } finally {
      modalConfirm.classList.add('hidden');
      modalConfirm.classList.remove('flex');
      currentConfirmAction = null;
    }
  });
}

// Modal plan / monto
if (mpCancelar && modalPlan) {
  mpCancelar.addEventListener('click', () => {
    modalPlan.classList.add('hidden');
    modalPlan.classList.remove('flex');
    mpEmpresaId = null;
  });
}

if (formPlan && modalPlan) {
  formPlan.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!mpEmpresaId) return;
    const plan = (mpPlan.value || '').trim();
    const montoStr = (mpMonto.value || '').trim();
    let monto = null;
    if (montoStr !== '') {
      monto = Number(montoStr);
      if (Number.isNaN(monto) || monto < 0) {
        if (window.showToast) window.showToast('Monto inválido (debe ser un número positivo).', 'error'); else alert('Monto inválido (debe ser un número positivo).');
        mpMonto.focus();
        return;
      }
    }
    modalPlan.classList.add('hidden');
    modalPlan.classList.remove('flex');
    const payload = { plan: plan || null, monto_mensual: monto };
    patchEmpresa(mpEmpresaId, payload, 'Plan y monto actualizados');
    mpEmpresaId = null;
  });
}

// Modal registrar pago
if (rpCancelar && modalPago) {
  rpCancelar.addEventListener('click', () => {
    modalPago.classList.add('hidden');
    modalPago.classList.remove('flex');
    rpEmpresaId = null;
  });
}

if (formPago && modalPago) {
  formPago.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!rpEmpresaId) return;
    const fechaStr = (rpFecha.value || '').trim();
    if (!fechaStr) {
      if (window.showToast) window.showToast('Debe indicar la fecha del pago.', 'error'); else alert('Debe indicar la fecha del pago.');
      rpFecha.focus();
      return;
    }
    const fechaPago = parseFechaLocal(fechaStr);
    if (!fechaPago) {
      if (window.showToast) window.showToast('Fecha de pago inválida.', 'error'); else alert('Fecha de pago inválida.');
      rpFecha.focus();
      return;
    }
    const mesesStr = (rpMeses.value || '').trim();
    const meses = parseInt(mesesStr, 10);
    if (Number.isNaN(meses) || meses <= 0 || meses > 24) {
      if (window.showToast) window.showToast('Cantidad de meses inválida (1-24).', 'error'); else alert('Cantidad de meses inválida (1-24).');
      rpMeses.focus();
      return;
    }
    const proximoCobroDate = addMonths(fechaPago, meses);
    const proximoCobroStr = formatDateInput(proximoCobroDate);
    modalPago.classList.add('hidden');
    modalPago.classList.remove('flex');
    patchEmpresa(rpEmpresaId, {
      ultimo_pago_en: fechaStr,
      proximo_cobro: proximoCobroStr,
      estado: 'activa'
    }, 'Pago registrado y próximo cobro actualizado');
    rpEmpresaId = null;
  });
}

// Modal ciclo de facturación
if (ecCancelar && modalCiclo) {
  ecCancelar.addEventListener('click', () => {
    modalCiclo.classList.add('hidden');
    modalCiclo.classList.remove('flex');
    ecEmpresaId = null;
  });
}

if (formCiclo && modalCiclo) {
  formCiclo.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ecEmpresaId) return;
    const graciaStr = (ecGracia.value || '').trim();
    const gracia = parseInt(graciaStr, 10);
    if (Number.isNaN(gracia) || gracia < 0 || gracia > 60) {
      if (window.showToast) window.showToast('Valor de días de gracia inválido (0-60).', 'error'); else alert('Valor de días de gracia inválido (0-60).');
      ecGracia.focus();
      return;
    }
    modalCiclo.classList.add('hidden');
    modalCiclo.classList.remove('flex');
    patchEmpresa(ecEmpresaId, { dias_gracia: gracia }, 'Días de gracia actualizados');
    ecEmpresaId = null;
  });
}

// Guardar branding global del panel
if (btnGuardarBranding && brandTituloInput) {
  btnGuardarBranding.addEventListener('click', async () => {
    const titulo = (brandTituloInput.value || '').trim() || DEFAULT_BRAND_TITULO;
    const drawerNombre = ((brandDrawerInput && brandDrawerInput.value) || '').trim() || titulo || DEFAULT_BRAND_DRAWER;
    try {
      const resp = await apiFetchJson('/admin/ajustes/branding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, drawer_nombre: drawerNombre })
      });
      const branding = resp && resp.branding ? resp.branding : { titulo, drawer_nombre: drawerNombre };
      aplicarBrandingEnVista(branding);
      if (window.showToast) window.showToast('Branding actualizado correctamente.', 'success');
      else alert('Branding actualizado correctamente.');
    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : 'Error al guardar branding';
      if (window.showToast) window.showToast(msg, 'error');
      else alert(msg);
    }
  });
}

// Funciones globales para botones de acciones
window.__abrirCrearAdmin = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  abrirModalAdminEmpresa(empresa);
};

window.__eliminarEmpresa = async function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!modalConfirm) {
    const confirmado = window.confirm(`¿Eliminar la empresa "${empresa.nombre}"?\n\nSe eliminarán todos los usuarios, productos y datos transaccionales asociados a esa empresa (ventas, presupuestos, compras, etc.). Esta acción no se puede deshacer.`);
    if (!confirmado) return;
    try {
      await apiFetchJson(`/admin/empresas/${id}`, { method: 'DELETE' });
      if (window.showToast) window.showToast('Empresa eliminada correctamente.', 'success');
      else alert('Empresa eliminada correctamente.');
      await cargarEmpresas();
    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : 'Error al eliminar empresa';
      if (window.showToast) window.showToast(msg, 'error'); else alert(msg);
    }
    return;
  }

  mcTitle.textContent = 'Eliminar empresa';
  mcMessage.textContent = `¿Eliminar la empresa "${empresa.nombre}"?\n\nSe eliminarán todos los usuarios, productos y datos transaccionales asociados a esa empresa (ventas, presupuestos, compras, etc.). Esta acción no se puede deshacer.`;
  currentConfirmAction = async () => {
    try {
      await apiFetchJson(`/admin/empresas/${id}`, { method: 'DELETE' });
      if (window.showToast) window.showToast('Empresa eliminada correctamente.', 'success');
      else alert('Empresa eliminada correctamente.');
      await cargarEmpresas();
    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : 'Error al eliminar empresa';
      if (window.showToast) window.showToast(msg, 'error'); else alert(msg);
    }
  };
  modalConfirm.classList.remove('hidden');
  modalConfirm.classList.add('flex');
};

// Carga inicial
cargarEmpresas();
cargarBranding();
