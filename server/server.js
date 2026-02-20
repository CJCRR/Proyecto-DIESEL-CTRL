const express = require('express');
const logger = require('./services/logger');
const path = require('path');
const db = require('./db');
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
// Enforce HTTPS en producción
app.use(enforceHTTPS);
// Helmet avanzado
// app.use(helmetConfig);
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
    res.sendFile(path.join(PAGES_DIR, 'index.html'));
});

app.get('/index.html', (req, res) => {
        res.redirect(301, '/');
});

// Servir todas las páginas HTML de /pages con CSP
const htmlPages = [
    'ajustes.html', 'clientes.html', 'cobranzas.html', 'dashboard.html',
    'index.html', 'inventario.html', 'login.html', 'reportes.html', 'usuarios.html',
    'admin-empresas.html'
];
htmlPages.forEach(page => {
    app.get(`/pages/${page}`, (req, res) => {
        res.sendFile(path.join(PAGES_DIR, page));
    });
});

// Registro de Rutas API
// Nota: La ruta /ventas ahora deberá estar preparada para recibir un array de items
app.use('/auth', authRoutes);
app.use('/admin/productos', productosAdmin);
app.use('/admin/ajustes', ajustesRoutes);
app.use('/admin/usuarios', usuariosRoutes);
app.use('/admin/empresas', empresasAdminRoutes);
app.use('/proveedores', proveedoresRoutes);
app.use('/depositos', depositosRoutes);
app.use('/compras', comprasRoutes);
app.use('/productos', productosRoutes);
app.use('/ventas', ventasRoutes);
app.use('/nota', notasRoutes);
app.use('/reportes', reportesRoutes);
app.use('/devoluciones', devolucionesRoutes);
app.use('/buscar', busquedaRoutes);
app.use('/backup', backupRoutes);
app.use('/cobranzas', cobranzasRoutes);
app.use('/alertas', alertasRoutes);
app.use('/presupuestos', presupuestosRoutes);
app.use('/sync', syncRoutes);

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