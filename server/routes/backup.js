const express = require('express');
const router = express.Router();
const path = require('path');

router.get('/export', (req, res) => {
    const dbPath = path.join(__dirname, '../data.db');
    res.download(dbPath, `respaldo_${Date.now()}.db`);
});

module.exports = router;
