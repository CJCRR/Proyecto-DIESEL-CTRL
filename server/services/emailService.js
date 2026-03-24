const nodemailer = require('nodemailer');
const logger = require('./logger');

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const secureEnv = process.env.SMTP_SECURE;
  const secure = secureEnv ? ['1', 'true', 'yes'].includes(String(secureEnv).toLowerCase()) : false;

  return nodemailer.createTransport({
    host,
    port: Number(port),
    secure,
    auth: { user, pass }
  });
}

async function sendPasswordResetEmail({ to, resetUrl, empresaNombre }) {
  const transporter = getTransporter();

  const subject = 'Recuperación de contraseña - Nexa CTRL';
  const text = `Hola,

Recibimos una solicitud para restablecer la contraseña de tu usuario administrador en Nexa CTRL${empresaNombre ? ` para la empresa "${empresaNombre}"` : ''}.

Si tú realizaste esta solicitud, haz clic en el siguiente enlace o cópialo en tu navegador para crear una nueva contraseña:

${resetUrl}

Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña actual seguirá siendo válida.

Este enlace es válido por 1 hora.

Saludos,
Equipo Nexa CTRL`;

  const html = `
    <p>Hola,</p>
    <p>Recibimos una solicitud para restablecer la contraseña de tu usuario administrador en <strong>Nexa CTRL</strong>${empresaNombre ? ` para la empresa <strong>${empresaNombre}</strong>` : ''}.</p>
    <p>Si tú realizaste esta solicitud, haz clic en el siguiente botón o copia el enlace en tu navegador para crear una nueva contraseña:</p>
    <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Crear nueva contraseña</a></p>
    <p style="font-size:12px;color:#64748b;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
    <p style="font-size:12px;color:#64748b;word-break:break-all;">${resetUrl}</p>
    <p style="font-size:12px;color:#64748b;">Este enlace es válido por 1 hora.</p>
    <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
    <p>Saludos,<br>Equipo Nexa CTRL</p>
  `;

  if (!transporter) {
    logger.warn('SMTP no configurado. No se envió correo de recuperación. Enlace:', { resetUrl, to });
    return { ok: false, reason: 'smtp-not-configured', resetUrl };
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@nexa-ctrl.local',
      to,
      subject,
      text,
      html
    });
    logger.info('Correo de recuperación de contraseña enviado', { to });
    return { ok: true };
  } catch (err) {
    logger.error('Error enviando correo de recuperación de contraseña', { message: err.message, stack: err.stack, to });
    return { ok: false, reason: 'send-failed', error: err.message };
  }
}

module.exports = {
  sendPasswordResetEmail
};
