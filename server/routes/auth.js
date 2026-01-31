const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { signJwt } = require('../middleware/jwt');

// Generar token único
function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intente más tarde.' }
});

function limpiarSesionesExpiradas() {
  try {
    db.prepare("DELETE FROM sesiones WHERE expira_en IS NOT NULL AND datetime(expira_en) <= datetime('now')").run();
  } catch (err) {
    const logger = require('../services/logger');
    logger.warn('No se pudo limpiar sesiones expiradas:', err.message);
  }
}

// POST /auth/login - Iniciar sesión
router.post('/login', loginLimiter, (req, res) => {
  limpiarSesionesExpiradas();
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const usuario = db.prepare(`
      SELECT id, username, nombre_completo, rol, activo, password, failed_attempts, locked_until, must_change_password
      FROM usuarios
      WHERE username = ? AND activo = 1
    `).get(username);

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (usuario.locked_until && new Date(usuario.locked_until) > new Date()) {
      return res.status(429).json({ error: 'Cuenta bloqueada temporalmente. Intente más tarde.' });
    }

    const isBcrypt = typeof usuario.password === 'string' && /^\$2[aby]\$/.test(usuario.password);
    let ok = false;
    if (isBcrypt) {
      ok = bcrypt.compareSync(password, usuario.password);
    } else {
      ok = password === usuario.password;
      if (ok) {
        const newHash = bcrypt.hashSync(password, 10);
        db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(newHash, usuario.id);
      }
    }

    if (!ok) {
      const newFailed = (usuario.failed_attempts || 0) + 1;
      // Bloqueo progresivo: 5 intentos = 15min, 10 intentos = 1h, 15 intentos = 24h
      let lockUntil = null;
      if (newFailed >= 15) {
        lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      } else if (newFailed >= 10) {
        lockUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      } else if (newFailed >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      db.prepare('UPDATE usuarios SET failed_attempts = ?, locked_until = ? WHERE id = ?')
        .run(newFailed, lockUntil, usuario.id);
      // Log de intento fallido y bloqueo
      try {
        const logger = require('../services/logger');
        logger.warn(`Intento fallido de login para usuario ${usuario.username} (${usuario.id}), intentos: ${newFailed}${lockUntil ? ', bloqueado hasta: ' + lockUntil : ''}`);
      } catch (e) {}
      if (lockUntil) {
        return res.status(429).json({ error: `Cuenta bloqueada temporalmente. Intente después de: ${new Date(lockUntil).toLocaleString()}` });
      }
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Reset de intentos fallidos al iniciar sesión exitoso
    db.prepare('UPDATE usuarios SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(usuario.id);

    // Crear sesión
    const token = generarToken();
    const expiraEn = new Date();
    expiraEn.setHours(expiraEn.getHours() + 8); // Sesión válida por 8 horas

    db.prepare(`
      INSERT INTO sesiones (usuario_id, token, expira_en)
      VALUES (?, ?, ?)
    `).run(usuario.id, token, expiraEn.toISOString());

    // Actualizar último login
    db.prepare(`
      UPDATE usuarios SET ultimo_login = datetime('now') WHERE id = ?
    `).run(usuario.id);

    // JWT: datos mínimos necesarios
    const jwtPayload = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre_completo,
      rol: usuario.rol,
      must_change_password: !!usuario.must_change_password
    };
    const jwtToken = signJwt(jwtPayload);

    // Setear ambas cookies: auth_token (clásico) y jwt_token (JWT)
    res.cookie('auth_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    });
    res.cookie('jwt_token', jwtToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      token, // clásico
      jwt: jwtToken, // JWT
      usuario: jwtPayload
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en login:', { message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// POST /auth/logout - Cerrar sesión
router.post('/logout', (req, res) => {
  const token = req.body?.token || req.headers.authorization?.replace('Bearer ', '') || req.cookies?.auth_token;
  
  if (token) {
    try {
      db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
    } catch (err) {
      const logger = require('../services/logger');
      logger.error('Error al cerrar sesión:', { message: err.message, stack: err.stack, url: req.originalUrl });
    }
  }
  
  res.clearCookie('auth_token');
  res.json({ success: true });
});

// GET /auth/verificar - Verificar si el token clásico o JWT es válido
router.get('/verificar', (req, res) => {
  limpiarSesionesExpiradas();
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.auth_token;
  const jwtToken = req.headers['x-jwt'] || req.cookies?.jwt_token;

  // Primero intenta JWT
  if (jwtToken) {
    const user = verifyJwt(jwtToken);
    if (user) {
      return res.json({ valido: true, usuario: user, via: 'jwt' });
    }
  }

  // Si no hay JWT válido, intenta token clásico
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  try {
    const sesion = db.prepare(`
      SELECT s.*, u.username, u.nombre_completo, u.rol, u.must_change_password
      FROM sesiones s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ? AND datetime(s.expira_en) > datetime('now')
    `).get(token);
    if (!sesion) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }
    res.json({
      valido: true,
      usuario: {
        id: sesion.usuario_id,
        username: sesion.username,
        nombre: sesion.nombre_completo,
        rol: sesion.rol,
        must_change_password: !!sesion.must_change_password
      },
      via: 'token'
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error verificando sesión:', { message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error al verificar sesión' });
  }
});

// Middleware para proteger rutas (exportable)
const { verifyJwt } = require('../middleware/jwt');
function requireAuth(req, res, next) {
  limpiarSesionesExpiradas();
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.auth_token;
  const jwtToken = req.headers['x-jwt'] || req.cookies?.jwt_token;

  // Primero intenta JWT
  if (jwtToken) {
    const user = verifyJwt(jwtToken);
    if (user) {
      req.usuario = user;
      return next();
    }
  }

  // Si no hay JWT válido, intenta token clásico
  if (!token) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const sesion = db.prepare(`
      SELECT s.*, u.username, u.rol
      FROM sesiones s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ? AND datetime(s.expira_en) > datetime('now')
    `).get(token);
    if (!sesion) {
      return res.status(401).json({ error: 'Sesión inválida' });
    }
    req.usuario = {
      id: sesion.usuario_id,
      username: sesion.username,
      rol: sesion.rol
    };
    next();
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en autenticación:', { message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error de autenticación' });
  }
}

// Middleware para requerir rol específico
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    
    next();
  };
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;
