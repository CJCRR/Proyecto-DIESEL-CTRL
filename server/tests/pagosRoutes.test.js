const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const pagosRoutes = require(path.join('..', 'routes', 'pagos'));
const { createTestUserAndToken } = require('./testAuthUtils');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/pagos', pagosRoutes);
  return app;
}

function resetPagosData() {
  db.prepare('DELETE FROM pagos_comision').run();
  db.prepare('DELETE FROM cuentas_comision').run();
  db.prepare('DELETE FROM devolucion_detalle').run();
  db.prepare('DELETE FROM devoluciones').run();
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare("DELETE FROM usuarios WHERE username LIKE 'pagos_route_%'").run();
}

describe('Rutas HTTP /pagos', () => {
  beforeEach(() => {
    resetPagosData();
  });

  test('GET /pagos/list auto-sincroniza el mes y devuelve las cuentas sin usar botón manual', async () => {
    const app = buildApp();
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId: 1 });

    const vendedor = db.prepare(`
      INSERT INTO usuarios (username, password, nombre_completo, rol, comision_pct, activo, empresa_id)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run('pagos_route_vend', '1234', 'Vendedor Ruta', 'vendedor', 12, 1);

    const producto = db.prepare(`
      INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('PAGR-001', 'Producto ruta', 20, 8, 20, 1);

    const venta = db.prepare(`
      INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('2026-07-12', 'Cliente Ruta', 'Vendedor Ruta', 'efectivo', 200, 10, vendedor.lastInsertRowid);

    db.prepare(`
      INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(venta.lastInsertRowid, producto.lastInsertRowid, 1, 20, 8, 200);

    const listed = await request(app)
      .get('/pagos/list?desde=2026-07-01&hasta=2026-07-31')
      .set('Authorization', `Bearer ${token}`);

    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body)).toBe(true);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].vendedor_nombre).toContain('Vendedor Ruta');
  });
});