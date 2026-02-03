const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./auth');
const {
  ajustarStock,
  listarAjustes,
  obtenerTasaBcv,
  guardarTasaBcv,
  actualizarTasaBcvAutomatica,
  obtenerStockMinimo,
  guardarStockMinimo,
  obtenerConfigGeneral,
  guardarConfigGeneral,
  purgeTransactionalData,
} = require('../services/ajustesService');

// POST /admin/ajustes - Ajustar Stock (Entrada/Salida manual)
router.post('/', requireAuth, (req, res) => {
  try {
    ajustarStock(req.body || {});
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

// GET /admin/ajustes - Listar ajustes (últimos 100 por defecto)
router.get('/', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const rows = listarAjustes(limit);
    res.json(rows);
  } catch (err) {
    console.error('Error listando ajustes:', err);
    res.status(500).json({ error: 'Error al listar ajustes' });
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
    const data = obtenerConfigGeneral();
    res.json(data);
  } catch (err) {
    console.error('Error obteniendo config general', err.message);
    res.status(500).json({ error: 'No se pudo obtener configuración' });
  }
});

router.post('/config', requireAuth, (req, res) => {
  try {
    const result = guardarConfigGeneral(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('Error guardando config general', err.message);
    res.status(500).json({ error: 'No se pudo guardar configuración' });
  }
});

// POST /admin/ajustes/purge-data - borrar datos transaccionales
router.post('/purge-data', requireAuth, requireRole('admin'), (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'BORRAR') {
    return res.status(400).json({ error: 'Confirmación inválida' });
  }

  try {
    purgeTransactionalData();
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