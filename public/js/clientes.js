import { obtenerClientesFirebase, upsertClienteFirebase, eliminarClienteFirebasePorCedula, eliminarClienteFirebasePorId } from './firebase-sync.js';
import { showToast } from './app-utils.js';
import { apiFetchJson } from './app-api.js';
import { formatNumber } from './format-utils.js';

console.log('clientes.js v2.0 cargado - con autenticación');

const tabla = document.getElementById('c_tabla');
const buscar = document.getElementById('c_buscar');
const nombreInput = document.getElementById('c_nombre');
const cedulaInput = document.getElementById('c_cedula');
const telefonoInput = document.getElementById('c_telefono');
const btnGuardar = document.getElementById('btnGuardarCliente');
const btnEliminar = document.getElementById('btnEliminarCliente');
const descuentoInput = document.getElementById('c_descuento');
const notasInput = document.getElementById('c_notas');
const tagsInput = document.getElementById('c_tags');
let clientes = [];
let seleccionado = null;



function renderTabla(filtro = '') {
    const f = filtro.toLowerCase();
    const data = clientes.filter(
        (c) => (c.nombre || '').toLowerCase().includes(f) || (c.cedula || '').toLowerCase().includes(f),
    );
    tabla.innerHTML = data
        .map(
            (c) => `
                <tr class="hover:bg-slate-50 cursor-pointer" data-id="${c.id || ''}" data-cedula="${c.cedula || ''}">
                    <td class="p-3 font-semibold text-slate-700">${c.nombre || ''} ${c.descuento ? `<span class='ml-2 text-[10px] text-green-700 font-bold'>-${c.descuento}%</span>` : ''}</td>
                    <td class="p-3 text-slate-600">${c.cedula || ''}</td>
                    <td class="p-3 text-slate-600">${c.telefono || ''}</td>
                </tr>
            `,
        )
        .join('');
}

function fillForm(c) {
    seleccionado = c || null;
    nombreInput.value = (c?.nombre || '').toString().toUpperCase();
    cedulaInput.value = c?.cedula || '';
    telefonoInput.value = c?.telefono || '';
    descuentoInput.value = c?.descuento || '';
    notasInput.value = c?.notas || '';
    tagsInput.value = Array.isArray(c?.tags) ? c.tags.join(', ') : c?.tags || '';
    cargarHistorial();
}

async function cargarHistorial() {
    const q = (cedulaInput.value || nombreInput.value || '').trim();
    const body = document.getElementById('c_historial');
    if (!q) {
        body.innerHTML = '';
        return;
    }
    try {
        const rows = await apiFetchJson(`/reportes/historial-cliente?q=${encodeURIComponent(q)}&limit=20`);
        body.innerHTML = rows
            .map(
                (r) => `<tr><td class=\"p-2\">${new Date(r.fecha).toLocaleString()}</td><td class=\"p-2\">${r.vendedor || ''}</td><td class=\"p-2 text-right\">${formatNumber(r.total_usd || 0, 2)}</td></tr>`,
            )
            .join('');
    } catch (err) {
        console.error(err);
    }
}

async function loadClientes() {
    try {
        clientes = await obtenerClientesFirebase();
    } catch (err) {
        console.error('No se pudieron obtener clientes', err);
        showToast('No se pudieron obtener clientes', 'error');
    }
    renderTabla(buscar.value.trim());
}

async function guardarCliente() {
    const cliente = {
        nombre: nombreInput.value.trim().toUpperCase(),
        cedula: cedulaInput.value.trim().toUpperCase(),
        telefono: telefonoInput.value.trim(),
        descuento: parseFloat(descuentoInput.value) || 0,
        notas: notasInput.value.trim(),
        tags: tagsInput.value.split(',').map((s) => s.trim()).filter(Boolean),
    };
    if (!cliente.nombre) {
        showToast('Nombre es requerido', 'error');
        return;
    }
    try {
        await upsertClienteFirebase(cliente);
        showToast('Guardado/actualizado', 'success');
        await loadClientes();
        fillForm(null);
    } catch (err) {
        console.error(err);
        showToast('Error guardando', 'error');
    }
}

async function eliminarCliente() {
    const cedula = cedulaInput.value.trim();
    const sel = seleccionado;
    if (!cedula && !(sel && sel.id)) {
        showToast('Seleccione un cliente o ingrese cédula para eliminar', 'error');
        return;
    }
    try {
        if (cedula) {
            await eliminarClienteFirebasePorCedula(cedula);
        } else if (sel && sel.id) {
            await eliminarClienteFirebasePorId(sel.id);
        }
        showToast('Cliente eliminado', 'success');
        await loadClientes();
        fillForm(null);
    } catch (err) {
        console.error(err);
        showToast('Error eliminando', 'error');
    }
}

tabla.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const cedula = tr.dataset.cedula || '';
    const id = tr.dataset.id || '';
    const c = clientes.find((x) => (cedula && (x.cedula || '') === cedula) || (id && x.id === id));
    fillForm(c);
});

cedulaInput.addEventListener('input', () => {
    seleccionado = null;
    cargarHistorial();
});

nombreInput.addEventListener('input', () => {
    seleccionado = null;
    cargarHistorial();
});

buscar.addEventListener('input', () => renderTabla(buscar.value.trim()));
btnGuardar.addEventListener('click', guardarCliente);
btnEliminar.addEventListener('click', eliminarCliente);

loadClientes();

// Tour guiado para Clientes
if (window.GuidedTour) {
    const steps = [
        {
            selector: '#clientes-form',
            title: 'Formulario del cliente',
            text: 'En este bloque creas o actualizas los datos básicos del cliente: nombre, cédula, teléfono, descuento, etiquetas y notas.',
            placement: 'right',
        },
        {
            selector: '#c_nombre',
            title: 'Nombre del cliente',
            text: 'Escribe aquí el nombre completo o razón social del cliente. Este campo es obligatorio.',
            placement: 'right',
        },
        {
            selector: '#c_cedula',
            title: 'Cédula o identificación',
            text: 'Coloca la cédula, RIF o identificación del cliente. Si la cédula ya existe, al guardar se actualiza ese registro; si no existe, se crea uno nuevo.',
            placement: 'right',
        },
        {
            selector: '#c_descuento',
            title: 'Descuento por cliente',
            text: 'Puedes asignar un porcentaje de descuento permanente a este cliente. Se aplicará automáticamente en el POS cuando lo selecciones.',
            placement: 'right',
        },
        {
            selector: '#c_tags',
            title: 'Tags y notas',
            text: 'Usa las etiquetas (tags) y el campo de observaciones para marcar clientes especiales, condiciones de crédito, rutas, etc.',
            placement: 'right',
        },
        {
            selector: '#btnGuardarCliente',
            title: 'Guardar o actualizar',
            text: 'Este botón guarda un nuevo cliente o actualiza los datos si la cédula ya existe. Úsalo siempre después de hacer cambios.',
            placement: 'bottom',
        },
        {
            selector: '#btnEliminarCliente',
            title: 'Eliminar cliente',
            text: 'Si necesitas borrar un cliente, selecciónalo en la lista o escribe su cédula y luego usa este botón. Úsalo con cuidado: la acción es definitiva.',
            placement: 'bottom',
        },
        {
            selector: '#c_buscar',
            title: 'Buscar en la lista de clientes',
            text: 'Desde aquí filtras rápidamente la tabla por nombre o cédula. Es útil cuando tienes muchos registros.',
            placement: 'bottom',
        },
        {
            selector: '#clientes-tabla-wrapper',
            title: 'Listado de clientes',
            text: 'La tabla muestra todos los clientes. Haz clic en una fila para cargar sus datos en el formulario y ver su historial de compras.',
            placement: 'top',
        },
        {
            selector: '#clientes-historial-wrapper',
            title: 'Historial de compras del cliente',
            text: 'Al seleccionar un cliente se llena este historial con sus últimas ventas, montos y vendedor. Sirve para revisar rápidamente su actividad.',
            placement: 'top',
        },
    ];

    const tourId = 'clientes_v1';
    const startClientesTour = (force = false) => {
        window.GuidedTour.start({
            id: tourId,
            steps,
            autoStart: !force,
        });
    };

    const btnClientesTour = document.getElementById('btnClientesTour');
    if (btnClientesTour) {
        btnClientesTour.addEventListener('click', () => {
            if (window.GuidedTour.reset && window.GuidedTour.hasSeen && window.GuidedTour.hasSeen(tourId)) {
                window.GuidedTour.reset(tourId);
            }
            startClientesTour(true);
        });
    }

    // Lanzar automáticamente solo la primera vez que entra a Clientes
    startClientesTour(false);
}
