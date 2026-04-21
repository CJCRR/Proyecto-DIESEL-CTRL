const express = require('express');
const logger = require('./services/logger');
const path = require('path');
const db = require('./db');
const rateLimit = require('express-rate-limit');
const { enforceHTTPS, helmetConfig } = require('./middleware/security');
const cookieParser = require('cookie-parser');

// Importación de Rutas
const productosAdmin = require('./routes/productos_admin');
const ajustesRoutes = require('./routes/ajustes');
const productosRoutes = require('./routes/productos');
const ventasRoutes = require('./routes/ventas');
const notasRoutes = require('./routes/nota');
const reportesRoutes = require('./routes/reportes');
const busquedaRoutes = require('./routes/busqueda');
const backupRoutes = require('./routes/backup');
const authRoutes = require('./routes/auth');
const usuariosRoutes = require('./routes/usuarios');
const empresasAdminRoutes = require('./routes/empresas_admin');
const syncRoutes = require('./routes/sync');
const cobranzasRoutes = require('./routes/cobranzas');
const devolucionesRoutes = require('./routes/devoluciones');
const proveedoresRoutes = require('./routes/proveedores');
const comprasRoutes = require('./routes/compras');
const { router: alertasRoutes } = require('./routes/alertas');
const presupuestosRoutes = require('./routes/presupuestos');
const depositosRoutes = require('./routes/depositos');

const app = express();
// Enforce HTTPS y Helmet sólo en producción
if (process.env.NODE_ENV === 'production') {
    app.use(enforceHTTPS);
    app.use(helmetConfig);
}
app.use(cookieParser());
// Ampliar límite para subir imágenes base64 desde ajustes
app.use(express.json({ limit: '10mb' }));
// Permitir parsing de bodies de texto (usado para importar CSV como text/plain)
app.use(express.text({ type: ['text/*', 'application/csv'], limit: '10mb' }));

// Servir archivos estáticos desde la carpeta public
const PUBLIC_DIR = path.join(__dirname, '../public');
const PAGES_DIR = path.join(PUBLIC_DIR, 'pages');
app.use(express.static(PUBLIC_DIR));

// Redirecciones para la nueva ubicación de las vistas en /pages

app.get('/', (req, res) => {
    // Landing informativa principal
    res.sendFile(path.join(PAGES_DIR, 'inicio.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect(301, '/');
});

// Redirección legada para la pantalla de login antigua
app.get('/pages/login.html', (req, res) => {
    res.redirect(301, '/login');
});

// Servir todas las páginas HTML de /pages con CSP
const htmlPages = [
    'ajustes.html', 'clientes.html', 'cobranzas.html', 'dashboard.html',
    'index.html', 'inicio.html', 'inventario.html', 'login.html', 'reportes.html', 'usuarios.html',
    'admin-empresas.html', '404.html', 'terminos.html', 'reset-password.html'
];
htmlPages.forEach(page => {
    app.get(`/pages/${page}`, (req, res) => {
        res.sendFile(path.join(PAGES_DIR, page));
    });
});

// Rutas amigables sin .html para las vistas principales
const prettyRoutes = {
    '/inicio': 'inicio.html',
    '/pos': 'index.html',
    '/login': 'login.html',
    '/dashboard': 'dashboard.html',
    '/inventario': 'inventario.html',
    '/clientes': 'clientes.html',
    '/reportes': 'reportes.html',
    '/cobranzas': 'cobranzas.html',
    '/ajustes': 'ajustes.html',
    '/usuarios': 'usuarios.html',
    // Las vistas de proveedores y compras se sirven aquí, las APIs ahora viven bajo /api
    '/proveedores': 'proveedores.html',
    '/compras': 'compras.html',
    '/admin-empresas': 'admin-empresas.html',
    '/404': '404.html',
    '/terminos': 'terminos.html',
    '/reset-password': 'reset-password.html'
};

Object.entries(prettyRoutes).forEach(([route, page]) => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(PAGES_DIR, page));
    });
});

// Registro de Rutas API
// Límite general para todas las rutas de datos (API y admin), evita abuso de endpoints costosos
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 300,                  // 300 requests por ventana por IP
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { error: 'Demasiadas solicitudes. Intente más tarde.' }
});
app.use('/api/', apiLimiter);
app.use('/admin/', apiLimiter);

// Nota: La ruta /ventas ahora deberá estar preparada para recibir un array de items
app.use('/auth', authRoutes);
app.use('/admin/productos', productosAdmin);
app.use('/admin/ajustes', ajustesRoutes);
app.use('/admin/usuarios', usuariosRoutes);
app.use('/admin/empresas', empresasAdminRoutes);
// Rutas API bajo prefijo /api para no colisionar con las vistas limpias
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/depositos', depositosRoutes);
app.use('/api/compras', comprasRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/nota', notasRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/devoluciones', devolucionesRoutes);
app.use('/api/buscar', busquedaRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/cobranzas', cobranzasRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/presupuestos', presupuestosRoutes);
app.use('/api/sync', syncRoutes);

// Middleware 404: rutas no encontradas
app.use((req, res, next) => {
    // Si parece una petición de API (prefijo /api o cabecera JSON), responder JSON
    const wantsJson = req.xhr
        || req.path.startsWith('/api/')
        || (req.headers.accept && req.headers.accept.includes('application/json'));

    if (wantsJson) {
        return res.status(404).json({ error: 'Recurso no encontrado', code: 'NOT_FOUND' });
    }

    // Para navegadores, servir la página 404 bonita
    return res.status(404).sendFile(path.join(PAGES_DIR, '404.html'));
});

// Backup automático (configurable por variables de entorno)
const isTestEnv = process.env.NODE_ENV === 'test';
const enableAutoBackupEnv = process.env.ENABLE_AUTOBACKUP;
const enableAutoBackup = enableAutoBackupEnv
    ? !['0', 'false', 'no'].includes(String(enableAutoBackupEnv).toLowerCase())
    : true; // por defecto habilitado fuera de test

const backupIntervalHours = Number(process.env.BACKUP_INTERVAL_HOURS || 6);

const runScheduledBackup = async () => {
    if (!backupRoutes.createBackup) return;
    try {
        const { fileName } = await backupRoutes.createBackup();
        logger.info(`📦 Backup automático creado: ${fileName}`);
    } catch (err) {
        logger.error('❌ Falló backup automático:', { message: err.message, stack: err.stack });
    }
};

if (!isTestEnv && enableAutoBackup) {
    setInterval(runScheduledBackup, backupIntervalHours * 60 * 60 * 1000);
    runScheduledBackup();
}

// Manejo de errores centralizado
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
        logger.info(`Servidor Diesel Ctrl ejecutándose en http://localhost:${PORT}`);
});

// Graceful shutdown
function shutdown(signal) {
    logger.info(`Recibida señal ${signal}, cerrando servidor...`);
    server.close(() => {
        logger.info('Servidor cerrado correctamente.');
        // Aquí puedes cerrar conexiones a la base de datos, limpiar recursos, etc.
        if (db && db.close) {
            try { db.close(); logger.info('Base de datos cerrada.'); } catch (e) {}
        }
        process.exit(0);
    });
    // Forzar salida si no cierra en 10s
    setTimeout(() => {
        logger.error('Forzando cierre del proceso tras 10s.');
        process.exit(1);
    }, 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));