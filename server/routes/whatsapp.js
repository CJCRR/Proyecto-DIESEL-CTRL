/**
 * Rutas del webhook de Meta WhatsApp Cloud API.
 *
 * GET  /whatsapp/webhook  - verificacion del webhook
 * POST /whatsapp/webhook  - recepcion de mensajes entrantes
 */

const crypto = require('crypto');
const express = require('express');
const { handleMessage } = require('../services/whatsappService');
const logger = require('../services/logger');

const router = express.Router();
const recentWahaMessageIds = new Map();
const WAHA_DEDUP_TTL_MS = 2 * 60 * 1000;

function pruneRecentWahaMessages(now = Date.now()) {
    for (const [key, expiresAt] of recentWahaMessageIds.entries()) {
        if (expiresAt <= now) {
            recentWahaMessageIds.delete(key);
        }
    }
}

function getWahaDedupKey(body, message) {
    const session = String(body.session || 'default').trim() || 'default';
    const messageId = String(message.id || '').trim();
    if (messageId) {
        return `${session}:${messageId}`;
    }

    const from = String(message.from || '').trim();
    const text = String(message.body || '').trim();
    const timestamp = String(message.timestamp || '').trim();
    if (!from || !text) {
        return '';
    }

    return `${session}:${from}:${timestamp}:${text}`;
}

function shouldProcessWahaMessage(body, message) {
    pruneRecentWahaMessages();
    const key = getWahaDedupKey(body, message);
    if (!key) {
        return true;
    }

    if (recentWahaMessageIds.has(key)) {
        return false;
    }

    recentWahaMessageIds.set(key, Date.now() + WAHA_DEDUP_TTL_MS);
    return true;
}

function queueReply(from, text, origin) {
    handleMessage(from, text).catch((error) => {
        logger.error(`whatsapp/${origin}: error en handleMessage`, {
            from,
            message: error.message,
            stack: error.stack,
        });
    });
}

function hasValidWahaSignature(req) {
    const secret = process.env.WAHA_WEBHOOK_HMAC_KEY;
    if (!secret) {
        return true;
    }

    const signature = req.header('X-Webhook-Hmac');
    const algorithm = String(req.header('X-Webhook-Hmac-Algorithm') || '').toLowerCase();
    if (!signature || algorithm !== 'sha512' || !req.rawBody) {
        return false;
    }

    try {
        const expected = crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch (error) {
        logger.warn('whatsapp/waha: firma HMAC invalida', { message: error.message });
        return false;
    }
}

router.get('/webhook', (req, res) => {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (!verifyToken) {
        logger.error('whatsapp/webhook: WHATSAPP_VERIFY_TOKEN no configurado');
        return res.status(500).send('Server misconfiguration');
    }

    if (mode === 'subscribe' && token === verifyToken) {
        logger.info('whatsapp/webhook: verificacion exitosa');
        const safeChallenge = String(challenge || '').replace(/[^0-9]/g, '');
        return res.status(200).send(safeChallenge);
    }

    logger.warn('whatsapp/webhook: token de verificacion invalido', { received: token });
    return res.sendStatus(403);
});

router.post('/webhook', (req, res) => {
    res.sendStatus(200);

    try {
        const body = req.body;
        if (!body || body.object !== 'whatsapp_business_account') {
            return;
        }

        const entries = body.entry || [];
        for (const entry of entries) {
            const changes = entry.changes || [];
            for (const change of changes) {
                const value = change.value || {};
                const messages = value.messages || [];

                for (const message of messages) {
                    if (message.type !== 'text') {
                        continue;
                    }

                    const from = message.from;
                    const text = message.text && message.text.body ? message.text.body : '';
                    if (!text) {
                        continue;
                    }

                    queueReply(from, text, 'webhook');
                }
            }
        }
    } catch (error) {
        logger.error('whatsapp/webhook: error procesando payload', {
            message: error.message,
            stack: error.stack,
        });
    }
});

router.post('/waha', (req, res) => {
    if (!hasValidWahaSignature(req)) {
        logger.warn('whatsapp/waha: webhook rechazado por firma invalida');
        return res.sendStatus(401);
    }

    res.sendStatus(200);

    try {
        const body = req.body || {};
        if (body.event !== 'message' || !body.payload) {
            return;
        }

        const message = body.payload;
        if (message.fromMe) {
            return;
        }

        const from = String(message.from || '').trim();
        const text = String(message.body || '').trim();
        if (!from || !text) {
            return;
        }

        if (/@g\.us$|@newsletter$/i.test(from) || from === 'status@broadcast') {
            return;
        }

        if (!shouldProcessWahaMessage(body, message)) {
            logger.info('whatsapp/waha: evento duplicado ignorado', {
                messageId: message.id,
                from,
            });
            return;
        }

        queueReply(from, text, 'waha');
    } catch (error) {
        logger.error('whatsapp/waha: error procesando payload', {
            message: error.message,
            stack: error.stack,
        });
    }
});

router._clearRecentWahaMessageIdsForTests = () => {
    recentWahaMessageIds.clear();
};

module.exports = router;