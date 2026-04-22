// Middleware para JWT opcional y utilidades
const jwt = require('jsonwebtoken');

const isProd = process.env.NODE_ENV === 'production';
const SECRET = process.env.JWT_SECRET || (!isProd ? 'jwt_dev_secret' : null);

if (!SECRET) {
  // Fallar rápido en producción si no hay secreto JWT configurado
  // para evitar emitir/verificar tokens inseguros.
  console.error('FATAL: JWT_SECRET no configurado en entorno de producción');
  throw new Error('JWT_SECRET no configurado');
}

function signJwt(payload, options = {}) {
  return jwt.sign(payload, SECRET, { expiresIn: '8h', ...options });
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

// Middleware: si hay JWT válido, lo adjunta a req.user
function jwtOptional(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.jwt_token;
  if (token) {
    const user = verifyJwt(token);
    if (user) req.user = user;
  }
  next();
}

// Middleware: requiere JWT válido
function jwtRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.jwt_token;
  if (!token) return res.status(401).json({ error: 'Token JWT requerido' });
  const user = verifyJwt(token);
  if (!user) return res.status(401).json({ error: 'Token JWT inválido o expirado' });
  req.user = user;
  next();
}

module.exports = { signJwt, verifyJwt, jwtOptional, jwtRequired };
