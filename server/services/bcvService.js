/**
 * bcvService.js
 * Obtiene y almacena en caché la tasa oficial del BCV (USD → BsD).
 *
 * La tasa se refresca una vez por día o cuando el caché expira.
 * Variables de entorno:
 *   BCV_RATE_FALLBACK  – tasa manual de respaldo (default: 36)
 *   BCV_CACHE_TTL_MS   – tiempo de vida del caché en ms (default: 24 horas)
 */

const https = require('https');
const logger = require('./logger');

const FALLBACK_RATE = parseFloat(process.env.BCV_RATE_FALLBACK || '36');
const CACHE_TTL_MS = parseInt(process.env.BCV_CACHE_TTL_MS || String(24 * 60 * 60 * 1000));

let cachedRate = null;
let cacheTimestamp = 0;

/**
 * Hace una petición HTTPS y devuelve el cuerpo como string.
 * @param {string} url
 * @returns {Promise<string>}
 */
function fetchText(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('BCV request timeout')); });
    });
}

/**
 * Intenta extraer la tasa USD del HTML de bcv.org.ve.
 * El sitio publica la tasa en un bloque como:
 *   <strong id="dolar">  36,56 </strong>
 * @returns {Promise<number|null>}
 */
async function fetchRateFromBCV() {
    try {
        const html = await fetchText('https://www.bcv.org.ve/');
        // Buscar el bloque del dólar
        const match = html.match(/id=["']dolar["'][^>]*>[\s]*([\d.,]+)[\s]*</i)
            || html.match(/USD[^<]*<[^>]+>\s*([\d.,]+)\s*<\//i);
        if (match) {
            // BCV usa coma como separador decimal en Venezuela
            const raw = match[1].replace(/\./g, '').replace(',', '.');
            const rate = parseFloat(raw);
            if (!isNaN(rate) && rate > 0) return rate;
        }
    } catch (err) {
        logger.warn('bcvService: no se pudo obtener tasa de bcv.org.ve', { message: err.message });
    }
    return null;
}

/**
 * Devuelve la tasa de cambio USD → BsD vigente.
 * Usa caché interno con TTL configurable. Si no puede obtenerla, retorna el valor de respaldo.
 * @returns {Promise<number>}
 */
async function getRate() {
    const now = Date.now();
    if (cachedRate !== null && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return cachedRate;
    }

    const rate = await fetchRateFromBCV();
    if (rate !== null) {
        cachedRate = rate;
        cacheTimestamp = now;
        logger.info(`bcvService: tasa actualizada → ${rate} BsD/USD`);
        return rate;
    }

    // Si ya teníamos un valor anterior (aunque expirado), seguir usándolo
    if (cachedRate !== null) {
        logger.warn(`bcvService: usando tasa anterior en caché (${cachedRate})`);
        return cachedRate;
    }

    logger.warn(`bcvService: usando tasa de respaldo (${FALLBACK_RATE})`);
    return FALLBACK_RATE;
}

/**
 * Fuerza la invalidación del caché para que la próxima llamada refresque la tasa.
 */
function invalidateCache() {
    cacheTimestamp = 0;
}

module.exports = { getRate, invalidateCache };
