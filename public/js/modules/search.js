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

function setupSearchModule(refs) {
	Object.assign(_refs, refs);
	if (_refs.buscarInput) {
		_refs.buscarInput.addEventListener('input', onBuscarInput);
	}
}

async function onBuscarInput() {
	const q = _refs.buscarInput.value.trim();
	if (q.length < 2) {
		_refs.resultadosUL.innerHTML = '';
		_refs.resultadosUL.classList.add('hidden');
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
			li.className = 'p-3 border-b hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors';
			li.innerHTML = `<div class="flex flex-col">
						<span class="font-bold text-slate-700">${_refs.escapeHtml ? _refs.escapeHtml(p.codigo) : p.codigo}</span>
						<span class="text-xs text-slate-400">${_refs.escapeHtml ? _refs.escapeHtml(p.descripcion) : p.descripcion}</span>
					</div>
					<div class="text-right">
						<span class="block text-blue-600 font-black">$${_refs.escapeHtml ? _refs.escapeHtml(p.precio_usd) : p.precio_usd}</span>
						<span class="block text-[9px] font-bold text-slate-400 uppercase">Stock: ${_refs.escapeHtml ? _refs.escapeHtml(p.stock) : p.stock}</span>
					</div>`;
			li.addEventListener('click', () => {
				if (_refs.prepararParaAgregar) _refs.prepararParaAgregar(p);
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
		const term = q.toLowerCase();
		const filtrados = (todos || []).filter(p => {
			const codigo = (p.codigo || '').toLowerCase();
			const desc = (p.descripcion || '').toLowerCase();
			return codigo.includes(term) || desc.includes(term);
		}).slice(0, 50);
		if (!filtrados.length && _refs.showToast) {
			_refs.showToast('Sin conexión. No hay coincidencias en cache local.', 'info');
		}
		renderResultados(filtrados);
	} catch (err) {
		console.warn('Error buscando en cache local de productos', err);
		_refs.resultadosUL.classList.add('hidden');
		if (_refs.showToast) _refs.showToast('Error en búsqueda offline', 'error');
	}
}

export function prepararParaAgregar(p) {
	// Esta función puede ser sobreescrita por el módulo cart.js si se requiere lógica especial
	if (_refs.prepararParaAgregar) return _refs.prepararParaAgregar(p);
}

export { setupSearchModule };
