const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

function agregarMetricaVenta(empresaId, payload) {
  if (!empresaId || !payload) return;

  const fechaIso = payload.fecha || new Date().toISOString();
  const fechaDia = String(fechaIso).split('T')[0];

  let totalBs = Number(payload.total_bs || 0) || 0;
  let totalUsd = Number(payload.total_usd || 0) || 0;

  const tasa = Number(payload.tasa_bcv || 0) || 0;

  if ((!totalBs || totalBs <= 0) && Array.isArray(payload.items)) {
    for (const it of payload.items) {
      const cantidad = Number(it.cantidad || 0) || 0;
      const precioUsd = Number(it.precio_usd || 0) || 0;
      const subBs = it.subtotal_bs != null
        ? Number(it.subtotal_bs || 0)
        : (tasa > 0 ? cantidad * precioUsd * tasa : 0);
      totalBs += subBs;
      totalUsd += (precioUsd * cantidad);
    }
  }

  if ((!totalUsd || totalUsd <= 0) && tasa > 0 && totalBs > 0) {
    totalUsd = totalBs / tasa;
  }

  const stmt = db.prepare(`
    INSERT INTO empresa_metricas_diarias (empresa_id, fecha, ventas_count, total_bs, total_usd)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(empresa_id, fecha) DO UPDATE SET
      ventas_count = ventas_count + 1,
      total_bs = total_bs + excluded.total_bs,
      total_usd = total_usd + excluded.total_usd,
      actualizado_en = datetime('now')
  `);

  stmt.run(empresaId, fechaDia, totalBs, totalUsd);
}

// POST /sync/push - recibir lote de eventos desde una instalación local
router.post('/push', requireAuth, (req, res) => {
  const usuario = req.usuario;

  if (!usuario || !usuario.empresa_id) {
    return res.status(400).json({ error: 'Solo usuarios de empresa pueden sincronizar datos' });
  }

  const { origen, eventos } = req.body || {};

  if (!Array.isArray(eventos) || eventos.length === 0) {
    return res.status(400).json({ error: 'Se requiere un arreglo de eventos' });
  }

  const origenStr = String(origen || 'local');

  const tx = db.transaction((items) => {
    const insertInbox = db.prepare(`
      INSERT OR IGNORE INTO sync_inbox (empresa_id, origen, evento_uid, tipo, entidad, payload_original)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const results = [];

    for (const ev of items) {
      const { evento_uid, tipo, entidad, payload } = ev || {};
      if (!evento_uid || !tipo || !entidad) {
        results.push({ evento_uid: evento_uid || null, status: 'error', error: 'Evento inválido: faltan campos requeridos' });
        continue;
      }

      try {
        const info = insertInbox.run(
          usuario.empresa_id,
          origenStr,
          String(evento_uid),
          String(tipo),
          String(entidad),
          JSON.stringify(payload || {})
        );

        if (info.changes > 0) {
          // Evento nuevo: actualizar métricas si es una venta
          if (String(tipo) === 'venta_registrada' && String(entidad) === 'venta') {
            try {
              agregarMetricaVenta(usuario.empresa_id, payload || {});
            } catch (e) {
              // No se rompe la sync si falla la métrica
            }
          }
          results.push({ evento_uid, status: 'ok' });
        } else {
          // Evento duplicado (ya procesado)
          results.push({ evento_uid, status: 'duplicado' });
        }
      } catch (err) {
        results.push({ evento_uid, status: 'error', error: err.message });
      }
    }

    return results;
  });

  try {
    const results = tx(eventos);
    res.json({ success: true, results });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en /sync/push:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al procesar sincronización' });
  }
});

// GET /sync/pull - (futuro) devolver cambios desde la nube hacia una instalación local
router.get('/pull', requireAuth, (req, res) => {
  const usuario = req.usuario;

  if (!usuario || !usuario.empresa_id) {
    return res.status(400).json({ error: 'Solo usuarios de empresa pueden sincronizar datos' });
  }

  // Por ahora no implementamos lógica de envío de cambios desde la nube.
  // Se deja el endpoint preparado para extender en fases siguientes.
  res.json({ success: true, eventos: [] });
});

// GET /sync/reportes/empresas-diario - resumen tipo "Drive" por empresa (solo superadmin)
router.get('/reportes/empresas-diario', requireAuth, requireRole('superadmin'), (req, res) => {
  const { desde, hasta } = req.query;

  try {
    const where = [];
    const params = [];

    if (desde) {
      where.push('m.fecha >= ?');
      params.push(String(desde));
    }
    if (hasta) {
      where.push('m.fecha <= ?');
      params.push(String(hasta));
    }

    let sql = `
      SELECT
        e.id AS empresa_id,
        e.nombre,
        e.codigo,
        m.fecha,
        m.ventas_count,
        m.total_bs,
        m.total_usd
      FROM empresa_metricas_diarias m
      JOIN empresas e ON e.id = m.empresa_id
    `;

    if (where.length) {
      sql += ' WHERE ' + where.join(' AND ');
    }

    sql += ' ORDER BY e.nombre ASC, m.fecha DESC';

    const filas = db.prepare(sql).all(...params);
    res.json(filas);
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en /sync/reportes/empresas-diario:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al obtener reporte de empresas' });
  }
});

module.exports = router;
