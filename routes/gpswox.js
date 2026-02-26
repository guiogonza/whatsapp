/**
 * Rutas de GPSwox
 */

const express = require('express');
const router = express.Router();
const gpswoxController = require('../controllers/gpswoxController');

// Crear sesión GPSwox
router.post('/session/create', gpswoxController.createGPSwoxSession);

// Crear todas las sesiones GPSwox
router.post('/sessions/create-all', gpswoxController.createAllGPSwoxSessions);

// Obtener conversaciones activas
router.get('/conversations', gpswoxController.getConversations);

// Obtener conversación específica
router.get('/conversation/:phoneNumber', gpswoxController.getConversation);

// Iniciar conversación
router.post('/conversation/:phoneNumber/start', gpswoxController.startConversation);

// Eliminar conversación
router.delete('/conversation/:phoneNumber', gpswoxController.deleteConversation);

// Estadísticas
router.get('/stats', gpswoxController.getStats);

// Mensajes
router.get('/messages', gpswoxController.getGPSwoxMessages);
router.get('/message-stats', gpswoxController.getGPSwoxMessageStats);

module.exports = router;
