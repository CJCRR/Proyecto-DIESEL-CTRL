import { apiFetchJson } from './app-api.js';
import { upsertEmpresaFirebase } from './firebase-sync.js';

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

// Modal ciclo de facturación
const modalCiclo = document.getElementById('modal-ciclo-empresa');
const formCiclo = document.getElementById('form-ciclo-empresa');
const ecCorte = document.getElementById('ec-corte');
const ecGracia = document.getElementById('ec-gracia');
const ecCancelar = document.getElementById('ec-cancelar');
let ecEmpresaId = null;

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

    // Botón para crear usuario admin de empresa
    if (e.id !== 1 && e.codigo !== 'LOCAL') {
      html += `<button class="px-2 py-1 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200" onclick="window.__abrirCrearAdmin(${e.id})">Usuario admin</button>`;
    }

    // Botón para eliminar empresa (solo no LOCAL)
    if (e.id !== 1 && e.codigo !== 'LOCAL') {
      html += `<button class="px-2 py-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200" onclick="window.__eliminarEmpresa(${e.id})">Eliminar</button>`;
    }

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
    const fechaPago = new Date(fechaPagoStr);
    if (Number.isNaN(fechaPago.getTime())) {
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
    const actualCorte = empresa.fecha_corte || 1;
    const actualGracia = empresa.dias_gracia || 7;
    const nuevoCorteStr = window.prompt('Día de corte de facturación (1-28):', String(actualCorte));
    if (nuevoCorteStr === null) return;
    const nuevoCorte = parseInt(nuevoCorteStr, 10);
    if (Number.isNaN(nuevoCorte) || nuevoCorte < 1 || nuevoCorte > 28) {
      if (window.showToast) window.showToast('Valor de día de corte inválido (1-28).', 'error'); else alert('Valor de día de corte inválido (1-28).');
      return;
    }
    const nuevoGraciaStr = window.prompt('Días de gracia (0-60):', String(actualGracia));
    if (nuevoGraciaStr === null) return;
    const nuevoGracia = parseInt(nuevoGraciaStr, 10);
    if (Number.isNaN(nuevoGracia) || nuevoGracia < 0 || nuevoGracia > 60) {
      if (window.showToast) window.showToast('Valor de días de gracia inválido (0-60).', 'error'); else alert('Valor de días de gracia inválido (0-60).');
      return;
    }
    patchEmpresa(id, { fecha_corte: nuevoCorte, dias_gracia: nuevoGracia }, 'Ciclo de facturación actualizado');
    return;
  }

  ecEmpresaId = id;
  const actualCorte = empresa.fecha_corte || 1;
  const actualGracia = empresa.dias_gracia || 7;
  ecCorte.value = String(actualCorte);
  ecGracia.value = String(actualGracia);
  modalCiclo.classList.remove('hidden');
  modalCiclo.classList.add('flex');
  setTimeout(() => ecCorte.focus(), 50);
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
    const fechaPago = new Date(fechaStr);
    if (Number.isNaN(fechaPago.getTime())) {
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
    const corteStr = (ecCorte.value || '').trim();
    const graciaStr = (ecGracia.value || '').trim();
    const corte = parseInt(corteStr, 10);
    const gracia = parseInt(graciaStr, 10);
    if (Number.isNaN(corte) || corte < 1 || corte > 28) {
      if (window.showToast) window.showToast('Valor de día de corte inválido (1-28).', 'error'); else alert('Valor de día de corte inválido (1-28).');
      ecCorte.focus();
      return;
    }
    if (Number.isNaN(gracia) || gracia < 0 || gracia > 60) {
      if (window.showToast) window.showToast('Valor de días de gracia inválido (0-60).', 'error'); else alert('Valor de días de gracia inválido (0-60).');
      ecGracia.focus();
      return;
    }
    modalCiclo.classList.add('hidden');
    modalCiclo.classList.remove('flex');
    patchEmpresa(ecEmpresaId, { fecha_corte: corte, dias_gracia: gracia }, 'Ciclo de facturación actualizado');
    ecEmpresaId = null;
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
    const confirmado = window.confirm(`¿Eliminar la empresa "${empresa.nombre}"?\n\nSolo se permitirá si no tiene usuarios ni productos asociados.`);
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
  mcMessage.textContent = `¿Eliminar la empresa "${empresa.nombre}"? Solo se permitirá si no tiene usuarios ni productos asociados.`;
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
