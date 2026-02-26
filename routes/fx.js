/**
 * Rutas de FX (MetaTrader5)
 */

const express = require('express');
const router = express.Router();
const fxController = require('../controllers/fxController');

// Crear sesión FX
router.post('/session/create', fxController.createFXSession);

// Crear todas las sesiones FX
router.post('/sessions/create-all', fxController.createAllFXSessions);

// Webhook para notificaciones desde MT5
router.post('/notify', fxController.sendNotification);

// Suscribir usuario a cuenta
router.post('/subscribe', fxController.subscribe);

// Desuscribir usuario de cuenta
router.post('/unsubscribe', fxController.unsubscribe);

// Listar todos los suscriptores
router.get('/subscribers', fxController.getSubscribers);

// Obtener suscriptores de una cuenta
router.get('/subscribers/:accountNumber', fxController.getAccountSubscribers);

// Estadísticas
router.get('/stats', fxController.getStats);

// Historial de notificaciones
router.get('/history', fxController.getHistory);

// Tipos de notificaciones disponibles
router.get('/types', fxController.getNotificationTypes);

module.exports = router;
