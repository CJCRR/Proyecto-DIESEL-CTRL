const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const ventasRoutes = require(path.join('..', 'routes', 'ventas'));
const ajustesService = require(path.join('..', 'services', 'ajustesService'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetVentasData() {
  db.prepare('DELETE FROM auditoria').run();
  db.prepare('DELETE FROM stock_por_deposito_marca').run();
  db.prepare('DELETE FROM stock_por_deposito').run();
  db.prepare('DELETE FROM depositos').run();
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM cuentas_cobrar').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare("DELETE FROM config WHERE clave = 'empresa_config' OR clave LIKE 'empresa_config:empresa:%'").run();
}

describe('Rutas HTTP /ventas', () => {
  beforeEach(() => {
    resetVentasData();
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/ventas', ventasRoutes);
    return app;
  }

  test('POST /ventas crea venta válida y responde 200', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?,?,?,?,1)'
      )
      .run(empresaId, 'Dep Ventas HTTP', 'DVH1', 1);
    const depositoId = depInfo.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id, deposito_id) VALUES (?,?,?,?,?,?,?)'
      )
      .run('COD-HTTP', 'Producto HTTP', 10, 5, 5, empresaId, depositoId);

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?,?,?,?)'
    ).run(empresaId, prodInfo.lastInsertRowid, depositoId, 5);

    const res = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ codigo: 'COD-HTTP', cantidad: 2 }],
        cliente: 'Cliente HTTP',
        vendedor: 'Tester',
        tasa_bcv: 10,
        descuento: 0,
        metodo_pago: 'EFECTIVO',
        iva_pct: 0,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ventaId');
    expect(res.body).toHaveProperty('message');
    expect(String(res.body.message)).toMatch(/Venta registrada/i);
  });

  test('POST /ventas con mismo id_global no crea una venta duplicada', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?,?,?,?,1)'
      )
      .run(empresaId, 'Dep Ventas Dedupe', 'DVD1', 1);
    const depositoId = depInfo.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id, deposito_id) VALUES (?,?,?,?,?,?,?)'
      )
      .run('COD-DEDUPE', 'Producto Dedupe', 10, 5, 5, empresaId, depositoId);

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?,?,?,?)'
    ).run(empresaId, prodInfo.lastInsertRowid, depositoId, 5);

    const payload = {
      id_global: 'VENTA-HTTP-DEDUPE-001',
      items: [{ codigo: 'COD-DEDUPE', cantidad: 2 }],
      cliente: 'Cliente HTTP Dedupe',
      vendedor: 'Tester',
      tasa_bcv: 10,
      descuento: 0,
      metodo_pago: 'EFECTIVO',
      iva_pct: 0,
    };

    const primera = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    const segunda = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(segunda.body.ventaId).toBe(primera.body.ventaId);

    const ventas = db.prepare('SELECT id FROM ventas WHERE id_global = ?').all(payload.id_global);
    expect(ventas).toHaveLength(1);

    const producto = db
      .prepare('SELECT * FROM productos WHERE id = ?')
      .get(prodInfo.lastInsertRowid);
    expect(producto.stock).toBe(3);
  });

  test('POST /ventas con carrito vacío retorna 400 y mensaje de error', async () => {
    const { token } = createTestUserAndToken();
    const app = buildApp();

    const res = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [],
        cliente: 'Cliente HTTP',
        tasa_bcv: 10,
        metodo_pago: 'EFECTIVO',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /ventas rechaza superadmin con 403', async () => {
    const { token } = createTestUserAndToken({ rol: 'superadmin' });
    const app = buildApp();

    const res = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [], cliente: 'X' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /ventas bloquea registro cuando la empresa está suspendida por pago', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    db.prepare("UPDATE empresas SET estado = 'suspendida' WHERE id = ?").run(empresaId);

    const res = await request(app)
      .post('/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ codigo: 'NO-IMPORTA', cantidad: 1 }],
        cliente: 'Cliente bloqueado',
        tasa_bcv: 10,
        metodo_pago: 'EFECTIVO',
      });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'LICENCIA_SUSPENDIDA');
  });

  test('DELETE /ventas/:id bloquea la anulación cuando la función está desactivada', async () => {
    const empresaId = 1;
    const { token } = createTestUserAndToken({ empresaId });
    const app = buildApp();

    const res = await request(app)
      .delete('/ventas/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('code', 'VENTA_ANULAR_DESHABILITADA');
  });

  test('DELETE /ventas/:id anula la venta y responde 200 cuando la función está activada', async () => {
    const empresaId = 1;
    const { token, userId } = createTestUserAndToken({ empresaId, rol: 'admin_empresa' });
    const app = buildApp();

    ajustesService.guardarConfigGeneral({
      empresa: {
        nombre: 'Empresa Test',
        permitir_anular_venta: true,
      },
    }, empresaId);

    const depInfo = db
      .prepare(
        'INSERT INTO depositos (empresa_id, nombre, codigo, es_principal, activo) VALUES (?,?,?,?,1)'
      )
      .run(empresaId, 'Dep Ventas Delete', 'DVDLT', 1);
    const depositoId = depInfo.lastInsertRowid;

    const prodInfo = db
      .prepare(
        'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id, deposito_id, marca) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run('COD-DELETE', 'Producto Delete', 15, 7, 1, empresaId, depositoId, 'ACME');

    db.prepare(
      'INSERT INTO stock_por_deposito (empresa_id, producto_id, deposito_id, cantidad) VALUES (?,?,?,?)'
    ).run(empresaId, prodInfo.lastInsertRowid, depositoId, 1);

    db.prepare(
      'INSERT INTO stock_por_deposito_marca (empresa_id, producto_id, deposito_id, marca, cantidad) VALUES (?,?,?,?,?)'
    ).run(empresaId, prodInfo.lastInsertRowid, depositoId, 'ACME', 1);

    const venta = db.prepare(`
      INSERT INTO ventas (fecha, cliente, vendedor, metodo_pago, total_bs, tasa_bcv, usuario_id)
      VALUES (datetime('now'), 'Cliente Delete', 'Vend Delete', 'EFECTIVO', 150, 10, ?)
    `).run(userId);

    db.prepare(
      'INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs, deposito_id, marca) VALUES (?,?,?,?,?,?,?,?)'
    ).run(venta.lastInsertRowid, prodInfo.lastInsertRowid, 1, 15, 7, 150, depositoId, 'ACME');

    db.prepare('UPDATE productos SET stock = 0 WHERE id = ?').run(prodInfo.lastInsertRowid);
    db.prepare('UPDATE stock_por_deposito SET cantidad = 0 WHERE producto_id = ? AND deposito_id = ?').run(prodInfo.lastInsertRowid, depositoId);
    db.prepare('UPDATE stock_por_deposito_marca SET cantidad = 0 WHERE producto_id = ? AND deposito_id = ? AND marca = ?').run(prodInfo.lastInsertRowid, depositoId, 'ACME');

    const res = await request(app)
      .delete(`/ventas/${venta.lastInsertRowid}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    const ventaEliminada = db.prepare('SELECT id FROM ventas WHERE id = ?').get(venta.lastInsertRowid);
    expect(ventaEliminada).toBeUndefined();

    const stockMarca = db
      .prepare('SELECT cantidad FROM stock_por_deposito_marca WHERE producto_id = ? AND deposito_id = ? AND marca = ?')
      .get(prodInfo.lastInsertRowid, depositoId, 'ACME');
    expect(Number(stockMarca.cantidad || 0)).toBe(1);

    const auditRow = db
      .prepare("SELECT accion FROM auditoria WHERE accion = 'VENTA_ANULADA' AND entidad_id = ?")
      .get(venta.lastInsertRowid);
    expect(auditRow).toBeDefined();
  });
});
