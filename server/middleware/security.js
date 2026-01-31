// Middleware de seguridad: HTTPS enforcement y configuración avanzada de Helmet
const helmet = require('helmet');

function enforceHTTPS(req, res, next) {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  }
  next();
}

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", 'https:'],
      scriptSrc: ["'self'", 'unsafe-inline', 'https:', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com'],
      styleSrc: ["'self'", 'unsafe-inline'],
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
