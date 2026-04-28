const path = require('path');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

jest.mock('../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../services/whatsappService', () => ({
  handleMessage: jest.fn().mockResolvedValue(undefined),
}));

const whatsappRoutes = require(path.join('..', 'routes', 'whatsapp'));
const { handleMessage } = require(path.join('..', 'services', 'whatsappService'));

function buildApp() {
  const app = express();
  app.use(express.json({
    verify: (req, res, buf) => {
      if (buf && buf.length) {
        req.rawBody = buf.toString('utf8');
      }
    },
  }));
  app.use('/whatsapp', whatsappRoutes);
  return app;
}

describe('Rutas HTTP /whatsapp', () => {
  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'token-prueba';
    if (typeof whatsappRoutes._clearRecentWahaMessageIdsForTests === 'function') {
      whatsappRoutes._clearRecentWahaMessageIdsForTests();
    }
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WAHA_WEBHOOK_HMAC_KEY;
  });

  test('GET /whatsapp/webhook devuelve challenge sanitizado', async () => {
    const res = await request(buildApp())
      .get('/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token-prueba',
        'hub.challenge': '123<script>alert(1)</script>456',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('1231456');
  });

  test('GET /whatsapp/webhook con token invalido responde 403', async () => {
    const res = await request(buildApp())
      .get('/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'otro-token',
        'hub.challenge': '123456',
      });

    expect(res.status).toBe(403);
  });

  test('POST /whatsapp/webhook responde 200 y procesa solo mensajes de texto', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    type: 'text',
                    from: '584121234567',
                    text: { body: 'precio filtro de aceite' },
                  },
                  {
                    type: 'image',
                    from: '584121234567',
                    image: { id: 'media-1' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await request(buildApp())
      .post('/whatsapp/webhook')
      .send(payload);

    expect(res.status).toBe(200);
    expect(handleMessage).toHaveBeenCalledTimes(1);
    expect(handleMessage).toHaveBeenCalledWith('584121234567', 'precio filtro de aceite');
  });

  test('POST /whatsapp/waha procesa mensajes entrantes de WAHA', async () => {
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: 'false_584121234567@c.us_AAA_waha_1',
        from: '584121234567@c.us',
        fromMe: false,
        body: 'hay filtro fleetguard',
      },
    };

    const res = await request(buildApp())
      .post('/whatsapp/waha')
      .send(payload);

    expect(res.status).toBe(200);
    expect(handleMessage).toHaveBeenCalledTimes(1);
    expect(handleMessage).toHaveBeenCalledWith('584121234567@c.us', 'hay filtro fleetguard');
  });

  test('POST /whatsapp/waha valida HMAC cuando se configura clave', async () => {
    process.env.WAHA_WEBHOOK_HMAC_KEY = 'clave-secreta';
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: 'false_584121234567@c.us_AAA_waha_2',
        from: '584121234567@c.us',
        fromMe: false,
        body: 'hola',
      },
    };
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha512', 'clave-secreta').update(raw).digest('hex');

    const res = await request(buildApp())
      .post('/whatsapp/waha')
      .set('X-Webhook-Hmac', signature)
      .set('X-Webhook-Hmac-Algorithm', 'sha512')
      .send(payload);

    expect(res.status).toBe(200);
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });

  test('POST /whatsapp/waha ignora eventos duplicados del mismo mensaje', async () => {
    const payload = {
      event: 'message',
      session: 'default',
      payload: {
        id: 'false_584121234567@c.us_DUPLICADO',
        from: '584121234567@c.us',
        fromMe: false,
        body: 'precio empacadura camara 4hg1',
      },
    };

    const app = buildApp();
    const first = await request(app)
      .post('/whatsapp/waha')
      .send(payload);
    const second = await request(app)
      .post('/whatsapp/waha')
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });
});