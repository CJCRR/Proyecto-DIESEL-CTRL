const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

jest.mock('../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../services/whatsappService', () => ({
  sendMessage: jest.fn().mockResolvedValue(undefined),
}));

const db = require(path.join('..', 'db'));
const ajustesService = require(path.join('..', 'services', 'ajustesService'));
const { sendMessage } = require(path.join('..', 'services', 'whatsappService'));

function resetAjustesData() {
  db.prepare('DELETE FROM ajustes_stock').run();
  db.prepare('DELETE FROM productos').run();
  db.prepare('DELETE FROM alertas').run();
  db.prepare('DELETE FROM pagos_licencia').run();
  db.prepare('DELETE FROM empresas WHERE id != 1').run();
  db.prepare("DELETE FROM config WHERE clave = 'tasa_bcv'").run();
  db.prepare("DELETE FROM config WHERE clave = 'whatsapp_admin_notificaciones'").run();
  db.prepare("DELETE FROM config WHERE clave = 'empresa_config' OR clave LIKE 'empresa_config:empresa:%'").run();
  db.prepare("DELETE FROM config WHERE clave = 'descuentos_volumen' OR clave LIKE 'descuentos_volumen:empresa:%'").run();
  db.prepare("DELETE FROM config WHERE clave = 'devolucion_politica' OR clave LIKE 'devolucion_politica:empresa:%'").run();
  db.prepare("DELETE FROM config WHERE clave = 'nota_config' OR clave LIKE 'nota_config:empresa:%'").run();
}

describe('ajustesService', () => {
  beforeEach(() => {
    resetAjustesData();
    jest.clearAllMocks();
  });

  test('ajustarStock modifica el stock y registra ajuste', () => {
    const insertProducto = db.prepare(
      'INSERT INTO productos (codigo, descripcion, precio_usd, costo_usd, stock, empresa_id) VALUES (?,?,?,?,?,?)'
    );

    insertProducto.run('AJ-1', 'Producto Ajuste', 10, 5, 5, 1);

    ajustesService.ajustarStock({
      codigo: 'AJ-1',
      diferencia: -2,
      motivo: 'Ajuste prueba',
      empresa_id: 1,
    });

    const prod = db.prepare('SELECT * FROM productos WHERE codigo = ?').get('AJ-1');
    expect(prod.stock).toBe(3);

    const ajustes = db.prepare('SELECT * FROM ajustes_stock WHERE producto_id = ?').all(prod.id);
    expect(ajustes.length).toBe(1);
    expect(ajustes[0].diferencia).toBe(-2);
  });

  test('obtener y guardar tasa BCV usan config', () => {
    const resGuardar = ajustesService.guardarTasaBcv(123.45);
    expect(resGuardar.ok).toBe(true);

    const { tasa_bcv } = ajustesService.obtenerTasaBcv();
    expect(tasa_bcv).toBeCloseTo(123.45);
  });

  test('obtenerConfigGeneral devuelve estructura por defecto sin config previa', () => {
    const cfg = ajustesService.obtenerConfigGeneral();
    expect(cfg.empresa).toBeDefined();
    expect(cfg.devolucion).toBeDefined();
    expect(cfg.nota).toBeDefined();
    expect(cfg.empresa.permitir_anular_venta).toBe(false);
  });

  test('guardarConfigGeneral persiste permitir_anular_venta por empresa', () => {
    const empresaId = 77;

    const guardado = ajustesService.guardarConfigGeneral({
      empresa: {
        nombre: 'Empresa Riesgo',
        permitir_anular_venta: true,
      },
    }, empresaId);

    expect(guardado.ok).toBe(true);
    expect(guardado.empresa.permitir_anular_venta).toBe(true);

    const cfgEmpresa = ajustesService.obtenerConfigGeneral(empresaId);
    expect(cfgEmpresa.empresa.permitir_anular_venta).toBe(true);

    const cfgOtraEmpresa = ajustesService.obtenerConfigGeneral(empresaId + 1);
    expect(cfgOtraEmpresa.empresa.permitir_anular_venta).toBe(false);
  });

  test('registrarSolicitudPagoLicencia crea alerta y notificación WhatsApp cuando hay destino configurado', () => {
    db.prepare(`
      INSERT INTO empresas (id, nombre, codigo, estado, plan, monto_mensual)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(2, 'Empresa Demo', 'DEMO', 'activa', 'Mensual', 25);

    db.prepare(`
      INSERT INTO config (clave, valor, actualizado_en)
      VALUES ('whatsapp_admin_notificaciones', ?, datetime('now'))
    `).run('584121234567');

    const pago = ajustesService.registrarSolicitudPagoLicencia(2, {
      id: 9,
      username: 'operador.demo',
      nombre: 'Operador Demo',
    }, {
      fecha_pago: '2026-01-10',
      monto_usd: 25,
      referencia: 'REF-123',
      tipo: 'pago_movil',
      notas: 'Pago enviado para validación',
    });

    expect(pago).toBeDefined();
    expect(pago.estado).toBe('pendiente');

    const alerta = db.prepare(`
      SELECT tipo, mensaje, data
      FROM alertas
      WHERE tipo = 'licencia_pago_pendiente'
      ORDER BY id DESC
      LIMIT 1
    `).get();

    expect(alerta).toBeDefined();
    expect(alerta.mensaje).toContain('Empresa Demo');

    const data = JSON.parse(alerta.data || '{}');
    expect(data.empresa_id).toBe(2);
    expect(data.monto_usd).toBe(25);
    expect(data.referencia).toBe('REF-123');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      '584121234567',
      expect.stringContaining('Empresa: Empresa Demo (DEMO)')
    );
  });
});
