/**
 * Nucleo del bot de WhatsApp para Diesel CTRL.
 */

const http = require('http');
const https = require('https');
const db = require('../db');
const { obtenerTasaBcv, obtenerConfigGeneral } = require('./ajustesService');
const logger = require('./logger');

const empresaIdRaw = process.env.WHATSAPP_EMPRESA_ID
    ? parseInt(process.env.WHATSAPP_EMPRESA_ID, 10)
    : null;
const empresaId = Number.isFinite(empresaIdRaw) && empresaIdRaw > 0 ? empresaIdRaw : null;
const whatsappPriceLevelKey = String(process.env.WHATSAPP_NIVEL_PRECIO || process.env.WHATSAPP_PRICE_LEVEL || '').trim();
const RECENT_QUERY_TTL_MS = 15 * 60 * 1000;
const SEARCH_STOPWORDS = new Set([
    'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'o', 'para', 'por', 'en', 'con', 'al',
    'cancelar', 'cancelando', 'pagar', 'pagando', 'pago', 'divisa', 'divisas', 'usd', 'usdt', 'dolar',
    'dolares', 'bs', 'bolivar', 'bolivares', 'efectivo', 'zelle',
]);
const BASE_USD_KEYWORDS_RE = /(?:\b(?:divisa|divisas|usd|usdt|zelle|dolar|dolares)\b|\$)/;
const CONTEXTUAL_PRICE_FOLLOW_UP_RE = /\b(?:cuanto seria|cuanto quedaria|y cuanto seria|y en divisas|y en usd|y en bs|y en bolivares|en divisas|en usd|en bs|en bolivares|al cambio|a tasa)\b/;
const NON_PRODUCT_MESSAGES_RE = /^(?:ok|oki|okey|dale|gracias|perfecto|listo|si|sii|yes|no)\b/;
const recentQueriesByCustomer = new Map();

function formatAmount(value, options = {}) {
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: options.minimumFractionDigits ?? 2,
        maximumFractionDigits: options.maximumFractionDigits ?? 2,
    }).format(Number(value || 0) || 0);
}

function formatUsd(value) {
    return `$${formatAmount(value)}`;
}

function formatBs(value) {
    return `Bs ${formatAmount(value)}`;
}

function formatPercent(value) {
    return formatAmount(value, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function redondearA0o5(valor) {
    const n = Number(valor) || 0;
    const signo = n < 0 ? -1 : 1;
    let abs = Math.round(Math.abs(n));
    const unidad = abs % 10;
    const baseDecena = abs - unidad;
    let resultado;

    if (unidad <= 1) {
        resultado = baseDecena;
    } else if (unidad <= 6) {
        resultado = baseDecena + 5;
    } else {
        resultado = baseDecena + 10;
    }

    return resultado * signo;
}

function getPriceLevelsConfig() {
    const config = obtenerConfigGeneral(empresaId);
    const empresa = config && config.empresa ? config.empresa : {};
    const levels = [
        { key: '1', nombre: empresa.precio1_nombre, pct: empresa.precio1_pct },
        { key: '2', nombre: empresa.precio2_nombre, pct: empresa.precio2_pct },
        { key: '3', nombre: empresa.precio3_nombre, pct: empresa.precio3_pct },
    ]
        .map((level) => ({
            key: level.key,
            nombre: (level.nombre || '').toString().trim().slice(0, 60),
            pct: Number(level.pct || 0) || 0,
        }))
        .filter((level) => level.pct > 0);

    return {
        levels,
        roundTo0or5: !!empresa.precio_redondeo_0_5,
        roundThreshold: Number(empresa.precio_redondeo_umbral || 0) || 0,
    };
}

function resolveActivePriceLevel(levels) {
    if (!Array.isArray(levels) || !levels.length) {
        return null;
    }

    if (whatsappPriceLevelKey) {
        const selected = levels.find((level) => level.key === whatsappPriceLevelKey);
        if (selected) {
            return selected;
        }
    }

    return levels[0] || null;
}

function shouldQuoteBaseUsd(text) {
    return BASE_USD_KEYWORDS_RE.test(normalize(text || ''));
}

function buildQuoteContext(text) {
    const tasaInfo = obtenerTasaBcv(empresaId);
    const rate = Number(tasaInfo && tasaInfo.tasa_bcv) || 1;
    const priceConfig = getPriceLevelsConfig();

    return {
        wantsBaseUsd: shouldQuoteBaseUsd(text),
        rate,
        rateUpdatedAt: tasaInfo && tasaInfo.actualizado_en ? tasaInfo.actualizado_en : null,
        activeLevel: resolveActivePriceLevel(priceConfig.levels),
        roundTo0or5: priceConfig.roundTo0or5,
        roundThreshold: priceConfig.roundThreshold,
    };
}

function cleanupRecentQueries(now = Date.now()) {
    for (const [key, value] of recentQueriesByCustomer.entries()) {
        if (!value || (now - value.updatedAt) > RECENT_QUERY_TTL_MS) {
            recentQueriesByCustomer.delete(key);
        }
    }
}

function rememberRecentQuery(from, query) {
    const normalizedQuery = String(query || '').trim();
    const customerKey = String(from || '').trim();
    if (!customerKey || !normalizedQuery) {
        return;
    }

    cleanupRecentQueries();
    recentQueriesByCustomer.set(customerKey, {
        query: normalizedQuery,
        updatedAt: Date.now(),
    });
}

function getRecentQuery(from) {
    const customerKey = String(from || '').trim();
    if (!customerKey) {
        return '';
    }

    cleanupRecentQueries();
    const recent = recentQueriesByCustomer.get(customerKey);
    return recent ? recent.query : '';
}

function quoteProduct(producto, quoteContext) {
    const baseUsd = Number(producto && producto.precio_usd) || 0;

    if (!baseUsd) {
        return {
            wantsBaseUsd: quoteContext.wantsBaseUsd,
            activeLevel: quoteContext.activeLevel,
            rate: quoteContext.rate,
            baseUsd: 0,
            quotedUsd: 0,
            quotedBs: 0,
        };
    }

    let quotedUsd = baseUsd;

    if (!quoteContext.wantsBaseUsd && quoteContext.activeLevel) {
        quotedUsd = baseUsd * (1 + (quoteContext.activeLevel.pct / 100));

        if (quoteContext.roundTo0or5 && (!quoteContext.roundThreshold || baseUsd >= quoteContext.roundThreshold)) {
            quotedUsd = redondearA0o5(quotedUsd);
        }
    }

    return {
        wantsBaseUsd: quoteContext.wantsBaseUsd,
        activeLevel: quoteContext.activeLevel,
        rate: quoteContext.rate,
        baseUsd,
        quotedUsd,
        quotedBs: quotedUsd * quoteContext.rate,
    };
}

function formatAvailability(stock) {
    const amount = Number(stock || 0) || 0;
    return amount > 0 ? `${amount} disponibles` : 'sin stock';
}

function buildPriceLine(producto, quote) {
    const availability = formatAvailability(producto.stock);
    const title = `*${producto.codigo}* - ${producto.descripcion}`;

    if (!quote.baseUsd) {
        return `${title}\nPrecio por confirmar • ${availability}`;
    }

    if (quote.wantsBaseUsd) {
        return `${title}\nPrecio base: ${formatUsd(quote.baseUsd)} • ${availability}`;
    }

    return `${title}\nPrecio: ${formatUsd(quote.quotedUsd)} • ${availability}`;
}

function requestJson(urlString, options) {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const request = transport.request(url, options, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode || 0,
                    body: data,
                });
            });
        });

        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error(`Request timeout after ${options.timeout || 0}ms`));
        });

        if (options.body) {
            request.write(options.body);
        }

        request.end();
    });
}

function getProvider() {
    return String(process.env.WHATSAPP_PROVIDER || 'meta').trim().toLowerCase();
}

function getBotName() {
    return process.env.WHATSAPP_BOT_NAME || 'ALPHA DIESEL';
}

function getMetaConfig() {
    return {
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v19.0',
        token: process.env.WHATSAPP_TOKEN,
        phoneId: process.env.WHATSAPP_PHONE_ID,
    };
}

function getWahaConfig() {
    return {
        apiKey: process.env.WAHA_API_KEY || '',
        baseUrl: process.env.WAHA_BASE_URL || 'http://127.0.0.1:3001',
        session: process.env.WAHA_SESSION || 'default',
    };
}

function normalizeWahaChatId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    if (/@s\.whatsapp\.net$/i.test(raw)) {
        return `${raw.slice(0, raw.indexOf('@'))}@c.us`;
    }

    if (/@(c\.us|g\.us|lid|newsletter)$/i.test(raw) || raw === 'status@broadcast') {
        return raw;
    }

    const digits = raw.replace(/\D/g, '');
    return digits ? `${digits}@c.us` : raw;
}

async function sendMessageViaMeta(to, text) {
    const { apiVersion, token, phoneId } = getMetaConfig();

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

    const response = await requestJson(`https://graph.facebook.com/${apiVersion}/${phoneId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
        body,
    });

    if (response.statusCode >= 400) {
        logger.error('whatsappService: error al enviar mensaje con Meta', {
            status: response.statusCode,
            body: response.body,
        });
    }
}

async function sendMessageViaWaha(to, text) {
    const { apiKey, baseUrl, session } = getWahaConfig();
    const chatId = normalizeWahaChatId(to);

    if (!chatId) {
        logger.error('whatsappService: no se pudo resolver el chatId para WAHA');
        return;
    }

    const body = JSON.stringify({
        session,
        chatId,
        text,
    });

    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    };

    if (apiKey) {
        headers['X-Api-Key'] = apiKey;
    }

    const response = await requestJson(new URL('/api/sendText', baseUrl).toString(), {
        method: 'POST',
        headers,
        timeout: 15000,
        body,
    });

    if (response.statusCode >= 400) {
        logger.error('whatsappService: error al enviar mensaje con WAHA', {
            status: response.statusCode,
            body: response.body,
        });
        throw new Error(`WAHA sendText failed with status ${response.statusCode}`);
    }
}

async function sendMessage(to, text) {
    if (getProvider() === 'waha') {
        return sendMessageViaWaha(to, text);
    }

    return sendMessageViaMeta(to, text);
}

function buildSearchTokens(text) {
    return Array.from(new Set(
        normalize(text)
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token && (token.length >= 2 || /\d/.test(token)) && !SEARCH_STOPWORDS.has(token))
    ));
}

function buildNormalizedSqlExpr(field) {
    return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(lower(COALESCE(${field}, '')),'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),'ñ','n'),'ü','u')`;
}

function buscarProductos(termino) {
    try {
        const tokens = buildSearchTokens(termino);
        if (!tokens.length) {
            return [];
        }

        const codigoExpr = buildNormalizedSqlExpr('p.codigo');
        const descripcionExpr = buildNormalizedSqlExpr('p.descripcion');
        const tokenConditions = tokens
            .map(() => `(${codigoExpr} LIKE ? OR ${descripcionExpr} LIKE ?)`)
            .join(' AND ');
        const sql = `
            SELECT p.codigo, p.descripcion, p.precio_usd,
                   COALESCE((
                       SELECT SUM(sd.cantidad)
                       FROM stock_por_deposito sd
                       WHERE sd.producto_id = p.id
                   ), p.stock) AS stock
            FROM productos p
            WHERE p.activo = 1
              AND ${tokenConditions}
              ${empresaId ? 'AND p.empresa_id = ?' : ''}
            ORDER BY CASE WHEN COALESCE((
                       SELECT SUM(sd.cantidad)
                       FROM stock_por_deposito sd
                       WHERE sd.producto_id = p.id
                   ), p.stock) > 0 THEN 0 ELSE 1 END,
                     lower(p.descripcion) ASC,
                     p.codigo ASC
            LIMIT 5
        `;
        const params = [];
        for (const token of tokens) {
            const like = `%${token}%`;
            params.push(like, like);
        }
        if (empresaId) {
            params.push(empresaId);
        }
        return db.prepare(sql).all(...params);
    } catch (error) {
        logger.error('whatsappService: error buscando productos', { message: error.message });
        return [];
    }
}

const INTENT = {
    GREETING: 'greeting',
    PRICE: 'price',
    STOCK: 'stock',
    ORDER: 'order',
    HELP: 'help',
    UNKNOWN: 'unknown',
};

function normalize(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿?¡!]/g, '')
        .trim();
}

function extractQuery(normalized, keywordsRe) {
    return normalized
        .replace(new RegExp(`^.*?(${keywordsRe})\\s*(de|del|la|el|los|las|un|una)?\\s*`, 'i'), '')
        .trim();
}

function detectIntent(text) {
    const normalized = normalize(text);

    if (/^(hola|buenas|buenos|buen dia|buen tarde|buen noche|saludos|hey|hi|hola|ola)/.test(normalized)) {
        return { intent: INTENT.GREETING, query: '' };
    }
    if (/(precio|cuanto cuesta|cuanto vale|valor|cuanto es|cuanto sale|a cuanto|cuanto seria|cuanto quedaria|ando buscando|busco|necesito|tiene|tiene disponible)/.test(normalized)) {
        return {
            intent: INTENT.PRICE,
            query: extractQuery(normalized, 'precio|cuanto cuesta|cuanto vale|valor|cuanto es|cuanto sale|a cuanto|cuanto seria|cuanto quedaria|ando buscando|busco|necesito|tiene|tiene disponible'),
        };
    }
    if (/(stock|hay|disponible|tienen|existe|tienes|cuantos hay|cuantas hay|disponibilidad)/.test(normalized)) {
        return {
            intent: INTENT.STOCK,
            query: extractQuery(normalized, 'stock|hay|disponible|tienen|existe|tienes|cuantos hay|cuantas hay|disponibilidad'),
        };
    }
    if (/(pedir|quiero|comprar|ordenar|pedido|necesito|dame|me puedes dar|apartar)/.test(normalized)) {
        return {
            intent: INTENT.ORDER,
            query: extractQuery(normalized, 'pedir|quiero|comprar|ordenar|pedido|necesito|dame|me puedes dar|apartar'),
        };
    }
    if (/(ayuda|menu|opciones|que puedes hacer|como funciona|info|informacion)/.test(normalized)) {
        return { intent: INTENT.HELP, query: '' };
    }

    return { intent: INTENT.UNKNOWN, query: normalized };
}

function replyGreeting() {
    const botName = getBotName();
    return (
        `Hola, soy el asistente de *${botName}*.\n` +
        'Puedes escribirme el nombre o código del repuesto directamente.\n\n' +
        'Ejemplos:\n' +
        '• _anillos 4hf1_\n' +
        '• _stock bomba 4hg1_\n' +
        '• _quiero pedir filtro ff5421_\n\n' +
        'Si luego quieres el precio base en divisas, solo dímelo.'
    );
}

function replyHelp() {
    const botName = getBotName();
    return (
        `*${botName}* te puede ayudar con esto:\n` +
        '• _anillos 4hf1_\n' +
        '• _precio filtro FF5421_\n' +
        '• _stock bomba de agua_\n' +
        '• _quiero pedir correa 8PK_\n\n' 
       /* 'Si quieres precio base en divisas, dímelo después del repuesto.'*/
    );
}

async function replyPrice(query, originalText) {
    if (!query) {
        return 'Escríbeme el nombre o código del repuesto y te paso el precio.';
    }

    const productos = buscarProductos(query);
    if (!productos.length) {
        return `No vi *${query}* en el catálogo. Pásame el código o una descripción más corta.`;
    }

    const quoteContext = buildQuoteContext(originalText);
    const lines = productos.map((producto) => buildPriceLine(producto, quoteProduct(producto, quoteContext)));
    const footer = `\n\nTasa BCV: ${formatBs(quoteContext.rate)}`;

    return `Resultados para *${query}*:\n\n${lines.join('\n\n')}${footer}`;
}

async function replyStock(query) {
    if (!query) {
        return 'Dime el repuesto y te digo si hay. Ejemplo: _stock filtro FF5421_.';
    }

    const productos = buscarProductos(query);
    if (!productos.length) {
        return `No encontré *${query}* en el catálogo.`;
    }

    const lines = productos.map((producto) => {
        return `*${producto.codigo}* - ${producto.descripcion}\n${formatAvailability(producto.stock)}`;
    });

    return `Para *${query}* tengo esto:\n\n${lines.join('\n\n')}`;
}

async function replyOrder(query, originalText) {
    if (!query) {
        return 'Pásame el nombre o código del repuesto para ayudarte con el pedido.';
    }

    const productos = buscarProductos(query);
    if (!productos.length) {
        return `No conseguí *${query}*. Envíame el código o una descripción más precisa.`;
    }

    const producto = productos[0];
    const quoteContext = buildQuoteContext(originalText);
    const quote = quoteProduct(producto, quoteContext);
    const priceText = !quote.baseUsd
        ? 'Precio por confirmar'
        : quote.wantsBaseUsd
            ? `Precio base: ${formatUsd(quote.baseUsd)}`
            : `Precio: ${formatUsd(quote.quotedUsd)}`;

    if (producto.stock <= 0) {
        return (
            `Ahora mismo *${producto.codigo} - ${producto.descripcion}* está sin stock.\n` +
            'Si quieres, te aviso apenas entre.'
        );
    }

    return (
        `Sí, disponible.\n\n` +
        `*${producto.codigo}* - ${producto.descripcion}\n` +
        `${priceText}\n` +
        `Stock: ${formatAvailability(producto.stock)}\n` +
        `Tasa BCV: ${formatBs(quote.rate)}\n\n` +
        'Si quieres apartarlo, envíame tu nombre y la cantidad.'
    );
}

function replyUnknown(text) {
    return (
        `No te entendí bien con *${text}*.\n` +
        'Prueba con el nombre o código del repuesto, por ejemplo: _anillos 4hf1_, _8-97028691-0_ o _bomba 4hg1_.'
    );
}

function isContextualPriceFollowUp(text) {
    return CONTEXTUAL_PRICE_FOLLOW_UP_RE.test(normalize(text || ''));
}

function shouldTreatUnknownAsDirectPriceQuery(text) {
    const normalized = normalize(text || '');
    if (!normalized || NON_PRODUCT_MESSAGES_RE.test(normalized) || isContextualPriceFollowUp(normalized)) {
        return false;
    }

    return buscarProductos(text).length > 0;
}

function resolveQueryFromContext(from, intent, query, text) {
    const normalizedQuery = String(query || '').trim();
    const recentQuery = getRecentQuery(from);

    if (normalizedQuery && !isContextualPriceFollowUp(text)) {
        return normalizedQuery;
    }

    if (!recentQuery) {
        return normalizedQuery;
    }

    if (intent === INTENT.PRICE || intent === INTENT.STOCK || intent === INTENT.ORDER || intent === INTENT.UNKNOWN) {
        if (!normalizedQuery || isContextualPriceFollowUp(text)) {
            return recentQuery;
        }
    }

    return normalizedQuery;
}

async function buildReply(from, text) {
    const { intent, query } = detectIntent(text);
    const effectiveQuery = resolveQueryFromContext(from, intent, query, text);

    logger.info(`whatsappBot: from=${from} intent=${intent} query="${effectiveQuery || query}"`);

    switch (intent) {
        case INTENT.GREETING:
            return replyGreeting();
        case INTENT.PRICE:
            if (effectiveQuery) {
                rememberRecentQuery(from, effectiveQuery);
            }
            return replyPrice(effectiveQuery, text);
        case INTENT.STOCK:
            if (effectiveQuery) {
                rememberRecentQuery(from, effectiveQuery);
            }
            return replyStock(effectiveQuery);
        case INTENT.ORDER:
            if (effectiveQuery) {
                rememberRecentQuery(from, effectiveQuery);
            }
            return replyOrder(effectiveQuery, text);
        case INTENT.HELP:
            return replyHelp();
        default:
            if (effectiveQuery && isContextualPriceFollowUp(text)) {
                rememberRecentQuery(from, effectiveQuery);
                return replyPrice(effectiveQuery, text);
            }

            if (shouldTreatUnknownAsDirectPriceQuery(text)) {
                const directQuery = String(text || '').trim();
                rememberRecentQuery(from, directQuery);
                return replyPrice(directQuery, text);
            }

            return replyUnknown(text);
    }
}

async function handleMessage(from, text) {
    try {
        const reply = await buildReply(from, text);
        await sendMessage(from, reply);
    } catch (error) {
        logger.error('whatsappService: error procesando mensaje', {
            message: error.message,
            stack: error.stack,
        });
        await sendMessage(from, '⚠️ Ocurrió un error procesando tu solicitud. Por favor intenta de nuevo en unos momentos.');
    }
}

module.exports = {
    handleMessage,
    sendMessage,
    detectIntent,
    buscarProductos,
    __testables: {
        buildSearchTokens,
        buildReply,
        shouldQuoteBaseUsd,
        isContextualPriceFollowUp,
        redondearA0o5,
        buildQuoteContext,
        quoteProduct,
        replyPrice,
        replyOrder,
        resolveQueryFromContext,
        shouldTreatUnknownAsDirectPriceQuery,
    },
};