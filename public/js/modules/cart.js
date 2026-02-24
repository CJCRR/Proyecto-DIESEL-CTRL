// cart.js - Módulo de gestión del carrito y parte de la UI del POS

// Estado compartido (se importa/exporta también desde otros módulos)
export let carrito = [];
export let productoSeleccionado = null;
export let modoDevolucion = false;
let ventaSeleccionada = null;

export function getVentaSeleccionada() {
	return ventaSeleccionada;
}

export function setVentaSeleccionada(value) {
	ventaSeleccionada = value;
}

// Referencias a elementos de DOM que usa el carrito
const buscarInput = document.getElementById('buscar');
const resultadosUL = document.getElementById('resultados');
const tablaCuerpo = document.getElementById('venta-items-cuerpo');
const btnVender = document.getElementById('btnVender');

// Estas variables vienen de la configuración general del POS
// (se espera que configGeneral y lastAutoDescuentoVolumen estén en el scope global)

export function prepararParaAgregar(p) {
	if (modoDevolucion) { showToast('En modo devolución no puedes agregar productos manualmente. Selecciona una venta.', 'error'); return; }
	productoSeleccionado = p;
	if (buscarInput) {
		buscarInput.value = `${p.codigo} - ${p.descripcion}`;
	}
	if (resultadosUL) resultadosUL.classList.add('hidden');
	const qty = document.getElementById('v_cantidad');
	if (qty) qty.focus();
}

export function agregarAlCarrito() {
	if (modoDevolucion) { showToast('Usa la selección de venta para devolver.', 'error'); return; }
	const cantidadInput = document.getElementById('v_cantidad');
	const cantidad = parseInt(cantidadInput?.value);

	if (!productoSeleccionado) { showToast('Por favor, busque y seleccione un producto.', 'error'); return; }
	if (isNaN(cantidad) || cantidad <= 0) { showToast('Ingrese una cantidad válida.', 'error'); return; }
	if (cantidad > productoSeleccionado.stock) { showToast('No hay suficiente stock disponible.', 'error'); return; }

	const index = carrito.findIndex(item => item.codigo === productoSeleccionado.codigo);

	// Determinar el precio de venta segun la estrategia de precios configurada
	let precioBase = Number(productoSeleccionado.precio_usd || 0) || 0;
	let precioVenta = precioBase;
	try {
		const niveles = Array.isArray(window.priceLevelsConfig) ? window.priceLevelsConfig : [];
		const nivelActual = window.currentPriceLevelKey || 'base';
		if (nivelActual !== 'base') {
			const lvl = niveles.find(l => l.key === nivelActual);
			if (lvl && typeof lvl.pct === 'number' && !Number.isNaN(lvl.pct)) {
				precioVenta = precioBase * (1 + (lvl.pct / 100));
			}
		}
	} catch {}

	if (index !== -1) {
		if ((carrito[index].cantidad + cantidad) > productoSeleccionado.stock) {
			showToast('La cantidad total en el carrito supera el stock físico.', 'error'); return;
		}
		carrito[index].cantidad += cantidad;
	} else {
		carrito.push({
			codigo: productoSeleccionado.codigo,
			descripcion: productoSeleccionado.descripcion,
			precio_base_usd: precioBase,
			precio_usd: precioVenta,
			cantidad: cantidad
		});
	}

	actualizarTabla();
	limpiarSeleccion();
}

export function recalcularPreciosPorNivel() {
	if (!carrito.length) return;

	let niveles = [];
	let nivelActual = 'base';
	try {
		niveles = Array.isArray(window.priceLevelsConfig) ? window.priceLevelsConfig : [];
		nivelActual = window.currentPriceLevelKey || 'base';
	} catch {}

	carrito.forEach(item => {
		const base = (typeof item.precio_base_usd === 'number' && !Number.isNaN(item.precio_base_usd))
			? Number(item.precio_base_usd)
			: (Number(item.precio_usd || 0) || 0);
		item.precio_base_usd = base;

		let precioVenta = base;
		if (nivelActual !== 'base') {
			const lvl = niveles.find(l => l.key === nivelActual);
			if (lvl && typeof lvl.pct === 'number' && !Number.isNaN(lvl.pct)) {
				precioVenta = base * (1 + (lvl.pct / 100));
			}
		}
		item.precio_usd = precioVenta;
	});

	actualizarTabla();
}

export function actualizarTabla() {
	if (!tablaCuerpo) return;
	tablaCuerpo.innerHTML = '';

	const vacioMsg = document.getElementById('vacio-msg');
	const countLabel = document.getElementById('items-count');

	if (carrito.length === 0) {
		if (vacioMsg) vacioMsg.classList.remove('hidden');
		if (countLabel) countLabel.innerText = "0 ITEMS";
	} else {
		if (vacioMsg) vacioMsg.classList.add('hidden');
		if (countLabel) countLabel.innerText = `${carrito.length} ITEM${carrito.length > 1 ? 'S' : ''}`;
	}

	let totalUSD = 0;
	const tasa = parseFloat(document.getElementById('v_tasa')?.value) || 1;

	carrito.forEach((item, index) => {
		const subtotalUSD = item.cantidad * item.precio_usd;
		totalUSD += subtotalUSD;

		const tr = document.createElement('tr');
		tr.className = "border-b text-sm hover:bg-slate-50 transition-colors";
		const qtyCell = modoDevolucion
			? `<input type="number" min="0" max="${item.maxCantidad || item.cantidad}" value="${item.cantidad}" class="w-16 text-center border rounded" data-idx="${index}" data-role="dev-qty">`
			: `${item.cantidad}`;
		tr.innerHTML = `
			<td class="p-4 font-bold text-slate-600">${escapeHtml(item.codigo)}</td>
			<td class="p-4 text-slate-500">${escapeHtml(item.descripcion)}</td>
			<td class="p-4 text-center font-bold">${qtyCell}</td>
			<td class="p-4 text-right text-slate-400 font-mono">$${item.precio_usd.toFixed(2)}</td>
			<td class="p-4 text-right font-black ${modoDevolucion ? 'text-rose-600' : 'text-blue-600'} font-mono">$${subtotalUSD.toFixed(2)}</td>
			<td class="p-4 text-center">
				<button onclick="eliminarDelCarrito(${index})" class="w-8 h-8 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all">
					<i class="fas fa-trash-alt"></i>
				</button>
			</td>
		`;
		tablaCuerpo.appendChild(tr);
	});

	if (modoDevolucion) {
		tablaCuerpo.querySelectorAll('input[data-role="dev-qty"]').forEach(inp => {
			inp.addEventListener('input', (e) => {
				const idx = parseInt(e.target.dataset.idx, 10);
				let val = parseInt(e.target.value, 10) || 0;
				const max = carrito[idx]?.maxCantidad || carrito[idx]?.cantidad || 0;
				if (val < 0) val = 0;
				if (val > max) val = max;
				carrito[idx].cantidad = val;
				actualizarTabla();
			});
		});
	}

	const cfg = window.configGeneral || {};

	// Descuento por volumen (configurado en %), convertido a monto USD
	let descuentoInputEl = document.getElementById('v_desc');
	let descuentoMontoManual = parseFloat(descuentoInputEl ? descuentoInputEl.value : 0) || 0;
	let autoDescUsd = 0;
	let totalAfterDiscount;

	if (!modoDevolucion) {
		const tiers = Array.isArray(cfg.descuentos_volumen) ? cfg.descuentos_volumen : [];
		if (tiers.length && totalUSD > 0) {
			// Calcular cantidad total de ítems en el carrito
			const totalCantidad = carrito.reduce((sum, it) => sum + (Number(it.cantidad) || 0), 0);
			let mejorTier = null;
			for (const t of tiers) {
				const min = Number(t.min_qty) || 0;
				if (totalCantidad >= min && min > 0) {
					if (!mejorTier || min > (Number(mejorTier.min_qty) || 0)) {
						mejorTier = t;
					}
				}
			}
			if (mejorTier && Number(mejorTier.descuento_pct) > 0) {
				const pct = Math.max(0, Math.min(100, Number(mejorTier.descuento_pct) || 0));
				autoDescUsd = totalUSD * (pct / 100);
				// Aviso visual cuando se aplique o cambie el tramo de volumen
				try {
					if (window.showToast) {
						window.showToast(`Descuento por volumen aplicado: ${pct.toFixed(1)}%`, 'info', 4000);
					}
				} catch {}
			}
		}

		// Lógica para no pisar un descuento manual del usuario:
		// - Si el campo está vacío/0 o coincide con el último auto, se reemplaza por el automático.
		// - Si el usuario modificó el valor, se respeta su monto.
		const prevAuto = typeof window.lastAutoDescuentoVolumen === 'number' ? window.lastAutoDescuentoVolumen : 0;
		const diffPrev = Math.abs(descuentoMontoManual - prevAuto);
		const usuarioModifico = prevAuto > 0 && diffPrev > 0.01;

		if (autoDescUsd > 0 && (!descuentoMontoManual || !usuarioModifico)) {
			descuentoMontoManual = autoDescUsd;
			if (descuentoInputEl) {
				descuentoInputEl.value = autoDescUsd.toFixed(2);
			}
			window.lastAutoDescuentoVolumen = autoDescUsd;
		} else if (!autoDescUsd) {
			// Sin tramo aplicable: si el valor actual coincide con el último
			// descuento automático, limpiar también el campo de descuento.
			if (prevAuto > 0 && !usuarioModifico && descuentoInputEl) {
				descuentoInputEl.value = '0.00';
				descuentoMontoManual = 0;
			}
			window.lastAutoDescuentoVolumen = 0;
		}

		let descuentoMonto = descuentoMontoManual;
		if (!Number.isFinite(descuentoMonto) || descuentoMonto < 0) descuentoMonto = 0;
		if (descuentoMonto > totalUSD) descuentoMonto = totalUSD;
		totalAfterDiscount = totalUSD - descuentoMonto;
	} else {
		totalAfterDiscount = totalUSD;
	}
	const sign = modoDevolucion ? -1 : 1;

	// IVA desde configuración de nota (solo para ventas, no devoluciones)
	let ivaPct = 0;
	if (!modoDevolucion && cfg.nota && cfg.nota.iva_pct !== undefined && cfg.nota.iva_pct !== null) {
		const rawIva = Number(cfg.nota.iva_pct) || 0;
		ivaPct = Math.max(0, Math.min(100, rawIva));
	}

	const baseUsd = totalAfterDiscount;
	const baseBs = baseUsd * tasa;
	let ivaBs = 0;
	let totalUsdFinal = baseUsd;
	let totalBsFinal = baseBs;
	if (ivaPct > 0 && baseUsd > 0 && !modoDevolucion) {
		ivaBs = baseBs * (ivaPct / 100);
		totalUsdFinal = baseUsd * (1 + ivaPct / 100);
		totalBsFinal = baseBs * (1 + ivaPct / 100);
	}

	const subtotalUsdEl = document.getElementById('subtotal-usd');
	const subtotalBsEl = document.getElementById('subtotal-bs');
	const totalUsdEl = document.getElementById('total-usd');
	const totalBsEl = document.getElementById('total-bs');
	const ivaRow = document.getElementById('iva-row');
	const ivaPctLabel = document.getElementById('iva-pct-label');
	const ivaBsEl = document.getElementById('total-iva-bs');

	if (subtotalUsdEl) subtotalUsdEl.innerText = (baseUsd * sign).toFixed(2);
	if (subtotalBsEl) subtotalBsEl.innerText = (baseBs * sign).toLocaleString('es-VE', { minimumFractionDigits: 2 });
	if (totalUsdEl) totalUsdEl.innerText = (totalUsdFinal * sign).toFixed(2);
	if (totalBsEl) totalBsEl.innerText = (totalBsFinal * sign).toLocaleString('es-VE', { minimumFractionDigits: 2 });
	if (ivaRow && ivaPctLabel && ivaBsEl) {
		if (ivaPct > 0 && baseUsd > 0 && !modoDevolucion) {
			ivaRow.classList.remove('hidden');
			ivaPctLabel.textContent = `${ivaPct.toFixed(0)}%`;
			ivaBsEl.textContent = (ivaBs * sign).toLocaleString('es-VE', { minimumFractionDigits: 2 });
		} else {
			ivaRow.classList.add('hidden');
			ivaPctLabel.textContent = '';
			ivaBsEl.textContent = '0.00';
		}
	}
}

export function eliminarDelCarrito(index) {
	carrito.splice(index, 1);
	actualizarTabla();
}

export function limpiarSeleccion() {
	productoSeleccionado = null;
	if (buscarInput) buscarInput.value = '';
	const qty = document.getElementById('v_cantidad');
	if (qty) qty.value = 1;
	if (buscarInput) buscarInput.focus();
}

export function setModoDevolucion(active) {
	modoDevolucion = !!active;
	const label = document.getElementById('pv-modo-label');
	const btnVenta = document.getElementById('btn-tab-venta');
	const btnDev = document.getElementById('btn-tab-devolucion');
	const panelDev = document.getElementById('panel-devolucion');
	const panelCredito = document.getElementById('panel-credito');
	const panelVentaControls = document.querySelectorAll('[data-panel-venta]');
	if (label) label.textContent = modoDevolucion ? 'Devolución' : 'Venta';
	if (btnVenta && btnDev) {
		btnVenta.classList.toggle('active-tab', !modoDevolucion);
		btnVenta.classList.toggle('text-slate-500', modoDevolucion);
		btnDev.classList.toggle('active-tab', modoDevolucion);
		btnDev.classList.toggle('text-slate-500', !modoDevolucion);
	}
	if (panelDev) panelDev.classList.toggle('hidden', !modoDevolucion);
	if (panelVentaControls && panelVentaControls.length) {
		panelVentaControls.forEach(el => {
			el.classList.toggle('hidden', modoDevolucion);
			if (!modoDevolucion && el === panelCredito) {
				el.classList.add('hidden');
			}
		});
	}
	if (btnVender) {
		btnVender.textContent = modoDevolucion ? 'Registrar devolución' : 'Registrar venta';
		btnVender.classList.toggle('bg-blue-500', !modoDevolucion);
		btnVender.classList.toggle('bg-rose-500', modoDevolucion);
	}
	if (buscarInput) buscarInput.disabled = modoDevolucion;
	const qtyInput = document.getElementById('v_cantidad');
	if (qtyInput) qtyInput.disabled = modoDevolucion;
	const btnAgregar = document.querySelector('button[onclick="agregarAlCarrito()"]');
	if (btnAgregar) btnAgregar.disabled = modoDevolucion;
	if (modoDevolucion) {
		carrito = [];
		ventaSeleccionada = null;
		if (typeof renderVentaSeleccionada === 'function') {
			renderVentaSeleccionada();
		}
	}
	actualizarTabla();
	if (window.syncCreditoUI) window.syncCreditoUI();
}

export function toggleDevolucion() {
	setModoDevolucion(!modoDevolucion);
}

// Exponer algunas funciones al scope global por compatibilidad con onclick inline
window.agregarAlCarrito = agregarAlCarrito;
window.eliminarDelCarrito = eliminarDelCarrito;
window.prepararParaAgregar = prepararParaAgregar;
window.actualizarTabla = actualizarTabla;
window.setModoDevolucion = setModoDevolucion;
window.recalcularPreciosPorNivel = recalcularPreciosPorNivel;
