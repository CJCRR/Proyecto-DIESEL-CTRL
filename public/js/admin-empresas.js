import { apiFetchJson } from './app-api.js';

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
const filtroEstado = document.getElementById('filtro-estado');
const inputBusqueda = document.getElementById('busqueda');
const btnBuscar = document.getElementById('btn-buscar');

let empresas = [];

async function cargarEmpresas() {
  try {
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
      window.location.href = '/pages/login.html';
      return;
    }
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-red-500">Error cargando empresas</td></tr>';
  }
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function calcularEstadoLicencia(empresa) {
  const estadoBase = empresa.estado || 'activa';

  // Si está suspendida manualmente, siempre manda
  if (estadoBase === 'suspendida') return 'suspendida';

  // Si no hay próximo cobro configurado, usamos el estado base
  if (!empresa.proximo_cobro) return estadoBase;

  const hoy = new Date();
  const fechaCobro = new Date(empresa.proximo_cobro);
  if (Number.isNaN(fechaCobro.getTime())) return estadoBase;

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
  if (!Array.isArray(empresas) || empresas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-slate-400">No hay empresas registradas</td></tr>';
    return;
  }

  let html = '';

  empresas.forEach(e => {
    const estadoLicencia = calcularEstadoLicencia(e);
    const planTexto = (e.plan || '—') + (e.monto_mensual ? ` / $${Number(e.monto_mensual).toFixed(2)}` : '');
    const corteGracia = `Día ${e.fecha_corte || 1} · ${e.dias_gracia || 0} días`;
    const proximo = e.proximo_cobro ? new Date(e.proximo_cobro).toLocaleDateString() : '—';
    const ultimoPago = e.ultimo_pago_en ? new Date(e.ultimo_pago_en).toLocaleDateString() : '—';

    let rowClasses = 'hover:bg-slate-50 transition';
    if (estadoLicencia === 'morosa') rowClasses += ' bg-amber-50';
    if (estadoLicencia === 'suspendida') rowClasses += ' bg-rose-50';

    html += `<tr class="${rowClasses}">`;
    html += `<td class="p-3 align-top"><div class="font-semibold text-slate-800">${e.nombre || ''}</div><div class="text-xs text-slate-400 mt-1">ID ${e.id}</div>${e.nota_interna ? `<div class=\"text-xs text-slate-500 mt-1\">${e.nota_interna}</div>` : ''}</td>`;
    html += `<td class="p-3 align-top text-slate-600">${e.codigo || ''}</td>`;
    html += `<td class="p-3 align-top">${badgeEstado(estadoLicencia)}</td>`;
    html += `<td class="p-3 align-top text-slate-600">${planTexto}</td>`;
    html += `<td class="p-3 align-top text-slate-600">${corteGracia}</td>`;
    html += `<td class="p-3 align-top text-slate-600">
      <div>Próximo: ${proximo}</div>
      <div class="text-xs text-slate-400 mt-1">Último pago: ${ultimoPago}</div>
    </td>`;

    html += '<td class="p-3 align-top"><div class="flex flex-wrap gap-2 justify-end text-xs">';

    if (estadoLicencia !== 'activa') {
      html += `<button class="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200" onclick="window.__activarEmpresa(${e.id})">Activar</button>`;
    }
    if (estadoLicencia !== 'suspendida') {
      html += `<button class="px-2 py-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200" onclick="window.__suspenderEmpresa(${e.id})">Suspender</button>`;
    }
    if (estadoLicencia === 'activa') {
      html += `<button class="px-2 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200" onclick="window.__marcarMorosa(${e.id})">Marcar morosa</button>`;
    }

    html += `<button class="px-2 py-1 rounded-lg bg-sky-100 text-sky-700 hover:bg-sky-200" onclick="window.__editarPlan(${e.id})">Plan / Monto</button>`;
    html += `<button class="px-2 py-1 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200" onclick="window.__registrarPago(${e.id})">Registrar pago</button>`;

    html += `<button class="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200" onclick="window.__editarCiclo(${e.id})">Corte / Gracia</button>`;

    html += '</div></td>';
    html += '</tr>';
  });

  tbody.innerHTML = html;
}

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

window.__activarEmpresa = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!confirm(`¿Activar la empresa "${empresa.nombre}"?`)) return;
  patchEmpresa(id, { estado: 'activa' }, 'Empresa activada');
};

window.__suspenderEmpresa = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!confirm(`¿Suspender la empresa "${empresa.nombre}"?
\nEsto bloqueará el acceso de sus usuarios hasta que se reactive.`)) return;
  patchEmpresa(id, { estado: 'suspendida' }, 'Empresa suspendida');
};

window.__marcarMorosa = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;
  if (!confirm(`¿Marcar la empresa "${empresa.nombre}" como morosa?`)) return;
  patchEmpresa(id, { estado: 'morosa' }, 'Empresa marcada como morosa');
};

window.__editarPlan = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;

  const planActual = empresa.plan || '';
  const montoActual = Number(empresa.monto_mensual || 0);

  const nuevoPlan = prompt('Nombre del plan (Ej: Mensual, Pro, Multi-sucursal):', planActual);
  if (nuevoPlan === null) return;

  const nuevoMontoStr = prompt('Monto mensual en USD:', montoActual > 0 ? String(montoActual) : '0');
  if (nuevoMontoStr === null) return;
  const nuevoMonto = Number(nuevoMontoStr);
  if (Number.isNaN(nuevoMonto) || nuevoMonto < 0) {
    if (window.showToast) window.showToast('Monto inválido (debe ser un número positivo).', 'error'); else alert('Monto inválido (debe ser un número positivo).');
    return;
  }

  patchEmpresa(id, { plan: nuevoPlan, monto_mensual: nuevoMonto }, 'Plan y monto actualizados');
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

  const hoy = new Date();
  const fechaDefault = formatDateInput(hoy);

  const fechaPagoStr = prompt('Fecha del pago (YYYY-MM-DD):', fechaDefault);
  if (fechaPagoStr === null) return;
  const fechaPago = new Date(fechaPagoStr);
  if (Number.isNaN(fechaPago.getTime())) {
    if (window.showToast) window.showToast('Fecha de pago inválida.', 'error'); else alert('Fecha de pago inválida.');
    return;
  }

  const mesesStr = prompt('Meses pagados (1 = mensual, 3 = trimestral, etc.):', '1');
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
};

window.__editarCiclo = function (id) {
  const empresa = empresas.find(e => e.id === id);
  if (!empresa) return;

  const actualCorte = empresa.fecha_corte || 1;
  const actualGracia = empresa.dias_gracia || 7;

  const nuevoCorteStr = prompt(`Día de corte de facturación (1-28):`, String(actualCorte));
  if (nuevoCorteStr === null) return;
  const nuevoCorte = parseInt(nuevoCorteStr, 10);
  if (Number.isNaN(nuevoCorte) || nuevoCorte < 1 || nuevoCorte > 28) {
    if (window.showToast) window.showToast('Valor de día de corte inválido (1-28).', 'error'); else alert('Valor de día de corte inválido (1-28).');
    return;
  }

  const nuevoGraciaStr = prompt(`Días de gracia (0-60):`, String(actualGracia));
  if (nuevoGraciaStr === null) return;
  const nuevoGracia = parseInt(nuevoGraciaStr, 10);
  if (Number.isNaN(nuevoGracia) || nuevoGracia < 0 || nuevoGracia > 60) {
    if (window.showToast) window.showToast('Valor de días de gracia inválido (0-60).', 'error'); else alert('Valor de días de gracia inválido (0-60).');
    return;
  }

  patchEmpresa(id, { fecha_corte: nuevoCorte, dias_gracia: nuevoGracia }, 'Ciclo de facturación actualizado');
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

// Carga inicial
cargarEmpresas();
