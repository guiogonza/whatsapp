/**
 * Módulo de Mensajería y Notificaciones
 * Maneja envío de mensajes, media y notificaciones al admin
 */

const config = require('../../config');
const { logMessageSent } = require('./logging');
const { formatPhoneNumber, sleep } = require('./utils');

// Dependencias inyectadas
let _getActiveSessions = null;
let _getCurrentSession = null;
let _sessions = {};

/**
 * Inyecta las dependencias necesarias
 */
function injectDependencies(deps) {
    _getActiveSessions = deps.getActiveSessions;
    _getCurrentSession = deps.getCurrentSession;
    _sessions = deps.sessions || {};
}

/**
 * Envía mensaje con reintentos y manejo de errores
 */
async function sendMessageWithRetry(session, phoneNumber, message, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (session.state !== config.SESSION_STATES.READY || !session.socket) {
                throw new Error('Sesión no está lista');
            }
            
            const formattedJid = phoneNumber.includes('@') 
                ? phoneNumber 
                : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;
            
            const result = await session.socket.sendMessage(formattedJid, {
                text: message
            });
            
            console.log(`✅ ${session.name}: Mensaje enviado a ${phoneNumber}`);
            return { success: true, messageResult: result };
            
        } catch (error) {
            lastError = error;
            const errorMsg = error.message || String(error);
            
            console.log(`${session.name}: Error en intento ${attempt}/${maxRetries}: ${errorMsg}`);
            
            if (attempt < maxRetries) {
                await sleep(3000 * attempt);
            }
        }
    }
    
    return { success: false, error: lastError };
}

/**
 * Envía mensaje con media (imagen, video, audio, documento)
 */
async function sendMediaMessage(session, phoneNumber, mediaBuffer, mimetype, caption = '') {
    try {
        if (session.state !== config.SESSION_STATES.READY || !session.socket) {
            throw new Error('Sesión no está lista');
        }
        
        const formattedJid = phoneNumber.includes('@') 
            ? phoneNumber 
            : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;
        
        let messageContent = {};
        
        if (mimetype.startsWith('image/')) {
            messageContent.image = mediaBuffer;
            messageContent.caption = caption;
        } else if (mimetype.startsWith('video/')) {
            messageContent.video = mediaBuffer;
            messageContent.caption = caption;
        } else if (mimetype.startsWith('audio/')) {
            messageContent.audio = mediaBuffer;
            messageContent.mimetype = mimetype;
        } else {
            messageContent.document = mediaBuffer;
            messageContent.mimetype = mimetype;
            messageContent.fileName = caption || 'documento';
        }
        
        const result = await session.socket.sendMessage(formattedJid, messageContent);
        
        console.log(`✅ ${session.name}: Media enviado a ${phoneNumber}`);
        return { success: true, messageResult: result };
        
    } catch (error) {
        console.error(`❌ ${session.name}: Error enviando media:`, error.message);
        return { success: false, error };
    }
}

/**
 * Envía mensaje usando rotación automática de sesiones
 */
async function sendMessageWithRotation(phoneNumber, message, rotation) {
    const activeSessions = rotation.getActiveSessions();

    if (activeSessions.length === 0) {
        return {
            success: false,
            error: new Error('No hay sesiones activas disponibles')
        };
    }

    const session = rotation.getNextSessionRoundRobin();
    if (!session) {
        return {
            success: false,
            error: new Error('No se pudo obtener sesión para envío')
        };
    }

    console.log(`📤 Enviando via ${session.name} (${activeSessions.length} sesiones activas)`);

    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return {
            success: false,
            error: new Error('Número de teléfono inválido')
        };
    }

    const result = await sendMessageWithRetry(session, formattedNumber, message, 3);

    if (result.success) {
        logMessageSent(session.name, formattedNumber, message, 'sent');
        session.messagesSentCount = (session.messagesSentCount || 0) + 1;

        if (!session.messages) session.messages = [];
        session.messages.push({
            timestamp: new Date(),
            to: formattedNumber,
            message: message,
            direction: 'OUT',
            status: 'sent'
        });

        session.lastActivity = new Date();

        if (session.messages.length > config.MAX_MESSAGE_HISTORY) {
            session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);
        }
    } else {
        logMessageSent(session.name, formattedNumber, message, 'failed', result.error?.message);
    }

    return { ...result, sessionUsed: session.name };
}

/**
 * Envía SMS usando API de Hablame.co
 */
async function sendSMSNotification(message) {
    if (!config.SMS_API_KEY) {
        console.log('⚠️ API Key de Hablame.co no configurada');
        return false;
    }

    const cleanMessage = message.replace(/\*/g, '').replace(/\n\n/g, '\n').substring(0, 160);

    try {
        const axios = require('axios');
        const response = await axios.post(config.SMS_API_URL, {
            messages: [{ to: config.NOTIFICATION_NUMBER, text: cleanMessage }],
            priority: true,
            sendDate: 'Now'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Hablame-Key': config.SMS_API_KEY
            }
        });

        if (response.status === 200 && response.data.statusCode === 200) {
            console.log('✅ SMS enviado exitosamente');
            return true;
        }
        return false;
    } catch (error) {
        console.log(`❌ Error enviando SMS: ${error.message}`);
        return false;
    }
}

/**
 * Envía notificación al administrador
 * IMPORTANTE: SMS solo se envía si NO hay NINGUNA sesión activa (READY)
 */
async function sendNotificationToAdmin(message) {
    const formattedNumber = formatPhoneNumber(config.NOTIFICATION_NUMBER);
    if (!formattedNumber) {
        console.log('⚠️ Número de notificación no configurado');
        return false;
    }
    
    // Verificar si hay sesiones activas usando la función inyectada
    const activeSessions = _getActiveSessions ? _getActiveSessions() : [];
    const hasActiveSessions = activeSessions.length > 0;
    
    const session = _getCurrentSession ? _getCurrentSession() : null;
    if (!session) {
        console.log('⚠️ No hay sesiones disponibles para enviar notificación');
        // SOLO enviar SMS si NO hay ninguna sesión activa
        if (!hasActiveSessions) {
            console.log('📱 Enviando SMS (no hay sesiones activas)');
            return await sendSMSNotification(message);
        } else {
            console.log('ℹ️ No se envía SMS porque hay sesiones activas');
            return false;
        }
    }
    
    try {
        const result = await sendMessageWithRetry(session, formattedNumber, message, 1);
        if (!result.success) {
            // SOLO enviar SMS si NO hay ninguna sesión activa
            if (!hasActiveSessions) {
                console.log('📱 Enviando SMS (fallo envío y no hay sesiones activas)');
                return await sendSMSNotification(message);
            } else {
                console.log('ℹ️ No se envía SMS porque hay sesiones activas');
                return false;
            }
        }
        return true;
    } catch (error) {
        console.log(`⚠️ Error enviando notificación: ${error.message}`);
        // SOLO enviar SMS si NO hay ninguna sesión activa
        if (!hasActiveSessions) {
            console.log('📱 Enviando SMS (error y no hay sesiones activas)');
            return await sendSMSNotification(message);
        } else {
            console.log('ℹ️ No se envía SMS porque hay sesiones activas');
            return false;
        }
    }
}

module.exports = {
    injectDependencies,
    sendMessageWithRetry,
    sendMediaMessage,
    sendMessageWithRotation,
    sendSMSNotification,
    sendNotificationToAdmin,
    formatPhoneNumber,  // Re-exportado desde utils para compatibilidad
    sleep  // Re-exportado desde utils para compatibilidad
};
