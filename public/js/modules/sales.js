// sales.js - Módulo de ventas, devoluciones e historial

import { apiFetchJson } from '../app-api.js';
import { formatNumber } from '../format-utils.js';
import { escapeHtml, showToast } from '../app-utils.js';
import { sincronizarVentasPendientes } from '../firebase-sync.js';
import {
	carrito,
	modoDevolucion,
	actualizarTabla,
	setModoDevolucion,
	getVentaSeleccionada,
	setVentaSeleccionada
} from './cart.js';
import { guardarVentaLocal as guardarVentaLocalIDB, abrirIndexedDB, obtenerVentasPendientes, marcarComoSincronizada } from '../db-local.js';
import { enviarVentaASync } from '../sync-client.js';

let vendiendo = false;

// --- GENERADOR DE ID GLOBAL (VEN-YYYY-MM-DD-UUID) ---
function generarIDVenta() {
	const fecha = new Date().toISOString().split('T')[0];
	const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
	return `VEN-${fecha}-${randomPart}`;
}

// --- HISTORIAL DE DEVOLUCIONES / VENTA SELECCIONADA ---
export function renderVentaSeleccionada() {
	const ventaSeleccionada = getVentaSeleccionada();
	const info = document.getElementById('dev-venta-info');
	const detalle = document.getElementById('dev-venta-detalle');
	if (!info || !detalle) return;
	if (!ventaSeleccionada) {
		info.classList.add('hidden');
		detalle.classList.add('hidden');
		return;
	}
	info.classList.remove('hidden');
	const totalUsd = ventaSeleccionada.tasa_bcv ? (ventaSeleccionada.total_bs / ventaSeleccionada.tasa_bcv) : 0;
	info.innerHTML = `<div class="flex justify-between">
		<div>
			<div class="font-semibold text-slate-700">${escapeHtml(ventaSeleccionada.cliente || '')}</div>
			<div class="text-[11px] text-slate-500">#${escapeHtml(ventaSeleccionada.id)} • ${escapeHtml(new Date(ventaSeleccionada.fecha).toLocaleString())}</div>
			<div class="text-[11px] text-slate-500">Ref: ${escapeHtml(ventaSeleccionada.referencia || '—')}</div>
		</div>
		<div class="text-right text-sm font-black text-rose-600">$${formatNumber(totalUsd)}</div>
	</div>`;

	detalle.classList.remove('hidden');
	detalle.innerHTML = carrito.map(d => `<div class="flex items-center justify-between border-b pb-1">
		<div class="text-slate-700">${escapeHtml(d.codigo)} — ${escapeHtml(d.descripcion)}</div>
		<div class="text-xs text-slate-500">Vendidos: ${escapeHtml(d.maxCantidad)}</div>
	</div>`).join('');
}

export function renderHistorialDevoluciones(list = []) {
	const cont = document.getElementById('dev-historial');
	if (!cont) return;
	if (!list.length) {
		cont.classList.remove('hidden');
		cont.innerHTML = '<div class="text-slate-400 text-xs">Sin devoluciones previas para este cliente.</div>';
		return;
	}
	cont.classList.remove('hidden');
	cont.innerHTML = list.slice(0, 5).map(d => {
		const fecha = new Date(d.fecha).toLocaleString();
		return `<div class="p-3 border rounded-xl bg-slate-50 flex items-center justify-between">
			<div>
				<div class="font-semibold text-slate-700">${escapeHtml(d.cliente || '')}</div>
				<div class="text-[11px] text-slate-500">${escapeHtml(fecha)}${d.motivo ? ' • ' + escapeHtml(d.motivo) : ''}</div>
				${d.referencia ? `<div class="text-[11px] text-slate-500">Ref: ${escapeHtml(d.referencia)}</div>` : ''}
			</div>
			<div class="text-right text-[11px]">
				<div class="font-black text-rose-600">$${formatNumber(d.total_usd)}</div>
				<div class="text-slate-500">${formatNumber(d.total_bs)} Bs</div>
			</div>
		</div>`;
	}).join('');
}

export function aplicarDescuentoDevolucion(list = []) {
	if (!list.length) return;
	const inputDesc = document.getElementById('v_desc');
	if (!inputDesc) return;
	const actual = parseFloat(inputDesc.value || '0') || 0;
	if (actual > 0) return;
	inputDesc.value = '5';
	showToast('Descuento 5% aplicado por devolución previa del cliente', 'info');
	actualizarTabla();
}

export async function cargarHistorialDevoluciones(cliente, cedula) {
	const cont = document.getElementById('dev-historial');
	if (!cont) return;
	if (!cliente && !cedula) {
		cont.innerHTML = '<div class="text-slate-400 text-xs">Sin cliente seleccionado.</div>';
		return;
	}
	cont.innerHTML = '<div class="text-slate-400 text-xs">Cargando devoluciones...</div>';
	try {
		const params = new URLSearchParams();
		if (cliente) params.set('cliente', cliente);
		if (cedula) params.set('cedula', cedula);
		const data = await apiFetchJson(`/devoluciones/historial?${params.toString()}`);
		renderHistorialDevoluciones(data || []);
		aplicarDescuentoDevolucion(data || []);
	} catch (err) {
		console.error(err);
		cont.innerHTML = '<div class="text-rose-600 text-xs">Error cargando historial de devoluciones.</div>';
	}
}

// --- PANEL DE SINCRONIZACIÓN ---
export async function actualizarSyncPendientes() {
	try {
		const cont = document.getElementById('sync-pendientes');
		if (!cont) return;
		let pendientes = 0;
		if (typeof abrirIndexedDB === 'function' && typeof obtenerVentasPendientes === 'function') {
			const db = await abrirIndexedDB();
			const arr = await obtenerVentasPendientes(db);
			pendientes = (arr || []).length;
		} else {
			const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
			pendientes = historico.filter(v => !v.sync).length;
		}
		cont.textContent = String(pendientes);
		if (pendientes > 0) {
			cont.classList.add('text-rose-600', 'font-bold');
			showToast(`Tienes ${pendientes} venta(s) pendiente(s) de sincronizar.`, 'info', 5000);
		} else {
			cont.classList.remove('text-rose-600', 'font-bold');
		}
	} catch (err) {
		console.warn('No se pudo calcular pendientes', err);
	}
}

// --- IMPRESIÓN DE NOTA ---
async function imprimirNotaLocal(venta) {
	// reutilizamos la implementación global definida en app.js vía window
	if (typeof window.imprimirNotaLocal === 'function') {
		return window.imprimirNotaLocal(venta);
	}
	throw new Error('Función imprimirNotaLocal no disponible');
}

// --- PROCESAR VENTA FINAL ---
export async function registrarVenta() {
	if (modoDevolucion) {
		await registrarDevolucion();
		return;
	}
	if (vendiendo || carrito.length === 0) return;

	const cliente = document.getElementById('v_cliente').value.trim();
	const vendedor = document.getElementById('v_vendedor') ? document.getElementById('v_vendedor').value.trim() : '';
	const cedula = document.getElementById('v_cedula') ? document.getElementById('v_cedula').value.trim() : '';
	const telefono = document.getElementById('v_telefono') ? document.getElementById('v_telefono').value.trim() : '';
	const tasa = parseFloat(document.getElementById('v_tasa').value);

	const selMetodo = document.getElementById('v_metodo');
	const isCredito = (selMetodo?.value === 'credito');
	const diasVenc = parseInt(document.getElementById('v_dias')?.value, 10) || 21;
	const fechaVenc = document.getElementById('v_fecha_venc')?.value || null;

	const metodo = selMetodo ? selMetodo.value : '';
	if (!isCredito && !metodo) { showToast('Seleccione un método de pago', 'error'); return; }
	if (!cliente) { showToast('Ingrese el nombre del cliente', 'error'); return; }
	if (!tasa || isNaN(tasa) || tasa <= 0) { showToast('Ingrese una tasa de cambio válida (> 0)', 'error'); return; }

	const descuento = parseFloat(document.getElementById('v_desc') ? document.getElementById('v_desc').value : 0) || 0;
	const referencia = (document.getElementById('v_ref') && document.getElementById('v_ref').value)
		? document.getElementById('v_ref').value.trim()
		: '';

	const metodoFinal = isCredito ? 'CREDITO' : metodo;

	let ivaPct = 0;
	try {
		if (window.configGeneral && window.configGeneral.nota && window.configGeneral.nota.iva_pct != null) {
			ivaPct = Math.max(0, Math.min(100, parseFloat(window.configGeneral.nota.iva_pct) || 0));
		}
	} catch {}

	const ventaData = {
		id_global: generarIDVenta(),
		items: [...carrito],
		cliente,
		vendedor,
		cedula,
		telefono,
		tasa_bcv: tasa,
		descuento,
		metodo_pago: metodoFinal,
		referencia,
		cliente_doc: cedula,
		credito: isCredito,
		dias_vencimiento: diasVenc,
		fecha_vencimiento: fechaVenc,
		iva_pct: ivaPct,
		fecha: new Date().toISOString(),
		sync: false
	};

	const btnVender = document.getElementById('btnVender');
	vendiendo = true;
	if (btnVender) {
		btnVender.disabled = true;
		btnVender.innerText = 'Procesando...';
	}

	try {
		await guardarVentaLocal(ventaData);
		await actualizarSyncPendientes();

		const online = navigator.onLine;
		if (!online) {
			try {
				if ('serviceWorker' in navigator && 'SyncManager' in window) {
					const reg = await navigator.serviceWorker.ready;
					await reg.sync.register('sync-ventas');
				}
			} catch (err) {
				console.warn('No se pudo registrar background sync', err);
			}
		}

		if (online) {
			try {
				await sincronizarVentasPendientes();
			} catch (err) {
				console.warn('Error al sincronizar ventas pendientes', err);
			}

			// Enviar evento de venta al backend nube vía /sync/push (multiempresa)
			try {
				await enviarVentaASync(ventaData);
			} catch (err) {
				console.warn('Error enviando venta a sync nube', err);
			}
		}

		if (typeof window.finalizarVentaUI === 'function') {
			window.finalizarVentaUI();
		}
		await imprimirNotaLocal(ventaData);
		setTimeout(() => showToast('✅ Venta registrada exitosamente', 'success'), 300);
	} catch (err) {
		console.error(err);
		showToast('❌ Error: ' + err.message, 'error');
	} finally {
		vendiendo = false;
		if (btnVender) {
			btnVender.disabled = false;
			btnVender.textContent = 'Registrar venta';
		}
	}
	if (typeof window.actualizarHistorial === 'function') {
		window.actualizarHistorial();
	}
}

export async function registrarDevolucion() {
	if (vendiendo || carrito.length === 0) return;

	const cliente = document.getElementById('v_cliente').value.trim();
	const cedula = document.getElementById('v_cedula') ? document.getElementById('v_cedula').value.trim() : '';
	const telefono = document.getElementById('v_telefono') ? document.getElementById('v_telefono').value.trim() : '';
	const tasa = parseFloat(document.getElementById('v_tasa').value);
	const motivo = document.getElementById('dev-motivo') ? document.getElementById('dev-motivo').value.trim() : '';
	const ventaSel = getVentaSeleccionada();
	const ventaOriginalId = ventaSel ? ventaSel.id : null;

	if (!cliente) { showToast('Ingrese el nombre del cliente', 'error'); return; }
	if (!tasa || isNaN(tasa) || tasa <= 0) { showToast('Ingrese una tasa de cambio válida (> 0)', 'error'); return; }
	if (!ventaOriginalId) { showToast('Selecciona una venta a devolver', 'error'); return; }

	const policyError = (typeof window.validarPoliticaDevolucionLocal === 'function')
		? window.validarPoliticaDevolucionLocal(ventaSel)
		: null;
	if (policyError) { showToast(policyError, 'error'); return; }

	const items = carrito
		.filter(item => Number(item.cantidad) > 0)
		.map(item => ({ codigo: item.codigo, cantidad: Number(item.cantidad) }));
	if (!items.length) { showToast('Coloca cantidades a devolver', 'error'); return; }

	const btnVender = document.getElementById('btnVender');
	vendiendo = true;
	if (btnVender) {
		btnVender.disabled = true;
		btnVender.textContent = 'Procesando...';
	}

	try {
		const usuario = window.Auth ? window.Auth.getUser() : null;
		const refDev = ventaSel?.referencia || `DEV-${ventaOriginalId}`;
		const payload = {
			items,
			cliente,
			cedula,
			telefono,
			tasa_bcv: tasa,
			referencia: refDev,
			motivo,
			venta_original_id: ventaOriginalId,
			usuario_id: usuario ? usuario.id : null
		};
		await apiFetchJson('/devoluciones', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (typeof window.finalizarVentaUI === 'function') {
			window.finalizarVentaUI();
		}
		setModoDevolucion(false);
		showToast('Devolución registrada', 'success');
		await cargarHistorialDevoluciones(cliente, cedula);
		if (typeof window.actualizarHistorial === 'function') {
			await window.actualizarHistorial();
		}
		if (typeof window.cargarVentasRecientes === 'function') {
			await window.cargarVentasRecientes();
		}
	} catch (err) {
		showToast('❌ Error: ' + err.message, 'error');
	} finally {
		vendiendo = false;
		if (btnVender) {
			btnVender.disabled = false;
			btnVender.textContent = 'Registrar venta';
		}
	}
}

// --- SINCRONIZACIÓN MANUAL DESDE LOCALSTORAGE (LEGADO) ---
export async function enviarVentaAlServidor(venta) {
	const user = window.Auth ? window.Auth.getUser() : null;
	const ventaConUsuario = {
		...venta,
		usuario_id: user ? user.id : null
	};

	const data = await apiFetchJson('/ventas', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(ventaConUsuario)
	});

	// Marcar como sincronizada en IndexedDB usando el helper de compatibilidad
	await marcarVentaComoSincronizadaCompat(venta.id_global);
	return data;
}

export function guardarVentaLocal(venta) {
	// Preferir implementación de IndexedDB de db-local.js
	if (typeof window.guardarVentaLocal === 'function' && window.guardarVentaLocal !== guardarVentaLocal) {
		return window.guardarVentaLocal(venta);
	}
	return guardarVentaLocalIDB(venta);
}

export function marcarVentaComoSincronizadaCompat(idGlobal) {
	// Preferir IndexedDB implementation si existe
	if (typeof window.abrirIndexedDB === 'function' && typeof window.marcarComoSincronizada === 'function') {
		return window.abrirIndexedDB().then(db => window.marcarComoSincronizada(db, idGlobal));
	}
	return marcarComoSincronizada(abrirIndexedDB(), idGlobal);
}

export function intentarSincronizar() {
	const historico = JSON.parse(localStorage.getItem('ventas_pendientes') || '[]');
	const pendientes = historico.filter(v => !v.sync);
	if (pendientes.length === 0) return;

	pendientes.reduce(async (promise, venta) => {
		await promise;
		return enviarVentaAlServidor(venta).catch(e => console.error(e));
	}, Promise.resolve()).then(() => {
		if (typeof window.actualizarHistorial === 'function') {
			window.actualizarHistorial();
		}
	});
}

// Exponer algunas funciones también en window para código legado
if (typeof window !== 'undefined') {
	window.renderVentaSeleccionada = renderVentaSeleccionada;
	window.cargarHistorialDevoluciones = cargarHistorialDevoluciones;
	window.actualizarSyncPendientes = actualizarSyncPendientes;
	window.intentarSincronizar = intentarSincronizar;
}

