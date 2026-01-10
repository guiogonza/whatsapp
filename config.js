// Configuración centralizada de la aplicación
const path = require('path');
require('dotenv').config();

module.exports = {
    // Servidor
    PORT: process.env.PORT || 3010,
    
    // Rutas
    SESSION_DATA_PATH: path.join(__dirname, 'whatsapp-sessions'),
    PUBLIC_PATH: path.join(__dirname, 'public'),
    
    // Consola
    CONSOLE_CLEAR_ENABLED: process.env.CONSOLE_CLEAR_ENABLED === 'true',
    CONSOLE_CLEAR_INTERVAL: parseInt(process.env.CONSOLE_CLEAR_INTERVAL_MINUTES) || 5,
    
    // Rotación de sesiones para envío de mensajes
    // DESHABILITADO: Usar balanceo round-robin automático en cada mensaje
    SESSION_ROTATION_INTERVAL: 0, // 0 = deshabilitado (siempre round-robin)
    
    // Balanceo round-robin por mensaje (rota sesión cada mensaje)
    // TRUE = Cada mensaje usa una sesión diferente automáticamente
    LOAD_BALANCING_ENABLED: process.env.LOAD_BALANCING_ENABLED !== 'false', // true por defecto
    
    // Monitoreo
    SESSION_MONITOR_INTERVAL: 45, // minutos (aumentado para menos checks)
    INACTIVE_CHECK_INTERVAL: 90, // minutos (aumentado para menos checks)
    
    // Notificaciones
    NOTIFICATION_NUMBER: process.env.NOTIFICATION_NUMBER || '573183499539',
    NOTIFICATION_INTERVAL_MINUTES: parseInt(process.env.NOTIFICATION_INTERVAL_MINUTES, 10) || 30,
    
    // SMS API Hablame.co
    SMS_API_URL: 'https://www.hablame.co/api/sms/v5/send',
    SMS_API_KEY: process.env.HABLAME_API_KEY || '',
    
    // Puppeteer
    PUPPETEER_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    PUPPETEER_TIMEOUT: 60000,
    
    // Límites
    MAX_MESSAGE_HISTORY: 100,
    MAX_BULK_CONTACTS: 50,
    MAX_FILE_SIZE: 16 * 1024 * 1024, // 16MB
    
    // Consolidación de mensajes
    // Intervalo en minutos para procesar y enviar mensajes consolidados
    CONSOLIDATION_INTERVAL_MINUTES: parseInt(process.env.CONSOLIDATION_INTERVAL_MINUTES) || 3,
    // Icono que aparece al inicio de cada mensaje consolidado
    MESSAGE_CONSOLIDATION_ICON: '\uD83D\uDCCD',  // 📍 usando Unicode escape
    
    // Auto respuesta
    AUTO_RESPONSE: process.env.AUTO_RESPONSE || '',
    
    // Números que reciben respuesta automática con IA
    // Separados por coma en .env: AI_AUTO_RESPONSE_NUMBERS=573183499539,573001234567
    AI_AUTO_RESPONSE_NUMBERS: (process.env.AI_AUTO_RESPONSE_NUMBERS || '573183499539').split(',').map(n => n.trim()).filter(n => n),
    
    // Estados de sesión
    SESSION_STATES: {
        STARTING: 'STARTING',
        LOADING: 'LOADING',
        WAITING_FOR_QR: 'WAITING_FOR_QR',
        READY: 'READY',
        DISCONNECTED: 'DISCONNECTED',
        ERROR: 'ERROR',
        RECONNECTING: 'RECONNECTING'
    },
    
    // Tipos MIME permitidos
    ALLOWED_MIMES: [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/3gpp',
        'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain'
    ]
};
