// Middleware de seguridad: HTTPS enforcement y configuración avanzada de Helmet
const helmet = require('helmet');

function isHttpsEnforced() {
  const raw = String(process.env.ENFORCE_HTTPS || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function enforceHTTPS(req, res, next) {
  if (!isHttpsEnforced()) {
    return next();
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const isSecure = req.secure || forwardedProto === 'https';

  if (!isSecure) {
    return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  }

  next();
}

const httpsEnforced = isHttpsEnforced();

const cspDirectives = {
  defaultSrc: ["'self'", 'https:'],
  scriptSrc: ["'self'", "'unsafe-inline'", 'https:', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
  fontSrc: ["'self'", 'https:', 'data:', 'fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'", 'https:'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"]
};

if (httpsEnforced) {
  cspDirectives.upgradeInsecureRequests = [];
}

const helmetConfig = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: cspDirectives,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  hsts: httpsEnforced ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  xssFilter: true,
  noSniff: true,
  ieNoOpen: true,
  dnsPrefetchControl: { allow: false },
});

module.exports = {
  isHttpsEnforced,
  enforceHTTPS,
  helmetConfig
};
