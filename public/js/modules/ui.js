// ui.js - Módulo de utilidades y control de interfaz

import { escapeHtml, showToast } from '../app-utils.js';
import { apiFetchJson } from '../app-api.js';
import { upsertClienteFirebase, obtenerClientesFirebase, sincronizarVentasPendientes } from '../firebase-sync.js';
import { guardarClienteLocal, obtenerClientesLocales } from '../db-local.js';
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

function setFormattedInputValue(input, nextValue) {
	if (!input) return;
	if (input.value === nextValue) return;
	input.value = nextValue;
	try {
		input.setSelectionRange(nextValue.length, nextValue.length);
	} catch (_) {
		// Algunos navegadores móviles no permiten mover el cursor aquí.
	}
}

function setFieldHintState(input, hintEl, state = 'idle', message = '') {
	if (!input) return;
	input.classList.remove('pos-input--soft-error', 'pos-input--error');
	if (hintEl) {
		hintEl.classList.remove('pos-field-hint--soft', 'pos-field-hint--error');
		hintEl.classList.add('hidden');
		hintEl.textContent = '';
	}

	if (state === 'soft') {
		input.classList.add('pos-input--soft-error');
		if (hintEl && message) {
			hintEl.textContent = message;
			hintEl.classList.remove('hidden');
			hintEl.classList.add('pos-field-hint--soft');
		}
		return;
	}

	if (state === 'error') {
		input.classList.add('pos-input--error');
		if (hintEl && message) {
			hintEl.textContent = message;
			hintEl.classList.remove('hidden');
			hintEl.classList.add('pos-field-hint--error');
		}
	}
}

function formatCedulaRif(value, forceSeparator = false) {
	const raw = (value || '')
		.toString()
		.toUpperCase()
		.replace(/\s+/g, '')
		.replace(/[^A-Z0-9]/g, '');

	if (!raw) return '';

	const prefix = raw.charAt(0);
	if (!/[VEJGPCR]/.test(prefix)) {
		return raw.replace(/[^0-9]/g, '');
	}

	const digits = raw.slice(1).replace(/[^0-9]/g, '');
	if (digits.length || forceSeparator) {
		return `${prefix}-${digits}`;
	}

	return prefix;
}

function formatTelefono(value, forceSeparator = false) {
	const digits = (value || '')
		.toString()
		.replace(/\D/g, '')
		.slice(0, 11);

	if (!digits) return '';
	if (digits.length > 4) {
		return `${digits.slice(0, 4)}-${digits.slice(4)}`;
	}
	if (digits.length === 4 && forceSeparator) {
		return `${digits}-`;
	}
	return digits;
}

function bindAutoFormatter(input, formatter) {
	if (!input || input.dataset.autoFormatted === '1') return;
	input.dataset.autoFormatted = '1';

	const syncValue = (event) => {
		const inputType = (event && event.inputType) || '';
		const forceSeparator = !inputType.startsWith('delete');
		setFormattedInputValue(input, formatter(input.value, forceSeparator));
	};

	input.addEventListener('input', syncValue);
	input.addEventListener('blur', () => {
		setFormattedInputValue(input, formatter(input.value, false));
	});

	setFormattedInputValue(input, formatter(input.value, false));
}

function validateCedulaRif(value) {
	const text = (value || '').toString().trim().toUpperCase();
	if (!text) return { state: 'idle', message: '' };

	const prefix = text.charAt(0);
	if (!/[VEJGPCR]/.test(prefix)) {
		return { state: 'error', message: 'Empiece con V-, J-, G-, E- o similar.' };
	}

	if (!text.includes('-')) {
		return { state: 'soft', message: 'El guion se agrega solo, continúe con el número.' };
	}

	const digits = text.slice(text.indexOf('-') + 1).replace(/\D/g, '');
	if (!digits.length) {
		return { state: 'soft', message: 'Ingrese el número de documento.' };
	}
	if (digits.length < 6) {
		return { state: 'soft', message: `Faltan ${6 - digits.length} dígitos como mínimo.` };
	}
	if (digits.length > 10) {
		return { state: 'error', message: 'Demasiados dígitos para ese documento.' };
	}

	return { state: 'ok', message: '' };
}

function validateTelefono(value) {
	const digits = (value || '').toString().replace(/\D/g, '');
	if (!digits) return { state: 'idle', message: '' };
	if (digits.length < 4) {
		return { state: 'soft', message: 'Ingrese el prefijo de 4 dígitos.' };
	}
	if (digits.length < 11) {
		return { state: 'soft', message: `Faltan ${11 - digits.length} dígitos.` };
	}
	if (digits.length > 11) {
		return { state: 'error', message: 'Demasiados dígitos para el teléfono.' };
	}
	return { state: 'ok', message: '' };
}

function bindFieldValidation(input, hintEl, validator) {
	if (!input || !validator || input.dataset.validatedField === '1') return;
	input.dataset.validatedField = '1';

	const syncState = () => {
		const result = validator(input.value);
		setFieldHintState(input, hintEl, result.state, result.message);
	};

	input.addEventListener('input', syncState);
	input.addEventListener('blur', syncState);
	input.addEventListener('change', syncState);
	syncState();
	input.__syncValidationState = syncState;
}

function getFormCliente() {
	return {
		nombre: (document.getElementById('v_cliente')?.value || '').trim().toUpperCase(),
		cedula: (document.getElementById('v_cedula')?.value || '').trim().toUpperCase(),
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
			const nombreUpper = (nombre || '').toString().toUpperCase();
			if (inputNombreCliente) inputNombreCliente.value = nombreUpper;
			const ced = document.getElementById('v_cedula');
			const tel = document.getElementById('v_telefono');
			if (ced) ced.value = cedula;
			if (tel) tel.value = telefono;
			if (ced && typeof ced.__syncValidationState === 'function') ced.__syncValidationState();
			if (tel && typeof tel.__syncValidationState === 'function') tel.__syncValidationState();
			try {
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
			// Sincronizar también en IndexedDB para uso offline
			for (const c of list) {
				try {
					await guardarClienteLocal({
						cedula: c.cedula || '',
						nombre: c.nombre || c.cliente || '',
						telefono: c.telefono || c.telefono_cliente || '',
						descuento: c.descuento || 0,
						notas: c.notas || ''
					});
				} catch (e) {
					console.warn('No se pudo cachear cliente en IndexedDB', e);
				}
			}
		}
	} catch (err) {
		console.error('No se pudieron obtener clientes de Firebase, usando cache local', err);
	}
	if (!list || !list.length) {
		// Preferir IndexedDB como cache offline
		try {
			list = await obtenerClientesLocales();
		} catch (e) {
			console.warn('No se pudieron obtener clientes de IndexedDB, usando localStorage', e);
		}
		if (!list || !list.length) {
			list = JSON.parse(localStorage.getItem('clientes_frecuentes_v2') || '[]');
		}
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
		try {
			await guardarClienteLocal(actualizado);
		} catch (e) {
			console.warn('No se pudo guardar cliente en IndexedDB', e);
		}
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
		try {
			await guardarClienteLocal(fallback);
		} catch (e) {
			console.warn('No se pudo guardar cliente en IndexedDB (modo offline)', e);
		}
		showToast('Guardado local (sin Firebase)', 'info');
	}
}

export async function initClientesUI() {
	const btnGuardarCliente = document.getElementById('btnGuardarCliente');
	const inputNombreCliente = document.getElementById('v_cliente');
	const inputCedula = document.getElementById('v_cedula');
	const inputTelefono = document.getElementById('v_telefono');
	const inputCedulaHint = document.getElementById('v_cedula_hint');
	const inputTelefonoHint = document.getElementById('v_telefono_hint');
	const ulSugerenciasClientes = document.getElementById('v_sugerencias_clientes');

	await loadClientes();

	bindAutoFormatter(inputCedula, formatCedulaRif);
	bindAutoFormatter(inputTelefono, formatTelefono);
	bindFieldValidation(inputCedula, inputCedulaHint, validateCedulaRif);
	bindFieldValidation(inputTelefono, inputTelefonoHint, validateTelefono);

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

// Exponer helper para que el POS pueda auto-guardar el cliente
// al registrar una venta, incluso si el usuario no presionó el botón.
if (typeof window !== 'undefined') {
	window.upsertClienteDesdeFormularioPOS = upsertClienteDesdeFormulario;
}

// ---- SELECTS PERSONALIZADOS TIPO POS ----

export function initCustomSelect(id) {
	const select = document.getElementById(id);
	if (!select) return;

	// Si ya fue personalizado anteriormente, solo reconstruir la lista de opciones
	// para reflejar cualquier cambio dinámico en el <select> original.
	if (select.dataset.customized === '1') {
		const wrapper = select.parentElement;
		if (!wrapper) return;
		const list = wrapper.querySelector('ul');
		const display = wrapper.querySelector('button');
		if (!list || !display) return;
		list.innerHTML = '';
		Array.from(select.options).forEach((opt) => {
			const value = opt.value;
			const label = opt.textContent || '';
			if (label === '' && !value) return;
			const li = document.createElement('li');
			li.className = 'p-3 border-b last:border-b-0 hover:bg-slate-50 cursor-pointer text-sm';
			li.textContent = label;
			li.addEventListener('click', () => {
				select.value = value;
				display.textContent = label;
				list.classList.add('hidden');
				select.dispatchEvent(new Event('change', { bubbles: true }));
			});
			list.appendChild(li);
		});
		// Actualizar el texto visible según la opción seleccionada actual
		const selected = select.options[select.selectedIndex] || null;
		display.textContent = selected && selected.textContent ? selected.textContent.trim() : 'Seleccionar';
		return;
	}

	const originalClasses = (select.className || '').split(/\s+/).filter(Boolean);
	const layoutClasses = originalClasses.filter((token) => {
		const utility = token.includes(':') ? token.split(':').pop() : token;
		return utility.startsWith('col-span-')
			|| utility === 'w-full'
			|| utility === 'flex-1'
			|| utility.startsWith('w-')
			|| utility.startsWith('min-w-')
			|| utility.startsWith('max-w-')
			|| utility.startsWith('basis-')
			|| utility.startsWith('grow')
			|| utility.startsWith('shrink')
			|| utility.startsWith('order-');
	});

	const parent = select.parentElement;
	if (!parent) return;

	const wrapper = document.createElement('div');
	wrapper.className = ['relative', ...layoutClasses].join(' ').trim();
	parent.insertBefore(wrapper, select);
	wrapper.appendChild(select);

	select.dataset.customized = '1';
	select.classList.add('hidden');

	const getSelectedLabel = () => {
		const opt = select.options[select.selectedIndex] || null;
		return opt && opt.textContent ? opt.textContent.trim() : '';
	};

	const display = document.createElement('button');
	display.type = 'button';
	display.className = 'w-full select-pos text-left';
	display.textContent = getSelectedLabel() || 'Seleccionar';
	wrapper.insertBefore(display, select);

	const list = document.createElement('ul');
	list.className = 'absolute left-0 right-0 mt-1 border rounded-xl hidden bg-white shadow-2xl max-h-60 overflow-y-auto z-50 text-sm';
	wrapper.appendChild(list);

	const rebuild = () => {
		list.innerHTML = '';
		Array.from(select.options).forEach((opt) => {
			const value = opt.value;
			const label = opt.textContent || '';
			if (label === '' && !value) return;
			const li = document.createElement('li');
			li.className = 'p-3 border-b last:border-b-0 hover:bg-slate-50 cursor-pointer text-sm';
			li.textContent = label;
			li.addEventListener('click', () => {
				select.value = value;
				display.textContent = label;
				list.classList.add('hidden');
				select.dispatchEvent(new Event('change', { bubbles: true }));
			});
			list.appendChild(li);
		});
	};

	rebuild();

	const toggle = () => {
		if (list.classList.contains('hidden')) {
			list.classList.remove('hidden');
		} else {
			list.classList.add('hidden');
		}
	};

	display.addEventListener('click', (e) => {
		e.preventDefault();
		toggle();
	});

	document.addEventListener('click', (ev) => {
		if (wrapper.contains(ev.target)) return;
		list.classList.add('hidden');
	});

	select.addEventListener('change', () => {
		display.textContent = getSelectedLabel() || 'Seleccionar';
	});
}

