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
  obtenerConfigGeneral,
  guardarConfigGeneral,
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
