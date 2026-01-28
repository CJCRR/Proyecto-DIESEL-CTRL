const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');
const { insertAlerta } = require('./alertas');

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

router.post('/', requireAuth, (req, res) => {
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
    } = req.body;


    // 1. Validaciones de estructura estrictas
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío o es inválido' });
    }

    if (items.length > MAX_ITEMS) {
        return res.status(400).json({ error: 'Demasiados items en la venta' });
    }
    
    const clienteSafe = safeStr(cliente, MAX_TEXT);
    if (!clienteSafe) {
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
    }

    if (!tasa_bcv || isNaN(tasa_bcv) || tasa_bcv <= 0) {
        return res.status(400).json({ error: 'La tasa de cambio es inválida o no fue enviada' });
    }

    if (typeof descuento !== 'number' && typeof descuento !== 'string') {
        return res.status(400).json({ error: 'Descuento inválido' });
    }

    const descuentoNum = Math.max(0, Math.min(100, parseFloat(descuento) || 0));

    const metodoPagoFinal = credito ? (metodo_pago || 'CREDITO') : metodo_pago;

    if (!metodoPagoFinal || metodoPagoFinal.toString().trim() === '') {
        return res.status(400).json({ error: 'El método de pago es obligatorio' });
    }

    const vendedorSafe = safeStr(vendedor, MAX_TEXT);
    const cedulaSafe = safeStr(cedula, MAX_DOC);
    const telefonoSafe = safeStr(telefono, MAX_DOC);
    const referenciaSafe = safeStr(referencia, MAX_REF);
    const metodoSafe = safeStr(metodoPagoFinal, MAX_METODO);
    const clienteDocSafe = safeStr(cliente_doc, MAX_DOC);

    if (dias_vencimiento !== null && dias_vencimiento !== undefined) {
        const dias = parseInt(dias_vencimiento, 10);
        if (Number.isNaN(dias) || dias < 1 || dias > 365) {
            return res.status(400).json({ error: 'Días de vencimiento inválidos' });
        }
    }

    if (fecha_vencimiento && !isValidDateString(fecha_vencimiento)) {
        return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
    }

    for (const item of items) {
        const codigo = safeStr(item.codigo, 64);
        const cantidad = parseInt(item.cantidad, 10);
        if (!codigo || Number.isNaN(cantidad) || cantidad <= 0 || cantidad > 100000) {
            return res.status(400).json({ error: 'Item inválido en la venta' });
        }
    }

    try {
        const fecha = new Date().toISOString();
        let totalGeneralBs = 0;
        let totalGeneralUsd = 0;

        // 2. Transacción para asegurar integridad (Todo o nada)
        const transaction = db.transaction(() => {
            // Crear la cabecera de la venta con total 0 inicialmente, guardando descuento y metodo_pago
            const ventaResult = db.prepare(`
                INSERT INTO ventas (fecha, cliente, vendedor, cedula, telefono, tasa_bcv, descuento, metodo_pago, referencia, total_bs, usuario_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            `).run(fecha, clienteSafe, vendedorSafe, cedulaSafe, telefonoSafe, tasa_bcv, descuentoNum, metodoSafe, referenciaSafe, usuario_id);

            const ventaId = ventaResult.lastInsertRowid;

            for (const item of items) {
                // Buscar producto real en DB por CÓDIGO
                const producto = db.prepare('SELECT id, stock, precio_usd, costo_usd FROM productos WHERE codigo = ?').get(item.codigo);
                
                if (!producto) {
                    throw new Error(`El producto con código ${item.codigo} no existe en la base de datos`);
                }
                
                if (producto.stock < item.cantidad) {
                    throw new Error(`Stock insuficiente para el producto: ${item.codigo}`);
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

                // Descontar del inventario y verificar stock crítico
                const nuevoStock = producto.stock - item.cantidad;
                db.prepare(`
                    UPDATE productos SET stock = ? WHERE id = ?
                `).run(nuevoStock, producto.id);
                if (nuevoStock <= 0) {
                    insertAlerta('stock', `Stock agotado: ${item.codigo}`, { codigo: item.codigo, descripcion: producto.descripcion || '' });
                }
            }

            // Aplicar descuento (porcentaje) al total acumulado
            const multiplicador = 1 - Math.max(0, Math.min(100, descuentoNum)) / 100;
            const totalConDescuentoBs = totalGeneralBs * multiplicador;
            const totalConDescuentoUsd = totalGeneralUsd * multiplicador;

            // Actualizar el total final sumado en la cabecera
            db.prepare('UPDATE ventas SET total_bs = ? WHERE id = ?').run(totalConDescuentoBs, ventaId);

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
                const info = stmt.run(clienteSafe, clienteDocSafe || cedulaSafe || '', ventaId, totalConDescuentoUsd, tasa_bcv, totalConDescuentoUsd, fecha, fvISO, 'Venta a crédito');
                cuentaCobrarId = info.lastInsertRowid;
            }

            return { ventaId, cuentaCobrarId };
        });

        const { ventaId, cuentaCobrarId } = transaction();
        res.json({ message: 'Venta registrada con éxito', ventaId, cuentaCobrarId });

    } catch (error) {
        // Si algo falla dentro del loop (stock, producto inexistente), se revierte todo
        console.error("Error procesando la venta:", error.message);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;