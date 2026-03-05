/**
 * Módulo de Rotación de Sesiones
 * Maneja el balanceo round-robin y rotación de sesiones activas
 * Incluye sistema de DESCANSO rotativo para evitar baneos
 */

const config = require('../../config');

// Estado de rotación
let currentSessionIndex = 0;
let lastRotationTime = new Date();
let rotationInterval = null;

// ============================================
// SISTEMA DE DESCANSO ROTATIVO
// ============================================
// Cada REST_INTERVAL_MINUTES (30 min por defecto), una sesión descansa.
// Con 3 sesiones el ciclo es:
//   Periodo 0: Sesión 0 descansa → solo envían sesiones 1 y 2
//   Periodo 1: Sesión 1 descansa → solo envían sesiones 0 y 2
//   Periodo 2: Sesión 2 descansa → solo envían sesiones 0 y 1
//   Periodo 3: TODAS activas (periodo de gracia)
//   ... repite
// ============================================
const REST_INTERVAL_MINUTES = parseInt(process.env.SESSION_REST_INTERVAL_MINUTES) || 30;
const REST_ENABLED = process.env.SESSION_REST_ENABLED !== 'false'; // Habilitado por defecto
let restRotationStartTime = Date.now();

// Referencia a sesiones (inyectada desde core)
let _sessions = {};

/**
 * Inyecta la referencia a las sesiones
 */
function injectSessions(sessions) {
    _sessions = sessions;
}

/**
 * Obtiene TODAS las sesiones Baileys activas (READY) sin filtro de descanso.
 * Excluye sesiones GPSwox y FX.
 * @returns {Array} - Array de todas las sesiones activas
 */
function getAllReadySessions() {
    const gpswoxSessionNames = config.GPSWOX_SESSION_NAMES || [config.GPSWOX_SESSION_NAME || 'gpswox-session'];
    const fxSessionNames = config.FX_SESSION_NAMES || [];
    const excludedNames = [...gpswoxSessionNames, ...fxSessionNames];
    
    return Object.keys(_sessions)
        .sort((a, b) => a.localeCompare(b))
        .map(name => _sessions[name])
        .filter(s => s.state === config.SESSION_STATES.READY && s.socket && !excludedNames.includes(s.name));
}

/**
 * Determina qué sesión está descansando en el periodo actual.
 * @returns {Object|null} - { sessionName, periodIndex, totalPeriods, minutesRemaining } o null si todas activas
 */
function getRestingSession() {
    if (!REST_ENABLED) return null;
    
    const allSessions = getAllReadySessions();
    // Solo aplicar descanso si hay 3 o más sesiones
    if (allSessions.length < 3) return null;
    
    const periodMs = REST_INTERVAL_MINUTES * 60 * 1000;
    const elapsed = Date.now() - restRotationStartTime;
    
    // Ciclo total = N periodos de descanso + 1 periodo con todas activas
    const totalPeriods = allSessions.length + 1;
    const currentPeriod = Math.floor(elapsed / periodMs) % totalPeriods;
    
    // Último periodo = todas las sesiones activas (periodo de gracia)
    if (currentPeriod >= allSessions.length) {
        return null;
    }
    
    // La sesión en el índice currentPeriod descansa
    const restingSession = allSessions[currentPeriod];
    const periodStart = Math.floor(elapsed / periodMs) * periodMs;
    const periodEnd = periodStart + periodMs;
    const msRemaining = Math.max(0, periodEnd - elapsed);
    const minutesRemaining = Math.ceil(msRemaining / 60000);
    
    return {
        sessionName: restingSession.name,
        periodIndex: currentPeriod,
        totalPeriods: totalPeriods,
        minutesRemaining: minutesRemaining,
        msRemaining: msRemaining,
        restIntervalMinutes: REST_INTERVAL_MINUTES
    };
}

/**
 * Obtiene todas las sesiones que están activas (READY) y NO están descansando.
 * Excluye sesiones GPSwox, FX, y la sesión en periodo de descanso.
 * @returns {Array} - Array de sesiones disponibles para envío
 */
function getActiveSessions() {
    const allSessions = getAllReadySessions();
    
    const restInfo = getRestingSession();
    if (!restInfo) return allSessions;
    
    // Filtrar la sesión que está descansando
    return allSessions.filter(s => s.name !== restInfo.sessionName);
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
    
    // Iniciar logger de descanso rotativo
    if (REST_ENABLED) {
        restRotationStartTime = Date.now();
        console.log(`😴 Descanso rotativo ACTIVO: cada ${REST_INTERVAL_MINUTES} min una sesión descansa`);
        
        // Log periódico del estado de descanso
        if (rotationInterval) clearInterval(rotationInterval);
        rotationInterval = setInterval(() => {
            const allReady = getAllReadySessions();
            if (allReady.length < 3) return;
            
            const restInfo = getRestingSession();
            if (restInfo) {
                console.log(`😴 [DESCANSO] ${restInfo.sessionName} descansando (${restInfo.minutesRemaining} min restantes) | Activas: ${getActiveSessions().map(s => s.name).join(', ')}`);
            } else {
                console.log(`✅ [DESCANSO] Todas las sesiones activas (periodo de gracia) | ${allReady.map(s => s.name).join(', ')}`);
            }
        }, 5 * 60 * 1000); // Log cada 5 minutos
    }
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
 * Obtiene información sobre la rotación actual (incluye info de descanso)
 */
function getRotationInfo() {
    const activeSessions = getActiveSessions();
    const allReady = getAllReadySessions();
    const currentSession = getCurrentSession();
    const restInfo = getRestingSession();
    
    return {
        currentSession: currentSession?.name || null,
        currentIndex: currentSessionIndex,
        totalActiveSessions: activeSessions.length,
        totalReadySessions: allReady.length,
        activeSessions: activeSessions.map(s => s.name),
        allReadySessions: allReady.map(s => s.name),
        lastRotation: lastRotationTime.toISOString(),
        rotationIntervalMinutes: config.SESSION_ROTATION_INTERVAL,
        nextRotation: new Date(lastRotationTime.getTime() + config.SESSION_ROTATION_INTERVAL * 60 * 1000).toISOString(),
        loadBalancingEnabled: config.LOAD_BALANCING_ENABLED,
        balancingMode: config.LOAD_BALANCING_ENABLED ? 'round-robin-per-message' : 'time-based',
        // Info de descanso rotativo
        rest: {
            enabled: REST_ENABLED,
            intervalMinutes: REST_INTERVAL_MINUTES,
            restingSession: restInfo ? restInfo.sessionName : null,
            currentPeriod: restInfo ? restInfo.periodIndex : (allReady.length >= 3 ? allReady.length : -1),
            totalPeriods: allReady.length >= 3 ? allReady.length + 1 : 0,
            minutesRemaining: restInfo ? restInfo.minutesRemaining : 0,
            msRemaining: restInfo ? restInfo.msRemaining : 0,
            description: restInfo 
                ? `${restInfo.sessionName} descansando (${restInfo.minutesRemaining} min restantes)`
                : (allReady.length >= 3 ? 'Todas las sesiones activas (periodo de gracia)' : 'Descanso no aplicable (< 3 sesiones)')
        }
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
    getAllReadySessions,
    getCurrentSession,
    rotateSession,
    getNextSessionRoundRobin,
    startSessionRotation,
    stopSessionRotation,
    getRotationInfo,
    getRestingSession,
    resetRotationIndex,
    getCurrentIndex,
    setCurrentIndex
};
