// Middleware centralizado para manejo de errores
const logger = require('../services/logger');

function errorHandler(err, req, res, next) {
    // Log detallado para diagnóstico
    logger.error('Error global', {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        user: req.usuario ? req.usuario.id : null,
        code: err.code || null,
        status: err.status || 500
    });

    const isDev = process.env.NODE_ENV !== 'production';
    const status = Number.isInteger(err.status) ? err.status : 500;
    // Mensaje pensado para el usuario final (siempre en español)
    const userMessage = err.userMessage
        || (status >= 500
            ? 'Error interno del servidor'
            : 'No se pudo procesar la solicitud');
    // Código de error estable para facilitar manejo en frontend/logs
    const code = err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');

    const payload = {
        // Campo principal de error, compatible con código existente
        error: isDev ? (err.message || userMessage) : userMessage,
        code
    };

    // En entornos no productivos agregamos más contexto
    if (isDev) {
        payload.detail = {
            message: err.message,
            userMessage,
            originalCode: err.code || null
        };
        payload.stack = err.stack;
    }

    res.status(status).json(payload);
}

module.exports = errorHandler;
