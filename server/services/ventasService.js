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

    if (typeof descuento !== 'number' && typeof descuento !== 'string') {
        throw new Error('Descuento inválido');
    }

    const descuentoNum = Math.max(0, Math.min(100, parseFloat(descuento) || 0));

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

    const fecha = new Date().toISOString();
    let totalGeneralBs = 0;
    let totalGeneralUsd = 0;

    // 2. Transacción para asegurar integridad (Todo o nada)
    const transaction = db.transaction(() => {
        // Crear la cabecera de la venta con total 0 inicialmente, guardando descuento y metodo_pago
        const ventaResult = db.prepare(`
                INSERT INTO ventas (fecha, cliente, vendedor, cedula, telefono, tasa_bcv, descuento, metodo_pago, referencia, total_bs, iva_pct, total_bs_iva, total_usd_iva, usuario_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
            `).run(fecha, clienteSafe, vendedorSafe, cedulaSafe, telefonoSafe, tasa_bcv, descuentoNum, metodoSafe, referenciaSafe, usuario_id);

        const ventaId = ventaResult.lastInsertRowid;

        const selectProducto = db.prepare('SELECT id, stock, precio_usd, costo_usd, descripcion, deposito_id, empresa_id FROM productos WHERE codigo = ?');
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
            // Buscar producto real en DB por CÓDIGO
            const producto = selectProducto.get(item.codigo);

            if (!producto) {
                throw new Error(`El producto con código ${item.codigo} no existe en la base de datos`);
            }

            if (producto.stock < item.cantidad) {
                throw new Error(`Stock insuficiente para el producto: ${item.codigo}`);
            }

            const depositoVentaId = producto.deposito_id;
            if (!depositoVentaId) {
                throw new Error(`El producto ${item.codigo} no tiene depósito asignado para la venta`);
            }

            const stockDepRow = selectStockDep.get(producto.id, depositoVentaId);
            const stockEnDeposito = stockDepRow ? Number(stockDepRow.cantidad || 0) : 0;
            if (stockEnDeposito < item.cantidad) {
                throw new Error(`Stock insuficiente en el depósito asignado para el producto: ${item.codigo}`);
            }

            const subtotalUsd = producto.precio_usd * item.cantidad;
            const subtotalBs = subtotalUsd * tasa_bcv;
            totalGeneralUsd += subtotalUsd;
            totalGeneralBs += subtotalBs;

            // Insertar cada item en el detalle
            db.prepare(`
                    INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(ventaId, producto.id, item.cantidad, producto.precio_usd, producto.costo_usd || 0, subtotalBs);

            // Descontar del inventario por depósito y en total, y verificar stock crítico
            const nuevoStock = producto.stock - item.cantidad;
            updateProdStock.run(nuevoStock, producto.id);

            updateStockDepSub.run(item.cantidad, producto.id, depositoVentaId);
            if (nuevoStock <= 0) {
                insertAlerta('stock', `Stock agotado: ${item.codigo}`, { codigo: item.codigo, descripcion: producto.descripcion || '' });
            }
        }

        // Aplicar descuento (porcentaje) al total acumulado
        const multiplicador = 1 - Math.max(0, Math.min(100, descuentoNum)) / 100;
                const totalConDescuentoBs = totalGeneralBs * multiplicador;
                const totalConDescuentoUsd = totalGeneralUsd * multiplicador;

                const factorIva = 1 + ivaPctNum / 100;
                const totalBsIva = totalConDescuentoBs * factorIva;
                const totalUsdIva = totalConDescuentoUsd * factorIva;

                // Actualizar el total final sumado en la cabecera, incluyendo IVA
                db.prepare('UPDATE ventas SET total_bs = ?, iva_pct = ?, total_bs_iva = ?, total_usd_iva = ? WHERE id = ?')
                    .run(totalConDescuentoBs, ivaPctNum, totalBsIva, totalUsdIva, ventaId);

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

module.exports = {
    registrarVenta,
};
