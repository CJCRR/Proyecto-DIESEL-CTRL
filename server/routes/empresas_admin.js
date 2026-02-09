const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');
const bcrypt = require('bcryptjs');
const { registrarEventoNegocio } = require('../services/eventosService');
const { registrarAuditoria } = require('../services/auditLogService');

// GET /admin/empresas - Listar empresas con filtros básicos (solo superadmin)
router.get('/', requireAuth, requireRole('superadmin'), (req, res) => {
  const { estado, q } = req.query;

  try {
    const where = [];
    const params = [];

    if (estado && ['activa', 'morosa', 'suspendida'].includes(estado)) {
      where.push('estado = ?');
      params.push(estado);
    }

    if (q && q.trim()) {
      where.push('(nombre LIKE ? OR codigo LIKE ?)');
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    let sql = `SELECT id, nombre, codigo, estado, plan, monto_mensual, fecha_alta, fecha_corte, dias_gracia,
              ultimo_pago_en, proximo_cobro, nota_interna, rif, telefono, direccion
                FROM empresas`;
    if (where.length) {
      sql += ' WHERE ' + where.join(' AND ');
    }
    sql += ' ORDER BY fecha_alta DESC, id DESC';

    const empresas = db.prepare(sql).all(...params);
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
    try {
      registrarAuditoria({
        usuario: req.usuario,
        accion: 'EMPRESA_CREADA',
        entidad: 'empresa',
        entidadId: nueva.id,
        detalle: {
          codigo: nueva.codigo,
          nombre: nueva.nombre,
          plan: nueva.plan,
          monto_mensual: nueva.monto_mensual,
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
        entidadId: nueva.id,
        origen: 'panel-master',
        payload: nueva,
      });
    } catch (_err) {
      // No romper flujo si falla el registro del evento
    }

    res.status(201).json({
      message: 'Empresa creada correctamente',
      empresa: nueva,
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
  const { estado, fecha_corte, dias_gracia, plan, monto_mensual, ultimo_pago_en, proximo_cobro, nota_interna } = req.body || {};

  try {
    const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
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

    if (ultimo_pago_en !== undefined) {
      updates.push('ultimo_pago_en = ?');
      params.push(ultimo_pago_en || null);
    }

    if (proximo_cobro !== undefined) {
      updates.push('proximo_cobro = ?');
      params.push(proximo_cobro || null);
    }

    if (nota_interna !== undefined) {
      updates.push('nota_interna = ?');
      params.push(nota_interna || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    params.push(id);

    db.prepare(`
      UPDATE empresas
      SET ${updates.join(', ')}, actualizado_en = datetime('now')
      WHERE id = ?
    `).run(...params);

    const empresaActualizada = db.prepare(`
      SELECT id, nombre, codigo, estado, plan, monto_mensual, fecha_alta, fecha_corte, dias_gracia,
             ultimo_pago_en, proximo_cobro, nota_interna
      FROM empresas
      WHERE id = ?
    `).get(id);
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

// DELETE /admin/empresas/:id - Eliminar una empresa (solo superadmin)
// Nota: por seguridad solo se permite si no tiene usuarios ni productos asociados
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

    // Verificar dependencias básicas
    const usuariosCount = db.prepare('SELECT COUNT(*) as c FROM usuarios WHERE empresa_id = ?').get(id).c;
    if (usuariosCount > 0) {
      return res.status(409).json({ error: 'No se puede eliminar: la empresa tiene usuarios asociados. Elimínelos o muévalos antes.' });
    }

    const productosCount = db.prepare('SELECT COUNT(*) as c FROM productos WHERE empresa_id = ?').get(id).c;
    if (productosCount > 0) {
      return res.status(409).json({ error: 'No se puede eliminar: la empresa tiene productos en inventario.' });
    }

    // Limpiar métricas/sync relacionadas (si existieran)
    db.prepare('DELETE FROM empresa_metricas_diarias WHERE empresa_id = ?').run(id);
    db.prepare('DELETE FROM sync_outbox WHERE empresa_id = ?').run(id);
    db.prepare('DELETE FROM sync_inbox WHERE empresa_id = ?').run(id);

    // Finalmente eliminar la empresa
    db.prepare('DELETE FROM empresas WHERE id = ?').run(id);

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
