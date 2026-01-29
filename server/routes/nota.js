const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const { requireAuth } = require('./auth');
const tplCompact = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template-compact.js'));
const tplStandard = require(path.join(__dirname, '..', '..', 'public', 'shared', 'nota-template.js'));

router.get('/:id', requireAuth, async (req, res) => {
  const ventaId = req.params.id;

  const venta = db.prepare(`
    SELECT * FROM ventas WHERE id = ?
  `).get(ventaId);

  if (!venta) {
    return res.status(404).send('Venta no encontrada');
  }

  const detalles = db.prepare(`
    SELECT vd.cantidad, vd.precio_usd, vd.subtotal_bs, p.descripcion, p.codigo
    FROM venta_detalle vd
    JOIN productos p ON p.id = vd.producto_id
    WHERE vd.venta_id = ?
  `).all(ventaId);

  try {
    // Leer configuración para escoger plantilla (compact/standard) y datos de empresa
    const cfgNotaRow = db.prepare(`SELECT valor FROM config WHERE clave='nota_config'`).get();
    const cfgEmpresaRow = db.prepare(`SELECT valor FROM config WHERE clave='empresa_config'`).get();
    let layout = 'compact';
    let empresa = {};
    let notaCfg = {};
    if (cfgNotaRow && cfgNotaRow.valor) {
      try { notaCfg = JSON.parse(cfgNotaRow.valor) || {}; layout = notaCfg.layout || 'compact'; } catch {}
    }
    if (cfgEmpresaRow && cfgEmpresaRow.valor) {
      try { empresa = JSON.parse(cfgEmpresaRow.valor); } catch {}
    }
    // Pasar datos de empresa y marcas igual que en demo, con lógica robusta para el nombre
    // Lógica robusta: prioriza empresa_config.nombre, luego nota_config, nunca "EMPRESA" si hay uno válido
    let empresaNombre = '';
    if (empresa && typeof empresa.nombre === 'string' && empresa.nombre.trim()) {
      empresaNombre = empresa.nombre.trim();
    } else if (notaCfg && typeof notaCfg.empresa_nombre === 'string' && notaCfg.empresa_nombre.trim()) {
      empresaNombre = notaCfg.empresa_nombre.trim();
    } else if (notaCfg && typeof notaCfg.nombre === 'string' && notaCfg.nombre.trim()) {
      empresaNombre = notaCfg.nombre.trim();
    }
    // Si sigue vacío, intenta leer de configGeneral (caso navegador, por compatibilidad futura)
    if (!empresaNombre && typeof global !== 'undefined' && global.configGeneral && global.configGeneral.empresa && global.configGeneral.empresa.nombre) {
      empresaNombre = global.configGeneral.empresa.nombre.trim();
    }
    // Si aún no hay nombre, último recurso: 'EMPRESA'
    if (!empresaNombre) empresaNombre = 'EMPRESA';
    // ADVERTENCIA: Si el nombre es 'EMPRESA', loguea advertencia para diagnóstico
    if (empresaNombre === 'EMPRESA') {
      console.warn('[ADVERTENCIA] El nombre de la empresa no está configurado correctamente en la base de datos. Verifica la clave empresa_config en la tabla config.');
    }
    const ventaConEmpresa = {
      ...venta,
      empresa_nombre: empresaNombre,
      empresa_logo_url: empresa.logo_url || notaCfg.header_logo_url || '',
      empresa_ubicacion: empresa.ubicacion || notaCfg.ubicacion || '',
      empresa_rif: empresa.rif || notaCfg.rif || '',
      empresa_telefonos: empresa.telefonos || notaCfg.telefonos || '',
      empresa_marcas: Array.isArray(notaCfg.brand_logos) ? notaCfg.brand_logos : [],
      empresa_encabezado: notaCfg.encabezado_texto || '',
      empresa: {
        nombre: empresaNombre,
        logo_url: empresa.logo_url || notaCfg.header_logo_url || '',
        ubicacion: empresa.ubicacion || notaCfg.ubicacion || '',
        rif: empresa.rif || notaCfg.rif || '',
        telefonos: empresa.telefonos || notaCfg.telefonos || ''
      }
    };
    const tpl = layout === 'standard' ? tplStandard : tplCompact;
    const html = tpl && tpl.buildNotaHTML
      ? await tpl.buildNotaHTML({ venta: ventaConEmpresa, detalles })
      : '<html><body><pre>Plantilla no disponible</pre></body></html>';

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html || '<html><body><pre>Nota vacía</pre></body></html>');
  } catch (err) {
    console.error('Error construyendo nota:', err);
    res.status(500).send('Error generando la nota');
  }
});

module.exports = router;