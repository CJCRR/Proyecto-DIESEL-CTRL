const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

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
                      ultimo_pago_en, proximo_cobro, nota_interna
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

    res.json({
      message: 'Empresa actualizada correctamente',
      empresa: empresaActualizada
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error actualizando empresa:', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Error al actualizar empresa' });
  }
});

module.exports = router;
