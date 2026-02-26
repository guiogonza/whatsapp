/**
 * Módulo de Rotación de Sesiones
 * Maneja el balanceo round-robin y rotación de sesiones activas
 */

const config = require('../../config');

// Estado de rotación
let currentSessionIndex = 0;
let lastRotationTime = new Date();
let rotationInterval = null;

// Referencia a sesiones (inyectada desde core)
let _sessions = {};

/**
 * Inyecta la referencia a las sesiones
 */
function injectSessions(sessions) {
    _sessions = sessions;
}

/**
 * Obtiene todas las sesiones que están activas (READY)
 * Excluye sesiones GPSwox (solo para registro de vehículos) y FX (solo para reenvío de alertas MT5)
 * @returns {Array} - Array de sesiones activas
 */
function getActiveSessions() {
    const gpswoxSessionNames = config.GPSWOX_SESSION_NAMES || [config.GPSWOX_SESSION_NAME || 'gpswox-session'];
    const fxSessionNames = config.FX_SESSION_NAMES || [];
    const excludedNames = [...gpswoxSessionNames, ...fxSessionNames];
    
    return Object.keys(_sessions)
        .sort((a, b) => a.localeCompare(b))
        .map(name => _sessions[name])
        .filter(s => s.state === config.SESSION_STATES.READY && s.socket && !excludedNames.includes(s.name));
}

/**
 * Obtiene la sesión activa actual para envío de mensajes
 * @returns {Object|null} - Sesión activa o null
 */
function getCurrentSession() {
    const activeSessions = getActiveSessions();
    if (activeSessions.length === 0) return null;
    
    if (currentSessionIndex >= activeSessions.length) {
        currentSessionIndex = 0;
    }
    
    return activeSessions[currentSessionIndex];
}

/**
 * Rota a la siguiente sesión activa
 */
function rotateSession() {
    const activeSessions = getActiveSessions();
    if (activeSessions.length <= 1) return;
    
    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;
    lastRotationTime = new Date();
}

/**
 * Obtiene la siguiente sesión usando balanceo round-robin
 * @returns {Object|null} - Sesión para usar o null
 */
function getNextSessionRoundRobin() {
    const activeSessions = getActiveSessions();
    if (activeSessions.length === 0) return null;
    
    if (currentSessionIndex >= activeSessions.length) {
        currentSessionIndex = 0;
    }
    
    const session = activeSessions[currentSessionIndex];
    
    // Rotar al siguiente índice para el próximo mensaje
    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;
    lastRotationTime = new Date();
    
    return session;
}

/**
 * Inicia el intervalo de rotación automática de sesiones
 */
function startSessionRotation() {
    console.log('🔄 Balanceo round-robin activo: cada mensaje usa una sesión diferente');
}

/**
 * Detiene el intervalo de rotación
 */
function stopSessionRotation() {
    if (rotationInterval) {
        clearInterval(rotationInterval);
        rotationInterval = null;
    }
}

/**
 * Obtiene información sobre la rotación actual
 */
function getRotationInfo() {
    const activeSessions = getActiveSessions();
    const currentSession = getCurrentSession();
    
    return {
        currentSession: currentSession?.name || null,
        currentIndex: currentSessionIndex,
        totalActiveSessions: activeSessions.length,
        activeSessions: activeSessions.map(s => s.name),
        lastRotation: lastRotationTime.toISOString(),
        rotationIntervalMinutes: config.SESSION_ROTATION_INTERVAL,
        nextRotation: new Date(lastRotationTime.getTime() + config.SESSION_ROTATION_INTERVAL * 60 * 1000).toISOString(),
        loadBalancingEnabled: config.LOAD_BALANCING_ENABLED,
        balancingMode: config.LOAD_BALANCING_ENABLED ? 'round-robin-per-message' : 'time-based'
    };
}

/**
 * Reinicia el índice de rotación
 */
function resetRotationIndex() {
    currentSessionIndex = 0;
    lastRotationTime = new Date();
}

/**
 * Obtiene el índice actual de rotación
 */
function getCurrentIndex() {
    return currentSessionIndex;
}

/**
 * Establece el índice de rotación
 */
function setCurrentIndex(index) {
    currentSessionIndex = index;
}

module.exports = {
    injectSessions,
    getActiveSessions,
    getCurrentSession,
    rotateSession,
    getNextSessionRoundRobin,
    startSessionRotation,
    stopSessionRotation,
    getRotationInfo,
    resetRotationIndex,
    getCurrentIndex,
    setCurrentIndex
};
