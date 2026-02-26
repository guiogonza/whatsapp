/**
 * Rutas de configuración
 */

const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

// Session timeout settings
router.get('/session-timeout', settingsController.getSessionTimeout);
router.post('/session-timeout', settingsController.saveSessionTimeout);

module.exports = router;
