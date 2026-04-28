/**
 * Obtiene y cachea la tasa oficial del BCV (USD -> BsD).
 */

const https = require('https');
const logger = require('./logger');

const FALLBACK_RATE = parseFloat(process.env.BCV_RATE_FALLBACK || '36');
const CACHE_TTL_MS = parseInt(
    process.env.BCV_CACHE_TTL_MS || String(24 * 60 * 60 * 1000),
    10
);

let cachedRate = null;
let cacheTimestamp = 0;

function fetchText(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { timeout: 10000 }, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => resolve(data));
        });

        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('BCV request timeout after 10000ms'));
        });
    });
}

async function fetchRateFromBCV() {
    try {
        const html = await fetchText('https://www.bcv.org.ve/');
        const primary = html.match(/id=["']dolar["'][^>]*>[\s]*([\d.,]+)[\s]*</i);
        if (!primary) {
            logger.warn('bcvService: patron primario no encontro el bloque dolar; intentando patron alternativo');
        }

        const match = primary || html.match(/USD[^<]*<[^>]+>\s*([\d.,]+)\s*<\//i);
        if (match) {
            const raw = match[1].replace(/\./g, '').replace(',', '.');
            const rate = parseFloat(raw);
            if (!Number.isNaN(rate) && rate > 0) {
                return rate;
            }

            logger.warn('bcvService: valor encontrado pero no es un numero valido', {
                raw: match[1],
            });
        } else {
            logger.warn('bcvService: ningun patron encontro la tasa en el HTML de bcv.org.ve');
        }
    } catch (error) {
        logger.warn('bcvService: no se pudo obtener tasa de bcv.org.ve', {
            message: error.message,
        });
    }

    return null;
}

async function getRate() {
    const now = Date.now();
    if (cachedRate !== null && now - cacheTimestamp < CACHE_TTL_MS) {
        return cachedRate;
    }

    const rate = await fetchRateFromBCV();
    if (rate !== null) {
        cachedRate = rate;
        cacheTimestamp = now;
        logger.info(`bcvService: tasa actualizada -> ${rate} BsD/USD`);
        return rate;
    }

    if (cachedRate !== null) {
        logger.warn(`bcvService: usando tasa anterior en cache (${cachedRate})`);
        return cachedRate;
    }

    logger.warn(`bcvService: usando tasa de respaldo (${FALLBACK_RATE})`);
    return FALLBACK_RATE;
}

function invalidateCache() {
    cacheTimestamp = 0;
}

module.exports = { getRate, invalidateCache };