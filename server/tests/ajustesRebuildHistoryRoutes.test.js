const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require(path.join('..', 'db'));
const ajustesRoutes = require(path.join('..', 'routes', 'ajustes'));
const { createTestUserAndToken } = require('./testAuthUtils');

function resetRebuildHistoryData() {
  db.prepare('DELETE FROM auditoria').run();
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/admin/ajustes', ajustesRoutes);
  return app;
}

describe('Rutas HTTP /admin/ajustes rebuild history', () => {
  beforeEach(() => {
    resetRebuildHistoryData();
  });

  test('GET /admin/ajustes/rebuild-stock/history devuelve corridas del rebuild para la empresa actual', async () => {
    const empresaId = 44;
    const otraEmpresaId = 45;
    const { token } = createTestUserAndToken({ rol: 'admin', empresaId });
    const app = buildApp();

    db.prepare(
      'INSERT INTO auditoria (empresa_id, accion, entidad, detalle, fecha) VALUES (?, ?, ?, ?, ?)'
    ).run(
      empresaId,
      'REBUILD_STOCK_EMPRESA',
      'inventario',
      JSON.stringify({
        totalProductos: 12,
        actualizados: 2,
        negativos: 0,
        sinStockPorDeposito: 1,
        truncado: false,
        corregidos: [
          { producto_id: 9, codigo: 'ABC', stock_anterior: 7, stock_nuevo: 5 },
          { producto_id: 10, codigo: 'XYZ', stock_anterior: 2, stock_nuevo: 3 },
        ],
      }),
      '2026-05-13T08:00:00.000Z'
    );

    db.prepare(
      'INSERT INTO auditoria (empresa_id, accion, entidad, detalle, fecha) VALUES (?, ?, ?, ?, ?)'
    ).run(
      otraEmpresaId,
      'REBUILD_STOCK_EMPRESA',
      'inventario',
      JSON.stringify({
        totalProductos: 99,
        actualizados: 9,
        negativos: 1,
        sinStockPorDeposito: 0,
        truncado: false,
        corregidos: [{ producto_id: 11, codigo: 'OTRO', stock_anterior: 1, stock_nuevo: 0 }],
      }),
      '2026-05-12T08:00:00.000Z'
    );

    const res = await request(app)
      .get('/admin/ajustes/rebuild-stock/history?limit=5')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      totalProductos: 12,
      actualizados: 2,
      sinStockPorDeposito: 1,
      negativos: 0,
      truncado: false,
    });
    expect(res.body.items[0].corregidos).toEqual([
      { producto_id: 9, codigo: 'ABC', stock_anterior: 7, stock_nuevo: 5 },
      { producto_id: 10, codigo: 'XYZ', stock_anterior: 2, stock_nuevo: 3 },
    ]);
  });
});