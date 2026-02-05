const db = require('../db');
const { insertAlerta } = require('../routes/alertas');

// ===== AJUSTES DE STOCK =====

const MAX_MOTIVO = 400;

function safeStr(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function ajustarStock(payload = {}) {
  const { codigo, diferencia, motivo } = payload;
  const diff = parseInt(diferencia);

  if (!codigo || Number.isNaN(diff) || diff === 0 || !motivo) {
    const error = new Error('Datos inválidos. Se requiere código, diferencia distinta de 0 y motivo.');
    error.tipo = 'VALIDACION';
    throw error;
  }

  db.transaction(() => {
    const producto = db.prepare('SELECT id, stock, codigo FROM productos WHERE codigo = ?').get(codigo);

    if (!producto) throw new Error('PRODUCTO_NO_ENCONTRADO');

    const nuevoStock = producto.stock + diff;
    if (nuevoStock < 0) throw new Error('STOCK_NEGATIVO');

    db.prepare('UPDATE productos SET stock = ? WHERE id = ?').run(nuevoStock, producto.id);
    if (nuevoStock <= 0) {
      insertAlerta('stock', `Stock agotado: ${producto.codigo || codigo}`, { codigo: producto.codigo || codigo, nuevoStock });
    }

    const motivoSafe = safeStr(motivo, MAX_MOTIVO);
    db.prepare(`
                INSERT INTO ajustes_stock (producto_id, diferencia, motivo, fecha)
                VALUES (?, ?, ?, ?)
            `).run(producto.id, diff, motivoSafe, new Date().toISOString());
  })();
}

function listarAjustes(limit = 100) {
  return db.prepare(`
      SELECT a.id, a.producto_id, p.codigo, p.descripcion, a.diferencia, a.motivo, a.fecha
      FROM ajustes_stock a
      LEFT JOIN productos p ON p.id = a.producto_id
      ORDER BY a.fecha DESC
      LIMIT ?
    `).all(limit);
}

// ===== UTILIDADES DE CONFIG =====

function getConfig(clave, def = null) {
  const row = db.prepare(`SELECT valor FROM config WHERE clave = ?`).get(clave);
  if (!row || row.valor === undefined || row.valor === null) return def;
  return row.valor;
}

function setConfig(clave, valor, fecha = new Date().toISOString()) {
  db.prepare(`INSERT INTO config (clave, valor, actualizado_en) VALUES (?, ?, ?)
              ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actualizado_en=excluded.actualizado_en`)
    .run(clave, String(valor), fecha);
}

function getConfigJSON(clave, defObj = {}) {
  const raw = getConfig(clave, null);
  if (!raw) return defObj;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : defObj;
  } catch (err) {
    return defObj;
  }
}

// ===== TASA BCV =====

function obtenerTasaBcv() {
  const row = db.prepare(`SELECT valor, actualizado_en FROM config WHERE clave='tasa_bcv'`).get();
  const valor = parseFloat(row?.valor ?? '1') || 1;
  return { tasa_bcv: valor, actualizado_en: row?.actualizado_en || null };
}

function guardarTasaBcv(tasa) {
  const now = new Date().toISOString();
  setConfig('tasa_bcv', tasa, now);
  return { ok: true, tasa_bcv: tasa, actualizado_en: now };
}

async function actualizarTasaBcvAutomatica() {
  const https = require('https');

  async function fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
        let data = '';
        resp.on('data', chunk => { data += chunk; });
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  async function fetchHTML(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8' } }, (resp) => {
        let data = '';
        resp.on('data', chunk => { data += chunk; });
        resp.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  try {
    let tasa = null;

    // 1) Scrape BCV oficial
    try {
      const html = await fetchHTML('https://www.bcv.org.ve/');
      const patterns = [
        /USD\s*<\/strong>\s*([0-9\.]{3,9},[0-9]{2})/i,
        /USD[^0-9]+([0-9\.]{3,9},[0-9]{2})/i,
        /D(?:\u00f3|ó)lar\s+USD[^0-9]+([0-9\.]{3,9},[0-9]{2})/i,
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) {
          tasa = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
          if (!Number.isNaN(tasa) && tasa > 0) break;
        }
      }
    } catch (e) {
      // ignorar errores de scrape
    }

    // 2) API comunitaria
    if (!tasa || Number.isNaN(tasa)) {
      try {
        const j = await fetchJSON('https://pydolarve.org/api/v1/dollar?page=bcv');
        tasa = parseFloat(j?.monitors?.bcv?.price || j?.bcv?.price || j?.price || j?.promedio || j?.[0]?.price);
      } catch (e) {}
    }

    // 3) Otra API comunitaria
    if (!tasa || Number.isNaN(tasa)) {
      try {
        const j2 = await fetchJSON('https://pydolarvenezuela-api.vercel.app/api/v1/dollar');
        tasa = parseFloat(j2?.bcv?.price || j2?.BCV?.promedio || j2?.BCV?.price);
      } catch (e) {}
    }

    // 4) Fallback USD->VES promedio
    if (!tasa || Number.isNaN(tasa)) {
      try {
        const j3 = await fetchJSON('https://api.exchangerate.host/latest?base=USD&symbols=VES');
        tasa = parseFloat(j3?.rates?.VES);
      } catch (e) {}
    }

    const previa = parseFloat(getConfig('tasa_bcv', '1')) || 1;
    if (!tasa || Number.isNaN(tasa) || tasa <= 0) {
      return { ok: false, tasa_bcv: previa, error: 'No fue posible obtener la tasa automáticamente' };
    }

    const now = new Date().toISOString();
    setConfig('tasa_bcv', tasa, now);
    return { ok: true, tasa_bcv: tasa, previa, actualizado_en: now };
  } catch (err) {
    console.error('Error actualizando tasa:', err.message);
    const previa = parseFloat(getConfig('tasa_bcv', '1')) || 1;
    return { ok: false, tasa_bcv: previa, error: 'Error actualizando tasa' };
  }
}

// ===== STOCK MÍNIMO =====

function obtenerStockMinimo() {
  const v = parseInt(getConfig('stock_minimo', '3')) || 3;
  return { stock_minimo: v };
}

function guardarStockMinimo(n) {
  setConfig('stock_minimo', n);
  return { ok: true, stock_minimo: n };
}

// ===== CONFIG GENERAL =====

const DEFAULT_EMPRESA = {
  nombre: 'Diesel CTRL',
  logo_url: '',
  color_primario: '#2563eb',
  color_secundario: '#0f172a',
  color_acento: '#f97316',
};

const DEFAULT_DESCUENTOS_VOLUMEN = [];

const DEFAULT_DEVOLUCION = {
  habilitado: true,
  dias_max: 30,
  requiere_referencia: true,
  recargo_restock_pct: 0,
};

const DEFAULT_NOTA = {
  header_logo_url: '',
  brand_logos: [],
  rif: '',
  telefonos: '',
  ubicacion: '',
  direccion_general: '',
  encabezado_texto: '¡Tu Proveedor de Confianza!',
  terminos:
    'LOS BIENES AQUÍ FACTURADOS ESTÁN EXENTOS DEL PAGO DEL I.V.A. SEGÚN ART. 18#10 DE LA LEY DEL IMPUESTO AL VALOR AGREGADO Y ART. 19 DEL REGLAMENTO DE LEY.',
  pie: 'Total a Pagar:',
  pie_usd: 'Total USD',
  pie_bs: 'Total Bs',
  iva_pct: 0,
  resaltar_color: '#fff59d',
  layout: 'compact',
};

function obtenerConfigGeneral() {
  const empresa = getConfigJSON('empresa_config', DEFAULT_EMPRESA);
  const descuentos = getConfigJSON('descuentos_volumen', DEFAULT_DESCUENTOS_VOLUMEN);
  const devolucion = getConfigJSON('devolucion_politica', DEFAULT_DEVOLUCION);
  const nota = getConfigJSON('nota_config', DEFAULT_NOTA);
  return { empresa, descuentos_volumen: descuentos, devolucion, nota };
}

function guardarConfigGeneral(payload = {}) {
  const { empresa = {}, descuentos_volumen = [], devolucion = {}, nota = {} } = payload;

  let nombreEmpresa = (empresa.nombre || '').toString().slice(0, 120);
  if ((!nombreEmpresa || nombreEmpresa === 'EMPRESA') && typeof nota === 'object' && nota && nota.empresa_nombre) {
    nombreEmpresa = nota.empresa_nombre.toString().slice(0, 120);
  }
  if ((!nombreEmpresa || nombreEmpresa === 'EMPRESA') && typeof nota === 'object' && nota && nota.nombre) {
    nombreEmpresa = nota.nombre.toString().slice(0, 120);
  }
  if (!nombreEmpresa) nombreEmpresa = 'EMPRESA';

  const safeEmpresa = {
    nombre: nombreEmpresa,
    logo_url: (empresa.logo_url || '').toString().slice(0, 500),
    color_primario: empresa.color_primario || DEFAULT_EMPRESA.color_primario,
    color_secundario: empresa.color_secundario || DEFAULT_EMPRESA.color_secundario,
    color_acento: empresa.color_acento || DEFAULT_EMPRESA.color_acento,
    rif: (empresa.rif || '').toString().slice(0, 120),
    telefonos: (empresa.telefonos || '').toString().slice(0, 200),
    ubicacion: (empresa.ubicacion || '').toString().slice(0, 240),
  };

  const safeDescuentos = Array.isArray(descuentos_volumen)
    ? descuentos_volumen
        .map((t) => ({
          min_qty: Math.max(1, parseInt(t.min_qty, 10) || 0),
          descuento_pct: Math.max(0, Math.min(100, parseFloat(t.descuento_pct) || 0)),
        }))
        .filter((t) => t.min_qty > 0 && t.descuento_pct > 0)
        .sort((a, b) => a.min_qty - b.min_qty)
    : DEFAULT_DESCUENTOS_VOLUMEN;

  const safeDevolucion = {
    habilitado: !!devolucion.habilitado,
    dias_max: Math.max(0, parseInt(devolucion.dias_max, 10) || DEFAULT_DEVOLUCION.dias_max),
    requiere_referencia: devolucion.requiere_referencia !== false,
    recargo_restock_pct: Math.max(0, Math.min(100, parseFloat(devolucion.recargo_restock_pct) || 0)),
  };

  const safeNota = {
    header_logo_url: (nota.header_logo_url || '').toString().slice(0, 500),
    brand_logos: Array.isArray(nota.brand_logos)
      ? nota.brand_logos.slice(0, 8).map((u) => (u || '').toString().slice(0, 500))
      : [],
    rif: (nota.rif || '').toString().slice(0, 120),
    telefonos: (nota.telefonos || '').toString().slice(0, 200),
    ubicacion: (nota.ubicacion || '').toString().slice(0, 240),
    direccion_general: (nota.direccion_general || '').toString().slice(0, 240),
    encabezado_texto: (nota.encabezado_texto || DEFAULT_NOTA.encabezado_texto).toString().slice(0, 200),
    terminos: (nota.terminos || DEFAULT_NOTA.terminos).toString().slice(0, 800),
    pie: (nota.pie || DEFAULT_NOTA.pie).toString().slice(0, 120),
    pie_usd: (nota.pie_usd || DEFAULT_NOTA.pie_usd).toString().slice(0, 60),
    pie_bs: (nota.pie_bs || DEFAULT_NOTA.pie_bs).toString().slice(0, 60),
    iva_pct: Math.max(0, Math.min(100, parseFloat(nota.iva_pct) || 0)),
    resaltar_color: (nota.resaltar_color || DEFAULT_NOTA.resaltar_color).toString().slice(0, 20),
    layout: ['compact', 'standard'].includes(nota.layout) ? nota.layout : DEFAULT_NOTA.layout,
  };

  const now = new Date().toISOString();
  setConfig('empresa_config', JSON.stringify(safeEmpresa), now);
  setConfig('descuentos_volumen', JSON.stringify(safeDescuentos), now);
  setConfig('devolucion_politica', JSON.stringify(safeDevolucion), now);
  setConfig('nota_config', JSON.stringify(safeNota), now);

  return {
    ok: true,
    empresa: safeEmpresa,
    descuentos_volumen: safeDescuentos,
    devolucion: safeDevolucion,
    nota: safeNota,
  };
}

// ===== BORRADO DE DATOS TRANSACCIONALES =====

function purgeTransactionalData() {
  db.transaction(() => {
    db.prepare('DELETE FROM devolucion_detalle').run();
    db.prepare('DELETE FROM devoluciones').run();
    db.prepare('DELETE FROM venta_detalle').run();
    db.prepare('DELETE FROM ventas').run();
    db.prepare('DELETE FROM pagos_cc').run();
    db.prepare('DELETE FROM cuentas_cobrar').run();
    db.prepare('DELETE FROM ajustes_stock').run();
    db.prepare('DELETE FROM productos').run();
    db.prepare('DELETE FROM alertas').run();

    const hasSeq = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
      .get();
    if (hasSeq) {
      db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (
          'devolucion_detalle','devoluciones','venta_detalle','ventas','pagos_cc',
          'cuentas_cobrar','ajustes_stock','productos','alertas'
        )`).run();
    }
  })();
}

module.exports = {
  ajustarStock,
  listarAjustes,
  obtenerTasaBcv,
  guardarTasaBcv,
  actualizarTasaBcvAutomatica,
  obtenerStockMinimo,
  guardarStockMinimo,
  obtenerConfigGeneral,
  guardarConfigGeneral,
  purgeTransactionalData,
};
