/**
 * Rutas de configuración
 */

const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

// Session timeout settings
router.get('/session-timeout', settingsController.getSessionTimeout);
router.post('/session-timeout', settingsController.saveSessionTimeout);

// Batch settings
router.get('/batch', settingsController.getBatchSettings);
router.post('/batch', settingsController.saveBatchSettings);

// Notification interval
router.get('/notification-interval', settingsController.getNotificationInterval);
router.post('/notification-interval', settingsController.saveNotificationInterval);

module.exports = router;
