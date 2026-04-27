/**
 * whatsapp.js – Rutas del webhook de Meta WhatsApp Cloud API
 *
 * GET  /whatsapp/webhook  – verificación del webhook (Meta challenge)
 * POST /whatsapp/webhook  – recepción de mensajes entrantes
 *
 * Variables de entorno requeridas:
 *   WHATSAPP_VERIFY_TOKEN  – token de verificación que configuras en Meta
 *   WHATSAPP_TOKEN         – Bearer token de la API
 *   WHATSAPP_PHONE_ID      – Phone Number ID de Meta Cloud API
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('../services/whatsappService');
const logger = require('../services/logger');

// ─────────────────────────────────────────────────────────────────────────────
// GET /whatsapp/webhook  –  Meta verifica la URL del webhook al configurarlo
// ─────────────────────────────────────────────────────────────────────────────
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
        logger.info('whatsapp/webhook: verificación exitosa');
        // Devolver solo el valor numérico del challenge para evitar XSS reflejado
        const safeChallenge = String(challenge || '').replace(/[^0-9]/g, '');
        return res.status(200).send(safeChallenge);
    }

    logger.warn('whatsapp/webhook: token de verificación inválido', { received: token });
    return res.sendStatus(403);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /whatsapp/webhook  –  Mensajes entrantes
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', (req, res) => {
    // Responder 200 inmediatamente para que Meta no reintente la entrega
    res.sendStatus(200);

    try {
        const body = req.body;
        if (!body || body.object !== 'whatsapp_business_account') return;

        const entries = body.entry || [];
        for (const entry of entries) {
            const changes = entry.changes || [];
            for (const change of changes) {
                const value = change.value || {};
                const messages = value.messages || [];
                for (const msg of messages) {
                    if (msg.type !== 'text') continue; // solo mensajes de texto por ahora
                    const from = msg.from;
                    const text = (msg.text && msg.text.body) ? msg.text.body : '';
                    if (!text) continue;

                    // Procesar en background para no bloquear la respuesta
                    handleMessage(from, text).catch((err) => {
                        logger.error('whatsapp/webhook: error en handleMessage', {
                            from,
                            message: err.message,
                            stack: err.stack,
                        });
                    });
                }
            }
        }
    } catch (err) {
        logger.error('whatsapp/webhook: error procesando payload', { message: err.message, stack: err.stack });
    }
});

module.exports = router;
