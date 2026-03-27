// search.js - Módulo de búsqueda y selección de productos

import { obtenerProductosLocales, guardarProductoLocal } from '../db-local.js';

let _refs = {
	buscarInput: null,
	resultadosUL: null,
	prepararParaAgregar: null,
	apiFetchJson: null,
	showToast: null,
	escapeHtml: null
};

function normalizarTextoBusqueda(text) {
	return (text || '')
		.toString()
		.toLowerCase()
		.replace(/[ñÑ]/g, 'n')
		.replace(/[üÜ]/g, 'u');
}

function setupSearchModule(refs) {
	Object.assign(_refs, refs);
	if (_refs.buscarInput) {
		_refs.buscarInput.addEventListener('input', onBuscarInput);
		// Cerrar resultados al hacer clic fuera del buscador
		document.addEventListener('click', onDocumentClick);
	}
}

function ocultarResultados() {
	if (!_refs.resultadosUL) return;
	_refs.resultadosUL.innerHTML = '';
	_refs.resultadosUL.classList.add('hidden');
}

async function handleResultadoClick(p) {
	if (_refs.resultadosUL) {
		_refs.resultadosUL.classList.add('hidden');
	}

	let detalle = null;
	if (_refs.apiFetchJson && p && p.codigo) {
		try {
			detalle = await _refs.apiFetchJson(`/productos/${encodeURIComponent(p.codigo)}`);
		} catch (err) {
			console.warn('No se pudo obtener detalle de producto para depósitos', err);
		}
	}

	const productoInfoEl = document.getElementById('pv-producto-info');
	const depWrapper = document.getElementById('pv-deposito-wrapper');
	const depSelect = document.getElementById('pv_deposito');

	let existencias = Array.isArray(detalle?.existencias_por_deposito)
		? detalle.existencias_por_deposito
		: [];
	const existenciasConStock = existencias.filter(e => Number(e.cantidad || 0) > 0);

	// Mostrar resumen de stock total + por depósito (si hay datos)
	if (productoInfoEl) {
		const stockTotal = typeof p.stock === 'number' ? p.stock : Number(p.stock || 0) || 0;
		if (existenciasConStock.length > 0) {
			const partes = existenciasConStock.map(e => {
				const nombre = (e.deposito_nombre || '').toString();
				const cant = Number(e.cantidad || 0) || 0;
				return `${nombre}: ${cant}`;
			});
			productoInfoEl.textContent = `Stock total: ${stockTotal} 
• Por depósito: ${partes.join(' • ')}`;
		} else {
			productoInfoEl.textContent = `Stock total: ${stockTotal}`;
		}
	}

	// Poblar selector de depósito cuando haya stock en más de un depósito
	if (depSelect && depWrapper) {
		if (existenciasConStock.length <= 1) {
			if (existenciasConStock.length === 1) {
				// Autoseleccionar el único depósito con stock aunque el selector se mantenga oculto
				const unico = existenciasConStock[0];
				depSelect.innerHTML = `<option value="">Automático</option>` +
					`<option value="${unico.deposito_id}">${unico.deposito_nombre} (${unico.cantidad})</option>`;
				depSelect.value = String(unico.deposito_id);
			} else {
				depSelect.innerHTML = '<option value="">Automático</option>';
				depSelect.value = '';
			}
			depWrapper.classList.add('hidden');
		} else {
			const options = ['<option value="">Automático</option>'];
			existenciasConStock.forEach(e => {
				const nombre = (e.deposito_nombre || '').toString();
				const cant = Number(e.cantidad || 0) || 0;
				options.push(`<option value="${e.deposito_id}">${nombre} (${cant})</option>`);
			});
			depSelect.innerHTML = options.join('');
			depSelect.value = '';
			depWrapper.classList.remove('hidden');
		}
	}

	// Pasar producto (con detalle opcional) al módulo de carrito.
	// Importante: conservamos el stock total calculado en la búsqueda (p.stock),
	// ya que el detalle puede traer un campo stock desactualizado de la tabla productos.
	let productoParaCarrito;
	if (detalle) {
		const stockTotal = typeof p.stock === 'number' ? p.stock : (Number(p.stock || 0) || 0);
		productoParaCarrito = { ...p, ...detalle };
		productoParaCarrito.stock = stockTotal;
	} else {
		productoParaCarrito = p;
	}
	if (_refs.prepararParaAgregar) {
		_refs.prepararParaAgregar(productoParaCarrito);
	}
}

function onDocumentClick(e) {
	if (!_refs.buscarInput || !_refs.resultadosUL) return;
	const target = e.target;
	// Si el clic fue dentro del input o de la lista de resultados, no cerrar
	if (_refs.buscarInput.contains(target) || _refs.resultadosUL.contains(target)) {
		return;
	}
	ocultarResultados();
}

async function onBuscarInput() {
	const q = _refs.buscarInput.value.trim();
	if (q.length < 2) {
		ocultarResultados();
		return;
 	}

	const online = navigator.onLine;
	if (online) {
		try {
			const data = await _refs.apiFetchJson(`/buscar?q=${encodeURIComponent(q)}`);
			// Guardar resultados en cache local para uso offline
			if (Array.isArray(data) && data.length) {
				for (const p of data) {
					try {
						if (p && p.codigo) {
							await guardarProductoLocal({
								codigo: p.codigo,
								descripcion: p.descripcion,
								precio_usd: p.precio_usd,
								stock: p.stock
							});
						}
					} catch (e) {
						console.warn('No se pudo cachear producto localmente', e);
					}
				}
			}
			renderResultados(data || []);
			return;
		} catch (err) {
			console.warn('Error en búsqueda online, usando cache local si existe', err);
			// caída a búsqueda offline
		}
	}

	await buscarOffline(q);
}

function renderResultados(data) {
	_refs.resultadosUL.innerHTML = '';
	if (Array.isArray(data) && data.length > 0) {
		_refs.resultadosUL.classList.remove('hidden');
		data.forEach(p => {
			const li = document.createElement('li');
			li.className = 'p-1 border-b hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors';
			li.innerHTML = `<div class="flex flex-col">
						<span class="font-bold text-slate-700">${_refs.escapeHtml ? _refs.escapeHtml(p.descripcion) : p.descripcion}</span>
						<span class="font-bold text-xs text-slate-400">${_refs.escapeHtml ? _refs.escapeHtml(p.codigo) : p.codigo}</span>
					</div>
					<div class="text-right">
						<span class="block text-blue-600 font-black">Stock: ${_refs.escapeHtml ? _refs.escapeHtml(p.stock) : p.stock}</span>
						<span class="block text-[13px] font-bold text-slate-400 uppercase">$${_refs.escapeHtml ? _refs.escapeHtml(p.precio_usd) : p.precio_usd}</span>
					</div>`;
				li.addEventListener('click', () => {
					handleResultadoClick(p);
				});
			_refs.resultadosUL.appendChild(li);
		});
	} else {
		_refs.resultadosUL.classList.add('hidden');
	}
}

async function buscarOffline(q) {
	try {
		const todos = await obtenerProductosLocales();
		const term = normalizarTextoBusqueda(q);
		const filtrados = (todos || []).filter(p => {
			const codigo = normalizarTextoBusqueda(p.codigo || '');
			const desc = normalizarTextoBusqueda(p.descripcion || '');
			return codigo.includes(term) || desc.includes(term);
		});
		if (!filtrados.length && _refs.showToast) {
			_refs.showToast('Sin conexión. No hay coincidencias en cache local.', 'info');
		}
		renderResultados(filtrados);
	} catch (err) {
		console.warn('Error buscando en cache local de productos', err);
		ocultarResultados();
		if (_refs.showToast) _refs.showToast('Error en búsqueda offline', 'error');
	}
}

export function prepararParaAgregar(p) {
	// Esta función puede ser sobreescrita por el módulo cart.js si se requiere lógica especial
	if (_refs.prepararParaAgregar) return _refs.prepararParaAgregar(p);
}

export { setupSearchModule };
