const express = require('express');
const path = require('path');
const db = require('./db');
const helmet = require('helmet');
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
const cobranzasRoutes = require('./routes/cobranzas');
const devolucionesRoutes = require('./routes/devoluciones');
const { router: alertasRoutes } = require('./routes/alertas');

const app = express();
app.use(helmet({
    contentSecurityPolicy: false
}));
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

// Registro de Rutas API
// Nota: La ruta /ventas ahora deberá estar preparada para recibir un array de items
app.use('/auth', authRoutes);
app.use('/admin/productos', productosAdmin);
app.use('/admin/ajustes', ajustesRoutes);
app.use('/admin/usuarios', usuariosRoutes);
app.use('/productos', productosRoutes);
app.use('/ventas', ventasRoutes);
app.use('/nota', notasRoutes);
app.use('/reportes', reportesRoutes);
app.use('/devoluciones', devolucionesRoutes);
app.use('/buscar', busquedaRoutes);
app.use('/backup', backupRoutes);
app.use('/cobranzas', cobranzasRoutes);
app.use('/alertas', alertasRoutes);

// Backup automático cada 6 horas (también ejecuta uno al iniciar)
const runScheduledBackup = async () => {
    if (!backupRoutes.createBackup) return;
    try {
        const { fileName } = await backupRoutes.createBackup();
        console.log(`📦 Backup automático creado: ${fileName}`);
    } catch (err) {
        console.error('❌ Falló backup automático:', err.message);
    }
};
setInterval(runScheduledBackup, 6 * 60 * 60 * 1000);
runScheduledBackup();

// Manejo de errores básico
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Algo salió mal en el servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Diesel Ctrl ejecutándose en http://localhost:${PORT}`);
});