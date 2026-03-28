const db = require('../db');
const { insertAlerta } = require('../routes/alertas');
// Referencias de tipos compartidos (VentaPayload, Venta)
// @ts-check

const MAX_ITEMS = 200;
const MAX_TEXT = 120;
const MAX_DOC = 40;
const MAX_REF = 120;
const MAX_METODO = 40;

function isValidDateString(val) {
    if (!val) return false;
    const d = new Date(val);
    return !Number.isNaN(d.getTime());
}

function safeStr(v, max) {
    if (v === null || v === undefined) return '';
    return String(v).trim().slice(0, max);
}

/**
 * Registra una venta en la base de datos, actualiza inventario
 * y opcionalmente crea una cuenta por cobrar cuando es a crédito.
 *
 * @param {import('../types').VentaPayload} payload
 * @returns {{ ventaId: number, cuentaCobrarId: (number|null) }}
 */
function registrarVenta(payload) {
    const {
        items,
        cliente,
        vendedor = '',
        cedula = '',
        telefono = '',
        tasa_bcv,
        descuento = 0,
        metodo_pago = '',
        referencia = '',
        usuario_id = null,
        cliente_doc = '',
        credito = false,
        dias_vencimiento = 21,
        fecha_vencimiento = null,
        iva_pct = 0,
        igtf_pct = 0,
        empresa_id = null,
    } = payload || {};

    // 1. Validaciones de entrada (antes se hacían en la ruta)
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error('El carrito está vacío o es inválido');
    }

    if (items.length > MAX_ITEMS) {
        throw new Error('Demasiados items en la venta');
    }

    const clienteSafe = safeStr(cliente, MAX_TEXT);
    if (!clienteSafe) {
        throw new Error('El nombre del cliente es obligatorio');
    }

    if (!tasa_bcv || isNaN(tasa_bcv) || tasa_bcv <= 0) {
        throw new Error('La tasa de cambio es inválida o no fue enviada');
    }

    if (descuento !== undefined && descuento !== null && typeof descuento !== 'number' && typeof descuento !== 'string') {
        throw new Error('Descuento inválido');
    }

    // El descuento ahora se interpreta como monto fijo en USD
    const descuentoMontoUsd = Math.max(0, parseFloat(descuento) || 0);

    const metodoPagoFinal = credito ? (metodo_pago || 'CREDITO') : metodo_pago;

    if (!metodoPagoFinal || metodoPagoFinal.toString().trim() === '') {
        throw new Error('El método de pago es obligatorio');
    }

    const vendedorSafe = safeStr(vendedor, MAX_TEXT);
    const cedulaSafe = safeStr(cedula, MAX_DOC);
    const telefonoSafe = safeStr(telefono, MAX_DOC);
    const referenciaSafe = safeStr(referencia, MAX_REF);
    const metodoSafe = safeStr(metodoPagoFinal, MAX_METODO);
    const clienteDocSafe = safeStr(cliente_doc, MAX_DOC);

    const ivaPctNum = Math.max(0, Math.min(100, parseFloat(iva_pct) || 0));
    const igtfPctNum = Math.max(0, Math.min(100, parseFloat(igtf_pct) || 0));

    if (dias_vencimiento !== null && dias_vencimiento !== undefined) {
        const dias = parseInt(dias_vencimiento, 10);
        if (Number.isNaN(dias) || dias < 1 || dias > 365) {
            throw new Error('Días de vencimiento inválidos');
        }
    }

    if (fecha_vencimiento && !isValidDateString(fecha_vencimiento)) {
        throw new Error('Fecha de vencimiento inválida');
    }

    for (const item of items) {
        const codigo = safeStr(item.codigo, 64);
        const cantidad = parseInt(item.cantidad, 10);
        if (!codigo || Number.isNaN(cantidad) || cantidad <= 0 || cantidad > 100000) {
            throw new Error('Item inválido en la venta');
        }
    }

    if (!empresa_id) {
        throw new Error('empresa_id es requerido para registrar la venta');
    }

    const fecha = new Date().toISOString();
    let totalGeneralBs = 0;
    let totalGeneralUsd = 0;

    // 2. Transacción para asegurar integridad (Todo o nada)
    const empresaId = empresa_id;

    const transaction = db.transaction(() => {
        // Crear la cabecera de la venta con total 0 inicialmente, guardando descuento y metodo_pago
        const ventaResult = db.prepare(`
                INSERT INTO ventas (fecha, cliente, vendedor, cedula, telefono, tasa_bcv, descuento, metodo_pago, referencia, total_bs, iva_pct, igtf_pct, total_bs_iva, total_usd_iva, usuario_id, comision_pct, comision_bs, comision_usd)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, 0, 0, 0)
            `).run(fecha, clienteSafe, vendedorSafe, cedulaSafe, telefonoSafe, tasa_bcv, descuentoMontoUsd, metodoSafe, referenciaSafe, usuario_id);

        const ventaId = ventaResult.lastInsertRowid;

        const selectProducto = db.prepare('SELECT id, stock, precio_usd, costo_usd, descripcion, deposito_id, empresa_id FROM productos WHERE codigo = ? AND empresa_id = ?');
        const selectStockTotal = db.prepare(`
            SELECT SUM(cantidad) AS total
            FROM stock_por_deposito
            WHERE producto_id = ?
        `);
        const selectStockDep = db.prepare(`
            SELECT cantidad FROM stock_por_deposito
            WHERE producto_id = ? AND deposito_id = ?
        `);
        const updateStockDepSub = db.prepare(`
            UPDATE stock_por_deposito
            SET cantidad = cantidad - ?, actualizado_en = datetime('now')
            WHERE producto_id = ? AND deposito_id = ?
        `);
        const updateProdStock = db.prepare(`
            UPDATE productos SET stock = ? WHERE id = ?
        `);

        for (const item of items) {
            // Buscar producto real en DB por CÓDIGO dentro de la empresa de la venta
            const producto = selectProducto.get(item.codigo, empresaId);

            if (!producto) {
                throw new Error(`El producto con código ${item.codigo} no existe en la base de datos`);
            }

            // Calcular stock total real preferentemente desde stock_por_deposito.
            // Si no hay filas allí, caer al campo productos.stock para compatibilidad.
            const rowTotal = selectStockTotal.get(producto.id);
            const stockTotal = rowTotal && rowTotal.total != null
                ? Number(rowTotal.total || 0)
                : (Number(producto.stock || 0) || 0);

            if (stockTotal < item.cantidad) {
                throw new Error(`Stock insuficiente para el producto: ${item.codigo}`);
            }

            // Permitir que cada item indique explícitamente el depósito origen de la venta.
            // Si no viene en el payload (clientes viejos/offline), se usa el deposito_id del producto
            // como antes para mantener compatibilidad.
            const itemDepositoId = item.deposito_id != null ? Number(item.deposito_id) : null;
            const depositoVentaId = itemDepositoId || producto.deposito_id;
            if (!depositoVentaId) {
                throw new Error(`El producto ${item.codigo} no tiene depósito asignado para la venta`);
            }

            const stockDepRow = selectStockDep.get(producto.id, depositoVentaId);
            const stockEnDeposito = stockDepRow ? Number(stockDepRow.cantidad || 0) : 0;
            if (stockEnDeposito < item.cantidad) {
                throw new Error(`Stock insuficiente en el depósito asignado para el producto: ${item.codigo}`);
            }

            // Usar el precio unitario enviado por el POS (ya con nivel aplicado)
            // y caer al precio base del producto si no viene en el payload
            let precioUnitUsd = Number(item.precio_usd);
            if (!Number.isFinite(precioUnitUsd) || precioUnitUsd <= 0) {
                precioUnitUsd = Number(producto.precio_usd || 0) || 0;
            }

            const subtotalUsd = precioUnitUsd * item.cantidad;
            const subtotalBs = subtotalUsd * tasa_bcv;
            totalGeneralUsd += subtotalUsd;
            totalGeneralBs += subtotalBs;

            // Insertar cada item en el detalle con el precio realmente vendido
            db.prepare(`
                    INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs, deposito_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(ventaId, producto.id, item.cantidad, precioUnitUsd, producto.costo_usd || 0, subtotalBs, depositoVentaId);

            // Descontar del inventario por depósito y en total, y verificar stock crítico.
            // Usamos el stock total calculado para evitar inconsistencias con productos.stock.
            const nuevoStock = stockTotal - item.cantidad;
            updateProdStock.run(nuevoStock, producto.id);

            updateStockDepSub.run(item.cantidad, producto.id, depositoVentaId);
            if (nuevoStock <= 0) {
                insertAlerta('stock', `Stock agotado: ${item.codigo}`, { codigo: item.codigo, descripcion: producto.descripcion || '' });
            }
        }

        // Aplicar descuento como monto fijo en USD al total acumulado
        const maxDescUsd = Math.max(0, totalGeneralUsd);
        const aplicadoUsd = Math.min(descuentoMontoUsd, maxDescUsd);
        const descBs = aplicadoUsd * tasa_bcv;
                const totalConDescuentoBs = totalGeneralBs - descBs;
                const totalConDescuentoUsd = totalGeneralUsd - aplicadoUsd;

                const factorImpuestos = 1 + (ivaPctNum / 100) + (igtfPctNum / 100);
                const totalBsIva = totalConDescuentoBs * factorImpuestos;
                const totalUsdIva = totalConDescuentoUsd * factorImpuestos;

                // Calcular comisión del vendedor (si hay usuario_id asociado)
                let comisionPct = 0;
                let comisionBs = 0;
                let comisionUsd = 0;
                if (usuario_id) {
                    const row = db.prepare('SELECT comision_pct FROM usuarios WHERE id = ?').get(usuario_id);
                    if (row && row.comision_pct != null) {
                        comisionPct = Math.max(0, Math.min(100, Number(row.comision_pct) || 0));
                        const factor = comisionPct / 100;
                        // Usar totales con descuento pero sin IVA como base de comisión
                        comisionBs = totalConDescuentoBs * factor;
                        comisionUsd = totalConDescuentoUsd * factor;
                    }
                }

                // Actualizar el total final sumado en la cabecera, incluyendo impuestos y campos de comisión
                db.prepare('UPDATE ventas SET total_bs = ?, iva_pct = ?, igtf_pct = ?, total_bs_iva = ?, total_usd_iva = ?, comision_pct = ?, comision_bs = ?, comision_usd = ? WHERE id = ?')
                    .run(totalConDescuentoBs, ivaPctNum, igtfPctNum, totalBsIva, totalUsdIva, comisionPct, comisionBs, comisionUsd, ventaId);

        // Si la venta es a crédito, registrar cuenta por cobrar enlazada
        let cuentaCobrarId = null;
        if (credito) {
            const dias = Number.isFinite(Number(dias_vencimiento)) ? Number(dias_vencimiento) : 21;
            const fvDate = fecha_vencimiento ? new Date(fecha_vencimiento) : new Date(new Date(fecha).getTime() + dias * 24 * 3600 * 1000);
            const fvISO = fvDate.toISOString().slice(0, 10);
            const stmt = db.prepare(`
                    INSERT INTO cuentas_cobrar (cliente_nombre, cliente_doc, venta_id, total_usd, tasa_bcv, saldo_usd, fecha_emision, fecha_vencimiento, estado, notas, creado_en, actualizado_en)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, datetime('now'), datetime('now'))
                `);
            const info = stmt.run(clienteSafe, clienteDocSafe || cedulaSafe || '', ventaId, totalUsdIva, tasa_bcv, totalUsdIva, fecha, fvISO, 'Venta a crédito');
            cuentaCobrarId = info.lastInsertRowid;
        }

        return { ventaId, cuentaCobrarId };
    });

    return transaction();
}

/**
 * Anula una venta existente, revirtiendo sus efectos sobre inventario
 * y eliminando cualquier cuenta por cobrar/pagos asociados.
 *
 * No permite anular ventas que ya tengan devoluciones registradas.
 *
 * @param {{ventaId:number,empresaId:number|null}} params
 * @returns {{ok:true}}
 */
function anularVenta(params) {
    const ventaId = Number(params && params.ventaId);
    const empresaId = params && params.empresaId != null ? Number(params.empresaId) : null;

    if (!Number.isFinite(ventaId) || ventaId <= 0) {
        throw new Error('ID de venta inválido');
    }
    if (!empresaId || !Number.isFinite(empresaId) || empresaId <= 0) {
        throw new Error('Empresa del usuario no definida');
    }

    const venta = db.prepare(`
        SELECT v.id, v.fecha, v.total_bs, v.tasa_bcv, v.usuario_id, u.empresa_id AS empresa_id
        FROM ventas v
        LEFT JOIN usuarios u ON u.id = v.usuario_id
        WHERE v.id = ?
    `).get(ventaId);

    if (!venta) {
        throw new Error('Venta no encontrada');
    }

    if (venta.empresa_id != null && Number(venta.empresa_id) !== empresaId) {
        throw new Error('No puedes anular ventas de otra empresa');
    }

    const devRow = db.prepare('SELECT COUNT(*) AS c FROM devoluciones WHERE venta_original_id = ?').get(ventaId);
    if (devRow && Number(devRow.c || 0) > 0) {
        const err = new Error('No se puede anular una venta que ya tiene devoluciones registradas');
        err.code = 'VENTA_CON_DEVOLUCIONES';
        throw err;
    }

     const detalles = db.prepare(`
     SELECT vd.id, vd.producto_id, vd.cantidad,
         p.stock AS stock_actual,
         COALESCE(vd.deposito_id, p.deposito_id) AS deposito_id,
         p.empresa_id AS prod_empresa_id
     FROM venta_detalle vd
     JOIN productos p ON p.id = vd.producto_id
     WHERE vd.venta_id = ?
    `).all(ventaId);

    const selectStockDep = db.prepare(`
        SELECT cantidad FROM stock_por_deposito
        WHERE producto_id = ? AND deposito_id = ?
    `);
    const updateStockDepSuma = db.prepare(`
        UPDATE stock_por_deposito
        SET cantidad = cantidad + ?, actualizado_en = datetime('now')
        WHERE producto_id = ? AND deposito_id = ?
    `);
    const insertStockDep = db.prepare(`
        INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad)
        VALUES (?, ?, ?, ?)
    `);
    const updateProdStock = db.prepare('UPDATE productos SET stock = ? WHERE id = ?');

    const deletePagosByCuenta = db.prepare('DELETE FROM pagos_cc WHERE cuenta_id = ?');
    const selectCuentas = db.prepare('SELECT id FROM cuentas_cobrar WHERE venta_id = ?');
    const deleteCuenta = db.prepare('DELETE FROM cuentas_cobrar WHERE id = ?');

    const tx = db.transaction(() => {
        // Revertir inventario: sumar nuevamente las cantidades vendidas
        for (const det of detalles) {
            const cantidad = Number(det.cantidad || 0) || 0;
            if (!cantidad) continue;

            const nuevoStock = Number(det.stock_actual || 0) + cantidad;
            updateProdStock.run(nuevoStock, det.producto_id);

            const depId = det.deposito_id;
            if (depId) {
                const rowDep = selectStockDep.get(det.producto_id, depId);
                if (rowDep) {
                    updateStockDepSuma.run(cantidad, det.producto_id, depId);
                } else {
                    insertStockDep.run(det.prod_empresa_id || empresaId || null, det.producto_id, depId, cantidad);
                }
            }
        }

        // Eliminar cuentas por cobrar y pagos asociados a esta venta (si existen)
        const cuentas = selectCuentas.all(ventaId) || [];
        for (const c of cuentas) {
            deletePagosByCuenta.run(c.id);
            deleteCuenta.run(c.id);
        }

        // Eliminar detalle de venta y cabecera
        db.prepare('DELETE FROM venta_detalle WHERE venta_id = ?').run(ventaId);
        db.prepare('DELETE FROM ventas WHERE id = ?').run(ventaId);

        return { ok: true };
    });

    return tx();
}

/**
 * Cambia el usuario/vendedor asociado a una venta, asegurando que
 * tanto la venta como el nuevo vendedor pertenezcan a la misma empresa.
 * Recalcula los campos de comisión en base al total de la venta.
 *
 * @param {{ventaId:number,nuevoUsuarioId:number,empresaId:number|null}} params
 */
function cambiarVendedorVenta(params) {
    const ventaId = Number(params && params.ventaId);
    const nuevoUsuarioId = Number(params && params.nuevoUsuarioId);
    const empresaId = params && params.empresaId != null ? Number(params.empresaId) : null;

    if (!Number.isFinite(ventaId) || ventaId <= 0) {
        throw new Error('ID de venta inválido');
    }
    if (!Number.isFinite(nuevoUsuarioId) || nuevoUsuarioId <= 0) {
        throw new Error('ID de vendedor inválido');
    }
    if (!empresaId || !Number.isFinite(empresaId) || empresaId <= 0) {
        throw new Error('Empresa del usuario no definida');
    }

    const venta = db.prepare(`
        SELECT v.id, v.usuario_id, v.vendedor, v.total_bs, v.tasa_bcv, u.empresa_id AS empresa_id
        FROM ventas v
        LEFT JOIN usuarios u ON u.id = v.usuario_id
        WHERE v.id = ?
    `).get(ventaId);

    if (!venta) {
        throw new Error('Venta no encontrada');
    }

    if (venta.empresa_id != null && Number(venta.empresa_id) !== empresaId) {
        throw new Error('No puedes modificar ventas de otra empresa');
    }

    const nuevoUsuario = db.prepare(`
        SELECT id, username, nombre_completo, rol, empresa_id, comision_pct, activo
        FROM usuarios
        WHERE id = ?
    `).get(nuevoUsuarioId);

    if (!nuevoUsuario) {
        throw new Error('Vendedor destino no encontrado');
    }

    if (!nuevoUsuario.activo) {
        throw new Error('El usuario seleccionado está inactivo');
    }

    if (Number(nuevoUsuario.empresa_id) !== empresaId) {
        throw new Error('El vendedor seleccionado pertenece a otra empresa');
    }

    if (!['admin', 'admin_empresa', 'vendedor'].includes(nuevoUsuario.rol)) {
        throw new Error('Solo usuarios con rol administrador o vendedor pueden ser asignados a una venta');
    }

    const nombreVendedor = (nuevoUsuario.nombre_completo || nuevoUsuario.username || '').toString().trim() || nuevoUsuario.username || '';

    const totalBs = Number(venta.total_bs || 0) || 0;
    const tasa = Number(venta.tasa_bcv || 0) || 0;
    const totalUsdBase = tasa > 0 ? (totalBs / tasa) : totalBs;

    const comisionPct = Math.max(0, Math.min(100, Number(nuevoUsuario.comision_pct || 0) || 0));
    const factor = comisionPct / 100;
    const comisionBs = totalBs * factor;
    const comisionUsd = totalUsdBase * factor;

    const tx = db.transaction(() => {
        db.prepare(`
            UPDATE ventas
            SET usuario_id = ?, vendedor = ?, comision_pct = ?, comision_bs = ?, comision_usd = ?
            WHERE id = ?
        `).run(nuevoUsuario.id, nombreVendedor, comisionPct, comisionBs, comisionUsd, ventaId);

        return db.prepare(`
            SELECT id, fecha, cliente, vendedor, usuario_id, total_bs, tasa_bcv, comision_pct, comision_bs, comision_usd
            FROM ventas
            WHERE id = ?
        `).get(ventaId);
    });

    return tx();
}

module.exports = {
    registrarVenta,
    anularVenta,
    cambiarVendedorVenta,
};
