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
    SESSION_ROTATION_INTERVAL: parseInt(process.env.SESSION_ROTATION_MINUTES) || 5,
    
    // Monitoreo
    SESSION_MONITOR_INTERVAL: 30, // minutos
    INACTIVE_CHECK_INTERVAL: 60, // minutos
    
    // Notificaciones
    NOTIFICATION_NUMBER: process.env.NOTIFICATION_NUMBER || '573183499539',
    
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
    
    // Auto respuesta
    AUTO_RESPONSE: process.env.AUTO_RESPONSE || '',
    
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
