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

function redondearA0o5(valor) {
	const n = Number(valor) || 0;
	const signo = n < 0 ? -1 : 1;
	// Trabajamos sobre el entero más cercano
	let abs = Math.round(Math.abs(n));
	const unidad = abs % 10;
	const baseDecena = abs - unidad;
	let resultado;

	// Regla:
	// 0-1  -> 0
	// 2-4  -> 5
	// 5-6  -> 5
	// 7-9  -> 10
	if (unidad <= 1) {
		resultado = baseDecena;
	} else if (unidad <= 6) {
		resultado = baseDecena + 5;
	} else {
		resultado = baseDecena + 10;
	}

	return resultado * signo;
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
	if (cantidad > productoSeleccionado.stock) {
		showToast('Advertencia: la cantidad excede el stock físico. Úsalo solo para presupuestos o pedidos.', 'warning');
	}

	const index = carrito.findIndex(item => item.codigo === productoSeleccionado.codigo);

	// Determinar el precio de venta segun la estrategia de precios configurada
	let precioBase = Number(productoSeleccionado.precio_usd || 0) || 0;
	let precioVenta = precioBase;
	try {
		const niveles = Array.isArray(window.priceLevelsConfig) ? window.priceLevelsConfig : [];
		const nivelActual = window.currentPriceLevelKey || 'base';
		const roundThreshold = Number(window.priceLevelRoundThreshold || 0) || 0;
		if (nivelActual !== 'base') {
			const lvl = niveles.find(l => l.key === nivelActual);
			if (lvl && typeof lvl.pct === 'number' && !Number.isNaN(lvl.pct)) {
				precioVenta = precioBase * (1 + (lvl.pct / 100));
			}
		}
		// Aplicar redondeo solo para niveles distintos de base cuando esté activo
		// y el precio base del producto sea mayor o igual al umbral configurado
		if (nivelActual !== 'base' && window.priceLevelRoundTo0or5 && (!roundThreshold || precioBase >= roundThreshold)) {
			precioVenta = redondearA0o5(precioVenta);
		}
	} catch {}

	if (index >= 0) {
		// Si el producto ya está en el carrito, aumentar cantidad
		if ((carrito[index].cantidad + cantidad) > productoSeleccionado.stock) {
			showToast('Advertencia: la cantidad total supera el stock físico. Úsalo solo para presupuestos o pedidos.', 'warning');
		}
		carrito[index].cantidad += cantidad;
	} else {
		carrito.push({
			codigo: productoSeleccionado.codigo,
			descripcion: productoSeleccionado.descripcion,
			marca: productoSeleccionado.marca || '',
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
		var roundThreshold = Number(window.priceLevelRoundThreshold || 0) || 0;
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
		if (nivelActual !== 'base' && window.priceLevelRoundTo0or5 && (!roundThreshold || base >= roundThreshold)) {
			precioVenta = redondearA0o5(precioVenta);
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
				<button onclick="eliminarDelCarrito(${index})" class="btn-trash" title="Quitar del carrito">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
						<path fill="currentColor" d="M8.78842 5.03866C8.86656 4.96052 8.97254 4.91663 9.08305 4.91663H11.4164C11.5269 4.91663 11.6329 4.96052 11.711 5.03866C11.7892 5.11681 11.833 5.22279 11.833 5.33329V5.74939H8.66638V5.33329C8.66638 5.22279 8.71028 5.11681 8.78842 5.03866ZM7.16638 5.74939V5.33329C7.16638 4.82496 7.36832 4.33745 7.72776 3.978C8.08721 3.61856 8.57472 3.41663 9.08305 3.41663H11.4164C11.9247 3.41663 12.4122 3.61856 12.7717 3.978C13.1311 4.33745 13.333 4.82496 13.333 5.33329V5.74939H15.5C15.9142 5.74939 16.25 6.08518 16.25 6.49939C16.25 6.9136 15.9142 7.24939 15.5 7.24939H15.0105L14.2492 14.7095C14.2382 15.2023 14.0377 15.6726 13.6883 16.0219C13.3289 16.3814 12.8414 16.5833 12.333 16.5833H8.16638C7.65805 16.5833 7.17054 16.3814 6.81109 16.0219C6.46176 15.6726 6.2612 15.2023 6.25019 14.7095L5.48896 7.24939H5C4.58579 7.24939 4.25 6.9136 4.25 6.49939C4.25 6.08518 4.58579 5.74939 5 5.74939H6.16667H7.16638ZM7.91638 7.24996H12.583H13.5026L12.7536 14.5905C12.751 14.6158 12.7497 14.6412 12.7497 14.6666C12.7497 14.7771 12.7058 14.8831 12.6277 14.9613C12.5495 15.0394 12.4436 15.0833 12.333 15.0833H8.16638C8.05588 15.0833 7.94989 15.0394 7.87175 14.9613C7.79361 14.8831 7.74972 14.7771 7.74972 14.6666C7.74972 14.6412 7.74842 14.6158 7.74584 14.5905L6.99681 7.24996H7.91638Z" clip-rule="evenodd" fill-rule="evenodd"></path>
					</svg>
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

	// IVA e IGTF desde configuración de nota (solo para ventas, no devoluciones)
	let ivaPct = 0;
	let igtfPct = 0;
	if (!modoDevolucion && cfg.nota) {
		let ivaCfg = 0;
		let igtfCfg = 0;
		if (cfg.nota.iva_pct !== undefined && cfg.nota.iva_pct !== null) {
			const rawIva = Number(cfg.nota.iva_pct) || 0;
			ivaCfg = Math.max(0, Math.min(100, rawIva));
		}
		if (cfg.nota.igtf_pct !== undefined && cfg.nota.igtf_pct !== null) {
			const rawIgtf = Number(cfg.nota.igtf_pct) || 0;
			igtfCfg = Math.max(0, Math.min(100, rawIgtf));
		}

		const ivaToggle = document.getElementById('pv_iva_toggle');
		const igtfToggle = document.getElementById('pv_igtf_toggle');
		const useIva = !ivaToggle || ivaToggle.checked;
		const useIgtf = !igtfToggle || igtfToggle.checked;

		if (useIva && ivaCfg > 0) ivaPct = ivaCfg;
		if (useIgtf && igtfCfg > 0) igtfPct = igtfCfg;
	}

	const baseUsd = totalAfterDiscount;
	const baseBs = baseUsd * tasa;
	let ivaBs = 0;
	let igtfBs = 0;
	let totalUsdFinal = baseUsd;
	let totalBsFinal = baseBs;
	if (baseUsd > 0 && !modoDevolucion) {
		if (ivaPct > 0) {
			ivaBs = baseBs * (ivaPct / 100);
			totalUsdFinal *= (1 + ivaPct / 100);
			totalBsFinal *= (1 + ivaPct / 100);
		}
		if (igtfPct > 0) {
			igtfBs = baseBs * (igtfPct / 100);
			totalUsdFinal *= (1 + igtfPct / 100);
			totalBsFinal *= (1 + igtfPct / 100);
		}
	}

	const subtotalUsdEl = document.getElementById('subtotal-usd');
	const subtotalBsEl = document.getElementById('subtotal-bs');
	const totalUsdEl = document.getElementById('total-usd');
	const totalBsEl = document.getElementById('total-bs');
	const ivaRow = document.getElementById('iva-row');
	const ivaPctLabel = document.getElementById('iva-pct-label');
	const ivaBsEl = document.getElementById('total-iva-bs');
	const igtfRow = document.getElementById('igtf-row');
	const igtfPctLabel = document.getElementById('igtf-pct-label');
	const igtfBsEl = document.getElementById('total-igtf-bs');

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
	if (igtfRow && igtfPctLabel && igtfBsEl) {
		if (igtfPct > 0 && baseUsd > 0 && !modoDevolucion) {
			igtfRow.classList.remove('hidden');
			igtfPctLabel.textContent = `${igtfPct.toFixed(0)}%`;
			igtfBsEl.textContent = (igtfBs * sign).toLocaleString('es-VE', { minimumFractionDigits: 2 });
		} else {
			igtfRow.classList.add('hidden');
			igtfPctLabel.textContent = '';
			igtfBsEl.textContent = '0.00';
		}
	}
}

export function eliminarDelCarrito(index) {
	carrito.splice(index, 1);
	actualizarTabla();
}

export function vaciarCarritoYForm() {
	// Vaciar carrito y actualizar totales
	carrito = [];
	actualizarTabla();
	limpiarSeleccion();

	// Limpiar campos del formulario de la derecha
	const limpiarValor = (id, value = '') => {
		const el = document.getElementById(id);
		if (el) el.value = value;
	};

	limpiarValor('v_cliente');
	limpiarValor('v_cedula');
	limpiarValor('v_telefono');
	limpiarValor('v_ref');
	limpiarValor('v_desc', '0.00');

	// Reset de sugerencias de clientes
	const sugClientes = document.getElementById('v_sugerencias_clientes');
	if (sugClientes) {
		sugClientes.innerHTML = '';
		sugClientes.classList.add('hidden');
	}

	// Reset método de pago al valor por defecto si existe
	const metodo = document.getElementById('v_metodo');
	if (metodo) {
		metodo.value = 'efectivo_$';
	}

	// Reset vendedor (primer opción si existe)
	const vendedor = document.getElementById('v_vendedor');
	if (vendedor && vendedor.options.length) {
		vendedor.selectedIndex = 0;
	}

	// Reset descuento automático por volumen
	if (typeof window !== 'undefined') {
		window.lastAutoDescuentoVolumen = 0;
	}

	// Sincronizar panel de crédito si hay lógica adicional
	if (window.syncCreditoUI) {
		try {
			window.syncCreditoUI();
		} catch {}
	}
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
	const tabGroup = document.querySelector('.pos-tab-group');
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
	if (tabGroup) {
		tabGroup.classList.toggle('pos-tab-group--dev', modoDevolucion);
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

	// Animación suave de entrada para el panel que se muestra
	const panelsToAnimate = [];
	if (modoDevolucion && panelDev && !panelDev.classList.contains('hidden')) {
		panelsToAnimate.push(panelDev);
	}
	if (!modoDevolucion && panelVentaControls && panelVentaControls.length) {
		panelVentaControls.forEach(el => {
			if (!el.classList.contains('hidden')) panelsToAnimate.push(el);
		});
	}
	panelsToAnimate.forEach(el => {
		el.classList.remove('tab-panel-animate');
		// forzar reflow para reiniciar la animación
		void el.offsetWidth;
		el.classList.add('tab-panel-animate');
	});
	if (btnVender) {
		const label = btnVender.querySelector('.cssbtn-label');
		if (label) {
			label.textContent = modoDevolucion ? 'Registrar devolución' : 'Registrar venta';
		} else {
			btnVender.textContent = modoDevolucion ? 'Registrar devolución' : 'Registrar venta';
		}
		btnVender.classList.toggle('cssbuttons-io-button--dev', modoDevolucion);
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
window.vaciarCarritoYForm = vaciarCarritoYForm;
