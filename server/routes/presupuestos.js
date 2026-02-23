const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');
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

router.get('/', requireAuth, (req, res) => {
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
      SELECT pd.*, p.stock
      FROM presupuesto_detalle pd
      LEFT JOIN productos p ON p.id = pd.producto_id
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
      SELECT pd.cantidad, pd.precio_usd, pd.subtotal_bs, pd.descripcion, pd.codigo
      FROM presupuesto_detalle pd
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
      // Este campo se usará en la plantilla para mostrar el NRO
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
      : '<html><body><pre>Plantilla no disponible</pre></body></html>';

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html || '<html><body><pre>Presupuesto vacío</pre></body></html>');
  } catch (err) {
    console.error('Error construyendo nota de presupuesto:', err.message);
    res.status(500).send('Error generando la nota');
  }
});

router.post('/', requireAuth, (req, res) => {
  const {
    items,
    cliente,
    cedula = '',
    telefono = '',
    tasa_bcv,
    descuento = 0,
    notas = ''
  } = req.body || {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El presupuesto no contiene productos.' });
  }
  if (items.length > MAX_ITEMS) {
    return res.status(400).json({ error: 'Demasiados items en el presupuesto.' });
  }
  const clienteSafe = safeStr(cliente, MAX_TEXT);
  if (!clienteSafe) return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
  const cedulaSafe = safeStr(cedula, MAX_DOC);
  const telefonoSafe = safeStr(telefono, MAX_DOC);
  const notasSafe = safeStr(notas, MAX_NOTAS);

  const tasa = parseFloat(tasa_bcv);
  if (!tasa || Number.isNaN(tasa) || tasa <= 0) {
    return res.status(400).json({ error: 'Tasa BCV inválida.' });
  }
  const descuentoNum = Math.max(0, Math.min(100, parseFloat(descuento) || 0));

  for (const item of items) {
    const codigo = safeStr(item.codigo, 64);
    const cantidad = parseInt(item.cantidad, 10);
    if (!codigo || Number.isNaN(cantidad) || cantidad <= 0 || cantidad > 100000) {
      return res.status(400).json({ error: 'Item inválido en el presupuesto.' });
    }
  }

  try {
    const fecha = new Date().toISOString();
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;

    if (!empresaId) {
      return res.status(400).json({ error: 'Usuario sin empresa asociada' });
    }
    let totalBs = 0;
    let totalUsd = 0;

    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO presupuestos (fecha, cliente, cliente_doc, telefono, tasa_bcv, descuento, total_bs, total_usd, valido_hasta, estado, notas, usuario_id, empresa_id)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, 'activo', ?, ?, ?)
      `).run(fecha, clienteSafe, cedulaSafe, telefonoSafe, tasa, descuentoNum, notasSafe, req.usuario?.id || null, empresaId);

      const presupuestoId = info.lastInsertRowid;

      for (const item of items) {
        const codigo = safeStr(item.codigo, 64).toUpperCase();
        const cantidad = parseInt(item.cantidad, 10);
        const producto = db.prepare('SELECT id, codigo, descripcion, precio_usd FROM productos WHERE codigo = ? AND empresa_id = ?').get(codigo, empresaId);
        if (!producto) throw new Error(`Producto ${codigo} no existe`);

        const precio = Number(producto.precio_usd || 0);
        const subtotalUsd = precio * cantidad;
        const subtotalBs = subtotalUsd * tasa;
        totalUsd += subtotalUsd;
        totalBs += subtotalBs;

        db.prepare(`
          INSERT INTO presupuesto_detalle (presupuesto_id, producto_id, codigo, descripcion, cantidad, precio_usd, subtotal_bs)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(presupuestoId, producto.id, producto.codigo, producto.descripcion || '', cantidad, precio, subtotalBs);
      }

      const multiplicador = 1 - (descuentoNum / 100);
      const totalBsFinal = totalBs * multiplicador;
      const totalUsdFinal = totalUsd * multiplicador;

      db.prepare('UPDATE presupuestos SET total_bs = ?, total_usd = ? WHERE id = ?')
        .run(totalBsFinal, totalUsdFinal, presupuestoId);

      return presupuestoId;
    });

    const presupuestoId = tx();
    res.json({ ok: true, presupuestoId });
  } catch (err) {
    console.error('Error creando presupuesto:', err.message);
    res.status(400).json({ error: err.message || 'Error creando presupuesto' });
  }
});

module.exports = router;
