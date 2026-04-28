jest.mock('../services/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../db', () => ({
  prepare: jest.fn(),
}));

jest.mock('../services/ajustesService', () => ({
  obtenerTasaBcv: jest.fn(() => ({
    tasa_bcv: 466,
    actualizado_en: '2024-01-15T12:00:00.000Z',
  })),
  obtenerConfigGeneral: jest.fn(() => ({
    empresa: {
      precio1_nombre: '60',
      precio1_pct: 60,
      precio2_nombre: '45',
      precio2_pct: 45,
      precio3_nombre: '',
      precio3_pct: 0,
      precio_redondeo_0_5: true,
      precio_redondeo_umbral: 15,
    },
    descuentos_volumen: [],
    devolucion: {},
    nota: {},
  })),
}));

describe('whatsappService', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.WHATSAPP_EMPRESA_ID = '1';
    process.env.WHATSAPP_NIVEL_PRECIO = '1';
  });

  afterEach(() => {
    delete process.env.WHATSAPP_EMPRESA_ID;
    delete process.env.WHATSAPP_NIVEL_PRECIO;
  });

  function loadServiceWithProducts(productos) {
    const db = require('../db');
    db.prepare.mockReturnValue({
      all: jest.fn(() => productos),
    });

    return require('../services/whatsappService');
  }

  test('cotiza en bolivares con nivel configurado y redondeo del POS', async () => {
    const service = loadServiceWithProducts([
      { codigo: 'FF5421', descripcion: 'Filtro Fleetguard', precio_usd: 15, stock: 4 },
    ]);

    const reply = await service.__testables.replyPrice('filtro fleetguard', 'precio filtro fleetguard');

    expect(reply).toContain('Precio: $25,00');
    expect(reply).toContain('Tasa BCV: Bs 466,00');
    expect(reply).not.toContain('(+60%)');
  });

  test('si piden divisas responde con precio base en usd', async () => {
    const service = loadServiceWithProducts([
      { codigo: 'FF5421', descripcion: 'Filtro Fleetguard', precio_usd: 15, stock: 4 },
    ]);

    const reply = await service.__testables.replyPrice('filtro fleetguard en divisas', 'precio filtro fleetguard en divisas');

    expect(reply).toContain('Precio base: $15,00');
    expect(reply).toContain('Tasa BCV: Bs 466,00');
    expect(reply).not.toContain('Precio: $25,00');
  });

  test('pedido usa precio en bs por defecto y base solo si piden divisas', async () => {
    const service = loadServiceWithProducts([
      { codigo: 'FF5421', descripcion: 'Filtro Fleetguard', precio_usd: 15, stock: 4 },
    ]);

    const replyBs = await service.__testables.replyOrder('filtro fleetguard', 'quiero pedir filtro fleetguard');
    const replyUsd = await service.__testables.replyOrder('filtro fleetguard', 'quiero pedir filtro fleetguard en divisas');

    expect(replyBs).toContain('Precio: $25,00');
    expect(replyBs).toContain('Tasa BCV: Bs 466,00');
    expect(replyUsd).toContain('Precio base: $15,00');
  });

  test('permite consultar directo por nombre o codigo sin pedir la palabra precio', async () => {
    const service = loadServiceWithProducts([
      { codigo: '8-97028691-0', descripcion: 'ANILLOS ISUZU 4HF1', precio_usd: 75, stock: 1 },
    ]);

    const reply = await service.__testables.buildReply('cliente-1', 'anillos 4hf1');

    expect(reply).toContain('Resultados para *anillos 4hf1*');
    expect(reply).toContain('Precio: $120,00');
    expect(reply).toContain('Tasa BCV: Bs 466,00');
  });

  test('usa el ultimo repuesto cuando el cliente pregunta luego por divisas', async () => {
    const service = loadServiceWithProducts([
      { codigo: '8-97028691-0', descripcion: 'ANILLOS ISUZU 4HF1', precio_usd: 75, stock: 1 },
    ]);

    await service.__testables.buildReply('cliente-1', 'anillos 4hf1');
    const reply = await service.__testables.buildReply('cliente-1', 'cuanto seria en divisas');

    expect(reply).toContain('Resultados para *anillos 4hf1*');
    expect(reply).toContain('Precio base: $75,00');
    expect(reply).toContain('Tasa BCV: Bs 466,00');
  });

  test('ignora palabras de pago al construir tokens de busqueda', () => {
    const service = loadServiceWithProducts([]);

    expect(service.__testables.buildSearchTokens('filtro en divisas usd zelle')).toEqual(['filtro']);
  });
});