const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const speakeasy = require('speakeasy');
const { signJwt } = require('../middleware/jwt');
const { registrarEventoNegocio } = require('../services/eventosService');
const { registrarAuditoria } = require('../services/auditLogService');
const { sendPasswordResetEmail } = require('../services/emailService');

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

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de recuperación. Intente más tarde.' }
});

// Límite para auto-registro de empresas (evitar abuso del endpoint público)
const registroEmpresaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de registro. Intente más tarde.' }
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
  const { username, password, empresaCodigo, empresa_codigo, twofa } = req.body || {};
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
               u.failed_attempts, u.locked_until, u.must_change_password, u.twofa_enabled, u.twofa_secret,
               u.empresa_id,
               e.codigo AS empresa_codigo, e.estado AS empresa_estado,
               e.proximo_cobro AS empresa_proximo_cobro, e.dias_gracia AS empresa_dias_gracia,
               e.plan AS empresa_plan
          FROM usuarios u
          LEFT JOIN empresas e ON e.id = u.empresa_id
          WHERE u.username = ? AND u.activo = 1 AND u.empresa_id = ?
        `).get(username, empresa.id)
      : db.prepare(`
             SELECT u.id, u.username, u.nombre_completo, u.rol, u.activo, u.password,
               u.failed_attempts, u.locked_until, u.must_change_password, u.twofa_enabled, u.twofa_secret,
               u.empresa_id,
               e.codigo AS empresa_codigo, e.estado AS empresa_estado,
               e.proximo_cobro AS empresa_proximo_cobro, e.dias_gracia AS empresa_dias_gracia,
               e.plan AS empresa_plan
          FROM usuarios u
          LEFT JOIN empresas e ON e.id = u.empresa_id
          WHERE u.username = ? AND u.activo = 1
        `).get(username);

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificación de licencia/estado de empresa (solo usuarios de empresa, no superadmin global)
    let empresaEstadoSesion = usuario.empresa_estado || (empresa && empresa.estado) || null;
    if (usuario.rol !== 'superadmin' && usuario.empresa_id) {
      const estadoEmpresa = empresaEstadoSesion || 'activa';
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
        empresaEstadoSesion = 'suspendida';
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
      // Contraseña legada sin hash — migración al vuelo con protección contra timing attacks
      try {
        const logger = require('../services/logger');
        logger.warn(`Usuario ${usuario.username} tiene contraseña sin hash (legada). Se migrará a bcrypt al iniciar sesión.`);
      } catch { }
      try {
        const a = Buffer.from(String(password));
        const b = Buffer.from(String(usuario.password));
        ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch {
        ok = false;
      }
      if (ok) {
        const newHash = bcrypt.hashSync(password, 10);
        db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(newHash, usuario.id);
      }
    }

    if (!ok) {
      const newFailed = (usuario.failed_attempts || 0) + 1;
      // Bloqueo simple: a partir de 5 intentos fallidos, bloquear la cuenta 5 minutos
      let lockUntil = null;
      if (newFailed >= 5) {
        lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
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

    // Si es superadmin y tiene 2FA habilitado, exigir código TOTP válido
    if (usuario.rol === 'superadmin' && usuario.twofa_enabled) {
      if (!usuario.twofa_secret) {
        const logger = require('../services/logger');
        logger.warn('Usuario superadmin con 2FA habilitado pero sin secreto configurado', { usuario_id: usuario.id });
        return res.status(500).json({ error: '2FA mal configurado para esta cuenta. Contacte al administrador.' });
      }
      const token2fa = (twofa || '').toString().trim();
      if (!token2fa) {
        return res.status(400).json({ error: 'Se requiere código 2FA para superadmin' });
      }

      const valid2fa = speakeasy.totp.verify({
        secret: usuario.twofa_secret,
        encoding: 'base32',
        token: token2fa,
        window: 1,
      });

      if (!valid2fa) {
        return res.status(401).json({ error: 'Código 2FA inválido' });
      }
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
    let empresaTrialInfo = null;
    if (usuario.empresa_plan && usuario.empresa_proximo_cobro) {
      const planStr = String(usuario.empresa_plan || '').toUpperCase();
      const finTrial = new Date(usuario.empresa_proximo_cobro);
      if (!Number.isNaN(finTrial.getTime()) && planStr.startsWith('TRIAL')) {
        const ahora = new Date();
        if (ahora <= finTrial) {
          const diffMs = finTrial.getTime() - ahora.getTime();
          const diasRestantes = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
          empresaTrialInfo = {
            dias_restantes: diasRestantes,
            termina_el: finTrial.toISOString(),
            plan: usuario.empresa_plan
          };
        }
      }
    }

    const jwtPayload = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre_completo,
      rol: usuario.rol,
      empresa_id: usuario.empresa_id || null,
      empresa_codigo: usuario.empresa_codigo || null,
      empresa_estado: empresaEstadoSesion,
      empresa_proximo_cobro: usuario.empresa_proximo_cobro || null,
      empresa_dias_gracia: (usuario.empresa_dias_gracia != null ? Number(usuario.empresa_dias_gracia) : null),
      empresa_plan: usuario.empresa_plan || null,
      empresa_trial: empresaTrialInfo,
      must_change_password: !!usuario.must_change_password,
      twofa_enabled: !!usuario.twofa_enabled
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
      const missingLicenciaData = user.empresa_id && (user.empresa_proximo_cobro === undefined || user.empresa_dias_gracia === undefined);
      if (missingLicenciaData) {
        try {
          const empresaRow = db.prepare('SELECT codigo, estado, proximo_cobro, dias_gracia FROM empresas WHERE id = ?').get(user.empresa_id);
          if (empresaRow) {
            const enriched = {
              ...user,
              empresa_codigo: user.empresa_codigo || empresaRow.codigo || null,
              empresa_estado: user.empresa_estado || empresaRow.estado || null,
              empresa_proximo_cobro: empresaRow.proximo_cobro || null,
              empresa_dias_gracia: empresaRow.dias_gracia != null ? Number(empresaRow.dias_gracia) : null,
            };
            return res.json({ valido: true, usuario: enriched, via: 'jwt' });
          }
        } catch (err) {
          const logger = require('../services/logger');
          logger.warn('No se pudo enriquecer payload JWT con datos de licencia', { message: err.message });
        }
      }
      return res.json({ valido: true, usuario: user, via: 'jwt' });
    }
  }

  // Si no hay JWT válido, intenta token clásico
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  try {
    const sesion = db.prepare(`
        SELECT s.*, u.username, u.nombre_completo, u.rol, u.must_change_password, u.twofa_enabled,
          u.empresa_id, e.codigo AS empresa_codigo, e.estado AS empresa_estado,
          e.proximo_cobro AS empresa_proximo_cobro, e.dias_gracia AS empresa_dias_gracia
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
        empresa_proximo_cobro: sesion.empresa_proximo_cobro || null,
        empresa_dias_gracia: (sesion.empresa_dias_gracia != null ? Number(sesion.empresa_dias_gracia) : null),
        must_change_password: !!sesion.must_change_password,
        twofa_enabled: !!sesion.twofa_enabled
      },
      via: 'token'
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error verificando sesión:', { message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error al verificar sesión' });
  }
});

// POST /auth/2fa/setup - Generar secreto inicial para 2FA (superadmin/admin)
router.post('/2fa/setup', requireAuth, (req, res) => {
  try {
    const usuarioActual = req.usuario;
    if (!usuarioActual || !['superadmin', 'admin'].includes(usuarioActual.rol)) {
      return res.status(403).json({ error: 'Permisos insuficientes para configurar 2FA' });
    }

    const row = db.prepare('SELECT id, username, twofa_enabled, twofa_secret FROM usuarios WHERE id = ?').get(usuarioActual.id);
    if (!row) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (row.twofa_enabled) {
      return res.status(400).json({ error: '2FA ya está habilitado para este usuario' });
    }

    const secret = speakeasy.generateSecret({ name: `Diesel-CTRL (${row.username})` });

    db.prepare('UPDATE usuarios SET twofa_secret = ? WHERE id = ?').run(secret.base32, row.id);

    res.json({
      secret: secret.base32,
      otpauth_url: secret.otpauth_url,
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en /auth/2fa/setup:', { message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error al preparar 2FA' });
  }
});

// POST /auth/2fa/enable - Verificar código y marcar 2FA como habilitado
router.post('/2fa/enable', requireAuth, (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: 'Código 2FA requerido' });
  }

  try {
    const usuarioActual = req.usuario;
    if (!usuarioActual || !['superadmin', 'admin'].includes(usuarioActual.rol)) {
      return res.status(403).json({ error: 'Permisos insuficientes para habilitar 2FA' });
    }

    const row = db.prepare('SELECT id, username, twofa_enabled, twofa_secret FROM usuarios WHERE id = ?').get(usuarioActual.id);
    if (!row || !row.twofa_secret) {
      return res.status(400).json({ error: '2FA no está en modo configuración. Use primero /auth/2fa/setup.' });
    }

    const verified = speakeasy.totp.verify({
      secret: row.twofa_secret,
      encoding: 'base32',
      token: String(token),
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ error: 'Código 2FA inválido' });
    }

    db.prepare('UPDATE usuarios SET twofa_enabled = 1 WHERE id = ?').run(row.id);

    res.json({ success: true, twofa_enabled: true });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en /auth/2fa/enable:', { message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error al habilitar 2FA' });
  }
});

// POST /auth/2fa/disable - Deshabilitar 2FA verificando el código actual
router.post('/2fa/disable', requireAuth, (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: 'Código 2FA requerido' });
  }

  try {
    const usuarioActual = req.usuario;
    if (!usuarioActual || !['superadmin', 'admin'].includes(usuarioActual.rol)) {
      return res.status(403).json({ error: 'Permisos insuficientes para deshabilitar 2FA' });
    }

    const row = db.prepare('SELECT id, username, twofa_enabled, twofa_secret FROM usuarios WHERE id = ?').get(usuarioActual.id);
    if (!row || !row.twofa_secret) {
      return res.status(400).json({ error: '2FA no está configurado para este usuario' });
    }

    const verified = speakeasy.totp.verify({
      secret: row.twofa_secret,
      encoding: 'base32',
      token: String(token),
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ error: 'Código 2FA inválido' });
    }

    db.prepare('UPDATE usuarios SET twofa_enabled = 0, twofa_secret = NULL WHERE id = ?').run(row.id);

    res.json({ success: true, twofa_enabled: false });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en /auth/2fa/disable:', { message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error al deshabilitar 2FA' });
  }
});

// POST /auth/registro-empresa - Auto-registro público de empresa + admin con prueba gratis
router.post('/registro-empresa', registroEmpresaLimiter, (req, res) => {
  const {
    empresa_nombre,
    empresa_rif,
    empresa_telefono,
    empresa_email,
    empresa_ubicacion,
    admin_username,
    admin_password,
    admin_nombre,
    admin_email
  } = req.body || {};

  const nombre = (empresa_nombre || '').toString().trim();
  const rif = (empresa_rif || '').toString().trim();
  const telefono = (empresa_telefono || '').toString().trim();
  const emailEmpresa = (empresa_email || '').toString().trim().toLowerCase();
  const direccion = (empresa_ubicacion || '').toString().trim();
  const username = (admin_username || '').toString().trim();
  const password = (admin_password || '').toString();
  const nombreAdmin = (admin_nombre || '').toString().trim();
  const emailAdmin = (admin_email || '').toString().trim().toLowerCase();

  if (!nombre || nombre.length < 3) {
    return res.status(400).json({ error: 'El nombre de la empresa debe tener al menos 3 caracteres.' });
  }
  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'El usuario administrador debe tener al menos 3 caracteres.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'La contraseña del administrador debe tener al menos 6 caracteres.' });
  }

  // Validaciones mínimas de formato de correo (solo si se envían)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailEmpresa && !emailRegex.test(emailEmpresa)) {
    return res.status(400).json({ error: 'El correo de la empresa no es válido.' });
  }
  if (emailAdmin && !emailRegex.test(emailAdmin)) {
    return res.status(400).json({ error: 'El correo del usuario administrador no es válido.' });
  }

  try {
    // Validar que el username no exista
    const existente = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
    if (existente) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre. Por favor elija otro.' });
    }

    // Generar código de empresa único a partir del nombre o RIF
    const baseCodigo = (rif || nombre).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'EMP';
    let codigo = baseCodigo;
    let intento = 0;
    while (true) {
      const existeCodigo = db.prepare('SELECT id FROM empresas WHERE codigo = ?').get(codigo);
      if (!existeCodigo) break;
      intento += 1;
      if (intento > 5) {
        return res.status(409).json({ error: 'No se pudo generar un código único para la empresa. Intente nuevamente más tarde.' });
      }
      const sufijo = String(Math.floor(100 + Math.random() * 900));
      codigo = (baseCodigo + sufijo).slice(0, 10);
    }

    const tx = db.transaction(() => {
      const ahora = new Date();
      const trialDias = 5;
      const finTrial = new Date(ahora.getTime() + trialDias * 24 * 60 * 60 * 1000);
      const finTrialIso = finTrial.toISOString();
      const diaCorte = ahora.getUTCDate();

      const infoEmpresa = db.prepare(`
        INSERT INTO empresas (nombre, codigo, estado, plan, monto_mensual, fecha_alta, fecha_corte, dias_gracia, nota_interna, rif, telefono, direccion, email, proximo_cobro)
        VALUES (?, ?, 'activa', ?, 0, datetime('now'), ?, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        nombre,
        codigo,
        'TRIAL-5D',
        diaCorte,
        'Empresa creada vía auto-registro (prueba gratis 5 días).',
        rif || null,
        telefono || null,
        direccion || null,
        emailEmpresa || null,
        finTrialIso
      );

      const empresaId = infoEmpresa.lastInsertRowid;
      const hash = bcrypt.hashSync(password, 10);

      db.prepare(`
        INSERT INTO usuarios (username, password, nombre_completo, rol, activo, must_change_password, empresa_id, email)
        VALUES (?, ?, ?, 'admin', 1, 0, ?, ?)
      `).run(
        username,
        hash,
        nombreAdmin || username,
        empresaId,
        emailAdmin || null
      );

      try {
        registrarAuditoria({
          usuario: null,
          accion: 'EMPRESA_AUTOREGISTRO',
          entidad: 'empresa',
          entidadId: empresaId,
          detalle: {
            nombre,
            codigo,
            origen: 'login-auto-registro',
            trial_dias: trialDias
          },
          ip: req.ip,
          userAgent: req.headers['user-agent']
        });
      } catch (_) {}

      try {
        registrarEventoNegocio(empresaId, {
          tipo: 'empresa_creada',
          entidad: 'empresa',
          entidadId: empresaId,
          origen: 'auto-registro',
          payload: {
            nombre,
            codigo,
            plan: 'TRIAL-5D',
            proximo_cobro: finTrialIso
          }
        });
      } catch (_) {}

      return { empresaId, codigo, finTrialIso };
    });

    const resultado = tx();

    res.status(201).json({
      success: true,
      message: 'Empresa creada correctamente. Ya puedes iniciar sesión con el usuario administrador.',
      empresa: {
        id: resultado.empresaId,
        nombre,
        codigo: resultado.codigo,
        plan: 'TRIAL-5D',
        proximo_cobro: resultado.finTrialIso
      },
      admin: {
        username
      }
    });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en auto-registro de empresa:', { message: err.message, stack: err.stack, url: req.originalUrl });
    res.status(500).json({ error: 'Error al registrar la empresa. Intente nuevamente.' });
  }
});

// POST /auth/password-reset-request - Solicitar recuperación de contraseña (solo admins principales con email)
router.post('/password-reset-request', forgotPasswordLimiter, (req, res) => {
  const { email } = req.body || {};
  const rawEmail = (email || '').toString().trim().toLowerCase();

  if (!rawEmail) {
    return res.status(400).json({ error: 'El correo es obligatorio.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(rawEmail)) {
    return res.status(400).json({ error: 'El correo no tiene un formato válido.' });
  }

  try {
    // Buscar solo usuarios admin de empresa con ese correo (admins principales previstos en auto-registro)
    const usuario = db.prepare(`
      SELECT u.id, u.username, u.email, u.empresa_id, e.nombre AS empresa_nombre
      FROM usuarios u
      LEFT JOIN empresas e ON e.id = u.empresa_id
      WHERE LOWER(u.email) = ? AND u.rol = 'admin' AND u.activo = 1
    `).get(rawEmail);

    // Siempre responder 200 para no filtrar si el correo existe o no
    const genericResponse = () => res.json({
      success: true,
      message: 'Si el correo existe como usuario administrador principal, se enviará un enlace para restablecer la contraseña.'
    });

    if (!usuario) {
      return genericResponse();
    }

    const token = generarToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

    db.prepare(`
      UPDATE usuarios
      SET password_reset_token = ?, password_reset_expires = ?
      WHERE id = ?
    `).run(token, expires, usuario.id);

    const envBaseUrl = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '';
    const baseUrl = envBaseUrl || `${req.protocol}://${req.get('host') || ''}`;
    const resetPath = '/pages/reset-password.html';
    const resetUrl = `${baseUrl}${resetPath}?token=${encodeURIComponent(token)}`;

    // Enviar correo (si SMTP está configurado)
    sendPasswordResetEmail({
      to: rawEmail,
      resetUrl,
      empresaNombre: usuario.empresa_nombre || null
    }).then((result) => {
      // En entornos sin SMTP configurado, exponer el enlace para pruebas locales
      const isProd = process.env.NODE_ENV === 'production';
      if (!isProd && result && result.resetUrl) {
        return res.json({
          success: true,
          message: 'Solicitud procesada (modo desarrollo). Usa el enlace para restablecer la contraseña.',
          resetUrl: result.resetUrl
        });
      }
      return genericResponse();
    }).catch(() => genericResponse());
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en /auth/password-reset-request:', { message: err.message, stack: err.stack, url: req.originalUrl });
    return res.status(500).json({ error: 'Error al procesar la solicitud de recuperación.' });
  }
});

// POST /auth/password-reset-confirm - Confirmar cambio de contraseña usando token
router.post('/password-reset-confirm', (req, res) => {
  const { token, password } = req.body || {};
  const rawToken = (token || '').toString().trim();
  const newPassword = (password || '').toString();

  if (!rawToken || !newPassword) {
    return res.status(400).json({ error: 'Token y nueva contraseña son obligatorios.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  }

  try {
    const usuario = db.prepare(`
      SELECT id, password_reset_token, password_reset_expires
      FROM usuarios
      WHERE password_reset_token = ?
    `).get(rawToken);

    if (!usuario || !usuario.password_reset_expires) {
      return res.status(400).json({ error: 'El enlace de recuperación no es válido o ya fue usado.' });
    }

    const exp = new Date(usuario.password_reset_expires);
    if (Number.isNaN(exp.getTime()) || exp < new Date()) {
      return res.status(400).json({ error: 'El enlace de recuperación ha expirado.' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare(`
      UPDATE usuarios
      SET password = ?, password_reset_token = NULL, password_reset_expires = NULL, must_change_password = 0
      WHERE id = ?
    `).run(hash, usuario.id);

    try {
      registrarAuditoria({
        usuario: null,
        accion: 'USUARIO_RESET_PASSWORD',
        entidad: 'usuario',
        entidadId: usuario.id,
        detalle: { origen: 'password-reset-email' },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
    } catch (_) {}

    return res.json({ success: true, message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión con tu nueva contraseña.' });
  } catch (err) {
    const logger = require('../services/logger');
    logger.error('Error en /auth/password-reset-confirm:', { message: err.message, stack: err.stack, url: req.originalUrl });
    return res.status(500).json({ error: 'Error al actualizar la contraseña.' });
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
