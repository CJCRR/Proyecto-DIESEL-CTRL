const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

// POST /admin/ajustes - Ajustar Stock (Entrada/Salida manual)
router.post('/', requireAuth, (req, res) => {
  const { codigo, diferencia, motivo } = req.body;
  const diff = parseInt(diferencia);

  if (!codigo || isNaN(diff) || diff === 0 || !motivo) {
    return res.status(400).json({ error: 'Datos inválidos. Se requiere código, diferencia distinta de 0 y motivo.' });
  }

  try {
    // Usamos una transacción para asegurar que el inventario no cambie 
    // sin que quede registrado el log en ajustes_stock.
    db.transaction(() => {
      const producto = db.prepare('SELECT id, stock FROM productos WHERE codigo = ?').get(codigo);

      if (!producto) throw new Error('PRODUCTO_NO_ENCONTRADO');

      // Evitar stock negativo
      const nuevoStock = producto.stock + diff;
      if (nuevoStock < 0) throw new Error('STOCK_NEGATIVO');

      // 1. Actualizar Producto
      db.prepare('UPDATE productos SET stock = ? WHERE id = ?').run(nuevoStock, producto.id);

      // 2. Registrar Auditoría
      db.prepare(`
                INSERT INTO ajustes_stock (producto_id, diferencia, motivo, fecha)
                VALUES (?, ?, ?, ?)
            `).run(producto.id, diff, motivo, new Date().toISOString());

    })(); // Ejecutar transacción inmediatamente

    res.json({ message: 'Ajuste de inventario procesado correctamente.' });

  } catch (err) {
    console.error('Error en ajuste:', err.message);
    if (err.message === 'PRODUCTO_NO_ENCONTRADO') return res.status(404).json({ error: 'Producto no encontrado.' });
    if (err.message === 'STOCK_NEGATIVO') return res.status(400).json({ error: 'El ajuste dejaría el stock en negativo.' });
    res.status(500).json({ error: 'Error interno al procesar ajuste.' });
  }
});

module.exports = router;

// GET /admin/ajustes - Listar ajustes (últimos 100 por defecto)
router.get('/', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const rows = db.prepare(`
      SELECT a.id, a.producto_id, p.codigo, p.descripcion, a.diferencia, a.motivo, a.fecha
      FROM ajustes_stock a
      LEFT JOIN productos p ON p.id = a.producto_id
      ORDER BY a.fecha DESC
      LIMIT ?
    `).all(limit);
    res.json(rows);
  } catch (err) {
    console.error('Error listando ajustes:', err);
    res.status(500).json({ error: 'Error al listar ajustes' });
  }
});

// ====== CONFIG Y TASA BCV ======

// Utilidad: obtener valor de config
function getConfig(clave, def = null) {
  const row = db.prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  if (!row || row.valor === undefined || row.valor === null) return def;
  return row.valor;
}

// Utilidad: setear valor de config
function setConfig(clave, valor, fecha = new Date().toISOString()) {
  db.prepare(`INSERT INTO config (clave, valor, actualizado_en) VALUES (?, ?, ?)
              ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actualizado_en=excluded.actualizado_en`)
    .run(clave, String(valor), fecha);
}

// GET /ajustes/tasa-bcv
router.get('/tasa-bcv', requireAuth, (req, res) => {
  try {
    const row = db.prepare(`SELECT valor, actualizado_en FROM config WHERE clave='tasa_bcv'`).get();
    const valor = parseFloat(row?.valor ?? '1') || 1;
    res.json({ tasa_bcv: valor, actualizado_en: row?.actualizado_en || null });
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
    const now = new Date().toISOString();
    setConfig('tasa_bcv', t, now);
    res.json({ ok: true, tasa_bcv: t, actualizado_en: now });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar tasa' });
  }
});

// POST /ajustes/tasa-bcv/actualizar - intenta consultar fuentes públicas
router.post('/tasa-bcv/actualizar', requireAuth, async (req, res) => {
  const https = require('https');
  async function fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  async function fetchHTML(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8' } }, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  try {
    // Intentar varias fuentes conocidas
    let tasa = null;
    // 1) Scrape BCV oficial
    try {
      const html = await fetchHTML('https://www.bcv.org.ve/');
      // Patrones vistos en la página lateral: "USD" seguido de número con miles y coma decimal
      const patterns = [
        /USD\s*<\/strong>\s*([0-9\.]{3,9},[0-9]{2})/i,
        /USD[^0-9]+([0-9\.]{3,9},[0-9]{2})/i,
        /D(?:\u00f3|ó)lar\s+USD[^0-9]+([0-9\.]{3,9},[0-9]{2})/i
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) {
          tasa = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
          if (!isNaN(tasa) && tasa > 0) break;
        }
      }
    } catch {}

    // 2) API comunitaria
    if (!tasa || isNaN(tasa)) {
      try {
        const j = await fetchJSON('https://pydolarve.org/api/v1/dollar?page=bcv');
        tasa = parseFloat(j?.monitors?.bcv?.price || j?.bcv?.price || j?.price || j?.promedio || j?.[0]?.price);
      } catch {}
    }
    // 3) Otra API comunitaria
    if (!tasa || isNaN(tasa)) {
      try {
        const j2 = await fetchJSON('https://pydolarvenezuela-api.vercel.app/api/v1/dollar');
        tasa = parseFloat(j2?.bcv?.price || j2?.BCV?.promedio || j2?.BCV?.price);
      } catch {}
    }
    // 4) Fallback USD->VES promedio
    if (!tasa || isNaN(tasa)) {
      try {
        const j3 = await fetchJSON('https://api.exchangerate.host/latest?base=USD&symbols=VES');
        tasa = parseFloat(j3?.rates?.VES);
      } catch {}
    }

    const previa = parseFloat(getConfig('tasa_bcv', '1')) || 1;
    if (!tasa || isNaN(tasa) || tasa <= 0) {
      // No interrumpir el flujo: devolver la previa con ok:false
      return res.status(200).json({ ok: false, tasa_bcv: previa, error: 'No fue posible obtener la tasa automáticamente' });
    }

    const now = new Date().toISOString();
    setConfig('tasa_bcv', tasa, now);
    res.json({ ok: true, tasa_bcv: tasa, previa, actualizado_en: now });
  } catch (err) {
    console.error('Error actualizando tasa:', err.message);
    const previa = parseFloat(getConfig('tasa_bcv', '1')) || 1;
    res.status(200).json({ ok: false, tasa_bcv: previa, error: 'Error actualizando tasa' });
  }
});

// GET /ajustes/stock-minimo
router.get('/stock-minimo', requireAuth, (req, res) => {
  try {
    const v = parseInt(getConfig('stock_minimo', '3')) || 3;
    res.json({ stock_minimo: v });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo obtener stock mínimo' });
  }
});

// POST /ajustes/stock-minimo { stock_minimo }
router.post('/stock-minimo', requireAuth, (req, res) => {
  const n = parseInt(req.body?.stock_minimo);
  if (isNaN(n) || n < 0) return res.status(400).json({ error: 'Valor inválido' });
  try {
    setConfig('stock_minimo', n);
    res.json({ ok: true, stock_minimo: n });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo guardar stock mínimo' });
  }
});