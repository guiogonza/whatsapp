/**
 * Rutas de Analytics
 */

const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

// Obtener mensajes con analytics
router.get('/messages', analyticsController.getMessages);

// Mensajes por sesión agrupados por mes
router.get('/sessions-monthly', analyticsController.getSessionsMonthly);

// Exportar mensajes enviados a Excel
router.get('/export-sent', analyticsController.getExportSent);

module.exports = router;
