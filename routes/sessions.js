/**
 * Rutas de Sesiones de WhatsApp
 */

const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');

// Listar sesiones
router.get('/', sessionController.getSessions);

// Crear sesión
router.post('/create', sessionController.createSession);

// Obtener QR de sesión
router.get('/:name/qr', sessionController.getQR);

// Obtener estado de sesión
router.get('/:name/status', sessionController.getStatus);

// Eliminar sesión
router.delete('/:name', sessionController.deleteSession);

// Limpiar sesiones estancadas
router.post('/cleanup', sessionController.cleanupSessions);

// Información de rotación
router.get('/rotation/info', sessionController.getRotationInfo);

module.exports = router;
