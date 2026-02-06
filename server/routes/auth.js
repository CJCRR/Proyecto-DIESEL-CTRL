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

// Cálculo de suspensión automática según proximo_cobro y dias_gracia
function debeSuspenderEmpresa(estadoActual, proximoCobroStr, diasGracia) {
  // Si ya está suspendida manualmente, se respeta
  if (estadoActual === 'suspendida') return true;

  if (!proximoCobroStr) return false;

  const proximoCobro = new Date(proximoCobroStr);
  if (Number.isNaN(proximoCobro.getTime())) return false;

  const dias = Number.isFinite(Number(diasGracia)) ? Number(diasGracia) : 0;
  const hoy = new Date();
  const limiteGracia = new Date(proximoCobro.getTime());
  limiteGracia.setDate(limiteGracia.getDate() + dias);

  // Suspender si hoy está después del límite de gracia
  return hoy > limiteGracia;
}

// POST /auth/login - Iniciar sesión (multiempresa-ready)
router.post('/login', loginLimiter, (req, res) => {
  limpiarSesionesExpiradas();
  const { username, password, empresaCodigo, empresa_codigo } = req.body;
  const empresaCode = empresaCodigo || empresa_codigo || null;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    let empresa = null;
    if (empresaCode) {
      empresa = db.prepare('SELECT id, codigo, estado, proximo_cobro, dias_gracia FROM empresas WHERE codigo = ?').get(empresaCode);
      if (!empresa) {
        return res.status(401).json({ error: 'Empresa no encontrada' });
      }
    }

    const usuario = empresa
      ? db.prepare(`
             SELECT u.id, u.username, u.nombre_completo, u.rol, u.activo, u.password,
               u.failed_attempts, u.locked_until, u.must_change_password,
               u.empresa_id,
               e.codigo AS empresa_codigo, e.estado AS empresa_estado,
               e.proximo_cobro AS empresa_proximo_cobro, e.dias_gracia AS empresa_dias_gracia
          FROM usuarios u
          LEFT JOIN empresas e ON e.id = u.empresa_id
          WHERE u.username = ? AND u.activo = 1 AND u.empresa_id = ?
        `).get(username, empresa.id)
      : db.prepare(`
             SELECT u.id, u.username, u.nombre_completo, u.rol, u.activo, u.password,
               u.failed_attempts, u.locked_until, u.must_change_password,
               u.empresa_id,
               e.codigo AS empresa_codigo, e.estado AS empresa_estado,
               e.proximo_cobro AS empresa_proximo_cobro, e.dias_gracia AS empresa_dias_gracia
          FROM usuarios u
          LEFT JOIN empresas e ON e.id = u.empresa_id
          WHERE u.username = ? AND u.activo = 1
        `).get(username);

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificación de licencia/estado de empresa (solo usuarios de empresa, no superadmin global)
    if (usuario.rol !== 'superadmin' && usuario.empresa_id) {
      const estadoEmpresa = usuario.empresa_estado || (empresa && empresa.estado) || 'activa';
      const diasGracia = usuario.empresa_dias_gracia ?? (empresa && empresa.dias_gracia);
      const proximoCobro = usuario.empresa_proximo_cobro || (empresa && empresa.proximo_cobro) || null;

      const debeSuspender = debeSuspenderEmpresa(estadoEmpresa, proximoCobro, diasGracia);

      if (debeSuspender) {
        // Persistir suspensión en BD si aún no está marcada
        if (estadoEmpresa !== 'suspendida') {
          try {
            db.prepare("UPDATE empresas SET estado = 'suspendida', actualizado_en = datetime('now') WHERE id = ?")
              .run(usuario.empresa_id || (empresa && empresa.id));
          } catch (e) {
            const logger = require('../services/logger');
            logger.warn('No se pudo actualizar estado de empresa a suspendida:', e.message);
          }
        }
        return res.status(403).json({ error: 'La cuenta de la empresa está suspendida. Contacte al administrador del sistema.' });
      }
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
      } catch (e) { }
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

    // JWT: datos mínimos necesarios (incluyendo empresa)
    const jwtPayload = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre_completo,
      rol: usuario.rol,
      empresa_id: usuario.empresa_id || null,
      empresa_codigo: usuario.empresa_codigo || null,
      empresa_estado: usuario.empresa_estado || null,
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
        SELECT s.*, u.username, u.nombre_completo, u.rol, u.must_change_password,
          u.empresa_id, e.codigo AS empresa_codigo, e.estado AS empresa_estado
      FROM sesiones s
      JOIN usuarios u ON u.id = s.usuario_id
      LEFT JOIN empresas e ON e.id = u.empresa_id
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
        empresa_id: sesion.empresa_id || null,
        empresa_codigo: sesion.empresa_codigo || null,
        empresa_estado: sesion.empresa_estado || null,
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
      SELECT s.*, u.username, u.rol, u.empresa_id, e.codigo AS empresa_codigo, e.estado AS empresa_estado
      FROM sesiones s
      JOIN usuarios u ON u.id = s.usuario_id
      LEFT JOIN empresas e ON e.id = u.empresa_id
      WHERE s.token = ? AND datetime(s.expira_en) > datetime('now')
    `).get(token);
    if (!sesion) {
      return res.status(401).json({ error: 'Sesión inválida' });
    }
    req.usuario = {
      id: sesion.usuario_id,
      username: sesion.username,
      rol: sesion.rol,
      empresa_id: sesion.empresa_id || null,
      empresa_codigo: sesion.empresa_codigo || null,
      empresa_estado: sesion.empresa_estado || null
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
