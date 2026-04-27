/**
 * whatsappService.js
 * Núcleo del bot de WhatsApp para Diesel CTRL.
 *
 * Flujo de conversación:
 *   saludo          → presentación + menú de opciones
 *   precio / cuánto → busca producto en POS y responde en USD y BsD
 *   stock / hay     → disponibilidad del producto
 *   pedir / quiero  → inicia flujo de pedido (captura datos básicos)
 *   ayuda / menú    → muestra opciones disponibles
 *   otro            → respuesta genérica + derivar a humano
 *
 * Variables de entorno requeridas:
 *   WHATSAPP_TOKEN          – Bearer token de Meta Cloud API
 *   WHATSAPP_PHONE_ID       – Phone Number ID de Meta Cloud API
 *
 * Variables opcionales:
 *   WHATSAPP_API_VERSION    – versión de la API (default: v19.0)
 *   WHATSAPP_EMPRESA_ID     – empresa_id para filtrar productos (omitir = global)
 *   WHATSAPP_BOT_NAME       – nombre del asistente (default: "Diesel CTRL")
 */

const https = require('https');
const db = require('../db');
const { getRate } = require('./bcvService');
const logger = require('./logger');

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v19.0';
const BOT_NAME = process.env.WHATSAPP_BOT_NAME || 'Diesel CTRL';

// ─────────────────────────────────────────────────────────────────────────────
// Envío de mensajes via Meta Cloud API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envía un mensaje de texto al número dado.
 * @param {string} to        – número en formato internacional (ej: 584121234567)
 * @param {string} text      – cuerpo del mensaje
 * @returns {Promise<void>}
 */
async function sendMessage(to, text) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;

    if (!token || !phoneId) {
        logger.error('whatsappService: WHATSAPP_TOKEN o WHATSAPP_PHONE_ID no configurados');
        return;
    }

    const body = JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
    });

    const options = {
        hostname: 'graph.facebook.com',
        path: `/${API_VERSION}/${phoneId}/messages`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    logger.error('whatsappService: error al enviar mensaje', { status: res.statusCode, body: data });
                }
                resolve();
            });
        });
        req.on('error', (err) => {
            logger.error('whatsappService: error de red al enviar mensaje', { message: err.message });
            reject(err);
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('WhatsApp API timeout')); });
        req.write(body);
        req.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultas a la base de datos local (POS)
// ─────────────────────────────────────────────────────────────────────────────

const empresaId = process.env.WHATSAPP_EMPRESA_ID
    ? parseInt(process.env.WHATSAPP_EMPRESA_ID)
    : null;

/**
 * Busca productos cuyo código o descripción contengan `termino`.
 * @param {string} termino
 * @returns {Array<{codigo:string, descripcion:string, precio_usd:number, stock:number}>}
 */
function buscarProductos(termino) {
    try {
        const like = `%${termino.toUpperCase()}%`;
        const sql = `
            SELECT p.codigo, p.descripcion, p.precio_usd,
                   COALESCE((
                       SELECT SUM(sd.cantidad)
                       FROM stock_por_deposito sd
                       WHERE sd.producto_id = p.id
                   ), p.stock) AS stock
            FROM productos p
            WHERE p.activo = 1
              AND (UPPER(p.codigo) LIKE ? OR UPPER(p.descripcion) LIKE ?)
              ${empresaId ? 'AND p.empresa_id = ?' : ''}
            LIMIT 5
        `;
        const params = empresaId ? [like, like, empresaId] : [like, like];
        return db.prepare(sql).all(...params);
    } catch (err) {
        logger.error('whatsappService: error buscando productos', { message: err.message });
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección de intenciones
// ─────────────────────────────────────────────────────────────────────────────

const INTENT = {
    GREETING: 'greeting',
    PRICE: 'price',
    STOCK: 'stock',
    ORDER: 'order',
    HELP: 'help',
    UNKNOWN: 'unknown',
};

/** Normaliza el texto: minúsculas, sin acentos, sin signos de puntuación extra */
function normalize(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿?¡!]/g, '')
        .trim();
}

/**
 * Detecta la intención del mensaje.
 * @param {string} text
 * @returns {{ intent: string, query: string }}
 */
function detectIntent(text) {
    const t = normalize(text);

    if (/^(hola|buenas|buenos|buen dia|buen tarde|buen noche|saludos|hey|hi|ola)/.test(t)) {
        return { intent: INTENT.GREETING, query: '' };
    }
    if (/(precio|cuanto cuesta|cuanto vale|valor|cuanto es|cuanto sale|a cuanto)/.test(t)) {
        const query = t
            .replace(/^.*?(precio|cuanto cuesta|cuanto vale|valor|cuanto es|cuanto sale|a cuanto)\s*(de|del|la|el|los|las|un|una)?\s*/i, '')
            .trim();
        return { intent: INTENT.PRICE, query };
    }
    if (/(stock|hay|disponible|tienen|existe|tienes|cuantos hay|cuantas hay|disponibilidad)/.test(t)) {
        const query = t
            .replace(/^.*?(stock|hay|disponible|tienen|existe|tienes|cuantos hay|cuantas hay|disponibilidad)\s*(de|del|la|el|los|las|un|una)?\s*/i, '')
            .trim();
        return { intent: INTENT.STOCK, query };
    }
    if (/(pedir|quiero|comprar|ordenar|pedido|necesito|dame|me puedes dar|apartar)/.test(t)) {
        const query = t
            .replace(/^.*?(pedir|quiero|comprar|ordenar|pedido|necesito|dame|me puedes dar|apartar)\s*(de|del|la|el|los|las|un|una)?\s*/i, '')
            .trim();
        return { intent: INTENT.ORDER, query };
    }
    if (/(ayuda|menu|opciones|que puedes hacer|como funciona|info|informacion)/.test(t)) {
        return { intent: INTENT.HELP, query: '' };
    }

    return { intent: INTENT.UNKNOWN, query: t };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generadores de respuesta
// ─────────────────────────────────────────────────────────────────────────────

function replyGreeting() {
    return (
        `👋 ¡Hola! Bienvenido a *${BOT_NAME}*.\n\n` +
        `Soy tu asistente de repuestos diesel. ¿En qué te puedo ayudar?\n\n` +
        `🔹 *Precio* – Consultar precio de un repuesto\n` +
        `🔹 *Stock* – Ver disponibilidad\n` +
        `🔹 *Pedir* – Hacer un pedido\n` +
        `🔹 *Ayuda* – Ver opciones\n\n` +
        `Escribe lo que necesitas y te respondo al instante. 🚛`
    );
}

function replyHelp() {
    return (
        `ℹ️ *${BOT_NAME} – Opciones disponibles*\n\n` +
        `💲 _"Precio filtro de aceite"_ → te digo el precio en USD y BsD\n` +
        `📦 _"Hay filtros Fleetguard"_ → verifico el stock\n` +
        `🛒 _"Quiero pedir correa"_ → inicio el pedido\n\n` +
        `Para hablar con un agente escribe *humano* o llama directamente. 📞`
    );
}

async function replyPrice(query) {
    if (!query) {
        return '¿De qué repuesto necesitas el precio? Escríbeme, por ejemplo: _"precio filtro de aceite Fleetguard"_';
    }
    const productos = buscarProductos(query);
    if (!productos.length) {
        return `😕 No encontré el repuesto *"${query}"* en nuestro catálogo.\nIntenta con el código o parte de la descripción.`;
    }

    const rate = await getRate();
    const lines = productos.map((p) => {
        const pUsd = p.precio_usd != null ? `$${p.precio_usd.toFixed(2)}` : 'sin precio';
        const pBs = p.precio_usd != null ? `Bs ${(p.precio_usd * rate).toFixed(2)}` : '';
        const stockInfo = p.stock > 0 ? `✅ ${p.stock} en stock` : '❌ Sin stock';
        return `*${p.codigo}* – ${p.descripcion}\n   💲 ${pUsd}${pBs ? ` / ${pBs}` : ''} | ${stockInfo}`;
    });

    return (
        `🔎 Resultados para _"${query}"_:\n\n` +
        lines.join('\n\n') +
        `\n\n📌 Tasa BCV: ${rate.toFixed(2)} BsD/USD`
    );
}

async function replyStock(query) {
    if (!query) {
        return '¿Cuál repuesto quieres verificar? Escríbeme, por ejemplo: _"hay filtro Fleetguard FF5421"_';
    }
    const productos = buscarProductos(query);
    if (!productos.length) {
        return `😕 No encontré *"${query}"* en nuestro catálogo.`;
    }

    const lines = productos.map((p) => {
        const disponible = p.stock > 0
            ? `✅ *Disponible* – ${p.stock} unidades`
            : `❌ *Sin stock* actualmente`;
        return `*${p.codigo}* – ${p.descripcion}\n   ${disponible}`;
    });

    return `📦 Disponibilidad para _"${query}"_:\n\n` + lines.join('\n\n');
}

async function replyOrder(query) {
    if (!query) {
        return '¿Qué repuesto deseas pedir? Escríbeme el nombre o código.';
    }
    const productos = buscarProductos(query);
    if (!productos.length) {
        return `😕 No encontré *"${query}"*. Verifica el nombre o código e inténtalo de nuevo.`;
    }

    const rate = await getRate();
    const p = productos[0];
    const pUsd = p.precio_usd != null ? `$${p.precio_usd.toFixed(2)}` : 'precio por confirmar';
    const pBs = p.precio_usd != null ? ` / Bs ${(p.precio_usd * rate).toFixed(2)}` : '';

    if (p.stock <= 0) {
        return (
            `⚠️ El repuesto *${p.codigo} – ${p.descripcion}* no tiene stock disponible ahora mismo.\n` +
            `¿Deseas que te avisemos cuando llegue? Escribe *sí* o comunícate con nosotros directamente.`
        );
    }

    return (
        `🛒 *Solicitud de pedido*\n\n` +
        `Producto: *${p.codigo} – ${p.descripcion}*\n` +
        `Precio: ${pUsd}${pBs}\n` +
        `Stock: ${p.stock} unidades\n\n` +
        `Para confirmar el pedido escríbenos:\n` +
        `1️⃣ Tu nombre completo\n` +
        `2️⃣ Cédula o RIF\n` +
        `3️⃣ Cantidad que necesitas\n` +
        `4️⃣ Método de pago (USD efectivo / Pago móvil / Zelle)\n\n` +
        `Un agente confirmará tu pedido a la brevedad. 🙏`
    );
}

function replyUnknown(text) {
    return (
        `🤔 No entendí bien tu mensaje: _"${text}"_\n\n` +
        `Puedo ayudarte con:\n` +
        `• *precio [repuesto]* – consultar precio\n` +
        `• *stock [repuesto]* – verificar disponibilidad\n` +
        `• *pedir [repuesto]* – hacer un pedido\n\n` +
        `O escribe *ayuda* para ver todas las opciones.`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Punto de entrada principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Procesa un mensaje entrante y envía la respuesta correspondiente.
 * @param {string} from    – número del remitente
 * @param {string} text    – texto recibido
 */
async function handleMessage(from, text) {
    let reply;
    try {
        const { intent, query } = detectIntent(text);
        logger.info(`whatsappBot: from=${from} intent=${intent} query="${query}"`);

        switch (intent) {
            case INTENT.GREETING:
                reply = replyGreeting();
                break;
            case INTENT.PRICE:
                reply = await replyPrice(query);
                break;
            case INTENT.STOCK:
                reply = await replyStock(query);
                break;
            case INTENT.ORDER:
                reply = await replyOrder(query);
                break;
            case INTENT.HELP:
                reply = replyHelp();
                break;
            default:
                reply = replyUnknown(text);
        }
    } catch (err) {
        logger.error('whatsappService: error procesando mensaje', { message: err.message, stack: err.stack });
        reply = '⚠️ Ocurrió un error procesando tu solicitud. Por favor intenta de nuevo en unos momentos.';
    }

    await sendMessage(from, reply);
}

module.exports = { handleMessage, sendMessage, detectIntent, buscarProductos };
