const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// __dirname = server/routes -> subir dos niveles para llegar a la raíz del proyecto
const DB_PATH = path.join(__dirname, '..', '..', 'database.sqlite');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

function ensureDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

async function createBackup() {
    ensureDir();
    const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
    const dest = path.join(BACKUP_DIR, fileName);
    await fs.promises.copyFile(DB_PATH, dest);
    return { fileName, dest };
}

router.get('/export', (req, res) => {
    res.download(DB_PATH, `respaldo_${Date.now()}.sqlite`);
});

router.post('/create', async (_req, res) => {
    try {
        const { fileName } = await createBackup();
        res.json({ ok: true, file: fileName });
    } catch (err) {
        console.error('No se pudo crear backup', err);
        res.status(500).json({ ok: false, error: 'No se pudo crear backup' });
    }
});

// Exponer para uso interno (cron en server.js)
router.createBackup = createBackup;

module.exports = router;
