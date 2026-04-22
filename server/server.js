const express = require('express');
const fs = require('fs');
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
const FIREBASE_CONFIG_FILE = path.join(PUBLIC_DIR, 'config', 'firebase-config.js');
const disableStaticCache = process.env.NODE_ENV !== 'production';

function applyNoStoreHeaders(res) {
    if (!disableStaticCache) return;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
}

app.get('/config/firebase-config.js', (req, res) => {
    applyNoStoreHeaders(res);
    res.type('application/javascript; charset=utf-8');

    try {
        if (fs.existsSync(FIREBASE_CONFIG_FILE)) {
            return res.send(fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf8'));
        }
    } catch (err) {
        logger.warn('No se pudo leer public/config/firebase-config.js; se usara config por entorno', {
            message: err.message,
            stack: err.stack,
        });
    }

    const firebaseConfig = {
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || '',
    };

    const moduleSource = `import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 2)};

const hasRealFirebaseConfig = Object.values(firebaseConfig).every((value) => {
  return typeof value === "string" && value.trim().length > 0;
});

const app = hasRealFirebaseConfig
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;
const db = app ? getFirestore(app) : null;

export { firebaseConfig, hasRealFirebaseConfig, db, collection, addDoc, getDocs, updateDoc, doc, query, where, deleteDoc, setDoc };
`;

    return res.send(moduleSource);
});

app.use(express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
        if (!disableStaticCache) return;
        if (/\.(html|js|css|map)$/i.test(filePath) || /service-worker\.js$/i.test(filePath)) {
            applyNoStoreHeaders(res);
        }
    }
}));

// Redirecciones para la nueva ubicación de las vistas en /pages

app.get('/', (req, res) => {
    // Landing informativa principal
    applyNoStoreHeaders(res);
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
        applyNoStoreHeaders(res);
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
        applyNoStoreHeaders(res);
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
// Rutas API bajo prefijo /api para no colisionar con las vistas limpias
app.use('/api/proveedores', proveedoresRoutes);
app.use('/depositos', depositosRoutes);
app.use('/api/compras', comprasRoutes);
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