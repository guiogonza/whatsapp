/**
 * Session Manager - Módulo Principal
 * Gestiona sesiones de WhatsApp usando Baileys
 * 
 * Este módulo exporta todas las funciones necesarias manteniendo
 * compatibilidad con el código existente.
 */

// Importar módulos
const proxy = require('./proxy');
const logging = require('./logging');
const queue = require('./queue');
const rotation = require('./rotation');
const messaging = require('./messaging');
const core = require('./core');

// Inicializar proxy al cargar
proxy.initProxy();

// Inyectar dependencias entre módulos
queue.injectDependencies({
    getActiveSessions: rotation.getActiveSessions,
    sendMessageWithRetry: messaging.sendMessageWithRetry,
    sendMessageWithRotation: (phone, msg) => messaging.sendMessageWithRotation(phone, msg, rotation),
    getRestingSession: rotation.getRestingSession
});

messaging.injectDependencies({
    getActiveSessions: rotation.getActiveSessions,
    getCurrentSession: rotation.getCurrentSession,
    sessions: core.sessions
});

/**
 * Wrapper para sendMessageWithRotation que incluye rotation
 */
function sendMessageWithRotation(phoneNumber, message) {
    return messaging.sendMessageWithRotation(phoneNumber, message, rotation);
}

/**
 * Enviar mensaje inmediatamente por sesión FX
 * @param {string} phoneNumber - Número de teléfono destino
 * @param {string} message - Mensaje a enviar
 * @returns {Promise<Object>} Resultado del envío
 */
async function sendViaFX(phoneNumber, message) {
    const config = require('../../config');
    const fxSession = require('./fx-session');
    
    // Obtener nombres de sesiones FX
    const fxSessionNames = fxSession.getFXSessionNames();
    
    if (fxSessionNames.length === 0) {
        return {
            success: false,
            error: 'No hay sesiones FX configuradas'
        };
    }
    
    // Buscar una sesión FX disponible y conectada
    for (const fxName of fxSessionNames) {
        const fxSessionObj = core.getSession(fxName);
        if (fxSessionObj && fxSessionObj.socket && fxSessionObj.state === config.SESSION_STATES.READY) {
            console.log(`🎯 Enviando inmediatamente por ${fxName}`);
            
            try {
                const result = await messaging.sendMessageWithRetry(
                    fxSessionObj,    // Pasar el objeto session completo, no solo el socket
                    phoneNumber,
                    message,
                    3                // maxRetries
                );
                
                // Incrementar contadores y registrar envío
                if (result.success) {
                    fxSessionObj.messagesSentCount = (fxSessionObj.messagesSentCount || 0) + 1;
                    fxSessionObj.lastActivity = new Date();
                    if (!fxSessionObj.messageTimestamps) fxSessionObj.messageTimestamps = [];
                    fxSessionObj.messageTimestamps.push(Date.now());
                }
                
                return {
                    success: result.success,
                    fxSession: fxName,
                    result: result
                };
            } catch (error) {
                console.log(`❌ Error enviando por ${fxName}: ${error.message}`);
                continue; // Intentar con la siguiente sesión FX
            }
        }
    }
    
    return {
        success: false,
        error: 'Ninguna sesión FX está disponible o conectada'
    };
}

// ======================== EXPORTACIONES ========================

module.exports = {
    // Sesiones Core
    createSession: core.createSession,
    loadSessionsFromDisk: core.loadSessionsFromDisk,
    closeSession: core.closeSession,
    deleteSessionData: core.deleteSessionData,
    getSession: core.getSession,
    getAllSessions: core.getAllSessions,
    getSessionsStatus: core.getSessionsStatus,
    getQRCode: core.getQRCode,
    runStaleSessionCleaner: core.runStaleSessionCleaner,
    reconnectSession: core.reconnectSession,
    reconnectAllSessions: core.reconnectAllSessions,
    
    // Rotación
    getActiveSessions: rotation.getActiveSessions,
    getAllReadySessions: rotation.getAllReadySessions,
    getCurrentSession: rotation.getCurrentSession,
    rotateSession: rotation.rotateSession,
    startSessionRotation: rotation.startSessionRotation,
    stopSessionRotation: rotation.stopSessionRotation,
    getRotationInfo: rotation.getRotationInfo,
    getRestingSession: rotation.getRestingSession,
    
    // Mensajería
    sendMessageWithRetry: messaging.sendMessageWithRetry,
    sendMessageWithRotation,
    sendViaFX,
    sendMediaMessage: messaging.sendMediaMessage,
    sendNotificationToAdmin: messaging.sendNotificationToAdmin,
    
    // Logging
    getRecentMessages: logging.getRecentMessages,
    logMessageSent: logging.logMessageSent,
    logMessageReceived: logging.logMessageReceived,
    
    // Cola/Batch
    queueMessage: queue.queueMessage,
    setBatchInterval: queue.setBatchInterval,
    getBatchSettings: queue.getBatchSettings,
    startBatchProcessor: queue.startBatchProcessor,
    
    // Consolidación
    addToConsolidation: queue.addToConsolidation,
    processConsolidationQueue: queue.processConsolidationQueue,
    startConsolidationProcessor: queue.startConsolidationProcessor,
    getConsolidationStatus: queue.getConsolidationStatus,
    
    // Modo Híbrido (Cloud API + Baileys)
    getHybridStatus: queue.getHybridStatus,
    shouldUseCloudApi: queue.shouldUseCloudApi,
    sendMessageHybrid: queue.sendMessageHybrid,
    cloudApi: queue.cloudApi,
    
    // Proxy
    getProxyStatus: proxy.getProxyStatus,
    getSessionProxyAssignments: proxy.getSessionProxyAssignments,
    
    // Conversación IA Anti-Ban
    setActiveConversationPhones: core.setActiveConversationPhones,
    clearActiveConversationPhones: core.clearActiveConversationPhones,
    isActiveConversationPhone: core.isActiveConversationPhone
};
