const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('./auth');

const MAX_TEXT = 120;
const MAX_DOC = 40;
const MAX_REF = 120;
const MAX_NOTAS = 400;

function safeStr(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function isValidDateString(val) {
  if (!val) return false;
  const d = new Date(val);
  return !Number.isNaN(d.getTime());
}

function computeEstado(row) {
  const saldo = Number(row.saldo_usd || 0);
  const total = Number(row.total_usd || 0);
  const vencimiento = row.fecha_vencimiento ? new Date(row.fecha_vencimiento) : null;
  const hoy = new Date();
  let estado = 'pendiente';
  if (saldo <= 0.00001) estado = 'cancelado';
  else if (saldo < total) estado = 'parcial';
  if (estado !== 'cancelado' && vencimiento && vencimiento < hoy) estado = 'vencido';
  return estado;
}

function mapCuenta(row) {
  const estado_calc = computeEstado(row);
  return { ...row, estado_calc };
}

router.get('/resumen', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT estado, COUNT(*) as cantidad, SUM(saldo_usd) as saldo_usd
      FROM cuentas_cobrar
      GROUP BY estado
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('Error resumen cc:', err);
    res.status(500).json({ error: 'No se pudo obtener resumen' });
  }
});

router.get('/', requireAuth, (req, res) => {
  try {
    const { cliente, estado } = req.query;
    let rows = db.prepare(`
      SELECT * FROM cuentas_cobrar
      ORDER BY date(fecha_vencimiento) ASC
    `).all();
    rows = rows.map(mapCuenta);
    if (cliente) {
      const lc = cliente.toLowerCase();
      rows = rows.filter(r => (r.cliente_nombre || '').toLowerCase().includes(lc) || (r.cliente_doc || '').toLowerCase().includes(lc));
    }
    if (estado) {
      rows = rows.filter(r => r.estado_calc === estado);
    }
    res.json(rows);
  } catch (err) {
    console.error('Error listando cc:', err);
    res.status(500).json({ error: 'No se pudo listar cuentas' });
  }
});

router.get('/:id', requireAuth, (req, res) => {
  try {
    const cuenta = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const pagos = db.prepare('SELECT * FROM pagos_cc WHERE cuenta_id = ? ORDER BY date(fecha) DESC, id DESC').all(req.params.id);
    res.json({ cuenta: mapCuenta(cuenta), pagos });
  } catch (err) {
    console.error('Error detalle cc:', err);
    res.status(500).json({ error: 'No se pudo obtener cuenta' });
  }
});

router.post('/', requireAuth, (req, res) => {
  try {
    const {
      cliente_nombre,
      cliente_doc,
      venta_id,
      total_usd,
      tasa_bcv,
      fecha_vencimiento,
      notas
    } = req.body || {};
    const total = Number(total_usd || 0);
    if (!total || Number.isNaN(total) || total <= 0) {
      return res.status(400).json({ error: 'Total inválido' });
    }
    const tasa = Number(tasa_bcv || 1) || 1;
    if (!Number.isFinite(tasa) || tasa <= 0 || tasa > 1e9) {
      return res.status(400).json({ error: 'Tasa inválida' });
    }
    if (fecha_vencimiento && !isValidDateString(fecha_vencimiento)) {
      return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
    }
    const hoy = new Date();
    const fv = fecha_vencimiento ? new Date(fecha_vencimiento) : new Date(hoy.getTime() + 21 * 24 * 3600 * 1000);
    const fvISO = fv.toISOString().slice(0, 10);
    const nombreSafe = safeStr(cliente_nombre || 'Cliente', MAX_TEXT);
    const docSafe = safeStr(cliente_doc || '', MAX_DOC);
    const notasSafe = safeStr(notas || '', MAX_NOTAS);
    const stmt = db.prepare(`
      INSERT INTO cuentas_cobrar (cliente_nombre, cliente_doc, venta_id, total_usd, tasa_bcv, saldo_usd, fecha_emision, fecha_vencimiento, estado, notas, creado_en, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, datetime('now'), datetime('now'))
    `);
    const info = stmt.run(nombreSafe, docSafe, venta_id || null, total, tasa, total, hoy.toISOString(), fvISO, notasSafe);
    const creada = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(info.lastInsertRowid);
    res.json(mapCuenta(creada));
  } catch (err) {
    console.error('Error creando cuenta por cobrar:', err);
    res.status(500).json({ error: 'No se pudo crear cuenta por cobrar' });
  }
});

router.post('/:id/pago', requireAuth, (req, res) => {
  try {
    const cuenta = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const { monto, moneda = 'USD', tasa_bcv, metodo, referencia, notas, usuario } = req.body || {};
    const m = Number(monto || 0);
    if (!m || Number.isNaN(m) || m <= 0) return res.status(400).json({ error: 'Monto inválido' });
    if (!['USD', 'BS'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
    const tasa = Number(tasa_bcv || cuenta.tasa_bcv || 1) || 1;
    if (!Number.isFinite(tasa) || tasa <= 0 || tasa > 1e9) return res.status(400).json({ error: 'Tasa inválida' });
    const monto_usd = moneda === 'BS' ? m / tasa : m;
    const fecha = new Date().toISOString();
    const metodoSafe = safeStr(metodo || '', MAX_TEXT);
    const referenciaSafe = safeStr(referencia || '', MAX_REF);
    const notasSafe = safeStr(notas || '', MAX_NOTAS);
    const usuarioSafe = safeStr(usuario || '', MAX_TEXT);
    db.prepare(`
      INSERT INTO pagos_cc (cuenta_id, fecha, monto_usd, moneda, tasa_bcv, monto_moneda, metodo, referencia, notas, usuario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cuenta.id, fecha, monto_usd, moneda, tasa, m, metodoSafe || null, referenciaSafe || null, notasSafe || null, usuarioSafe || null);

    const nuevoSaldo = Math.max(0, Number(cuenta.saldo_usd || 0) - monto_usd);
    const estado = computeEstado({ ...cuenta, saldo_usd: nuevoSaldo });
    db.prepare('UPDATE cuentas_cobrar SET saldo_usd = ?, estado = ?, actualizado_en = ? WHERE id = ?')
      .run(nuevoSaldo, estado, fecha, cuenta.id);
    const updated = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(cuenta.id);
    const pagos = db.prepare('SELECT * FROM pagos_cc WHERE cuenta_id = ? ORDER BY date(fecha) DESC, id DESC').all(cuenta.id);
    res.json({ cuenta: mapCuenta(updated), pagos });
  } catch (err) {
    console.error('Error registrando pago:', err);
    res.status(500).json({ error: 'No se pudo registrar pago' });
  }
});

router.patch('/:id', requireAuth, (req, res) => {
  try {
    const { fecha_vencimiento, notas, estado } = req.body || {};
    const cuenta = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(req.params.id);
    if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' });
    if (fecha_vencimiento && !isValidDateString(fecha_vencimiento)) return res.status(400).json({ error: 'Fecha inválida' });
    const fv = fecha_vencimiento ? new Date(fecha_vencimiento).toISOString().slice(0, 10) : cuenta.fecha_vencimiento;
    const est = estado || cuenta.estado;
    if (!['pendiente', 'parcial', 'cancelado', 'vencido'].includes(est)) return res.status(400).json({ error: 'Estado inválido' });
    const notasSafe = safeStr(notas ?? cuenta.notas, MAX_NOTAS);
    db.prepare('UPDATE cuentas_cobrar SET fecha_vencimiento = ?, notas = ?, estado = ?, actualizado_en = datetime("now") WHERE id = ?')
      .run(fv, notasSafe, est, cuenta.id);
    const updated = db.prepare('SELECT * FROM cuentas_cobrar WHERE id = ?').get(cuenta.id);
    res.json(mapCuenta(updated));
  } catch (err) {
    console.error('Error actualizando cuenta:', err);
    res.status(500).json({ error: 'No se pudo actualizar cuenta' });
  }
});

module.exports = router;
