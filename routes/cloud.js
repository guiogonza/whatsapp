/**
 * Rutas de Cloud API y modo híbrido
 */

const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Enviar mensaje por Cloud API
router.post('/send', messageController.sendCloudMessage);

// Estadísticas de Cloud API
router.get('/stats', messageController.getCloudStats);

// Habilitar Cloud API
router.post('/enable', messageController.enableCloud);

// Deshabilitar Cloud API
router.post('/disable', messageController.disableCloud);

// Estado del modo híbrido
router.get('/hybrid/status', messageController.getHybridStatus);

module.exports = router;
