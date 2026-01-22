import { obtenerClientesFirebase, upsertClienteFirebase, eliminarClienteFirebasePorCedula } from './firebase-sync.js';

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
const toast = document.getElementById('toast');

let clientes = [];
let seleccionado = null;

function showToast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `px-3 py-2 rounded-lg text-white shadow ${type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-slate-800'}`;
    el.innerText = msg;
    toast.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

function renderTabla(filtro = '') {
    const f = filtro.toLowerCase();
    const data = clientes.filter(
        (c) => (c.nombre || '').toLowerCase().includes(f) || (c.cedula || '').toLowerCase().includes(f),
    );
    tabla.innerHTML = data
        .map(
            (c) => `
                <tr class="hover:bg-slate-50 cursor-pointer" data-cedula="${c.cedula || ''}">
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
    nombreInput.value = c?.nombre || '';
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
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`/reportes/historial-cliente?q=${encodeURIComponent(q)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const rows = await res.json();
        body.innerHTML = rows
            .map(
                (r) => `<tr><td class="p-2">${new Date(r.fecha).toLocaleString()}</td><td class="p-2">${r.vendedor || ''}</td><td class="p-2 text-right">${Number(r.total_usd || 0).toFixed(2)}</td></tr>`,
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
        nombre: nombreInput.value.trim(),
        cedula: cedulaInput.value.trim(),
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
    if (!cedula) {
        showToast('Cédula requerida para eliminar', 'error');
        return;
    }
    try {
        await eliminarClienteFirebasePorCedula(cedula);
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
    const c = clientes.find((x) => (x.cedula || '') === cedula);
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
