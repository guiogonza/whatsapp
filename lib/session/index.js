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
    sendMessageWithRotation: (phone, msg) => messaging.sendMessageWithRotation(phone, msg, rotation)
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
    
    // Rotación
    getActiveSessions: rotation.getActiveSessions,
    getCurrentSession: rotation.getCurrentSession,
    rotateSession: rotation.rotateSession,
    startSessionRotation: rotation.startSessionRotation,
    stopSessionRotation: rotation.stopSessionRotation,
    getRotationInfo: rotation.getRotationInfo,
    
    // Mensajería
    sendMessageWithRetry: messaging.sendMessageWithRetry,
    sendMessageWithRotation,
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
