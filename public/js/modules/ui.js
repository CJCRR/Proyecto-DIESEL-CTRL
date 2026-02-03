// ui.js - Módulo de utilidades y control de interfaz

import { escapeHtml, showToast } from '../app-utils.js';
import { apiFetchJson } from '../app-api.js';
import { upsertClienteFirebase, obtenerClientesFirebase, sincronizarVentasPendientes } from '../firebase-sync.js';
import { cargarHistorialDevoluciones, actualizarSyncPendientes } from './sales.js';

let clientesFrecuentesCache = [];
let isOnline = navigator.onLine;
const statusIndicator = document.createElement('div');

export function initOfflineUI() {
	statusIndicator.id = 'status-indicator';
	statusIndicator.className = `fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold transition-all shadow-lg ${isOnline ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`;
	statusIndicator.innerHTML = isOnline
		? '<i class="fas fa-wifi mr-2"></i> EN LÍNEA'
		: '<i class="fas fa-wifi-slash mr-2"></i> MODO OFFLINE';
	document.body.appendChild(statusIndicator);

	window.addEventListener('online', async () => {
		isOnline = true;
		statusIndicator.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold bg-green-500 text-white shadow-lg';
		statusIndicator.innerHTML = '<i class="fas fa-wifi mr-2"></i> EN LÍNEA';
		showToast('¡Conexión restablecida! Intentando sincronizar pendientes...', 'success', 4000);
		// Sincronizar ventas pendientes (IndexedDB + Firebase). El SW también
		// puede sincronizar, pero esta llamada es idempotente a nivel de datos.
		try {
			if (typeof sincronizarVentasPendientes === 'function') {
				await sincronizarVentasPendientes();
			}
		} catch (err) {
			console.warn('No se pudo disparar sync al reconectar', err);
		}
		actualizarSyncPendientes();
	});

	window.addEventListener('offline', () => {
		isOnline = false;
		statusIndicator.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-full text-xs font-bold bg-red-500 text-white shadow-lg';
		statusIndicator.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i> MODO OFFLINE';
		showToast('Estás en modo offline. Las ventas se guardarán localmente y se sincronizarán al reconectar.', 'info', 6000);
		actualizarSyncPendientes();
	});
}

export function initSyncBackupUI() {
	// Acciones de sync/backup manual
	const btnSyncNow = document.getElementById('btnSyncNow');
	if (btnSyncNow) {
		btnSyncNow.addEventListener('click', async () => {
			try {
				if (typeof sincronizarVentasPendientes === 'function') {
					await sincronizarVentasPendientes();
					await actualizarSyncPendientes();
					showToast('Sync ejecutado', 'success');
				}
			} catch (err) {
				console.error(err);
				showToast('Error al sincronizar', 'error');
			}
		});
	}
	const btnBackupNow = document.getElementById('btnBackupNow');
	if (btnBackupNow) {
		btnBackupNow.addEventListener('click', async () => {
			try {
				await apiFetchJson('/backup/create', {
					method: 'POST',
				});
				showToast('Backup creado', 'success');
			} catch (err) {
				console.error(err);
				showToast('Error de backup', 'error');
			}
		});
	}
}

function getFormCliente() {
	return {
		nombre: (document.getElementById('v_cliente')?.value || '').trim(),
		cedula: (document.getElementById('v_cedula')?.value || '').trim(),
		telefono: (document.getElementById('v_telefono')?.value || '').trim()
	};
}

function renderSugerenciasClientes(list = []) {
	const ulSugerenciasClientes = document.getElementById('v_sugerencias_clientes');
	const inputNombreCliente = document.getElementById('v_cliente');
	if (!ulSugerenciasClientes) return;
	ulSugerenciasClientes.innerHTML = '';
	if (!list.length) {
		ulSugerenciasClientes.classList.add('hidden');
		return;
	}
	list.slice(0, 8).forEach(c => {
		const li = document.createElement('li');
		li.className = 'p-3 border-b hover:bg-slate-50 cursor-pointer flex justify-between items-center text-sm';
		const nombre = c.nombre || c.cliente || '';
		const cedula = c.cedula || '';
		const telefono = c.telefono || c.telefono_cliente || '';
		li.innerHTML = `
			<div>
				<div class="font-semibold text-slate-700">${escapeHtml(nombre || '(sin nombre)')}${cedula ? ` • ${escapeHtml(cedula)}` : ''}</div>
				${telefono ? `<div class="text-[11px] text-slate-500">${escapeHtml(telefono)}</div>` : ''}
			</div>
		`;
		li.addEventListener('click', () => {
			if (inputNombreCliente) inputNombreCliente.value = nombre;
			const ced = document.getElementById('v_cedula');
			const tel = document.getElementById('v_telefono');
			if (ced) ced.value = cedula;
			if (tel) tel.value = telefono;
			try {
				const desc = parseFloat(c.descuento);
				const descInput = document.getElementById('v_desc');
				if (!Number.isNaN(desc) && descInput) {
					descInput.value = String(desc);
					showToast(`Descuento ${desc}% aplicado por cliente`, 'info');
				}
				if (c.notas) showToast(`Nota cliente: ${c.notas}`, 'info', 4500);
			} catch {}
			cargarHistorialDevoluciones(nombre, cedula);
			ulSugerenciasClientes.classList.add('hidden');
		});
		ulSugerenciasClientes.appendChild(li);
	});
	ulSugerenciasClientes.classList.remove('hidden');
}

async function loadClientes() {
	let list = [];
	try {
		list = await obtenerClientesFirebase();
		if (list && list.length) {
			localStorage.setItem('clientes_frecuentes_v2', JSON.stringify(list));
		}
	} catch (err) {
		console.error('No se pudieron obtener clientes de Firebase, usando cache local', err);
	}
	if (!list || !list.length) {
		list = JSON.parse(localStorage.getItem('clientes_frecuentes_v2') || '[]');
	}
	clientesFrecuentesCache = list || [];
}

async function upsertClienteDesdeFormulario() {
	const cliente = getFormCliente();
	if (!cliente.nombre) { showToast('Ingrese nombre de cliente', 'error'); return; }

	const existente = cliente.cedula
		? clientesFrecuentesCache.find(c => (c.cedula || '').toLowerCase() === cliente.cedula.toLowerCase())
		: clientesFrecuentesCache.find(c => (c.nombre || c.cliente) === cliente.nombre);

	try {
		const id = await upsertClienteFirebase({ ...cliente, id: existente?.id });
		const actualizado = { ...cliente, id: id || existente?.id };
		if (existente) {
			clientesFrecuentesCache = clientesFrecuentesCache.map(c => {
				const mismaCedula = cliente.cedula && (c.cedula || '').toLowerCase() === cliente.cedula.toLowerCase();
				const mismoNombre = !cliente.cedula && (c.nombre || c.cliente) === cliente.nombre;
				return (mismaCedula || mismoNombre) ? { ...c, ...actualizado } : c;
			});
		} else {
			clientesFrecuentesCache = [actualizado, ...clientesFrecuentesCache].slice(0, 50);
		}
		localStorage.setItem('clientes_frecuentes_v2', JSON.stringify(clientesFrecuentesCache));
		showToast(existente ? 'Cliente actualizado' : 'Cliente guardado', 'success');
	} catch (err) {
		console.error('No se pudo guardar/actualizar en Firebase, se mantiene en cache local', err);
		const fallback = { ...cliente, id: existente?.id };
		if (existente) {
			clientesFrecuentesCache = clientesFrecuentesCache.map(c => {
				const mismaCedula = cliente.cedula && (c.cedula || '').toLowerCase() === cliente.cedula.toLowerCase();
				const mismoNombre = !cliente.cedula && (c.nombre || c.cliente) === cliente.nombre;
				return (mismaCedula || mismoNombre) ? { ...c, ...fallback } : c;
			});
		} else {
			clientesFrecuentesCache = [fallback, ...clientesFrecuentesCache].slice(0, 50);
		}
		localStorage.setItem('clientes_frecuentes_v2', JSON.stringify(clientesFrecuentesCache));
		showToast('Guardado local (sin Firebase)', 'info');
	}
}

export async function initClientesUI() {
	const btnGuardarCliente = document.getElementById('btnGuardarCliente');
	const inputNombreCliente = document.getElementById('v_cliente');
	const ulSugerenciasClientes = document.getElementById('v_sugerencias_clientes');

	await loadClientes();

	if (inputNombreCliente) {
		inputNombreCliente.addEventListener('input', (e) => {
			const q = (e.target.value || '').toLowerCase().trim();
			if (!q || q.length < 1) {
				if (ulSugerenciasClientes) ulSugerenciasClientes.classList.add('hidden');
				return;
			}
			const list = (clientesFrecuentesCache || []).filter(c => {
				const nombre = (c.nombre || c.cliente || '').toLowerCase();
				const cedula = (c.cedula || '').toLowerCase();
				return nombre.includes(q) || (cedula && cedula.includes(q));
			});
			renderSugerenciasClientes(list);
		});
		inputNombreCliente.addEventListener('focus', () => {
			const val = inputNombreCliente.value.trim().toLowerCase();
			if (!val) {
				renderSugerenciasClientes((clientesFrecuentesCache || []).slice(0, 8));
			}
		});
		inputNombreCliente.addEventListener('blur', () => {
			const nombre = inputNombreCliente.value.trim();
			const cedInput = document.getElementById('v_cedula');
			const ced = cedInput ? cedInput.value.trim() : '';
			if (nombre) cargarHistorialDevoluciones(nombre, ced);
		});
		document.addEventListener('click', (ev) => {
			if (!ulSugerenciasClientes) return;
			const within = ulSugerenciasClientes.contains(ev.target) || inputNombreCliente.contains(ev.target);
			if (!within) ulSugerenciasClientes.classList.add('hidden');
		});
	}

	if (btnGuardarCliente) btnGuardarCliente.addEventListener('click', upsertClienteDesdeFormulario);
}

