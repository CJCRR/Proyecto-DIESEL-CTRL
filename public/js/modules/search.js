// search.js - Módulo de búsqueda y selección de productos

import { obtenerProductosLocales, guardarProductoLocal } from '../db-local.js';
import { initCustomSelect } from './ui.js';

let _refs = {
	buscarInput: null,
	resultadosUL: null,
	prepararParaAgregar: null,
	apiFetchJson: null,
	showToast: null,
	escapeHtml: null
};

let _resultadosActuales = [];
let _resultadoActivoIndex = -1;

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
		_refs.buscarInput.addEventListener('keydown', onBuscarKeydown);
		// Cerrar resultados al hacer clic fuera del buscador
		document.addEventListener('click', onDocumentClick);
	}
}

function updateResultadoActivo() {
	if (!_refs.resultadosUL) return;
	const items = Array.from(_refs.resultadosUL.querySelectorAll('li[data-resultado-index]'));
	items.forEach((el, idx) => {
		if (idx === _resultadoActivoIndex) {
			el.classList.add('bg-blue-50');
			el.scrollIntoView({ block: 'nearest' });
		} else {
			el.classList.remove('bg-blue-50');
		}
	});
}

function onBuscarKeydown(e) {
	if (!_refs.resultadosUL || _refs.resultadosUL.classList.contains('hidden') || !_resultadosActuales.length) {
		return;
	}

	if (e.key === 'ArrowDown') {
		e.preventDefault();
		_resultadoActivoIndex = _resultadoActivoIndex < (_resultadosActuales.length - 1)
			? _resultadoActivoIndex + 1
			: 0;
		updateResultadoActivo();
		return;
	}

	if (e.key === 'ArrowUp') {
		e.preventDefault();
		_resultadoActivoIndex = _resultadoActivoIndex > 0
			? _resultadoActivoIndex - 1
			: (_resultadosActuales.length - 1);
		updateResultadoActivo();
		return;
	}

	if (e.key === 'Enter') {
		const targetIndex = _resultadoActivoIndex >= 0 && _resultadoActivoIndex < _resultadosActuales.length
			? _resultadoActivoIndex
			: 0;
		if (targetIndex < 0 || targetIndex >= _resultadosActuales.length) return;
		e.preventDefault();
		handleResultadoClick(_resultadosActuales[targetIndex]);
	}
}

function ocultarResultados() {
	if (!_refs.resultadosUL) return;
	_resultadosActuales = [];
	_resultadoActivoIndex = -1;
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
			detalle = await _refs.apiFetchJson(`/api/productos/${encodeURIComponent(p.codigo)}`);
		} catch (err) {
			console.warn('No se pudo obtener detalle de producto para depósitos', err);
		}
	}

	const productoInfoEl = document.getElementById('pv-producto-info');
	const depWrapper = document.getElementById('pv-deposito-wrapper');
	const depSelect = document.getElementById('pv_deposito');
	const marcaWrapper = document.getElementById('pv-marca-wrapper');
	const marcaSelect = document.getElementById('pv_marca');

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
				let detalleMarcas = '';
				if (Array.isArray(e.marcas) && e.marcas.length > 0) {
					const marcasConStock = e.marcas
						.filter(m => Number(m.cantidad || 0) > 0)
						.map(m => `${(m.marca || 'SIN MARCA').toString()}: ${m.cantidad}`);
					if (marcasConStock.length) {
						detalleMarcas = ` [${marcasConStock.join(', ')}]`;
					}
				}
				return `${nombre}: ${cant}${detalleMarcas}`;
			});
			productoInfoEl.textContent = `Stock total: ${stockTotal} 
• Por depósito: ${partes.join(' • ')}`;
		} else {
			productoInfoEl.textContent = `Stock total: ${stockTotal}`;
		}
	}

	// Poblar selector de depósito usando solo los depósitos reales.
	// - Si hay exactamente un depósito con stock, se selecciona automáticamente
	//   y el selector puede permanecer oculto.
	// - Si hay más de uno, se muestran todos SIN opción "Automático" para que
	//   siempre quede asociado un depósito concreto en el carrito.
	if (depSelect && depWrapper) {
		if (existenciasConStock.length <= 1) {
			if (existenciasConStock.length === 1) {
				const unico = existenciasConStock[0];
				const depCodigo = (unico.deposito_codigo || unico.deposito_nombre || '').toString();
				depSelect.innerHTML = `<option value="${unico.deposito_id}" data-dep-codigo="${depCodigo}">${depCodigo} (${unico.cantidad})</option>`;
				depSelect.value = String(unico.deposito_id);
			} else {
				depSelect.innerHTML = '';
				depSelect.value = '';
			}
			// Cuando hay un solo depósito, mantenemos el selector oculto.
			depWrapper.classList.add('hidden');
		} else {
			const options = [];
			existenciasConStock.forEach(e => {
				const depCodigo = (e.deposito_codigo || e.deposito_nombre || '').toString();
				const cant = Number(e.cantidad || 0) || 0;
				options.push(`<option value="${e.deposito_id}" data-dep-codigo="${depCodigo}">${depCodigo} (${cant})</option>`);
			});
			depSelect.innerHTML = options.join('');
			// Seleccionar por defecto el primer depósito de la lista
			if (existenciasConStock.length > 0) {
				depSelect.value = String(existenciasConStock[0].deposito_id);
			}
			depWrapper.classList.remove('hidden');
			// Aplicar estilo custom igual que "Nivel de precio"
			try { initCustomSelect('pv_deposito'); } catch {}
		}
	}

	// Poblar selector de marca de forma dependiente del depósito seleccionado.
	// 1) Obtener marcas históricas del producto como respaldo.
	let marcasHistoricas = [];
	if (_refs.apiFetchJson && p && p.codigo) {
		try {
			const respMarcas = await _refs.apiFetchJson(`/admin/productos/marcas-por-producto?codigo=${encodeURIComponent(p.codigo)}`);
			const arr = Array.isArray(respMarcas?.items) ? respMarcas.items : [];
			marcasHistoricas = arr
				.map(m => (m || '').toString().trim())
				.filter(Boolean);
		} catch (err) {
			console.warn('No se pudieron obtener marcas históricas del producto', err);
		}
	}
	const marcaPrincipal = (detalle && detalle.marca) || p.marca || '';
	if (marcaPrincipal) {
		const norm = marcaPrincipal.toString().trim();
		if (!marcasHistoricas.some(m => m.toLowerCase() === norm.toLowerCase())) {
			marcasHistoricas.unshift(norm);
		}
	}

	function actualizarSelectorMarca() {
		if (!marcaSelect || !marcaWrapper) return;
		let marcasDisponibles = [];
		// Buscar depósito seleccionado y usar solo las marcas con stock > 0 en ese depósito
		let depositoSeleccionadoId = null;
		if (depSelect && depSelect.value) {
			const parsed = parseInt(depSelect.value, 10);
			if (!Number.isNaN(parsed)) depositoSeleccionadoId = parsed;
		}
		if (depositoSeleccionadoId != null) {
			const depRow = existenciasConStock.find(e => e.deposito_id === depositoSeleccionadoId) || existencias.find(e => e.deposito_id === depositoSeleccionadoId);
			if (depRow && Array.isArray(depRow.marcas) && depRow.marcas.length > 0) {
					marcasDisponibles = depRow.marcas
						.filter(m => Number(m.cantidad || 0) > 0)
						.map(m => ({
							nombre: (m.marca || '').toString().trim(),
							cantidad: Number(m.cantidad || 0) || 0,
						}))
						.filter(m => m.nombre);
			}
		}
		// Si no hay marcas con stock en ese depósito, usar las históricas como respaldo
		if (!marcasDisponibles.length) {
			marcasDisponibles = marcasHistoricas.map((nombre) => ({ nombre, cantidad: null }));
		}

		const escapeHtml = _refs.escapeHtml || ((v) => v);
		const buildLabel = (m) => {
			const base = m.nombre;
			if (m.cantidad != null) {
				return `${base} (${m.cantidad})`;
			}
			return base;
		};

		// Renderizar selector
		if (marcasDisponibles.length <= 1) {
			if (marcasDisponibles.length === 1) {
				const unica = marcasDisponibles[0];
				const label = buildLabel(unica);
				marcaSelect.innerHTML = `<option value="${escapeHtml(unica.nombre)}">${escapeHtml(label)}</option>`;
				marcaSelect.value = unica.nombre;
			} else {
				marcaSelect.innerHTML = '';
				marcaSelect.value = '';
			}
			marcaWrapper.classList.add('hidden');
		} else {
			const opts = marcasDisponibles.map((m) => {
				const label = buildLabel(m);
				return `<option value="${escapeHtml(m.nombre)}">${escapeHtml(label)}</option>`;
			}).join('');
			marcaSelect.innerHTML = opts;
			marcaSelect.value = marcasDisponibles[0].nombre;
			marcaWrapper.classList.remove('hidden');
		}
	}

	if (marcaSelect && marcaWrapper) {
		// Configurar actualización reactiva al cambiar de depósito
		if (depSelect) {
			// Sobrescribimos el handler para evitar acumular listeners
			depSelect.onchange = actualizarSelectorMarca;
		}
		// Inicializar según el depósito seleccionado actual (o único depósito)
			actualizarSelectorMarca();
			// Aplicar select custom también para marcas
			try { initCustomSelect('pv_marca'); } catch {}
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
			const data = await _refs.apiFetchJson(`/api/buscar?q=${encodeURIComponent(q)}`);
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
	_resultadosActuales = Array.isArray(data) ? data : [];
	_resultadoActivoIndex = -1;
	_refs.resultadosUL.innerHTML = '';
	if (Array.isArray(data) && data.length > 0) {
		_refs.resultadosUL.classList.remove('hidden');
		data.forEach((p, index) => {
			const li = document.createElement('li');
			li.className = 'p-1 border-b hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors';
			li.dataset.resultadoIndex = String(index);
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
		updateResultadoActivo();
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
