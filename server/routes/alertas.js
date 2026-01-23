const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

function insertAlerta(tipo, mensaje, dataObj = {}) {
  try {
    db.prepare(`INSERT INTO alertas (tipo, mensaje, data, leido, creado_en) VALUES (?, ?, ?, 0, datetime('now'))`)
      .run(tipo, mensaje, JSON.stringify(dataObj || {}));
  } catch (err) {
    console.warn('No se pudo insertar alerta', err.message);
  }
}

function getConfig(clave, def = null) {
  const row = db.prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  if (!row || row.valor === undefined || row.valor === null) return def;
  return row.valor;
}

function todayLocalISO() {
  const d = new Date();
  const tzAdj = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tzAdj.toISOString().slice(0, 10);
}

function getMorosos() {
  const hoyISO = todayLocalISO();
  return db.prepare(`
    SELECT *,
      CASE
        WHEN saldo_usd <= 0.00001 THEN 'cancelado'
        WHEN saldo_usd < total_usd THEN 'parcial'
        WHEN substr(fecha_vencimiento,1,10) <= ? THEN 'vencido'
        ELSE 'pendiente'
      END as estado_calc
    FROM cuentas_cobrar
    WHERE saldo_usd > 0 AND substr(fecha_vencimiento,1,10) <= ?
    ORDER BY substr(fecha_vencimiento,1,10) ASC
  `).all(hoyISO, hoyISO);
}

router.get('/stock', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT codigo, descripcion, stock
      FROM productos
      WHERE stock <= 0
      ORDER BY stock ASC, codigo ASC
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('Error alertas stock:', err);
    res.status(500).json({ error: 'No se pudo obtener alertas de stock' });
  }
});

router.get('/morosos', requireAuth, (req, res) => {
  try {
    const rows = getMorosos();
    res.json(rows);
  } catch (err) {
    console.error('Error alertas morosos:', err);
    res.status(500).json({ error: 'No se pudo obtener clientes morosos' });
  }
});

router.get('/resumen', requireAuth, (req, res) => {
  try {
    const stockCero = db.prepare(`SELECT COUNT(*) as c FROM productos WHERE stock <= 0`).get().c;
    const morosos = getMorosos();
    // Tareas pendientes: por ahora usamos cantidad de morosos + stock en cero
    const tareas = stockCero + morosos.length;
    res.json({ stock_cero: stockCero, morosos: morosos.length, tareas });
  } catch (err) {
    console.error('Error resumen alertas:', err);
    res.status(500).json({ error: 'No se pudo obtener resumen de alertas' });
  }
});

// Tareas: stock bajo (umbral configurable), morosos vencidos, backup desactualizado
router.get('/tareas', requireAuth, (req, res) => {
  try {
    const override = parseInt(req.query.umbral);
    const stockMin = Number.isFinite(override) ? Math.max(0, override) : (parseInt(getConfig('stock_minimo', '3')) || 3);
    const stockBajo = db.prepare(`
      SELECT codigo, descripcion, stock
      FROM productos
      WHERE CAST(stock AS INTEGER) <= ?
      ORDER BY CAST(stock AS INTEGER) ASC, codigo ASC
    `).all(stockMin);

    const morosos = getMorosos();

    const backupDir = path.join(__dirname, '..', 'backups');
    let ultimaBackup = null;
    try {
      const files = fs.readdirSync(backupDir);
      let latest = null;
      files.forEach(f => {
        const full = path.join(backupDir, f);
        const stat = fs.statSync(full);
        if (!stat.isFile()) return;
        if (!latest || stat.mtimeMs > latest.mtimeMs) {
          latest = { name: f, mtimeMs: stat.mtimeMs };
        }
      });
      if (latest) {
        ultimaBackup = { nombre: latest.name, fecha: new Date(latest.mtimeMs).toISOString() };
      }
    } catch (err) {
      // Si no existe la carpeta o no se puede leer, seguimos con null
    }

    const horasDesdeUltima = ultimaBackup ? (Date.now() - new Date(ultimaBackup.fecha).getTime()) / 36e5 : null;
    const necesitaBackup = horasDesdeUltima === null || horasDesdeUltima > 24;

    res.json({
      stock_bajo: stockBajo,
      morosos,
      backup: {
        ultima: ultimaBackup,
        horas_desde_ultima: horasDesdeUltima,
        necesita_backup: necesitaBackup
      }
    });
  } catch (err) {
    console.error('Error alertas tareas:', err);
    res.status(500).json({ error: 'No se pudo obtener tareas' });
  }
});

module.exports = { router, insertAlerta };
