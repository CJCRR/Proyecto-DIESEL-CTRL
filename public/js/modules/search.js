// search.js - Módulo de búsqueda y selección de productos

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
	try {
		const data = await _refs.apiFetchJson(`/buscar?q=${encodeURIComponent(q)}`);
		_refs.resultadosUL.innerHTML = '';
		if (data.length > 0) {
			_refs.resultadosUL.classList.remove('hidden');
			data.forEach(p => {
				const li = document.createElement('li');
				li.className = 'p-3 border-b hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors';
				li.innerHTML = `<div class="flex flex-col">
                                    <span class="font-bold text-slate-700">${escapeHtml(p.codigo)}</span>
                                    <span class="text-xs text-slate-400">${escapeHtml(p.descripcion)}</span>
                                </div>
                                <div class="text-right">
                                    <span class="block text-blue-600 font-black">$${escapeHtml(p.precio_usd)}</span>
                                    <span class="block text-[9px] font-bold text-slate-400 uppercase">Stock: ${escapeHtml(p.stock)}</span>
                                </div>`;
				li.addEventListener('click', () => {
					if (_refs.prepararParaAgregar) _refs.prepararParaAgregar(p);
				});
				_refs.resultadosUL.appendChild(li);
			});
		} else {
			_refs.resultadosUL.classList.add('hidden');
		}
	} catch (err) {
		_refs.resultadosUL.classList.add('hidden');
		if (_refs.showToast) _refs.showToast('Error en búsqueda', 'error');
	}
}

export function prepararParaAgregar(p) {
	// Esta función puede ser sobreescrita por el módulo cart.js si se requiere lógica especial
	if (_refs.prepararParaAgregar) return _refs.prepararParaAgregar(p);
}

export { setupSearchModule };
