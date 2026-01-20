const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', (req, res) => {
    const { items, cliente, cedula = '', telefono = '', tasa_bcv, descuento = 0, metodo_pago = '', referencia = '' } = req.body;

    // LOG DE DEPURACIÓN: Para ver qué llega al servidor
    console.log("Datos recibidos en /ventas:", { items, cliente, cedula, telefono, tasa_bcv, descuento, metodo_pago, referencia });

    // 1. Validaciones de estructura estrictas
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío o es inválido' });
    }
    
    if (!cliente || cliente.trim() === "") {
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
    }

    if (!tasa_bcv || isNaN(tasa_bcv) || tasa_bcv <= 0) {
        return res.status(400).json({ error: 'La tasa de cambio es inválida o no fue enviada' });
    }

    if (typeof descuento !== 'number' && typeof descuento !== 'string') {
        return res.status(400).json({ error: 'Descuento inválido' });
    }

    const descuentoNum = parseFloat(descuento) || 0;

    if (!metodo_pago || metodo_pago.toString().trim() === '') {
        return res.status(400).json({ error: 'El método de pago es obligatorio' });
    }

    try {
        const fecha = new Date().toISOString();
        let totalGeneralBs = 0;

        // 2. Transacción para asegurar integridad (Todo o nada)
        const transaction = db.transaction(() => {
            // Crear la cabecera de la venta con total 0 inicialmente, guardando descuento y metodo_pago
            const ventaResult = db.prepare(`
                INSERT INTO ventas (fecha, cliente, cedula, telefono, tasa_bcv, descuento, metodo_pago, referencia, total_bs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            `).run(fecha, cliente, cedula, telefono, tasa_bcv, descuentoNum, metodo_pago, referencia);

            const ventaId = ventaResult.lastInsertRowid;

            for (const item of items) {
                // Buscar producto real en DB por CÓDIGO
                const producto = db.prepare('SELECT id, stock, precio_usd FROM productos WHERE codigo = ?').get(item.codigo);
                
                if (!producto) {
                    throw new Error(`El producto con código ${item.codigo} no existe en la base de datos`);
                }
                
                if (producto.stock < item.cantidad) {
                    throw new Error(`Stock insuficiente para el producto: ${item.codigo}`);
                }

                const subtotalBs = producto.precio_usd * item.cantidad * tasa_bcv;
                totalGeneralBs += subtotalBs;

                // Insertar cada item en el detalle
                db.prepare(`
                    INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, subtotal_bs)
                    VALUES (?, ?, ?, ?, ?)
                `).run(ventaId, producto.id, item.cantidad, producto.precio_usd, subtotalBs);

                // Descontar del inventario
                db.prepare(`
                    UPDATE productos SET stock = stock - ? WHERE id = ?
                `).run(item.cantidad, producto.id);
            }

            // Aplicar descuento (porcentaje) al total acumulado
            const multiplicador = 1 - Math.max(0, Math.min(100, descuentoNum)) / 100;
            const totalConDescuento = totalGeneralBs * multiplicador;

            // Actualizar el total final sumado en la cabecera
            db.prepare('UPDATE ventas SET total_bs = ? WHERE id = ?').run(totalConDescuento, ventaId);

            return ventaId;
        });

        const idGenerado = transaction();
        res.json({ message: 'Venta registrada con éxito', ventaId: idGenerado });

    } catch (error) {
        // Si algo falla dentro del loop (stock, producto inexistente), se revierte todo
        console.error("Error procesando la venta:", error.message);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;