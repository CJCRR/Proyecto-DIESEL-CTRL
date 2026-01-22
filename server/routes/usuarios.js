const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

// GET /admin/usuarios - Listar todos los usuarios (solo admin)
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const usuarios = db.prepare(`
      SELECT id, username, nombre_completo, rol, activo, creado_en, ultimo_login
      FROM usuarios
      ORDER BY creado_en DESC
    `).all();
    res.json(usuarios);
  } catch (err) {
    console.error('Error listando usuarios:', err);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

// POST /admin/usuarios - Crear nuevo usuario (solo admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, nombre_completo, rol } = req.body;

  // Validaciones
  if (!username || !password) {
    return res.status(400).json({ error: 'Username y password son requeridos' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'El username debe tener al menos 3 caracteres' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const rolesValidos = ['admin', 'vendedor', 'lectura'];
  if (rol && !rolesValidos.includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido. Debe ser: admin, vendedor o lectura' });
  }

  try {
    // Verificar que no exista el username
    const existe = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
    if (existe) {
      return res.status(400).json({ error: 'El username ya existe' });
    }

    // Crear usuario
    const result = db.prepare(`
      INSERT INTO usuarios (username, password, nombre_completo, rol)
      VALUES (?, ?, ?, ?)
    `).run(username, password, nombre_completo || username, rol || 'vendedor');

    const nuevoUsuario = db.prepare(`
      SELECT id, username, nombre_completo, rol, activo, creado_en
      FROM usuarios WHERE id = ?
    `).get(result.lastInsertRowid);

    res.json({ 
      message: 'Usuario creado exitosamente',
      usuario: nuevoUsuario
    });
  } catch (err) {
    console.error('Error creando usuario:', err);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// PUT /admin/usuarios/:id - Actualizar usuario (solo admin)
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { nombre_completo, rol, password } = req.body;

  try {
    // Verificar que el usuario existe
    const usuario = db.prepare('SELECT id, username FROM usuarios WHERE id = ?').get(id);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // No permitir que el admin se quite sus propios permisos
    const usuarioActual = req.usuario;
    if (parseInt(id) === usuarioActual.id && rol && rol !== 'admin') {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol de administrador' });
    }

    // Validar rol si se proporciona
    const rolesValidos = ['admin', 'vendedor', 'lectura'];
    if (rol && !rolesValidos.includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    // Validar contraseña si se proporciona
    if (password && password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Construir query de actualización
    const updates = [];
    const params = [];

    if (nombre_completo !== undefined) {
      updates.push('nombre_completo = ?');
      params.push(nombre_completo);
    }

    if (rol !== undefined) {
      updates.push('rol = ?');
      params.push(rol);
    }

    if (password !== undefined) {
      updates.push('password = ?');
      params.push(password);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    params.push(id);

    db.prepare(`
      UPDATE usuarios 
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    const usuarioActualizado = db.prepare(`
      SELECT id, username, nombre_completo, rol, activo, creado_en
      FROM usuarios WHERE id = ?
    `).get(id);

    res.json({
      message: 'Usuario actualizado exitosamente',
      usuario: usuarioActualizado
    });
  } catch (err) {
    console.error('Error actualizando usuario:', err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// DELETE /admin/usuarios/:id - Desactivar usuario (solo admin)
// DELETE /admin/usuarios/:id/eliminar - Eliminar usuario definitivo (solo admin)
// Nota: Se coloca antes de /:id para que la ruta específica no sea capturada por la genérica
router.delete('/:id/eliminar', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;

  try {
    const usuario = db.prepare('SELECT id, username FROM usuarios WHERE id = ?').get(id);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // No permitir que el admin se elimine a sí mismo
    const usuarioActual = req.usuario;
    if (parseInt(id) === usuarioActual.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }

    // Validar dependencias (ventas ligadas)
    const ventas = db.prepare('SELECT COUNT(*) as c FROM ventas WHERE usuario_id = ?').get(id);
    if (ventas && ventas.c > 0) {
      return res.status(409).json({ error: 'No se puede eliminar: el usuario tiene ventas registradas. Desactívalo en su lugar.' });
    }

    // Eliminar sesiones y usuario
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);

    res.json({ message: 'Usuario eliminado definitivamente' });
  } catch (err) {
    console.error('Error eliminando usuario:', err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;

  try {
    const usuario = db.prepare('SELECT id, username FROM usuarios WHERE id = ?').get(id);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // No permitir que el admin se desactive a sí mismo
    const usuarioActual = req.usuario;
    if (parseInt(id) === usuarioActual.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }

    // Desactivar usuario (soft delete)
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(id);

    // Eliminar sesiones activas del usuario
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);

    res.json({ message: 'Usuario desactivado exitosamente' });
  } catch (err) {
    console.error('Error desactivando usuario:', err);
    res.status(500).json({ error: 'Error al desactivar usuario' });
  }
});

// POST /admin/usuarios/:id/activar - Reactivar usuario (solo admin)
router.post('/:id/activar', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;

  try {
    const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(id);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    db.prepare('UPDATE usuarios SET activo = 1 WHERE id = ?').run(id);

    res.json({ message: 'Usuario activado exitosamente' });
  } catch (err) {
    console.error('Error activando usuario:', err);
    res.status(500).json({ error: 'Error al activar usuario' });
  }
});

module.exports = router;
