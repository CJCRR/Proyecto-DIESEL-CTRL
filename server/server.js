const express = require('express');
const path = require('path');
const db = require('./db');

// Importación de Rutas
const productosAdmin = require('./routes/productos_admin');
const ajustesRoutes = require('./routes/ajustes');
const productosRoutes = require('./routes/productos');
const ventasRoutes = require('./routes/ventas');
const notasRoutes = require('./routes/nota');
const reportesRoutes = require('./routes/reportes');
const busquedaRoutes = require('./routes/busqueda');
const backupRoutes = require('./routes/backup');

const app = express();
app.use(express.json());
// Permitir parsing de bodies de texto (usado para importar CSV como text/plain)
app.use(express.text({ type: ['text/*', 'application/csv'] }));

// Servir archivos estáticos desde la carpeta public
// Esto servirá index.html, styles.css y app.js automáticamente
app.use(express.static(path.join(__dirname, '../public')));

// Registro de Rutas API
// Nota: La ruta /ventas ahora deberá estar preparada para recibir un array de items
app.use('/admin/productos', productosAdmin);
app.use('/admin/ajustes', ajustesRoutes);
app.use('/productos', productosRoutes);
app.use('/ventas', ventasRoutes);
app.use('/nota', notasRoutes);
app.use('/reportes', reportesRoutes);
app.use('/buscar', busquedaRoutes);
app.use('/backup', backupRoutes);

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