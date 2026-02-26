const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./auth');
const { registrarAuditoria } = require('../services/auditLogService');
const {
  ajustarStock,
  listarAjustes,
  reconciliarStockEmpresa,
  obtenerTasaBcv,
  guardarTasaBcv,
  actualizarTasaBcvAutomatica,
  obtenerStockMinimo,
  guardarStockMinimo,
  obtenerConfigGeneral,
  guardarConfigGeneral,
  obtenerBrandingGlobal,
  guardarBrandingGlobal,
  purgeTransactionalData,
} = require('../services/ajustesService');

// POST /admin/ajustes - Ajustar Stock (Entrada/Salida manual)
router.post('/', requireAuth, (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    ajustarStock({ ...(req.body || {}), empresa_id: empresaId });
    try {
      registrarAuditoria({
        usuario: req.usuario,
        accion: 'AJUSTE_STOCK',
        entidad: 'ajuste_stock',
        entidadId: null,
        detalle: req.body || {},
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (_err) {
      // no romper flujo si auditoría falla
    }
    res.json({ message: 'Ajuste de inventario procesado correctamente.' });
  } catch (err) {
    console.error('Error en ajuste:', err.message);
    if (err.message === 'PRODUCTO_NO_ENCONTRADO') {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    if (err.message === 'STOCK_NEGATIVO') {
      return res.status(400).json({ error: 'El ajuste dejaría el stock en negativo.' });
    }
    if (err.tipo === 'VALIDACION') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Error interno al procesar ajuste.' });
  }
});

// GET /admin/ajustes - Listar ajustes (últimos 100 por defecto, opcional filtro por código)
router.get('/', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const codigo = req.query.codigo ? String(req.query.codigo).trim().toUpperCase() : null;
    const rows = listarAjustes(limit, codigo || undefined);
    res.json(rows);
  } catch (err) {
    console.error('Error listando ajustes:', err);
    res.status(500).json({ error: 'Error al listar ajustes' });
  }
});

// POST /admin/ajustes/rebuild-stock - Recalcular stock desde stock_por_deposito (solo roles altos)
router.post('/rebuild-stock', requireAuth, requireRole('admin', 'admin_empresa', 'superadmin'), (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : 1;
    const info = reconciliarStockEmpresa(empresaId);
    res.json(info);
  } catch (err) {
    console.error('Error reconciliando stock de inventario:', err.message);
    res.status(500).json({ error: 'Error al recalcular stock de inventario' });
  }
});

// ====== CONFIG Y TASA BCV ======

// GET /ajustes/tasa-bcv
router.get('/tasa-bcv', requireAuth, (req, res) => {
  try {
    const data = obtenerTasaBcv();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo obtener tasa' });
  }
});

// POST /ajustes/tasa-bcv  { tasa_bcv }
router.post('/tasa-bcv', requireAuth, (req, res) => {
  const { tasa_bcv } = req.body || {};
  const t = parseFloat(tasa_bcv);
  if (!t || isNaN(t) || t <= 0) return res.status(400).json({ error: 'Tasa inválida' });
  try {
    const result = guardarTasaBcv(t);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar tasa' });
  }
});

// POST /ajustes/tasa-bcv/actualizar - intenta consultar fuentes públicas
router.post('/tasa-bcv/actualizar', requireAuth, async (req, res) => {
  try {
    const result = await actualizarTasaBcvAutomatica();
    res.status(200).json(result);
  } catch (err) {
    console.error('Error actualizando tasa (handler):', err.message);
    res.status(200).json({ ok: false, tasa_bcv: 1, error: 'Error actualizando tasa' });
  }
});

// GET /ajustes/stock-minimo
router.get('/stock-minimo', requireAuth, (req, res) => {
  try {
    const data = obtenerStockMinimo();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo obtener stock mínimo' });
  }
});

// POST /ajustes/stock-minimo { stock_minimo }
router.post('/stock-minimo', requireAuth, (req, res) => {
  const n = parseInt(req.body?.stock_minimo);
  if (isNaN(n) || n < 0) return res.status(400).json({ error: 'Valor inválido' });
  try {
    const result = guardarStockMinimo(n);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar stock mínimo' });
  }
});

router.get('/config', requireAuth, (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const data = obtenerConfigGeneral(empresaId);
    res.json(data);
  } catch (err) {
    console.error('Error obteniendo config general', err.message);
    res.status(500).json({ error: 'No se pudo obtener configuración' });
  }
});

router.post('/config', requireAuth, (req, res) => {
  try {
    const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
    const result = guardarConfigGeneral(req.body || {}, empresaId);
    res.json(result);
  } catch (err) {
    console.error('Error guardando config general', err.message);
    res.status(500).json({ error: 'No se pudo guardar configuración' });
  }
});

// ===== BRANDING GLOBAL DEL PANEL (nombre visible para todas las empresas) =====

// Público: cualquier visitante (incluido el login) puede leer el branding
router.get('/branding', (req, res) => {
  try {
    const data = obtenerBrandingGlobal();
    res.json(data);
  } catch (err) {
    console.error('Error obteniendo branding global', err.message);
    res.status(500).json({ error: 'No se pudo obtener branding' });
  }
});

router.post('/branding', requireAuth, requireRole('superadmin'), (req, res) => {
  try {
    const result = guardarBrandingGlobal(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('Error guardando branding global', err.message);
    res.status(500).json({ error: 'No se pudo guardar branding' });
  }
});

// POST /admin/ajustes/purge-data - borrar datos transaccionales
router.post('/purge-data', requireAuth, requireRole('admin'), (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'BORRAR') {
    return res.status(400).json({ error: 'Confirmación inválida' });
  }

  const empresaId = req.usuario && req.usuario.empresa_id ? req.usuario.empresa_id : null;
  if (!empresaId) {
    return res.status(400).json({ error: 'No se pudo determinar la empresa del usuario' });
  }

  try {
    purgeTransactionalData(empresaId);
    try {
      registrarAuditoria({
        usuario: req.usuario,
        accion: 'PURGE_TRANSACCIONAL',
        entidad: 'empresa',
        entidadId: empresaId,
        detalle: { empresaId },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (_err) {
      // no romper flujo si auditoría falla
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error borrando datos:', err.message);
    res.status(500).json({ error: 'No se pudo borrar la base de datos' });
  }
});

// ==== Upload de imágenes (data URL) ====
const fs = require('fs');
const path = require('path');
router.post('/upload-image', requireAuth, (req, res) => {
  try {
    const { dataUrl, filename } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ error: 'Formato inválido. Se espera data URL.' });
    }
    const match = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
    if (!match) return res.status(400).json({ error: 'Solo se permiten imágenes PNG/JPG/WebP en base64.' });
    const ext = match[2].toLowerCase() === 'jpeg' ? 'jpg' : match[2].toLowerCase();
    const base64 = match[3];
    const buffer = Buffer.from(base64, 'base64');
    const safeName = (filename || `img_${Date.now()}`).replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
    const uploadsDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, `${Date.now()}_${safeName}.${ext}`);
    fs.writeFileSync(filePath, buffer);
    const url = `/uploads/${path.basename(filePath)}`;
    res.json({ ok: true, url });
  } catch (err) {
    console.error('Upload falló:', err.message);
    res.status(500).json({ error: 'No se pudo subir imagen' });
  }
});

module.exports = router;