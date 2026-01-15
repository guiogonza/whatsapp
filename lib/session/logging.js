/**
 * Módulo de Logging de Mensajes
 * Registra mensajes enviados y recibidos en memoria y BD
 */

const database = require('../../database-postgres');

// Buffer de mensajes recientes para el monitor
let recentMessages = [];
const MAX_RECENT_MESSAGES = 100;

/**
 * Registra un mensaje enviado en el buffer del monitor y en la BD
 * @param {boolean} isConsolidated - Si el mensaje es parte de un envío consolidado
 * @param {number} msgCount - Cantidad de mensajes individuales en el consolidado
 */
function logMessageSent(sessionName, destination, message, status, errorMessage = null, isConsolidated = false, msgCount = 1) {
    const charCount = (message || '').length;

    recentMessages.unshift({
        timestamp: new Date().toISOString(),
        session: sessionName,
        destination,
        message: message.substring(0, 100),
        charCount: charCount,
        status,
        isConsolidated,
        msgCount
    });

    if (recentMessages.length > MAX_RECENT_MESSAGES) recentMessages.pop();
    
    try {
        database.logMessage(sessionName, destination, message, status, errorMessage, isConsolidated, msgCount);
    } catch (err) {
        console.error('Error guardando mensaje en BD:', err.message);
    }
}

/**
 * Registra un mensaje entrante en el buffer del monitor y en la BD
 */
function logMessageReceived(sessionName, origin, message) {
    const charCount = (message || '').length;

    recentMessages.unshift({
        timestamp: new Date().toISOString(),
        session: sessionName,
        origin,
        message: (message || '').substring(0, 100),
        charCount: charCount,
        status: 'received'
    });

    if (recentMessages.length > MAX_RECENT_MESSAGES) recentMessages.pop();

    try {
        database.logMessage(sessionName, origin, message, 'received', null);
    } catch (err) {
        console.error('Error guardando mensaje entrante en BD:', err.message);
    }
}

/**
 * Obtiene los mensajes recientes
 */
function getRecentMessages(limit = 50) {
    return recentMessages.slice(0, limit);
}

/**
 * Obtiene la fecha/hora actual en formato Colombia
 */
function getColombiaDateTime() {
    return new Date().toLocaleString('es-CO', { 
        timeZone: 'America/Bogota',
        day: '2-digit',
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

/**
 * Limpia el buffer de mensajes recientes
 */
function clearRecentMessages() {
    recentMessages = [];
}

module.exports = {
    logMessageSent,
    logMessageReceived,
    getRecentMessages,
    getColombiaDateTime,
    clearRecentMessages
};
