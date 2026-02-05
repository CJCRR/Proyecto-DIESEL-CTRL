const path = require('path');

// Aseguramos que NODE_ENV esté en 'test' para usar la BD en memoria
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Importamos la BD y el servicio de reportes
const db = require(path.join('..', 'db'));
const reportesService = require(path.join('..', 'services', 'reportesService'));

function limpiarDatosVentas() {
  // Borrado en orden para respetar FK: detalles -> ventas -> productos/proveedores
  db.prepare('DELETE FROM venta_detalle').run();
  db.prepare('DELETE FROM ventas').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare('DELETE FROM proveedores').run();
}

describe('reportesService módulo básico', () => {
  test('debe cargarse y exponer funciones clave', () => {
    expect(reportesService).toBeDefined();
    expect(typeof reportesService.getVentasRango).toBe('function');
    expect(typeof reportesService.getResumenFinanciero).toBe('function');
    expect(typeof reportesService.getRentabilidadCategorias).toBe('function');
    expect(typeof reportesService.getRentabilidadProveedores).toBe('function');
  });

  test('getVentasRango no debe lanzar error con rango vacío por defecto', () => {
    const hoy = new Date().toISOString().slice(0, 10);
    expect(() => {
      // Si la BD está vacía, igual debería devolver un array (posiblemente vacío) sin lanzar excepción
      const resultado = reportesService.getVentasRango({
        desde: hoy,
        hasta: hoy,
        clienteId: null,
        vendedorId: null,
        metodoPago: null,
        moneda: 'USD',
      });
      expect(Array.isArray(resultado)).toBe(true);
    }).not.toThrow();
  });
});

describe('reportesService rentabilidad y resumen financiero', () => {
  test('calcula rentabilidad por categoría y proveedor de forma consistente', () => {
    limpiarDatosVentas();

    const insertProveedor = db.prepare(
      'INSERT INTO proveedores (nombre) VALUES (?)'
    );
    const insertProducto = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, categoria, proveedor_id) VALUES (?,?,?,?,?,?,?)'
    );
    const insertVenta = db.prepare(
      'INSERT INTO ventas (fecha, cliente, vendedor, tasa_bcv, descuento, metodo_pago, referencia, total_bs) VALUES (?,?,?,?,?,?,?,?)'
    );
    const insertDetalle = db.prepare(
      'INSERT INTO venta_detalle (venta_id, producto_id, cantidad, precio_usd, costo_usd, subtotal_bs) VALUES (?,?,?,?,?,?)'
    );

    const fecha = '2024-01-01';
    const tasa = 10; // 1 USD = 10 Bs para el test

    const prov = insertProveedor.run('Proveedor Test');
    const proveedorId = prov.lastInsertRowid;

    const p1 = insertProducto.run(
      'P1',
      'Producto 1',
      100,
      50,
      10,
      'Motores',
      proveedorId
    );
    const p2 = insertProducto.run(
      'P2',
      'Producto 2',
      20,
      10,
      5,
      'Filtros',
      proveedorId
    );

    const venta = insertVenta.run(
      fecha,
      'Cliente Test',
      'Vendedor 1',
      tasa,
      0,
      'Efectivo',
      'REF-001',
      2600 // 2000 + 600
    );
    const ventaId = venta.lastInsertRowid;

    // Detalle: P1 -> 2 unidades * 100 USD * 10 = 2000 Bs
    insertDetalle.run(ventaId, p1.lastInsertRowid, 2, 100, 50, 2000);
    // Detalle: P2 -> 3 unidades * 20 USD * 10 = 600 Bs
    insertDetalle.run(ventaId, p2.lastInsertRowid, 3, 20, 10, 600);

    const params = { desde: fecha, hasta: fecha };

    const porCategoria = reportesService.getRentabilidadCategorias(params);
    const porProveedor = reportesService.getRentabilidadProveedores(params);
    const resumen = reportesService.getResumenFinanciero(params);

    // Rentabilidad por categoría
    expect(porCategoria.length).toBe(2);
    const porNombreCat = Object.fromEntries(
      porCategoria.map((c) => [c.categoria, c])
    );

    const catMotores = porNombreCat['Motores'];
    const catFiltros = porNombreCat['Filtros'];

    expect(catMotores).toBeDefined();
    expect(catFiltros).toBeDefined();

    // Motores: 2 * 100 USD, costo 2 * 50 USD
    expect(catMotores.ingresos_bs).toBeCloseTo(2000);
    expect(catMotores.ingresos_usd).toBeCloseTo(200);
    expect(catMotores.costos_bs).toBeCloseTo(1000);
    expect(catMotores.costos_usd).toBeCloseTo(100);
    expect(catMotores.margen_bs).toBeCloseTo(1000);
    expect(catMotores.margen_usd).toBeCloseTo(100);
    expect(catMotores.margen_pct).toBeCloseTo(0.5);

    // Filtros: 3 * 20 USD, costo 3 * 10 USD
    expect(catFiltros.ingresos_bs).toBeCloseTo(600);
    expect(catFiltros.ingresos_usd).toBeCloseTo(60);
    expect(catFiltros.costos_bs).toBeCloseTo(300);
    expect(catFiltros.costos_usd).toBeCloseTo(30);
    expect(catFiltros.margen_bs).toBeCloseTo(300);
    expect(catFiltros.margen_usd).toBeCloseTo(30);
    expect(catFiltros.margen_pct).toBeCloseTo(0.5);

    // Rentabilidad por proveedor (solo uno en el test)
    expect(porProveedor.length).toBe(1);
    const provRow = porProveedor[0];

    expect(provRow.ingresos_bs).toBeCloseTo(2600);
    expect(provRow.ingresos_usd).toBeCloseTo(260);
    expect(provRow.costos_bs).toBeCloseTo(1300);
    expect(provRow.costos_usd).toBeCloseTo(130);
    expect(provRow.margen_bs).toBeCloseTo(1300);
    expect(provRow.margen_usd).toBeCloseTo(130);
    expect(provRow.margen_pct).toBeCloseTo(0.5);

    // Resumen financiero global para el mismo rango
    expect(resumen.ingresos_bs).toBeCloseTo(2600);
    expect(resumen.ingresos_usd).toBeCloseTo(260);
    expect(resumen.costos_bs).toBeCloseTo(1300);
    expect(resumen.costos_usd).toBeCloseTo(130);
    expect(resumen.margen_bs).toBeCloseTo(1300);
    expect(resumen.margen_usd).toBeCloseTo(130);
    expect(resumen.margen_pct).toBeCloseTo(0.5);
  });
});
