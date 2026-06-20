const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');
const { body, validate } = require('../middleware/validation');
const path = require('path');
const { obtenerConfigGeneral } = require('../services/ajustesService');
const tplCompact = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template-compact.js'));
const tplStandard = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template.js'));

const MAX_ITEMS = 200;
const MAX_TEXT = 120;
const MAX_DOC = 40;
const MAX_NOTAS = 500;

function safeStr(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

// Validaciones para listar presupuestos (query params)
const listarValidaciones = [
  body('desde')
    .optional()
    .isISO8601()
    .withMessage('Fecha desde inválida'),
  body('hasta')
    .optional()
    .isISO8601()
    .withMessage('Fecha hasta inválida'),
  body('cliente')
    .optional()
    .isString()
    .isLength({ max: 120 })
    .withMessage('Cliente inválido'),
  body('estado')
    .optional()
    .isIn(['activo', 'vencido', 'convertido', 'anulado'])
    .withMessage('Estado inválido'),
  body('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('Límite debe ser entre 1 y 500'),
];

// Validaciones para crear presupuesto
const crearValidaciones = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('El presupuesto debe contener al menos un producto'),
  body('items.*.codigo')
    .notEmpty()
    .isString()
    .isLength({ max: 64 })
    .withMessage('Código de producto inválido'),
  body('items.*.cantidad')
    .isInt({ min: 1, max: 100000 })
    .withMessage('Cantidad debe ser un número entero entre 1 y 100000'),
  body('items.*.precio_usd')
    .optional()
    .isFloat({ min: 0, max: 1e9 })
    .withMessage('Precio inválido'),
  body('items.*.deposito_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('ID de depósito inválido'),
  body('cliente')
    .notEmpty()
    .isString()
    .isLength({ max: 120 })
    .withMessage('El nombre del cliente es obligatorio y no puede exceder 120 caracteres'),
  body('cedula')
    .optional()
    .isString()
    .isLength({ max: 40 })
    .withMessage('Cédula inválida'),
  body('telefono')
    .optional()
    .isString()
    .isLength({ max: 40 })
    .withMessage('Teléfono inválido'),
  body('tasa_bcv')
    .notEmpty()
    .isFloat({ gt: 0 })
    .withMessage('La tasa BCV es obligatoria y debe ser mayor a 0'),
  body('descuento')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Descuento debe ser un número positivo'),
  body('notas')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Notas demasiado largas'),
  body('nivel_precio')
    .optional()
    .isString()
    .isLength({ max: 16 })
    .withMessage('Nivel de precio inválido'),
];

router.get('/', requireAuth, validate(listarValidaciones), (req, res) => {
  try {
    const { desde, hasta, cliente, estado, limit = 100 } = req.query;
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const where = [];
    const params = [];
    if (empresaId) {
      where.push('p.empresa_id = ?');
      params.push(empresaId);
    }
    if (desde) { where.push("date(p.fecha) >= date(?)"); params.push(desde); }
    if (hasta) { where.push("date(p.fecha) <= date(?)"); params.push(hasta); }
    if (cliente) { where.push("(p.cliente LIKE ? OR p.cliente_doc LIKE ? OR p.telefono LIKE ?)"); params.push(`%${cliente}%`, `%${cliente}%`, `%${cliente}%`); }
    if (estado) { where.push("p.estado = ?"); params.push(estado); }
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT p.*
      FROM presupuestos p
      ${whereSQL}
      ORDER BY p.fecha DESC
      LIMIT ?
    `).all(...params, lim);

    res.json(rows);
  } catch (err) {
    console.error('Error listando presupuestos:', err.message);
    res.status(500).json({ error: 'Error listando presupuestos' });
  }
});

router.get('/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const presupuesto = empresaId
      ? db.prepare('SELECT * FROM presupuestos WHERE id = ? AND empresa_id = ?').get(id, empresaId)
      : db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(id);
    if (!presupuesto) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    const detalles = db.prepare(`
      SELECT
        pd.id,
        pd.presupuesto_id,
        pd.producto_id,
        pd.codigo,
        pd.descripcion,
        pd.cantidad,
        pd.precio_usd,
        pd.subtotal_bs,
        COALESCE(pd.deposito_id, p.deposito_id) AS deposito_id,
        COALESCE(pd.deposito_nombre, d.nombre) AS deposito_nombre,
        d.codigo AS deposito_codigo,
        p.stock,
        p.precio_usd AS precio_base_usd
      FROM presupuesto_detalle pd
      LEFT JOIN productos p ON p.id = pd.producto_id
      LEFT JOIN depositos d ON d.id = COALESCE(pd.deposito_id, p.deposito_id)
      WHERE pd.presupuesto_id = ?
    `).all(id);
    res.json({ presupuesto, detalles });
  } catch (err) {
    console.error('Error obteniendo presupuesto:', err.message);
    res.status(500).json({ error: 'Error obteniendo presupuesto' });
  }
});

// Nota de presupuesto (HTML)
router.get('/nota/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).send('ID inválido');
    const empresaIdSesion = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const presupuesto = empresaIdSesion
      ? db.prepare('SELECT * FROM presupuestos WHERE id = ? AND empresa_id = ?').get(id, empresaIdSesion)
      : db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(id);
    if (!presupuesto) return res.status(404).send('Presupuesto no encontrado');
    const detalles = db.prepare(`
      SELECT pd.cantidad,
        pd.precio_usd,
        pd.subtotal_bs,
        pd.descripcion,
        pd.codigo,
        p.marca AS marca,
        COALESCE(d.codigo, pd.deposito_nombre) AS deposito_codigo
      FROM presupuesto_detalle pd
      LEFT JOIN productos p ON p.id = pd.producto_id
      LEFT JOIN depositos d ON d.id = pd.deposito_id
      WHERE pd.presupuesto_id = ?
    `).all(id);

    // Calcular un correlativo de presupuesto por empresa para el campo "NRO:"
    const empresaIdSeq = presupuesto.empresa_id != null ? presupuesto.empresa_id : empresaIdSesion;
    let idGlobal = null;
    if (empresaIdSeq != null) {
      const filaSeq = db.prepare(`
        SELECT COUNT(*) AS n
        FROM presupuestos p2
        WHERE p2.empresa_id = ? AND p2.id <= ?
      `).get(empresaIdSeq, presupuesto.id);
      const correlativo = filaSeq && filaSeq.n ? Number(filaSeq.n) : Number(presupuesto.id);
      idGlobal = `PRES-${correlativo}`;
    } else if (presupuesto.id != null) {
      idGlobal = `PRES-${presupuesto.id}`;
    }

    // Leer configuración general por empresa (empresa + nota) usando multiempresa
    const empresaIdCfg = empresaIdSeq != null ? empresaIdSeq : empresaIdSesion;
    const cfgGeneral = obtenerConfigGeneral(empresaIdCfg);
    const empresa = (cfgGeneral && cfgGeneral.empresa) || {};
    const notaCfg = (cfgGeneral && cfgGeneral.nota) || {};

    // Layout de la nota (compact o standard)
    const layout = notaCfg.layout === 'standard' ? 'standard' : 'compact';

    // Lógica robusta para el nombre de empresa igual que en ventas
    let empresaNombre = (empresa && typeof empresa.nombre === 'string' && empresa.nombre.trim())
      ? empresa.nombre.trim()
      : (notaCfg.empresa_nombre && typeof notaCfg.empresa_nombre === 'string' && notaCfg.empresa_nombre.trim())
        ? notaCfg.empresa_nombre.trim()
        : (notaCfg.nombre && typeof notaCfg.nombre === 'string' && notaCfg.nombre.trim())
          ? notaCfg.nombre.trim()
          : 'EMPRESA';

    const logoUrl = (notaCfg.header_logo_url && notaCfg.header_logo_url.toString().trim())
      || (empresa.logo_url && empresa.logo_url.toString().trim())
      || '';
    const rif = (notaCfg.rif && notaCfg.rif.toString().trim())
      || (empresa.rif && empresa.rif.toString().trim())
      || '';
    const telefonos = (notaCfg.telefonos && notaCfg.telefonos.toString().trim())
      || (empresa.telefonos && empresa.telefonos.toString().trim())
      || '';
    const ubicacion = (notaCfg.ubicacion && notaCfg.ubicacion.toString().trim())
      || (notaCfg.direccion_general && notaCfg.direccion_general.toString().trim())
      || (empresa.ubicacion && empresa.ubicacion.toString().trim())
      || '';

    const presupuestoConEmpresa = {
      ...presupuesto,
      id_global: idGlobal,
      empresa_nombre: empresaNombre,
      empresa_logo_url: logoUrl,
      empresa_ubicacion: ubicacion,
      empresa_rif: rif,
      empresa_telefonos: telefonos,
      empresa_marcas: Array.isArray(notaCfg.brand_logos) ? notaCfg.brand_logos : [],
      empresa_encabezado: notaCfg.encabezado_texto || '',
      empresa: {
        nombre: empresaNombre,
        logo_url: logoUrl,
        ubicacion: ubicacion,
        rif: rif,
        telefonos: telefonos
      }
    };
    const tpl = layout === 'standard' ? tplStandard : tplCompact;
    const html = tpl && tpl.buildNotaHTML
      ? await tpl.buildNotaHTML({ venta: presupuestoConEmpresa, detalles }, { tipo: 'PRESUPUESTO', notaCfg })
      : '<pre>Plantilla no disponible</pre>';

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html || '<pre>Presupuesto vacío</pre>');
  } catch (err) {
    console.error('Error construyendo nota de presupuesto:', err.message);
    res.status(500).send('Error generando la nota');
  }
});

router.post('/', requireAuth, validate(crearValidaciones), (req, res) => {
  const {
    items,
    cliente,
    cedula = '',
    telefono = '',
    tasa_bcv,
    descuento = 0,
    notas = '',
    nivel_precio
  } = req.body || {};

  const clienteSafe = safeStr(cliente, MAX_TEXT);
  const cedulaSafe = safeStr(cedula, MAX_DOC);
  const telefonoSafe = safeStr(telefono, MAX_DOC);
  const notasSafe = safeStr(notas, MAX_NOTAS);
  const nivelPrecioSafe = safeStr(nivel_precio, 16) || 'base';

  const tasa = parseFloat(tasa_bcv);
  const descuentoNum = Math.max(0, parseFloat(descuento) || 0);

  try {
    const fecha = new Date().toISOString();
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;

    if (!empresaId) {
      return res.status(400).json({ error: 'Usuario sin empresa asociada' });
    }
    let totalBs = 0;
    let totalUsd = 0;

    // Configuración de nota por empresa para fijar IVA/IGTF al momento de crear el presupuesto
    const cfgGeneral = obtenerConfigGeneral(empresaId);
    const notaCfg = (cfgGeneral && cfgGeneral.nota) || {};
    const ivaPctNum = Math.max(0, Math.min(100, parseFloat(notaCfg.iva_pct) || 0));
    const igtfPctNum = Math.max(0, Math.min(100, parseFloat(notaCfg.igtf_pct) || 0));

    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO presupuestos (fecha, cliente, cliente_doc, telefono, tasa_bcv, descuento, iva_pct, igtf_pct, total_bs, total_usd, total_bs_iva, total_usd_iva, valido_hasta, estado, notas, usuario_id, empresa_id, nivel_precio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, 'activo', ?, ?, ?, ?)
      `).run(fecha, clienteSafe, cedulaSafe, telefonoSafe, tasa, descuentoNum, ivaPctNum, igtfPctNum, notasSafe, req.usuario?.id || null, empresaId, nivelPrecioSafe);

      const presupuestoId = info.lastInsertRowid;

      for (const item of items) {
        const codigo = safeStr(item.codigo, 64).toUpperCase();
        const cantidad = parseInt(item.cantidad, 10);
        const producto = db.prepare('SELECT id, codigo, descripcion, precio_usd, deposito_id FROM productos WHERE codigo = ? AND empresa_id = ?').get(codigo, empresaId);
        if (!producto) throw new Error(`Producto ${codigo} no existe`);

        let precio = Number(producto.precio_usd || 0);
        if (item.precio_usd !== undefined && item.precio_usd !== null) {
          const fromPayload = Number(item.precio_usd);
          if (!Number.isNaN(fromPayload) && fromPayload >= 0 && fromPayload <= 1e9) {
            precio = fromPayload;
          }
        }
        const subtotalUsd = precio * cantidad;
        const subtotalBs = subtotalUsd * tasa;
        totalUsd += subtotalUsd;
        totalBs += subtotalBs;

        let depId = null;
        if (item.deposito_id !== undefined && item.deposito_id !== null && item.deposito_id !== '') {
          const parsedDep = Number(item.deposito_id);
          if (!Number.isNaN(parsedDep)) depId = parsedDep;
        } else if (producto.deposito_id != null) {
          depId = Number(producto.deposito_id);
        }

        let depNombre = null;
        if (depId != null) {
          const dep = db.prepare('SELECT nombre FROM depositos WHERE id = ?').get(depId);
          if (dep && dep.nombre) depNombre = dep.nombre.toString();
        }

        db.prepare(`
          INSERT INTO presupuesto_detalle (presupuesto_id, producto_id, codigo, descripcion, cantidad, precio_usd, subtotal_bs, deposito_id, deposito_nombre)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(presupuestoId, producto.id, producto.codigo, producto.descripcion || '', cantidad, precio, subtotalBs, depId, depNombre);
      }

      const descuentoAplicadoUsd = Math.min(descuentoNum, totalUsd);
      const descuentoAplicadoBs = descuentoAplicadoUsd * tasa;
      const totalBsFinal = Math.max(0, totalBs - descuentoAplicadoBs);
      const totalUsdFinal = Math.max(0, totalUsd - descuentoAplicadoUsd);

      const factorImpuestos = 1 + (ivaPctNum / 100) + (igtfPctNum / 100);
      const totalBsIva = totalBsFinal * factorImpuestos;
      const totalUsdIva = totalUsdFinal * factorImpuestos;

      db.prepare('UPDATE presupuestos SET descuento = ?, total_bs = ?, total_usd = ?, iva_pct = ?, igtf_pct = ?, total_bs_iva = ?, total_usd_iva = ? WHERE id = ?')
        .run(descuentoAplicadoUsd, totalBsFinal, totalUsdFinal, ivaPctNum, igtfPctNum, totalBsIva, totalUsdIva, presupuestoId);

      return presupuestoId;
    });

    const presupuestoId = tx();
    res.json({ ok: true, presupuestoId });
  } catch (err) {
    console.error('Error creando presupuesto:', err.message);
    res.status(400).json({ error: err.message || 'Error creando presupuesto' });
  }
});

// Eliminar un presupuesto (y su detalle) para la empresa actual
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    if (!empresaId) return res.status(400).json({ error: 'Usuario sin empresa asociada' });

    const existente = db.prepare('SELECT id FROM presupuestos WHERE id = ? AND empresa_id = ?').get(id, empresaId);
    if (!existente) return res.status(404).json({ error: 'Presupuesto no encontrado' });

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM presupuesto_detalle WHERE presupuesto_id = ?').run(id);
      db.prepare('DELETE FROM presupuestos WHERE id = ?').run(id);
    });

    tx();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando presupuesto:', err.message);
    res.status(500).json({ error: 'Error eliminando presupuesto' });
  }
});

module.exports = router;