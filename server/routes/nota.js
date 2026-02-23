const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const { requireAuth } = require('./auth');
const { obtenerConfigGeneral } = require('../services/ajustesService');
const tplCompact = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template-compact.js'));
const tplStandard = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template.js'));

router.get('/:id', requireAuth, async (req, res) => {
  const ventaId = req.params.id;

  // Traer la venta junto con la empresa del usuario que la registró
  const venta = db.prepare(`
    SELECT v.*, u.empresa_id AS empresa_id
    FROM ventas v
    LEFT JOIN usuarios u ON u.id = v.usuario_id
    WHERE v.id = ?
  `).get(ventaId);

  if (!venta) {
    return res.status(404).send('Venta no encontrada');
  }

  // Control extra de seguridad multiempresa: si el usuario actual pertenece
  // a una empresa específica, no debe poder ver ventas de otra empresa.
  if (req.usuario && req.usuario.empresa_id !== null && req.usuario.empresa_id !== undefined) {
    if (venta.empresa_id !== null && venta.empresa_id !== undefined && venta.empresa_id !== req.usuario.empresa_id) {
      return res.status(403).send('No autorizado para ver esta venta');
    }
  }

  const detalles = db.prepare(`
    SELECT vd.cantidad, vd.precio_usd, vd.subtotal_bs, p.descripcion, p.codigo
    FROM venta_detalle vd
    JOIN productos p ON p.id = vd.producto_id
    WHERE vd.venta_id = ?
  `).all(ventaId);

  try {
    // Determinar empresa de la venta para config + correlativo de NRO
    const empresaId = venta.empresa_id != null
      ? venta.empresa_id
      : (req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null);

    // Calcular un número correlativo por empresa para mostrar en "NRO:".
    // Ej: primera venta de esa empresa => VENTA-1, luego VENTA-2, etc.
    let idGlobal = null;
    if (empresaId != null) {
      const filaSeq = db.prepare(`
        SELECT COUNT(*) AS n
        FROM ventas v2
        JOIN usuarios u2 ON u2.id = v2.usuario_id
        WHERE u2.empresa_id = ? AND v2.id <= ?
      `).get(empresaId, venta.id);
      const correlativo = filaSeq && filaSeq.n ? Number(filaSeq.n) : Number(venta.id);
      idGlobal = `VENTA-${correlativo}`;
    } else if (venta.id != null) {
      idGlobal = `VENTA-${venta.id}`;
    }

    // Leer configuración general por empresa (empresa + nota)
    const cfgGeneral = obtenerConfigGeneral(empresaId);
    const empresa = (cfgGeneral && cfgGeneral.empresa) || {};
    const notaCfg = (cfgGeneral && cfgGeneral.nota) || {};

    // Layout de la nota (compact o standard)
    const layout = notaCfg.layout === 'standard' ? 'standard' : 'compact';

    // Lógica robusta para el nombre de la empresa
    let empresaNombre = '';
    if (empresa && typeof empresa.nombre === 'string' && empresa.nombre.trim()) {
      empresaNombre = empresa.nombre.trim();
    } else if (notaCfg && typeof notaCfg.empresa_nombre === 'string' && notaCfg.empresa_nombre.trim()) {
      empresaNombre = notaCfg.empresa_nombre.trim();
    } else if (notaCfg && typeof notaCfg.nombre === 'string' && notaCfg.nombre.trim()) {
      empresaNombre = notaCfg.nombre.trim();
    }
    if (!empresaNombre) empresaNombre = 'EMPRESA';
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

    const ventaConEmpresa = {
      ...venta,
      // Este campo será utilizado por la plantilla para el "NRO:"
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
      ? await tpl.buildNotaHTML({ venta: ventaConEmpresa, detalles }, { notaCfg })
      : '<html><body><pre>Plantilla no disponible</pre></body></html>';

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html || '<html><body><pre>Nota vacía</pre></body></html>');
  } catch (err) {
    console.error('Error construyendo nota:', err);
    res.status(500).send('Error generando la nota');
  }
});

module.exports = router;