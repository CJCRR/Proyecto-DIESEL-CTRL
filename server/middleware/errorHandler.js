// Middleware centralizado para manejo de errores
const logger = require('../services/logger');

function errorHandler(err, req, res, next) {
    logger.error('Error global', {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        user: req.usuario ? req.usuario.id : null
    });

    // Respuesta estructurada según entorno
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(err.status || 500).json({
        error: isDev ? err.message : 'Error interno del servidor',
        ...(isDev && { stack: err.stack })
    });
}

module.exports = errorHandler;
