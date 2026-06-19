const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');
const bcrypt = require('bcryptjs');
const { registrarEventoNegocio } = require('../services/eventosService');
const { registrarAuditoria } = require('../services/auditLogService');
const {
  listarPagosLicenciaEmpresa,
  actualizarEstadoPagoLicencia,
  purgeTransactionalData,
  obtenerTasaBcv,
  obtenerConfigGeneral,
  guardarConfigGeneral,
  actualizarTasaBcvGeneralAutomatica,
  guardarTasaBcvGeneral,
} = require('../services/ajustesService');

function parseToggleValue(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function attachEmpresaFlags(empresa) {
  if (!empresa) return empresa;

  let empresaConfig = {};
  if (empresa.empresa_config_raw) {
    try {
      const parsed = JSON.parse(empresa.empresa_config_raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        empresaConfig = parsed;
      }
    } catch (_err) {
      empresaConfig = {};
    }
  }

  const { empresa_config_raw, ...rest } = empresa;
  return {
    ...rest,
    permitir_anular_venta: parseToggleValue(empresaConfig.permitir_anular_venta) === true,
  };
}

const WHATSAPP_ADMIN_CONFIG_KEY = 'whatsapp_admin_notificaciones';

function parseFechaLocal(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const simpleMatch = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = simpleMatch
    ? (() => {
        const [year, month, day] = raw.split('-').map(Number);
        return new Date(year, month - 1, day);
      })()
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function diffMonthsSince(value, baseDate = new Date()) {
  const start = parseFechaLocal(value);
  if (!start) return null;
  const end = new Date(baseDate.getTime());
  end.setHours(0, 0, 0, 0);
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

function getPuntualidadEmpresa(empresa = {}) {
  const estadoBase = String(empresa.estado || '').trim().toLowerCase() || 'activa';
  if (estadoBase === 'suspendida') {
    return { key: 'suspendida', label: 'Suspendida' };
  }

  const proximoCobro = parseFechaLocal(empresa.proximo_cobro);
  if (!proximoCobro) {
    return { key: 'sin_corte', label: 'Sin corte' };
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (hoy <= proximoCobro) {
    return { key: 'al_dia', label: 'Al día' };
  }

  const diasGracia = Number.isFinite(Number(empresa.dias_gracia)) ? Number(empresa.dias_gracia) : 0;
  const limite = addDays(proximoCobro, diasGracia);
  if (hoy <= limite) {
    return { key: 'en_gracia', label: 'En gracia' };
  }

  return { key: 'atrasada', label: 'Atrasada' };
}

function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function buildMonthWindow(count = 6) {
  const total = Math.max(1, Number(count) || 6);
  const now = new Date();
  const months = [];
  for (let index = total - 1; index >= 0; index -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - index, 1);
    months.push(getMonthKey(cursor));
  }
  return months;
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return String(monthKey || '');
  }
  const date = new Date(year, month - 1, 1);
  try {
    return date.toLocaleDateString('es-VE', { month: 'short', year: 'numeric' });
  } catch (_err) {
    return `${month}/${year}`;
  }
}

function getWhatsappAdminNotificationConfig() {
  const row = db.prepare('SELECT valor, actualizado_en FROM config WHERE clave = ?').get(WHATSAPP_ADMIN_CONFIG_KEY);
  const raw = row && row.valor != null && String(row.valor).trim()
    ? String(row.valor).trim()
    : String(process.env.WHATSAPP_ADMIN_NOTIFY_TO || process.env.WHATSAPP_ADMIN_PHONE || '').trim();
  const source = row && row.valor != null && String(row.valor).trim() ? 'config' : (raw ? 'env' : 'none');
  const targets = raw
    ? raw.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean)
    : [];

  return {
    raw,
    targets,
    source,
    updated_at: row && row.actualizado_en ? row.actualizado_en : null,
  };
}

function saveWhatsappAdminNotificationConfig(value) {
  const raw = String(value || '').trim().slice(0, 400);
  db.prepare(`
    INSERT INTO config (clave, valor, actualizado_en)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en
  `).run(WHATSAPP_ADMIN_CONFIG_KEY, raw);
  return getWhatsappAdminNotificationConfig();
}

function listLicenciaAlertas(limit = 6) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 20);
  const totalPendientesRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM pagos_licencia
    WHERE estado = 'pendiente'
  `).get() || { total: 0 };

  const pagos = db.prepare(`
    SELECT pl.id, pl.empresa_id, pl.fecha, pl.monto_usd, pl.moneda, pl.referencia, pl.descripcion,
           pl.origen, pl.estado, pl.tipo, pl.comprobante_url, pl.notas, pl.creado_en,
           e.nombre AS empresa_nombre, e.codigo AS empresa_codigo, e.plan, e.proximo_cobro,
           e.dias_gracia, e.estado AS empresa_estado
    FROM pagos_licencia pl
    INNER JOIN empresas e ON e.id = pl.empresa_id
    WHERE pl.estado = 'pendiente'
    ORDER BY COALESCE(pl.creado_en, pl.fecha) DESC, pl.id DESC
    LIMIT ?
  `).all(safeLimit).map((row) => {
    const puntualidad = getPuntualidadEmpresa({
      estado: row.empresa_estado,
      proximo_cobro: row.proximo_cobro,
      dias_gracia: row.dias_gracia,
    });
    return {
      ...row,
      puntualidad_estado: puntualidad.key,
      puntualidad_label: puntualidad.label,
    };
  });

  return {
    total_pendientes: Number(totalPendientesRow.total || 0),
    pagos,
  };
}

function buildSuscripcionMetricas() {
  const months = buildMonthWindow(6);
  const currentMonthKey = months[months.length - 1];

  const resumenBase = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN estado = 'aplicado' THEN monto_usd ELSE 0 END), 0) AS total_recaudado_usd,
      COALESCE(SUM(CASE WHEN estado = 'aplicado' AND substr(fecha, 1, 7) = ? THEN monto_usd ELSE 0 END), 0) AS ingresos_mes_usd,
      COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END), 0) AS pagos_pendientes,
      COALESCE(SUM(CASE WHEN estado = 'aplicado' THEN 1 ELSE 0 END), 0) AS pagos_aplicados,
      COUNT(DISTINCT CASE WHEN estado = 'aplicado' THEN empresa_id END) AS empresas_pagando
    FROM pagos_licencia
  `).get(currentMonthKey) || {};

  const monthlyRows = db.prepare(`
    SELECT substr(fecha, 1, 7) AS periodo, COALESCE(SUM(monto_usd), 0) AS total_usd
    FROM pagos_licencia
    WHERE estado = 'aplicado'
      AND substr(fecha, 1, 7) >= ?
    GROUP BY substr(fecha, 1, 7)
    ORDER BY periodo ASC
  `).all(months[0]);
  const monthMap = new Map(monthlyRows.map((row) => [row.periodo, Number(row.total_usd || 0)]));

  const empresas = db.prepare(`
    SELECT e.id, e.nombre, e.codigo, e.plan, e.estado, e.monto_mensual, e.fecha_alta, e.ultimo_pago_en,
           e.proximo_cobro, e.dias_gracia,
           COALESCE(SUM(CASE WHEN pl.estado = 'aplicado' THEN pl.monto_usd ELSE 0 END), 0) AS total_pagado_usd,
           COALESCE(SUM(CASE WHEN pl.estado = 'aplicado' AND substr(pl.fecha, 1, 7) = ? THEN pl.monto_usd ELSE 0 END), 0) AS ingresos_mes_usd,
           COUNT(CASE WHEN pl.estado = 'aplicado' THEN 1 END) AS pagos_aplicados,
           COUNT(CASE WHEN pl.estado = 'pendiente' THEN 1 END) AS pagos_pendientes,
           AVG(CASE WHEN pl.estado = 'aplicado' THEN pl.monto_usd END) AS ticket_promedio_usd,
           MIN(CASE WHEN pl.estado = 'aplicado' THEN pl.fecha END) AS primer_pago_en,
           MAX(CASE WHEN pl.estado = 'aplicado' THEN pl.fecha END) AS ultimo_pago_aplicado_en,
           MAX(CASE WHEN pl.estado = 'pendiente' THEN pl.fecha END) AS ultimo_pago_pendiente_en
    FROM empresas e
    LEFT JOIN pagos_licencia pl ON pl.empresa_id = e.id
    GROUP BY e.id
    ORDER BY total_pagado_usd DESC, pagos_pendientes DESC, e.nombre ASC
  `).all(currentMonthKey).map((row) => {
    const puntualidad = getPuntualidadEmpresa(row);
    return {
      ...row,
      monto_mensual: Number(row.monto_mensual || 0) || 0,
      total_pagado_usd: Number(row.total_pagado_usd || 0) || 0,
      ingresos_mes_usd: Number(row.ingresos_mes_usd || 0) || 0,
      pagos_aplicados: Number(row.pagos_aplicados || 0) || 0,
      pagos_pendientes: Number(row.pagos_pendientes || 0) || 0,
      ticket_promedio_usd: Number(row.ticket_promedio_usd || 0) || 0,
      antiguedad_meses: diffMonthsSince(row.primer_pago_en),
      puntualidad_estado: puntualidad.key,
      puntualidad_label: puntualidad.label,
    };
  });

  const puntualidad = empresas.reduce((accumulator, empresa) => {
    const key = empresa.puntualidad_estado || 'sin_corte';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {
    al_dia: 0,
    en_gracia: 0,
    atrasada: 0,
    suspendida: 0,
    sin_corte: 0,
  });

  const mrrEstimado = empresas.reduce((accumulator, empresa) => {
    if (empresa.estado === 'suspendida') {
      return accumulator;
    }
    return accumulator + (Number(empresa.monto_mensual || 0) || 0);
  }, 0);

  const actividadReciente = db.prepare(`
    SELECT pl.id, pl.empresa_id, pl.fecha, pl.monto_usd, pl.referencia, pl.tipo, pl.estado, pl.creado_en,
           e.nombre AS empresa_nombre, e.codigo AS empresa_codigo, e.plan
    FROM pagos_licencia pl
    INNER JOIN empresas e ON e.id = pl.empresa_id
    ORDER BY CASE WHEN pl.estado = 'pendiente' THEN 0 ELSE 1 END,
             COALESCE(pl.creado_en, pl.fecha) DESC,
             pl.id DESC
    LIMIT 10
  `).all();

  return {
    resumen: {
      total_recaudado_usd: Number(resumenBase.total_recaudado_usd || 0) || 0,
      ingresos_mes_usd: Number(resumenBase.ingresos_mes_usd || 0) || 0,
      pagos_pendientes: Number(resumenBase.pagos_pendientes || 0) || 0,
      pagos_aplicados: Number(resumenBase.pagos_aplicados || 0) || 0,
      empresas_pagando: Number(resumenBase.empresas_pagando || 0) || 0,
      mrr_estimado_usd: mrrEstimado,
      arr_estimado_usd: mrrEstimado * 12,
      puntualidad,
    },
    serie_mensual: months.map((periodo) => ({
      periodo,
      label: formatMonthLabel(periodo),
      total_usd: monthMap.get(periodo) || 0,
    })),
    empresas,
    actividad_reciente: actividadReciente,
  };
}

// GET /admin/empresas - Listar empresas con filtros básicos (solo superadmin)
router.get('/', requireAuth, requireRole('superadmin'), (req, res) => {
  const { estado, q } = req.query;

  try {
    const where = [];
    const params = [];

    if (estado && ['activa', 'morosa', 'suspendida'].includes(estado)) {
      where.push('e.estado = ?');
      params.push(estado);
    }

    if (q && q.trim()) {
      where.push('(e.nombre LIKE ? OR e.codigo LIKE ?)');
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    let sql = `SELECT e.id, e.nombre, e.codigo, e.estado, e.plan, e.monto_mensual, e.fecha_alta, e.fecha_corte, e.dias_gracia,
              e.ultimo_pago_en, e.proximo_cobro, e.nota_interna, e.rif, e.telefono, e.direccion,
              cfg.valor AS empresa_config_raw
                FROM empresas e
                LEFT JOIN config cfg ON cfg.clave = ('empresa_config:empresa:' || e.id)`;
    if (where.length) {
      sql += ' WHERE ' + where.join(' AND ');
    }
    sql += ' ORDER BY e.fecha_alta DESC, e.id DESC';

    const empresas = db.prepare(sql).all(...params).map(attachEmpresaFlags);
    res.json(empresas);
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error listando empresas:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al listar empresas' });
  }
});

// POST /admin/empresas/tasa-general - Guardar tasa global y replicarla a todas las empresas
router.post('/tasa-general', requireAuth, requireRole('superadmin'), (req, res) => {
  const { tasa_bcv } = req.body || {};
  const tasa = parseFloat(tasa_bcv);
  if (!Number.isFinite(tasa) || tasa <= 0) {
    return res.status(400).json({ error: 'Tasa inválida' });
  }

  try {
    const result = guardarTasaBcvGeneral(tasa);
    res.json(result);
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error guardando tasa general:', { message: err.message, stack: err.stack });
    if (err.tipo === 'VALIDACION') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'No se pudo guardar la tasa general' });
  }
});

// GET /admin/empresas/tasa-general - Leer la tasa global actual del sistema
router.get('/tasa-general', requireAuth, requireRole('superadmin'), (_req, res) => {
  try {
    const result = obtenerTasaBcv();
    res.json(result);
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error obteniendo tasa general:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'No se pudo obtener la tasa general' });
  }
});

// POST /admin/empresas/tasa-general/actualizar - Obtener tasa automática y replicarla a todas las empresas
router.post('/tasa-general/actualizar', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const result = await actualizarTasaBcvGeneralAutomatica();
    if (!result || result.ok !== true) {
      return res.status(200).json(result || { ok: false, tasa_bcv: 1, error: 'No se pudo actualizar la tasa general' });
    }
    res.json(result);
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error actualizando tasa general automática:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'No se pudo actualizar la tasa general automática' });
  }
});

// GET /admin/empresas/licencia-alertas - Alertas operativas para revisar pagos de licencia pendientes
router.get('/licencia-alertas', requireAuth, requireRole('superadmin'), (req, res) => {
  try {
    const result = listLicenciaAlertas(req.query && req.query.limit ? req.query.limit : 6);
    res.json(result);
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error listando alertas de licencia:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'No se pudieron obtener las alertas de licencia' });
  }
});

// GET /admin/empresas/licencia-metricas - Dashboard de métricas de suscripciones
router.get('/licencia-metricas', requireAuth, requireRole('superadmin'), (req, res) => {
  try {
    const result = buildSuscripcionMetricas();
    res.json(result);
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error construyendo métricas de licencia:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'No se pudieron obtener las métricas de licencia' });
  }
});

// GET /admin/empresas/licencia-notificaciones-whatsapp - Leer destinos para avisos de pagos
router.get('/licencia-notificaciones-whatsapp', requireAuth, requireRole('superadmin'), (_req, res) => {
  try {
    res.json(getWhatsappAdminNotificationConfig());
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error obteniendo configuración WhatsApp admin:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'No se pudo obtener la configuración de notificaciones' });
  }
});

// POST /admin/empresas/licencia-notificaciones-whatsapp - Guardar destinos para avisos de pagos
router.post('/licencia-notificaciones-whatsapp', requireAuth, requireRole('superadmin'), (req, res) => {
  try {
    const destinos = req.body && Object.prototype.hasOwnProperty.call(req.body, 'destinos')
      ? req.body.destinos
      : '';
    const result = saveWhatsappAdminNotificationConfig(destinos);
    res.json({ ok: true, ...result });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error guardando configuración WhatsApp admin:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'No se pudo guardar la configuración de notificaciones' });
  }
});

// POST /admin/empresas - Crear una nueva empresa (solo superadmin)
router.post('/', requireAuth, requireRole('superadmin'), (req, res) => {
  let { nombre, codigo, plan, monto_mensual, fecha_corte, dias_gracia, nota_interna, rif, telefono, direccion } = req.body || {};

  try {
    nombre = (nombre || '').toString().trim();
    codigo = (codigo || '').toString().trim().toUpperCase();

    if (!nombre || nombre.length < 3) {
      return res.status(400).json({ error: 'El nombre de la empresa debe tener al menos 3 caracteres.' });
    }
    if (!codigo || codigo.length < 2) {
      return res.status(400).json({ error: 'El código de la empresa debe tener al menos 2 caracteres.' });
    }

    // Verificar que el código sea único
    const existe = db.prepare('SELECT id FROM empresas WHERE codigo = ?').get(codigo);
    if (existe) {
      return res.status(409).json({ error: `Ya existe una empresa con el código ${codigo}.` });
    }

    const monto = monto_mensual !== undefined && monto_mensual !== null && monto_mensual !== ''
      ? Number(monto_mensual)
      : null;
    if (monto !== null && (Number.isNaN(monto) || monto < 0)) {
      return res.status(400).json({ error: 'monto_mensual debe ser un número positivo.' });
    }

    const diaCorte = fecha_corte !== undefined && fecha_corte !== null && fecha_corte !== ''
      ? parseInt(fecha_corte, 10)
      : 1;
    if (Number.isNaN(diaCorte) || diaCorte < 1 || diaCorte > 28) {
      return res.status(400).json({ error: 'fecha_corte debe ser un número entre 1 y 28.' });
    }

    const diasGraciaVal = dias_gracia !== undefined && dias_gracia !== null && dias_gracia !== ''
      ? parseInt(dias_gracia, 10)
      : 7;
    if (Number.isNaN(diasGraciaVal) || diasGraciaVal < 0 || diasGraciaVal > 60) {
      return res.status(400).json({ error: 'dias_gracia debe ser un número entre 0 y 60.' });
    }

    const info = db.prepare(`
      INSERT INTO empresas (nombre, codigo, estado, plan, monto_mensual, fecha_alta, fecha_corte, dias_gracia, nota_interna, rif, telefono, direccion)
      VALUES (?, ?, 'activa', ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)
    `).run(
      nombre,
      codigo,
      plan || null,
      monto,
      diaCorte,
      diasGraciaVal,
      nota_interna || null,
      (rif || '').toString().trim() || null,
      (telefono || '').toString().trim() || null,
      (direccion || '').toString().trim() || null
    );

    const nueva = db.prepare(`
            SELECT id, nombre, codigo, estado, plan, monto_mensual, fecha_alta, fecha_corte, dias_gracia,
              ultimo_pago_en, proximo_cobro, nota_interna, rif, telefono, direccion
      FROM empresas
      WHERE id = ?
    `).get(info.lastInsertRowid);
    const nuevaConFlags = attachEmpresaFlags({ ...nueva, empresa_config_raw: null });
    try {
      registrarAuditoria({
        usuario: req.usuario,
        accion: 'EMPRESA_CREADA',
        entidad: 'empresa',
        entidadId: nuevaConFlags.id,
        detalle: {
          codigo: nuevaConFlags.codigo,
          nombre: nuevaConFlags.nombre,
          plan: nuevaConFlags.plan,
          monto_mensual: nuevaConFlags.monto_mensual,
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (_err) {
      // no romper flujo si auditoría falla
    }
    try {
      registrarEventoNegocio(nueva.id, {
        tipo: 'empresa_creada',
        entidad: 'empresa',
        entidadId: nuevaConFlags.id,
        origen: 'panel-master',
        payload: nuevaConFlags,
      });
    } catch (_err) {
      // No romper flujo si falla el registro del evento
    }

    res.status(201).json({
      message: 'Empresa creada correctamente',
      empresa: nuevaConFlags,
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error creando empresa:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al crear empresa' });
  }
});

// PATCH /admin/empresas/:id - Actualizar datos/licencia de una empresa (solo superadmin)
router.patch('/:id', requireAuth, requireRole('superadmin'), (req, res) => {
  const { id } = req.params;
  const {
    estado,
    fecha_corte,
    dias_gracia,
    plan,
    monto_mensual,
    ultimo_pago_en,
    proximo_cobro,
    nota_interna,
    permitir_anular_venta,
    // Opcionales para registrar historial de pago de licencia
    registrar_pago_licencia,
    referencia_pago,
    descripcion_pago,
  } = req.body || {};

  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    const permitirAnularVenta = permitir_anular_venta !== undefined
      ? parseToggleValue(permitir_anular_venta)
      : undefined;
    if (permitir_anular_venta !== undefined && permitirAnularVenta === null) {
      return res.status(400).json({ error: 'permitir_anular_venta debe ser booleano' });
    }

    const updates = [];
    const params = [];

    if (estado !== undefined) {
      const estadosValidos = ['activa', 'morosa', 'suspendida'];
      if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
      }
      updates.push('estado = ?');
      params.push(estado);
    }

    if (fecha_corte !== undefined) {
      const dia = parseInt(fecha_corte, 10);
      if (Number.isNaN(dia) || dia < 1 || dia > 28) {
        return res.status(400).json({ error: 'fecha_corte debe ser un número entre 1 y 28' });
      }
      updates.push('fecha_corte = ?');
      params.push(dia);
    }

    if (dias_gracia !== undefined) {
      const dias = parseInt(dias_gracia, 10);
      if (Number.isNaN(dias) || dias < 0 || dias > 60) {
        return res.status(400).json({ error: 'dias_gracia debe ser un número entre 0 y 60' });
      }
      updates.push('dias_gracia = ?');
      params.push(dias);
    }

    if (plan !== undefined) {
      updates.push('plan = ?');
      params.push(String(plan));
    }

    if (monto_mensual !== undefined) {
      const monto = Number(monto_mensual);
      if (Number.isNaN(monto) || monto < 0) {
        return res.status(400).json({ error: 'monto_mensual debe ser un número positivo' });
      }
      updates.push('monto_mensual = ?');
      params.push(monto);
    }

    const ultimoPagoExplicito = ultimo_pago_en !== undefined && ultimo_pago_en !== null && String(ultimo_pago_en).trim() !== '';

    if (ultimo_pago_en !== undefined) {
      updates.push('ultimo_pago_en = ?');
      params.push(ultimoPagoExplicito ? String(ultimo_pago_en) : null);
    }

    if (proximo_cobro !== undefined) {
      updates.push('proximo_cobro = ?');
      params.push(proximo_cobro || null);
    }

    if (nota_interna !== undefined) {
      updates.push('nota_interna = ?');
      params.push(nota_interna || null);
    }

    if (updates.length === 0 && permitir_anular_venta === undefined) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    const updateParams = updates.length ? [...params, id] : [];

    db.transaction(() => {
      if (updates.length) {
        db.prepare(`
          UPDATE empresas
          SET ${updates.join(', ')}, actualizado_en = datetime('now')
          WHERE id = ?
        `).run(...updateParams);
      }

      if (permitir_anular_venta !== undefined) {
        const configActual = obtenerConfigGeneral(empresa.id);
        guardarConfigGeneral({
          ...configActual,
          empresa: {
            ...(configActual && configActual.empresa ? configActual.empresa : {}),
            permitir_anular_venta: permitirAnularVenta,
          },
        }, empresa.id);
      }
    })();

    const empresaActualizada = attachEmpresaFlags(db.prepare(`
      SELECT e.id, e.nombre, e.codigo, e.estado, e.plan, e.monto_mensual, e.fecha_alta, e.fecha_corte, e.dias_gracia,
             e.ultimo_pago_en, e.proximo_cobro, e.nota_interna, e.rif, e.telefono, e.direccion,
             cfg.valor AS empresa_config_raw
      FROM empresas e
      LEFT JOIN config cfg ON cfg.clave = ('empresa_config:empresa:' || e.id)
      WHERE e.id = ?
    `).get(id));

    // Si se indicó registrar pago de licencia (explícitamente o implícito por actualizar ultimo_pago_en),
    // crear una fila en pagos_licencia para que el historial de "Plan y pagos" se alimente solo.
    try {
      const debeRegistrarPago = !!registrar_pago_licencia || ultimoPagoExplicito;
      if (debeRegistrarPago && empresaActualizada) {
        const fechaPago = ultimoPagoExplicito
          ? String(ultimo_pago_en)
          : (empresaActualizada.ultimo_pago_en || new Date().toISOString());
        const montoPago = typeof monto_mensual === 'number'
          ? monto_mensual
          : Number(empresaActualizada.monto_mensual || 0) || 0;

        db.prepare(`
          INSERT INTO pagos_licencia (empresa_id, fecha, monto_usd, moneda, referencia, descripcion, origen)
          VALUES (?, ?, ?, 'USD', ?, ?, ?)
        `).run(
          empresaActualizada.id,
          fechaPago,
          montoPago,
          referencia_pago || null,
          descripcion_pago || (empresaActualizada.plan ? `Pago plan ${empresaActualizada.plan}` : 'Pago de plan'),
          'panel-master'
        );
      }
    } catch (errInsert) {
      const logger = require('../services/logger');
      logger.warn('No se pudo registrar pago_licencia asociado a empresa:', { message: errInsert.message });
    }
    try {
      registrarAuditoria({
        usuario: req.usuario,
        accion: 'EMPRESA_ACTUALIZADA',
        entidad: 'empresa',
        entidadId: empresa.id,
        detalle: {
          cambios: req.body || {},
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (_err) {
      // no romper flujo si auditoría falla
    }
    try {
      registrarEventoNegocio(empresa.id, {
        tipo: 'empresa_actualizada',
        entidad: 'empresa',
        entidadId: empresa.id,
        origen: 'panel-master',
        payload: empresaActualizada,
      });
    } catch (_err) {
      // No romper flujo si falla el registro del evento
    }

    res.json({
      message: 'Empresa actualizada correctamente',
      empresa: empresaActualizada,
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error actualizando empresa:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al actualizar empresa' });
  }
});

// GET /admin/empresas/:id/pagos-licencia - Listar pagos de licencia de una empresa (solo superadmin)
router.get('/:id/pagos-licencia', requireAuth, requireRole('superadmin'), (req, res) => {
  const { id } = req.params;
  const { estado } = req.query || {};
  try {
    const pagos = listarPagosLicenciaEmpresa(id, estado ? { estado } : {});
    res.json(pagos);
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error listando pagos de licencia:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al listar pagos de licencia' });
  }
});

// PATCH /admin/empresas/:id/pagos-licencia/:pagoId/estado - Cambiar estado de un pago de licencia (solo superadmin)
router.patch('/:id/pagos-licencia/:pagoId/estado', requireAuth, requireRole('superadmin'), (req, res) => {
  const { id, pagoId } = req.params;
  const { estado, meses_pagados } = req.body || {};
  try {
    const pago = actualizarEstadoPagoLicencia(id, pagoId, estado, { meses_pagados });
    res.json({ ok: true, pago });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error actualizando estado de pago de licencia:', { message: err.message, stack: err.stack });
    if (err.tipo === 'VALIDACION') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Error al actualizar estado de pago' });
  }
});

// DELETE /admin/empresas/:id - Eliminar una empresa (solo superadmin)
router.delete('/:id', requireAuth, requireRole('superadmin'), (req, res) => {
  const { id } = req.params;

  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // Nunca permitir borrar la empresa LOCAL (id 1)
    if (Number(empresa.id) === 1 || empresa.codigo === 'LOCAL') {
      return res.status(400).json({ error: 'La empresa LOCAL no se puede eliminar' });
    }

    const empresaId = Number(empresa.id);

    // 1) Borrar datos transaccionales e inventario de esa empresa (ventas, compras, presupuestos, productos, métricas, sync, etc.)
    purgeTransactionalData(empresaId);

    // 2) Borrar datos restantes ligados a la empresa (usuarios, proveedores, depósitos, stock por depósito, branding por empresa, etc.)
    const tx = db.transaction(() => {
      // Usuarios de la empresa (no debería afectar a superadmins globales)
      db.prepare("DELETE FROM usuarios WHERE empresa_id = ? AND (rol IS NULL OR rol != 'superadmin')").run(empresaId);

      // Proveedores de la empresa
      db.prepare('DELETE FROM proveedores WHERE empresa_id = ?').run(empresaId);

      // Stock por depósito y movimientos de depósitos de la empresa
      db.prepare('DELETE FROM stock_por_deposito WHERE empresa_id = ?').run(empresaId);
      db.prepare('DELETE FROM movimientos_deposito WHERE empresa_id = ?').run(empresaId);
      db.prepare('DELETE FROM depositos WHERE empresa_id = ?').run(empresaId);

      // Configuración específica de la empresa (branding, nota, descuentos, devoluciones)
      const eidStr = String(empresaId);
      db.prepare(`DELETE FROM config WHERE clave IN (
          'empresa_config:empresa:${eidStr}',
          'descuentos_volumen:empresa:${eidStr}',
          'devolucion_politica:empresa:${eidStr}',
          'nota_config:empresa:${eidStr}'
        )`).run();

      // Métricas y colas de sync (redundante con purgeTransactionalData, pero inofensivo)
      db.prepare('DELETE FROM empresa_metricas_diarias WHERE empresa_id = ?').run(empresaId);
      db.prepare('DELETE FROM sync_outbox WHERE empresa_id = ?').run(empresaId);
      db.prepare('DELETE FROM sync_inbox WHERE empresa_id = ?').run(empresaId);

      // Finalmente eliminar la empresa
      db.prepare('DELETE FROM empresas WHERE id = ?').run(empresaId);
    });

    tx();

    try {
      registrarAuditoria({
        usuario: req.usuario,
        accion: 'EMPRESA_ELIMINADA',
        entidad: 'empresa',
        entidadId: empresa.id,
        detalle: {
          codigo: empresa.codigo,
          nombre: empresa.nombre,
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (_err) {
      // no romper flujo si auditoría falla
    }

    res.json({ message: 'Empresa eliminada correctamente' });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error eliminando empresa:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al eliminar empresa' });
  }
});

// POST /admin/empresas/:id/crear-admin - Crear usuario admin ligado a una empresa (solo superadmin)
router.post('/:id/crear-admin', requireAuth, requireRole('superadmin'), (req, res) => {
  const { id } = req.params;
  let { username, password, nombre_completo } = req.body || {};

  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    username = (username || '').toString().trim();
    password = (password || '').toString();
    nombre_completo = (nombre_completo || '').toString().trim() || username;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username y contraseña son requeridos' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'El username debe tener al menos 3 caracteres' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const existe = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
    if (existe) {
      return res.status(409).json({ error: 'El username ya existe' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO usuarios (username, password, nombre_completo, rol, empresa_id, must_change_password)
      VALUES (?, ?, ?, 'admin', ?, 1)
    `).run(username, hash, nombre_completo, empresa.id);

    const nuevoUsuario = db.prepare(`
      SELECT id, username, nombre_completo, rol, activo, creado_en, empresa_id
      FROM usuarios
      WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
      message: 'Usuario admin de empresa creado correctamente',
      usuario: nuevoUsuario,
      empresa: { id: empresa.id, nombre: empresa.nombre, codigo: empresa.codigo }
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error creando usuario admin de empresa:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al crear usuario admin para la empresa' });
  }
});

module.exports = router;
