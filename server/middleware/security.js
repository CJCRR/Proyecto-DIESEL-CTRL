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

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https:', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'https:', 'fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  xssFilter: true,
  noSniff: true,
  ieNoOpen: true,
  dnsPrefetchControl: { allow: false },
});

module.exports = {
  enforceHTTPS,
  helmetConfig
};
