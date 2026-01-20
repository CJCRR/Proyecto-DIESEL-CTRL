const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /admin/productos - Crear nuevo producto
router.post('/', (req, res) => {
    // 1. Saneamiento de entrada
    let { codigo, descripcion, precio_usd, costo_usd, stock, categoria } = req.body;

    // Normalización (Mayúsculas para códigos)
    codigo = codigo ? codigo.trim().toUpperCase() : '';
    descripcion = descripcion ? descripcion.trim() : '';
    precio_usd = parseFloat(precio_usd);
    costo_usd = costo_usd !== undefined ? parseFloat(costo_usd) : 0;
    stock = parseInt(stock) || 0;
    categoria = categoria ? String(categoria).trim() : null;

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

    try {
        // 3. Verificación de duplicados (Optimización: SQLite lanza error en UNIQUE constraint, 
        // pero consultar antes permite dar un mensaje más amigable).
        const existe = db.prepare('SELECT id FROM productos WHERE codigo = ?').get(codigo);
        if (existe) {
            return res.status(409).json({ error: `El código ${codigo} ya existe en el inventario.` });
        }

        // 4. Inserción
        const info = db.prepare(`
            INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(codigo, descripcion, precio_usd, costo_usd, stock, categoria);

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
router.get('/', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const q = req.query.q ? String(req.query.q).trim().toLowerCase() : null;
    const categoria = req.query.categoria ? String(req.query.categoria).trim() : null;
    const stock_lt = req.query.stock_lt !== undefined ? parseInt(req.query.stock_lt) : null;
    const stock_gt = req.query.stock_gt !== undefined ? parseInt(req.query.stock_gt) : null;

    try {
        const where = [];
        const params = [];
        if (q) { where.push("(lower(codigo) LIKE ? OR lower(descripcion) LIKE ?)"); params.push('%'+q+'%', '%'+q+'%'); }
        if (categoria) { where.push('lower(categoria) LIKE ?'); params.push('%' + String(categoria).toLowerCase() + '%'); }
        if (stock_lt !== null) { where.push('stock < ?'); params.push(stock_lt); }
        if (stock_gt !== null) { where.push('stock > ?'); params.push(stock_gt); }

        const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

        const productos = db.prepare(`
            SELECT id, codigo, descripcion, precio_usd, costo_usd, stock, categoria
            FROM productos
            ${whereSQL}
            ORDER BY codigo ASC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        // Conteo total con mismos filtros
        const countRow = db.prepare(`SELECT COUNT(*) as total FROM productos ${whereSQL}`).get(...params);

        res.json({ items: productos, total: countRow.total || 0 });
    } catch (err) {
        console.error('Error listando productos:', err);
        res.status(500).json({ error: 'Error al listar productos' });
    }
});

// GET /admin/productos/export - Exportar todos los productos a CSV
router.get('/export', (req, res) => {
    try {
        const rows = db.prepare('SELECT codigo, descripcion, precio_usd, costo_usd, stock, categoria FROM productos ORDER BY codigo').all();
        // Allow delimiter selection: comma (default), semicolon or tab
        // Default delimiter: semicolon (works better with Excel in many locales)
        const delimParam = (req.query.delim || 'semicolon').toString().toLowerCase();
        let delimiter = ';';
        let contentType = 'text/csv; charset=utf-8';
        let ext = 'csv';
        if (delimParam === 'tab' || delimParam === 'tsv') { delimiter = '\t'; contentType = 'text/tab-separated-values; charset=utf-8'; ext = 'tsv'; }
        else if (delimParam === 'comma' || delimParam === ',') { delimiter = ','; ext = 'csv'; }

        function quoteField(v){
            if (v === null || v === undefined) return '';
            const s = String(v);
            // escape double quotes
            const hasSpecial = s.includes('"') || s.includes('\r') || s.includes('\n') || s.includes(delimiter);
            if (s.includes('"')) return '"' + s.replace(/"/g,'""') + '"';
            if (hasSpecial) return '"' + s + '"';
            return s;
        }

        const header = ['codigo','descripcion','precio_usd','costo_usd','stock','categoria'].join(delimiter) + '\r\n';
        const lines = rows.map(r => {
            return [
                quoteField(r.codigo),
                quoteField(r.descripcion),
                quoteField(r.precio_usd || ''),
                quoteField(r.costo_usd || ''),
                quoteField(r.stock || ''),
                quoteField(r.categoria || '')
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
router.post('/import', (req, res) => {
    try {
        const text = (typeof req.body === 'string') ? req.body : '';
        if (!text) return res.status(400).json({ error: 'CSV vacío' });

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
        function parseDelimited(txt, delim){
            const rows = [];
            let i = 0, len = txt.length;
            let cur = [];
            let field = '';
            let inQuotes = false;
            while (i < len) {
                const ch = txt[i];
                if (inQuotes) {
                    if (ch === '"') {
                        if (i+1 < len && txt[i+1] === '"') { field += '"'; i += 2; continue; }
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

        const rows = parseDelimited(raw, detectedDelim).map(r => r.map(c => (c||'').toString()));
        console.log('Import CSV: detected delimiter=', JSON.stringify(detectedDelim), 'rows=', rows.length);
        if (!rows || rows.length === 0) return res.status(400).json({ error: 'CSV sin contenido' });

        // remove completely empty rows
        const nonEmpty = rows.filter(r => r.some(c => (c||'').toString().trim() !== ''));
        if (nonEmpty.length === 0) return res.status(400).json({ error: 'CSV sin filas válidas' });

        // detect header row more flexibly
        let start = 0;
        const first = nonEmpty[0].map(c => (c||'').toString().toLowerCase());
        if (first.some(h => h.includes('codigo')) && first.some(h => h.includes('descripcion'))) start = 1;

        const insert = db.prepare('INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria) VALUES (?, ?, ?, ?, ?, ?)');
        const update = db.prepare('UPDATE productos SET descripcion = ?, precio_usd = ?, costo_usd = ?, stock = ?, categoria = ? WHERE codigo = ?');
        const findStmt = db.prepare('SELECT id FROM productos WHERE codigo = ?');

        const toImport = nonEmpty.slice(start);
        if (toImport.length === 0) return res.status(400).json({ error: 'No se encontraron filas de datos para importar' });

        const inserted = [];
        const updated = [];
        const skipped = [];
        const rowErrors = [];

        const tx = db.transaction((rowsToImport) => {
            for (let idx = 0; idx < rowsToImport.length; idx++) {
                const cols = rowsToImport[idx];
                try {
                    let codigo = (cols[0] || '').toString().trim();
                    if (!codigo) { skipped.push({ row: idx + start + 1, reason: 'codigo vacío' }); continue; }
                    codigo = codigo.toUpperCase();
                    const descripcion = (cols[1] || '').toString().trim();
                    const precio = parseFloat((cols[2] || '').toString().trim()) || 0;
                    const costo = parseFloat((cols[3] || '').toString().trim());
                    const costoVal = isNaN(costo) ? 0 : costo;
                    const stock = parseInt((cols[4] || '').toString().trim()) || 0;
                    const categoria = (cols[5] || '').toString().trim() || null;
                    const ex = findStmt.get(codigo);
                    if (ex) {
                        update.run(descripcion, precio, costoVal, stock, categoria, codigo);
                        updated.push(codigo);
                    } else {
                        insert.run(codigo, descripcion, precio, costoVal, stock, categoria);
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
            preview: nonEmpty.slice(0,5),
            counts: { totalRows: nonEmpty.length, dataRows: toImport.length, inserted: inserted.length, updated: updated.length, skipped: skipped.length, errors: rowErrors.length },
            items: { inserted, updated, skipped, rowErrors }
        });
    } catch (err) {
        console.error('Error importando CSV:', err);
        res.status(500).json({ error: 'Error al importar CSV' });
    }
});

// PUT /admin/productos/:codigo - Actualizar producto por código
router.put('/:codigo', (req, res) => {
    let codigo = req.params.codigo ? req.params.codigo.trim().toUpperCase() : '';
    let { descripcion, precio_usd, costo_usd, stock, categoria } = req.body;

    descripcion = descripcion ? descripcion.trim() : '';
    precio_usd = precio_usd !== undefined ? parseFloat(precio_usd) : null;
    stock = stock !== undefined ? parseInt(stock) : null;

    if (!codigo) return res.status(400).json({ error: 'Código inválido' });

    try {
        const existing = db.prepare('SELECT id FROM productos WHERE codigo = ?').get(codigo);
        if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

        const updates = [];
        const params = [];
        if (descripcion) { updates.push('descripcion = ?'); params.push(descripcion); }
        if (precio_usd !== null && !isNaN(precio_usd)) { updates.push('precio_usd = ?'); params.push(precio_usd); }
        if (costo_usd !== undefined && costo_usd !== null && !isNaN(parseFloat(costo_usd))) { updates.push('costo_usd = ?'); params.push(parseFloat(costo_usd)); }
        if (stock !== null && !isNaN(stock)) { updates.push('stock = ?'); params.push(stock); }
        if (categoria !== undefined) { updates.push('categoria = ?'); params.push(categoria); }

        if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

        params.push(codigo);
        const sql = `UPDATE productos SET ${updates.join(', ')} WHERE codigo = ?`;
        db.prepare(sql).run(...params);

        res.json({ message: 'Producto actualizado', codigo });
    } catch (err) {
        console.error('Error actualizando producto:', err);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// DELETE /admin/productos/:codigo - Eliminar producto por código
router.delete('/:codigo', (req, res) => {
    const codigo = req.params.codigo ? req.params.codigo.trim().toUpperCase() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido' });

    try {
        const info = db.prepare('DELETE FROM productos WHERE codigo = ?').run(codigo);
        if (info.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json({ message: 'Producto eliminado', codigo });
    } catch (err) {
        console.error('Error eliminando producto:', err);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

module.exports = router;
