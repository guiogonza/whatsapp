/**
 * Rutas de Mensajería
 */

const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Enviar mensaje simple
router.post('/send', messageController.sendMessage);

// Enviar mensajes masivos
router.post('/bulk', messageController.sendBulkMessages);

// Añadir a consolidación
router.post('/consolidate', messageController.consolidateMessage);

// Estado de consolidación
router.get('/consolidation/status', messageController.getConsolidationStatus);

// Historial de mensajes
router.get('/history', messageController.getMessageHistory);

// Logs de mensajes (para webhook-viewer)
router.get('/logs', messageController.getMessageLogs);

module.exports = router;
