const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');

// Generar token único
function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /auth/login - Iniciar sesión
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const usuario = db.prepare(`
      SELECT id, username, nombre_completo, rol, activo
      FROM usuarios
      WHERE username = ? AND password = ? AND activo = 1
    `).get(username, password);

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

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

    res.json({
      success: true,
      token,
      usuario: {
        id: usuario.id,
        username: usuario.username,
        nombre: usuario.nombre_completo,
        rol: usuario.rol
      }
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// POST /auth/logout - Cerrar sesión
router.post('/logout', (req, res) => {
  const { token } = req.body;
  
  if (token) {
    try {
      db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
    }
  }
  
  res.json({ success: true });
});

// GET /auth/verificar - Verificar si el token es válido
router.get('/verificar', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const sesion = db.prepare(`
      SELECT s.*, u.username, u.nombre_completo, u.rol
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
        rol: sesion.rol
      }
    });
  } catch (err) {
    console.error('Error verificando sesión:', err);
    res.status(500).json({ error: 'Error al verificar sesión' });
  }
});

// Middleware para proteger rutas (exportable)
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
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
    console.error('Error en autenticación:', err);
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
