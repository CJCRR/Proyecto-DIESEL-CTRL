const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

const MAX_IMPORT_ROWS = 5000;
const MAX_FIELD_LEN = 200;

// POST /admin/productos - Crear nuevo producto
router.post('/', requireAuth, (req, res) => {
    // 1. Saneamiento de entrada
    let { codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, deposito_id } = req.body;

    // Normalización (Mayúsculas para códigos)
    codigo = codigo ? codigo.trim().toUpperCase() : '';
    descripcion = descripcion ? descripcion.trim() : '';
    precio_usd = parseFloat(precio_usd);
    costo_usd = costo_usd !== undefined ? parseFloat(costo_usd) : 0;
    stock = parseInt(stock) || 0;
    categoria = categoria ? String(categoria).trim() : null;
    marca = marca ? String(marca).trim().slice(0, MAX_FIELD_LEN) : null;
    const depositoId = deposito_id ? parseInt(deposito_id, 10) || null : null;

    try {
        const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : 1;

        // 2. Validaciones
        if (!codigo || codigo.length < 3) {
            return res.status(400).json({ error: 'El código debe tener al menos 3 caracteres.' });
        }
        if (!descripcion) {
            return res.status(400).json({ error: 'La descripción es obligatoria.' });
        }
        if (isNaN(precio_usd) || precio_usd <= 0) {
            return res.status(400).json({ error: 'El precio debe ser un número positivo.' });
        }
        if (isNaN(costo_usd) || costo_usd < 0) {
            return res.status(400).json({ error: 'El costo debe ser un número mayor o igual a 0.' });
        }

        // Si no se envió depósito, intentar usar el depósito principal de la empresa
        let finalDepositoId = depositoId;
        if (!finalDepositoId || Number.isNaN(finalDepositoId)) {
            const principalDep = db.prepare('SELECT id FROM depositos WHERE empresa_id = ? AND es_principal = 1 ORDER BY id LIMIT 1').get(empresaId);
            if (principalDep && principalDep.id) {
                finalDepositoId = principalDep.id;
            }
        }
        if (!finalDepositoId || Number.isNaN(finalDepositoId)) {
            return res.status(400).json({ error: 'Debe seleccionar un depósito para el producto.' });
        }
        // 3. Verificación de duplicados (Optimización: SQLite lanza error en UNIQUE constraint, 
        // pero consultar antes permite dar un mensaje más amigable).
        const existe = db.prepare('SELECT id FROM productos WHERE codigo = ? AND empresa_id = ?').get(codigo, empresaId);
        if (existe) {
            return res.status(409).json({ error: `El código ${codigo} ya existe en el inventario.` });
        }

        // 4. Inserción
        const info = db.prepare(`
            INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id, deposito_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresaId, finalDepositoId);

        // Inicializar existencias en stock_por_deposito para este producto
        try {
            db.prepare(`
                INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad)
                VALUES (?, ?, ?, ?)
            `).run(empresaId, info.lastInsertRowid, finalDepositoId, stock);
        } catch (errStock) {
            console.warn('No se pudo inicializar stock_por_deposito para el nuevo producto:', errStock.message);
        }

        res.status(201).json({
            message: 'Producto creado exitosamente',
            id: info.lastInsertRowid,
            codigo
        });

    } catch (err) {
        console.error('Error creando producto:', err);
        res.status(500).json({ error: 'Error interno de base de datos.' });
    }
});

// GET /admin/productos - Listar productos (paginado opcional) con filtros
router.get('/', requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const q = req.query.q ? String(req.query.q).trim().toLowerCase() : null;
    const categoria = req.query.categoria ? String(req.query.categoria).trim() : null;
    const stock_lt = req.query.stock_lt !== undefined ? parseInt(req.query.stock_lt) : null;
    const stock_gt = req.query.stock_gt !== undefined ? parseInt(req.query.stock_gt) : null;
    const incompletos = req.query.incompletos === '1' || req.query.incompletos === 'true';
    const depositoId = req.query.deposito_id !== undefined && req.query.deposito_id !== ''
        ? parseInt(req.query.deposito_id, 10)
        : null;

    try {
        const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : 1;

        // Modo normal: sin filtro de depósito → usar stock total de productos
        if (depositoId === null || Number.isNaN(depositoId)) {
            const where = [];
            const params = [];
            where.push('p.empresa_id = ?');
            params.push(empresaId);
            if (q) { where.push("(lower(p.codigo) LIKE ? OR lower(p.descripcion) LIKE ?)"); params.push('%' + q + '%', '%' + q + '%'); }
            if (categoria) { where.push('lower(p.categoria) LIKE ?'); params.push('%' + String(categoria).toLowerCase() + '%'); }
            if (!incompletos) {
                if (stock_lt !== null) { where.push('p.stock < ?'); params.push(stock_lt); }
                if (stock_gt !== null) { where.push('p.stock > ?'); params.push(stock_gt); }
            }
            if (incompletos) {
                where.push('((p.costo_usd IS NULL OR p.costo_usd <= 0) OR (p.categoria IS NULL OR TRIM(p.categoria) = \'\') OR p.deposito_id IS NULL OR p.stock IS NULL)');
            }

            const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

            const productos = db.prepare(`
                                SELECT p.id,
                                             p.codigo,
                                             p.descripcion,
                                             p.precio_usd,
                                             p.costo_usd,
                                             COALESCE((
                                                 SELECT SUM(sd3.cantidad)
                                                 FROM stock_por_deposito sd3
                                                 WHERE sd3.producto_id = p.id
                                             ), p.stock) AS stock,
                                             p.categoria,
                                             p.marca,
                                             p.deposito_id,
                                             d.nombre AS deposito_nombre,
                                             (
                                                 SELECT GROUP_CONCAT(
                                                     d2.nombre || ' ' || (
                                                         CASE
                                                             WHEN sd2.cantidad = CAST(sd2.cantidad AS INTEGER)
                                                                 THEN CAST(CAST(sd2.cantidad AS INTEGER) AS TEXT)
                                                             ELSE printf('%.2f', sd2.cantidad)
                                                         END
                                                     ),
                                                     ' / '
                                                 )
                                                 FROM stock_por_deposito sd2
                                                 JOIN depositos d2 ON d2.id = sd2.deposito_id
                                                 WHERE sd2.producto_id = p.id AND sd2.cantidad > 0
                                             ) AS stock_detalle
                                FROM productos p
                                LEFT JOIN depositos d ON d.id = p.deposito_id
                                ${whereSQL}
                                ORDER BY p.codigo ASC
                                LIMIT ? OFFSET ?
                        `).all(...params, limit, offset);

            const countRow = db.prepare(`SELECT COUNT(*) as total FROM productos p ${whereSQL}`).get(...params);

            return res.json({ items: productos, total: countRow.total || 0 });
        }

        // Modo filtrado por depósito: mostrar stock de ESE depósito usando stock_por_deposito
        const where = [];
        const params = [];
        where.push('p.empresa_id = ?');
        params.push(empresaId);
        where.push('sd.deposito_id = ?');
        params.push(depositoId);
        if (q) { where.push("(lower(p.codigo) LIKE ? OR lower(p.descripcion) LIKE ?)"); params.push('%' + q + '%', '%' + q + '%'); }
        if (categoria) { where.push('lower(p.categoria) LIKE ?'); params.push('%' + String(categoria).toLowerCase() + '%'); }
        if (stock_lt !== null) { where.push('sd.cantidad < ?'); params.push(stock_lt); }
        if (stock_gt !== null) { where.push('sd.cantidad > ?'); params.push(stock_gt); }
        // Si no se pidió explícitamente un filtro de stock, solo mostrar productos con stock positivo en ese depósito
        if (stock_lt === null && stock_gt === null) {
            where.push('sd.cantidad > 0');
        }

        const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

        const productos = db.prepare(`
                        SELECT p.id,
                                     p.codigo,
                                     p.descripcion,
                                     p.precio_usd,
                                     p.costo_usd,
                                     sd.cantidad AS stock,
                                     p.categoria,
                                     p.marca,
                                     sd.deposito_id AS deposito_id,
                                     d.nombre AS deposito_nombre,
                                     (
                                         SELECT GROUP_CONCAT(
                                             d2.nombre || ' ' || (
                                                 CASE
                                                     WHEN sd2.cantidad = CAST(sd2.cantidad AS INTEGER)
                                                         THEN CAST(CAST(sd2.cantidad AS INTEGER) AS TEXT)
                                                     ELSE printf('%.2f', sd2.cantidad)
                                                 END
                                             ),
                                             ' / '
                                         )
                                         FROM stock_por_deposito sd2
                                         JOIN depositos d2 ON d2.id = sd2.deposito_id
                                         WHERE sd2.producto_id = p.id AND sd2.cantidad > 0
                                     ) AS stock_detalle
                        FROM productos p
                        JOIN stock_por_deposito sd ON sd.producto_id = p.id
                        LEFT JOIN depositos d ON d.id = sd.deposito_id
                        ${whereSQL}
                        ORDER BY p.codigo ASC
                        LIMIT ? OFFSET ?
                `).all(...params, limit, offset);

        const countRow = db.prepare(`
            SELECT COUNT(*) as total
            FROM productos p
            JOIN stock_por_deposito sd ON sd.producto_id = p.id
            ${whereSQL}
        `).get(...params);

        res.json({ items: productos, total: countRow.total || 0 });
    } catch (err) {
        console.error('Error listando productos:', err);
        res.status(500).json({ error: 'Error al listar productos' });
    }
});

// GET /admin/productos/export - Exportar todos los productos a CSV
router.get('/export', requireAuth, (req, res) => {
    try {
        const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : 1;
        const rows = db.prepare(`
            SELECT
                p.codigo,
                p.descripcion,
                p.precio_usd,
                p.costo_usd,
                COALESCE((
                    SELECT SUM(sd.cantidad)
                    FROM stock_por_deposito sd
                    WHERE sd.producto_id = p.id
                ), p.stock) AS stock,
                p.categoria,
                p.marca,
                d.codigo AS deposito_codigo
            FROM productos p
            LEFT JOIN depositos d ON d.id = p.deposito_id
            WHERE p.empresa_id = ?
            ORDER BY p.codigo
        `).all(empresaId);
        // Allow delimiter selection: comma (default), semicolon or tab
        // Default delimiter: semicolon (works better with Excel in many locales)
        const delimParam = (req.query.delim || 'semicolon').toString().toLowerCase();
        let delimiter = ';';
        let contentType = 'text/csv; charset=utf-8';
        let ext = 'csv';
        if (delimParam === 'tab' || delimParam === 'tsv') { delimiter = '\t'; contentType = 'text/tab-separated-values; charset=utf-8'; ext = 'tsv'; }
        else if (delimParam === 'comma' || delimParam === ',') { delimiter = ','; ext = 'csv'; }

        function quoteField(v) {
            if (v === null || v === undefined) return '';
            const s = String(v);
            // escape double quotes
            const hasSpecial = s.includes('"') || s.includes('\r') || s.includes('\n') || s.includes(delimiter);
            if (s.includes('"')) return '"' + s.replace(/"/g, '""') + '"';
            if (hasSpecial) return '"' + s + '"';
            return s;
        }

        const header = ['codigo', 'descripcion', 'precio_usd', 'costo_usd', 'stock', 'categoria', 'marca', 'deposito_codigo'].join(delimiter) + '\r\n';
        const lines = rows.map(r => {
            return [
                quoteField(r.codigo),
                quoteField(r.descripcion),
                quoteField(r.precio_usd || ''),
                quoteField(r.costo_usd || ''),
                quoteField(r.stock || ''),
                quoteField(r.categoria || ''),
                quoteField(r.marca || ''),
                quoteField(r.deposito_codigo || '')
            ].join(delimiter);
        }).join('\r\n');
        const csv = '\uFEFF' + header + lines + '\r\n';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="productos.${ext}"`);
        res.send(csv);
    } catch (err) {
        console.error('Error exportando CSV:', err);
        res.status(500).json({ error: 'Error al exportar CSV' });
    }
});

// POST /admin/productos/import - Importar CSV enviado en el body como text/plain
router.post('/import', requireAuth, (req, res) => {
    try {
        const text = (typeof req.body === 'string') ? req.body : '';
        if (!text) return res.status(400).json({ error: 'CSV vacío' });

        // Modo de importación: "reconteo" (reemplaza stock) o "adicional" (suma unidades).
        // Si no viene especificado, se mantiene el comportamiento actual para compatibilidad.
        const modeRaw = (req.query.mode || req.query.modo || '').toString().toLowerCase();
        let importMode = null; // null => modo legacy
        if (['reconteo', 'reconteo_total', 'total', 'recount'].includes(modeRaw)) {
            importMode = 'reconteo';
        } else if (['adicional', 'ingreso', 'ingreso_adicional', 'add', 'suma'].includes(modeRaw)) {
            importMode = 'adicional';
        }

        // detect delimiter: prefer tab if exists, else semicolon, else comma
        const raw = text.replace(/^\uFEFF/, '');
        // detect delimiter by counting occurrences in the first few lines
        const nl = raw.indexOf('\n') >= 0 ? raw.indexOf('\n') : raw.length;
        const sample = raw.slice(0, Math.min(raw.length, nl * 5 || 200));
        const counts = {
            '\t': (sample.match(/\t/g) || []).length,
            ';': (sample.match(/;/g) || []).length,
            ',': (sample.match(/,/g) || []).length
        };
        let detectedDelim = ';';
        // pick the delimiter with highest count; default to semicolon if none
        const max = Math.max(counts['\t'], counts[';'], counts[',']);
        if (max === counts['\t']) detectedDelim = '\t';
        else if (max === counts[',']) detectedDelim = ',';
        else if (max === counts[';']) detectedDelim = ';';

        // General CSV/TSV parser supporting quoted fields and a configurable delimiter
        function parseDelimited(txt, delim) {
            const rows = [];
            let i = 0, len = txt.length;
            let cur = [];
            let field = '';
            let inQuotes = false;
            while (i < len) {
                const ch = txt[i];
                if (inQuotes) {
                    if (ch === '"') {
                        if (i + 1 < len && txt[i + 1] === '"') { field += '"'; i += 2; continue; }
                        inQuotes = false; i++; continue;
                    } else {
                        field += ch; i++; continue;
                    }
                } else {
                    if (ch === '"') { inQuotes = true; i++; continue; }
                    if (ch === delim) { cur.push(field); field = ''; i++; continue; }
                    if (ch === '\r') { i++; continue; }
                    if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
                    field += ch; i++; continue;
                }
            }
            if (field !== '' || inQuotes || cur.length) { cur.push(field); rows.push(cur); }
            return rows;
        }

        const rows = parseDelimited(raw, detectedDelim).map(r => r.map(c => (c || '').toString()));
        console.log('Import CSV: detected delimiter=', JSON.stringify(detectedDelim), 'rows=', rows.length);
        if (!rows || rows.length === 0) return res.status(400).json({ error: 'CSV sin contenido' });

        // remove completely empty rows
        const nonEmpty = rows.filter(r => r.some(c => (c || '').toString().trim() !== ''));
        if (nonEmpty.length === 0) return res.status(400).json({ error: 'CSV sin filas válidas' });

        // detect header row more flexibly
        let start = 0;
        const first = nonEmpty[0].map(c => (c || '').toString().toLowerCase());
        if (first.some(h => h.includes('codigo')) && first.some(h => h.includes('descripcion'))) start = 1;

        const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : 1;
        const insert = db.prepare('INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, empresa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const insertWithDeposito = db.prepare('INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, marca, deposito_id, empresa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const update = db.prepare('UPDATE productos SET descripcion = ?, precio_usd = ?, costo_usd = ?, stock = ?, categoria = ?, marca = ? WHERE codigo = ? AND empresa_id = ?');
        const updateWithDeposito = db.prepare('UPDATE productos SET descripcion = ?, precio_usd = ?, costo_usd = ?, stock = ?, categoria = ?, marca = ?, deposito_id = ? WHERE codigo = ? AND empresa_id = ?');
        const findStmt = db.prepare('SELECT id FROM productos WHERE codigo = ? AND empresa_id = ?');
        const findDepositoByCodigo = db.prepare('SELECT id FROM depositos WHERE empresa_id = ? AND (codigo = ? OR nombre = ?)');
        const findPrincipalDeposito = db.prepare('SELECT id FROM depositos WHERE empresa_id = ? AND es_principal = 1 ORDER BY id LIMIT 1');
        const principalDepRow = findPrincipalDeposito.get(empresaId);
        const principalDepositoId = principalDepRow && principalDepRow.id ? principalDepRow.id : null;
        const insertStockPorDeposito = db.prepare('INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?, ?, ?, ?)');
        const findProductoById = db.prepare('SELECT id, empresa_id, deposito_id, stock FROM productos WHERE id = ?');
        const countStockRowsByProducto = db.prepare('SELECT COUNT(*) AS c FROM stock_por_deposito WHERE producto_id = ?');
        const selectStockPorDeposito = db.prepare('SELECT cantidad FROM stock_por_deposito WHERE producto_id = ? AND deposito_id = ?');
        const selectAllStockPorDeposito = db.prepare('SELECT deposito_id, cantidad FROM stock_por_deposito WHERE producto_id = ?');
        const updateStockPorDeposito = db.prepare("UPDATE stock_por_deposito SET cantidad = ?, actualizado_en = datetime('now') WHERE producto_id = ? AND deposito_id = ?");

        const toImport = nonEmpty.slice(start);
        if (toImport.length > MAX_IMPORT_ROWS) {
            return res.status(400).json({ error: `CSV demasiado grande. Máximo ${MAX_IMPORT_ROWS} filas.` });
        }
        if (toImport.length === 0) return res.status(400).json({ error: 'No se encontraron filas de datos para importar' });

        const inserted = [];
        const updated = [];
        const skipped = [];
        const rowErrors = [];

        const tx = db.transaction((rowsToImport) => {
            for (let idx = 0; idx < rowsToImport.length; idx++) {
                const cols = rowsToImport[idx];
                try {
                    let codigo = (cols[0] || '').toString().trim().slice(0, MAX_FIELD_LEN);
                    if (!codigo) {
                        // Registrar fila omitida con snapshot de columnas para poder identificarla en el frontend
                        skipped.push({ row: idx + start + 1, reason: 'codigo vacío', cols });
                        continue;
                    }
                    codigo = codigo.toUpperCase();
                    const descripcion = (cols[1] || '').toString().trim().slice(0, MAX_FIELD_LEN);
                    const precio = parseFloat((cols[2] || '').toString().trim()) || 0;
                    const costo = parseFloat((cols[3] || '').toString().trim());
                    const costoVal = isNaN(costo) ? 0 : costo;
                    const stock = parseInt((cols[4] || '').toString().trim()) || 0;
                    const categoria = (cols[5] || '').toString().trim().slice(0, MAX_FIELD_LEN) || null;
                    const marca = (cols[6] || '').toString().trim().slice(0, MAX_FIELD_LEN) || null;
                    const depositoCodigoRaw = (cols[7] || '').toString().trim();
                    let depositoId = null;
                    if (depositoCodigoRaw) {
                        const dep = findDepositoByCodigo.get(empresaId, depositoCodigoRaw, depositoCodigoRaw);
                        if (dep && dep.id) {
                            depositoId = dep.id;
                        }
                    }
                    const ex = findStmt.get(codigo, empresaId);
                    if (ex) {
                        // Producto existente
                        let prodRow = null;
                        let totalRows = 0;
                        try {
                            prodRow = findProductoById.get(ex.id);
                            if (prodRow) {
                                const cnt = countStockRowsByProducto.get(ex.id) || { c: 0 };
                                totalRows = Number(cnt.c || 0);
                            }
                        } catch (e) {
                            prodRow = null;
                            totalRows = 0;
                        }

                        const stockActualProducto = prodRow ? Number(prodRow.stock || 0) : 0;
                        const hayDepositoEnCsv = !!(depositoCodigoRaw && depositoId !== null);

                        // Determinar depósito objetivo para esta fila
                        let targetDepositoId = null;
                        if (hayDepositoEnCsv && depositoId !== null) {
                            targetDepositoId = depositoId;
                        } else if (prodRow && prodRow.deposito_id) {
                            targetDepositoId = prodRow.deposito_id;
                        } else if (principalDepositoId) {
                            targetDepositoId = principalDepositoId;
                        }

                        // === Modo legacy (sin modo especificado) ===
                        if (!importMode) {
                            let stockParaProducto = stock;

                            // Si el producto ya tiene stock distribuido en varios depósitos y el CSV indica un depósito,
                            // interpretamos el valor de stock del CSV como ingreso adicional para ese depósito.
                            if (hayDepositoEnCsv && prodRow && totalRows > 1) {
                                stockParaProducto = stockActualProducto + stock; // sumar al total
                            }

                            if (hayDepositoEnCsv && depositoId !== null) {
                                updateWithDeposito.run(descripcion, precio, costoVal, stockParaProducto, categoria, marca, depositoId, codigo, empresaId);
                            } else {
                                update.run(descripcion, precio, costoVal, stockParaProducto, categoria, marca, codigo, empresaId);
                            }

                            // Sincronizar stock_por_deposito
                            try {
                                if (prodRow && prodRow.deposito_id) {
                                    const depIdForStock = prodRow.deposito_id;
                                    if (totalRows <= 1) {
                                        // Caso simple: solo un depósito asociado → el stock del CSV es el nuevo total
                                        const currentDepRow = selectStockPorDeposito.get(ex.id, depIdForStock);
                                        if (currentDepRow) {
                                            updateStockPorDeposito.run(stockParaProducto, ex.id, depIdForStock);
                                        } else {
                                            insertStockPorDeposito.run(prodRow.empresa_id || empresaId, ex.id, depIdForStock, stockParaProducto);
                                        }
                                    } else if (hayDepositoEnCsv && depositoId) {
                                        // Varios depósitos: sumar unidades solo al depósito indicado en el CSV
                                        const currentDepRow = selectStockPorDeposito.get(ex.id, depositoId);
                                        const incremento = stock;
                                        if (currentDepRow) {
                                            const nuevaCant = Number(currentDepRow.cantidad || 0) + incremento;
                                            updateStockPorDeposito.run(nuevaCant, ex.id, depositoId);
                                        } else {
                                            insertStockPorDeposito.run(prodRow.empresa_id || empresaId, ex.id, depositoId, incremento);
                                        }
                                    }
                                }
                            } catch (syncErr) {
                                console.warn('No se pudo sincronizar stock_por_deposito al importar producto existente', codigo, syncErr.message);
                            }
                        } else if (importMode === 'adicional') {
                            // === Modo "Ingreso adicional": el stock del CSV es incremento, no total ===
                            const incremento = stock;
                            const nuevoTotal = stockActualProducto + incremento;

                            if (targetDepositoId) {
                                updateWithDeposito.run(descripcion, precio, costoVal, nuevoTotal, categoria, marca, targetDepositoId, codigo, empresaId);
                            } else {
                                update.run(descripcion, precio, costoVal, nuevoTotal, categoria, marca, codigo, empresaId);
                            }

                            // Actualizar stock_por_deposito solo para el depósito objetivo
                            try {
                                if (targetDepositoId) {
                                    const currentDepRow = selectStockPorDeposito.get(ex.id, targetDepositoId);
                                    const nuevaCant = (currentDepRow ? Number(currentDepRow.cantidad || 0) : 0) + incremento;
                                    if (currentDepRow) {
                                        updateStockPorDeposito.run(nuevaCant, ex.id, targetDepositoId);
                                    } else {
                                        insertStockPorDeposito.run(prodRow && prodRow.empresa_id ? prodRow.empresa_id : empresaId, ex.id, targetDepositoId, incremento);
                                    }
                                }
                            } catch (syncErr) {
                                console.warn('No se pudo sincronizar stock_por_deposito (modo adicional) al importar producto existente', codigo, syncErr.message);
                            }
                        } else if (importMode === 'reconteo') {
                            // === Modo "Reconteo total": el stock del CSV reemplaza el stock del depósito objetivo ===
                            let nuevoTotal = stock;

                            if (targetDepositoId && prodRow) {
                                // Recalcular el total del producto sumando otros depósitos + nuevo valor del depósito objetivo
                                let otherTotal = 0;
                                let currentDepRow = null;
                                try {
                                    const rowsDep = selectAllStockPorDeposito.all(ex.id) || [];
                                    for (const r of rowsDep) {
                                        const depId = Number(r.deposito_id);
                                        const cant = Number(r.cantidad || 0);
                                        if (depId === targetDepositoId) {
                                            currentDepRow = r;
                                        } else {
                                            otherTotal += cant;
                                        }
                                    }
                                } catch (e) {
                                    otherTotal = 0;
                                }
                                nuevoTotal = otherTotal + stock;

                                // Actualizar producto apuntando al depósito objetivo
                                updateWithDeposito.run(descripcion, precio, costoVal, nuevoTotal, categoria, marca, targetDepositoId, codigo, empresaId);

                                // Actualizar fila de stock_por_deposito para el depósito objetivo
                                try {
                                    if (currentDepRow) {
                                        updateStockPorDeposito.run(stock, ex.id, targetDepositoId);
                                    } else {
                                        insertStockPorDeposito.run(prodRow.empresa_id || empresaId, ex.id, targetDepositoId, stock);
                                    }
                                } catch (syncErr) {
                                    console.warn('No se pudo sincronizar stock_por_deposito (modo reconteo) al importar producto existente', codigo, syncErr.message);
                                }
                            } else {
                                // Sin depósito objetivo claro: interpretar el valor como nuevo stock total del producto
                                update.run(descripcion, precio, costoVal, stock, categoria, marca, codigo, empresaId);
                            }
                        }

                        updated.push(codigo);
                    } else {
                        // Producto nuevo: si no se indicó depósito pero existe un depósito principal, usarlo por defecto
                        let finalDepositoId = depositoId;
                        if (!finalDepositoId && principalDepositoId) {
                            finalDepositoId = principalDepositoId;
                        }

                        if (finalDepositoId) {
                            const info = insertWithDeposito.run(codigo, descripcion, precio, costoVal, stock, categoria, marca, finalDepositoId, empresaId);
                            // Inicializar stock_por_deposito igual que en la creación manual de productos
                            try {
                                insertStockPorDeposito.run(empresaId, info.lastInsertRowid, finalDepositoId, stock);
                            } catch (errStock) {
                                console.warn('No se pudo inicializar stock_por_deposito al importar producto', codigo, errStock.message);
                            }
                        } else {
                            insert.run(codigo, descripcion, precio, costoVal, stock, categoria, marca, empresaId);
                        }
                        inserted.push(codigo);
                    }
                } catch (rowErr) {
                    console.error('Error importando fila', idx + start + 1, cols, rowErr);
                    rowErrors.push({ row: idx + start + 1, cols, error: rowErr.message });
                    // continue with next row
                }
            }
        });

        try {
            tx(toImport);
        } catch (txErr) {
            console.error('Transaction error importing CSV:', txErr);
            return res.status(500).json({ error: 'Error al procesar importación', details: txErr.message });
        }

        res.json({
            message: 'CSV procesado',
            detectedDelimiter: detectedDelim,
            preview: nonEmpty.slice(0, 5),
            counts: { totalRows: nonEmpty.length, dataRows: toImport.length, inserted: inserted.length, updated: updated.length, skipped: skipped.length, errors: rowErrors.length },
            items: { inserted, updated, skipped, rowErrors }
        });
    } catch (err) {
        console.error('Error importando CSV:', err);
        res.status(500).json({ error: 'Error al importar CSV' });
    }
});

// PUT /admin/productos/:codigo - Actualizar producto por código
router.put('/:codigo', requireAuth, (req, res) => {
    let codigo = req.params.codigo ? req.params.codigo.trim().toUpperCase() : '';
    let { descripcion, precio_usd, costo_usd, stock, categoria, marca, deposito_id } = req.body;

    descripcion = descripcion ? descripcion.trim() : '';
    precio_usd = precio_usd !== undefined ? parseFloat(precio_usd) : null;
    stock = stock !== undefined ? parseInt(stock) : null;
    const depositoId = deposito_id !== undefined && deposito_id !== null
        ? parseInt(deposito_id, 10)
        : null;

    if (!codigo) return res.status(400).json({ error: 'Código inválido' });

    try {
        const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
        if (!empresaId) {
            return res.status(400).json({ error: 'Usuario sin empresa asociada' });
        }

        const existing = db.prepare('SELECT id, empresa_id, deposito_id, stock FROM productos WHERE codigo = ? AND empresa_id = ?').get(codigo, empresaId);
        if (!existing) return res.status(404).json({ error: 'Producto no encontrado en esta empresa' });

        if (deposito_id !== undefined && deposito_id !== null && (Number.isNaN(depositoId) || depositoId <= 0)) {
            return res.status(400).json({ error: 'Depósito inválido' });
        }

        const updates = [];
        const params = [];
        if (descripcion) { updates.push('descripcion = ?'); params.push(descripcion); }
        if (precio_usd !== null && !isNaN(precio_usd)) { updates.push('precio_usd = ?'); params.push(precio_usd); }
        if (costo_usd !== undefined && costo_usd !== null && !isNaN(parseFloat(costo_usd))) { updates.push('costo_usd = ?'); params.push(parseFloat(costo_usd)); }
        if (stock !== null && !isNaN(stock)) { updates.push('stock = ?'); params.push(stock); }
        if (categoria !== undefined) { updates.push('categoria = ?'); params.push(categoria); }
        if (marca !== undefined) { updates.push('marca = ?'); params.push(marca); }
        if (deposito_id !== undefined) { updates.push('deposito_id = ?'); params.push(depositoId); }

        if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

        params.push(codigo, empresaId);
        const sql = `UPDATE productos SET ${updates.join(', ')} WHERE codigo = ? AND empresa_id = ?`;
        db.prepare(sql).run(...params);

        // Sincronizar stock_por_deposito cuando el producto tiene depósito definido pero no hay fila asociada
        const updated = db.prepare('SELECT id, empresa_id, deposito_id, stock FROM productos WHERE codigo = ? AND empresa_id = ?').get(codigo, empresaId);
        if (updated && updated.deposito_id) {
            const rowDep = db.prepare(`
                SELECT cantidad FROM stock_por_deposito
                WHERE producto_id = ? AND deposito_id = ?
            `).get(updated.id, updated.deposito_id);
            if (!rowDep) {
                try {
                    db.prepare(`
                        INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad)
                        VALUES (?, ?, ?, ?)
                    `).run(updated.empresa_id, updated.id, updated.deposito_id, updated.stock || 0);
                } catch (errDep) {
                    console.warn('No se pudo inicializar stock_por_deposito al actualizar producto:', errDep.message);
                }
            }
        }

        res.json({ message: 'Producto actualizado', codigo });
    } catch (err) {
        console.error('Error actualizando producto:', err);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// DELETE /admin/productos/:codigo - Eliminar producto por código
router.delete('/:codigo', requireAuth, requireRole('admin'), (req, res) => {
    const codigo = req.params.codigo ? req.params.codigo.trim().toUpperCase() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido' });

    try {
        const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
        if (!empresaId) {
            return res.status(400).json({ error: 'Usuario sin empresa asociada' });
        }

        const prod = db.prepare('SELECT id FROM productos WHERE codigo = ? AND empresa_id = ?').get(codigo, empresaId);
        if (!prod) return res.status(404).json({ error: 'Producto no encontrado en esta empresa' });

        // No permitir eliminar productos que tengan ventas o devoluciones asociadas
        const ventasAsociadas = db.prepare('SELECT COUNT(*) AS c FROM venta_detalle WHERE producto_id = ?').get(prod.id);
        const devAsociadas = db.prepare('SELECT COUNT(*) AS c FROM devolucion_detalle WHERE producto_id = ?').get(prod.id);
        if ((ventasAsociadas && ventasAsociadas.c > 0) || (devAsociadas && devAsociadas.c > 0)) {
            return res.status(400).json({
                error: 'No se puede eliminar el producto porque tiene ventas o devoluciones asociadas. Puede dejarlo con stock 0 para no usarlo más.'
            });
        }

        const tx = db.transaction((productoId) => {
            // Limpiar tablas auxiliares relacionadas con el producto
            db.prepare('DELETE FROM stock_por_deposito WHERE producto_id = ?').run(productoId);
            db.prepare('DELETE FROM ajustes_stock WHERE producto_id = ?').run(productoId);
            db.prepare('DELETE FROM movimientos_deposito WHERE producto_id = ?').run(productoId);
            const info = db.prepare('DELETE FROM productos WHERE id = ?').run(productoId);
            return info.changes;
        });

        const changes = tx(prod.id);
        if (changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json({ message: 'Producto eliminado', codigo });
    } catch (err) {
        console.error('Error eliminando producto:', err);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

module.exports = router;
