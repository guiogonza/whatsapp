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
    
    // Adaptadores multi-librería para sesiones WhatsApp
    // Opciones: 'baileys-standard', 'baileys-stealth', 'whatsapp-web-js'
    // Se rotan automáticamente al crear nuevas sesiones para diversificar fingerprints
    ENABLED_ADAPTERS: (process.env.ENABLED_ADAPTERS || 'baileys-standard,baileys-stealth').split(',').map(a => a.trim()).filter(a => a),
    
    // Rotación de sesiones para envío de mensajes
    // DESHABILITADO: Usar balanceo round-robin automático en cada mensaje
    SESSION_ROTATION_INTERVAL: 0, // 0 = deshabilitado (siempre round-robin)
    
    // Balanceo round-robin por mensaje (rota sesión cada mensaje)
    // TRUE = Cada mensaje usa una sesión diferente automáticamente
    LOAD_BALANCING_ENABLED: process.env.LOAD_BALANCING_ENABLED !== 'false', // true por defecto
    
    // Monitoreo
    SESSION_MONITOR_INTERVAL: 45, // minutos (aumentado para menos checks)
    INACTIVE_CHECK_INTERVAL: 90, // minutos (aumentado para menos checks)
    
    // Tiempo de sesión (en minutos)
    // Opciones: 5, 10, 20, 30 minutos
    SESSION_TIMEOUT_MINUTES: parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 10,
    
    // Base de datos PostgreSQL
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://whatsapp:whatsapp_secure_2026@postgres:5432/whatsapp_analytics',
    POSTGRES_HOST: process.env.POSTGRES_HOST || 'postgres',
    POSTGRES_PORT: parseInt(process.env.POSTGRES_PORT) || 5432,
    POSTGRES_DB: process.env.POSTGRES_DB || 'whatsapp_analytics',
    POSTGRES_USER: process.env.POSTGRES_USER || 'whatsapp',
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'whatsapp_secure_2026',
    
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
    
    // Anti-ban: Límites de mensajes por sesión por hora
    // Para 3600 msgs/día con 10 sesiones = 60 msgs/hora/sesión
    // Para 3600 msgs/día con 15 sesiones = 40 msgs/hora/sesión (más seguro)
    MAX_MESSAGES_PER_SESSION_PER_HOUR: parseInt(process.env.MAX_MESSAGES_PER_SESSION_PER_HOUR) || 60,
    
    // Anti-ban: Delay mínimo y máximo entre mensajes (en segundos)
    // Con 60 msgs/hora = 1 cada 1 min = delay 30-60s es suficiente
    MIN_DELAY_SECONDS: parseInt(process.env.MIN_DELAY_SECONDS) || 30,
    MAX_DELAY_SECONDS: parseInt(process.env.MAX_DELAY_SECONDS) || 60,
    
    // Anti-ban: Horas de "descanso" donde no se envían mensajes (formato 24h)
    // 16 horas activas: 7am a 11pm
    QUIET_HOURS_START: parseInt(process.env.QUIET_HOURS_START) || 23,
    QUIET_HOURS_END: parseInt(process.env.QUIET_HOURS_END) || 7,
    
    // ============================================
    // WhatsApp Cloud API (Business) - HÍBRIDO
    // ============================================
    // Token de acceso permanente de Meta Business
    WHATSAPP_CLOUD_TOKEN: process.env.WHATSAPP_CLOUD_TOKEN || '',
    // ID del número de teléfono de Business
    WHATSAPP_CLOUD_PHONE_ID: process.env.WHATSAPP_CLOUD_PHONE_ID || '',
    // Versión de la API de Graph
    WHATSAPP_CLOUD_API_VERSION: process.env.WHATSAPP_CLOUD_API_VERSION || 'v18.0',
    // Límite de mensajes por hora via Cloud API
    WHATSAPP_CLOUD_MAX_PER_HOUR: parseInt(process.env.WHATSAPP_CLOUD_MAX_PER_HOUR) || 500,
    // Porcentaje de mensajes que van por Cloud API (0-100)
    // 50 = 50% Cloud API, 50% Baileys (sesiones personales)
    WHATSAPP_CLOUD_PERCENTAGE: parseInt(process.env.WHATSAPP_CLOUD_PERCENTAGE) || 50,
    // Habilitar modo híbrido (Cloud API + Baileys)
    HYBRID_MODE_ENABLED: process.env.HYBRID_MODE_ENABLED !== 'false',
    
    // ============================================
    // Webhook para recibir mensajes
    // ============================================
    // Token de verificación para el webhook (debe coincidir con el configurado en Meta)
    WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN || 'rastrear_webhook_2026',
    
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
