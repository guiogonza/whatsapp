/**
 * Módulo de Cola y Consolidación de Mensajes
 * Maneja el encolado, consolidación y procesamiento por lotes
 * Soporta modo HÍBRIDO: Cloud API + Baileys
 */

const config = require('../../config');
const database = require('../../database-postgres');
const { logMessageSent } = require('./logging');
const cloudApi = require('./whatsapp-cloud-api');
const { formatPhoneNumber, sleep } = require('./utils');

/**
 * Genera un delay aleatorio humanizado entre min y max segundos
 * Esto evita patrones detectables por WhatsApp
 */
const getRandomDelay = (minSeconds, maxSeconds) => {
    const min = minSeconds || config.MIN_DELAY_SECONDS || 30;
    const max = maxSeconds || config.MAX_DELAY_SECONDS || 60;
    const base = Math.floor(Math.random() * (max - min + 1)) + min;
    // Añadir variación adicional de ±15%
    const variation = base * (Math.random() * 0.3 - 0.15);
    return Math.floor((base + variation) * 1000);
};

/**
 * Añade variación sutil al mensaje para evitar detección de spam
 * (espacios invisibles, variaciones de puntuación, etc.)
 */
const addMessageVariation = (message) => {
    // Variaciones sutiles que no afectan legibilidad ni corrompen URLs
    const variations = [
        () => message + ' ',          // espacio al final
        () => message + '\u200B',      // zero-width space
        () => message + '\u200C',      // zero-width non-joiner
        () => message + '\u00A0',      // non-breaking space
        () => message,                 // sin cambio
    ];
    
    return variations[Math.floor(Math.random() * variations.length)]();
};

// Timer para el procesador de consolidación
let consolidationTimer = null;
let batchTimer = null;
let batchIntervalMinutes = config.CONSOLIDATION_INTERVAL_MINUTES || 3;

// Estas funciones serán inyectadas desde core.js para evitar dependencias circulares
let _getActiveSessions = null;
let _sendMessageWithRetry = null;
let _sendMessageWithRotation = null;
let _getRestingSession = null;

// Contador para intercalado híbrido
let hybridCounter = 0;

/**
 * Decide si el siguiente mensaje debe ir por Cloud API o Baileys
 * Basado en el porcentaje configurado y disponibilidad
 */
function shouldUseCloudApi() {
    // Si el modo híbrido no está habilitado, siempre usar Baileys
    if (!config.HYBRID_MODE_ENABLED) return false;
    
    // Si Cloud API no está configurada o disponible, usar Baileys
    if (!cloudApi.isConfigured() || !cloudApi.isAvailable()) return false;
    
    // Verificar si hay sesiones Baileys disponibles
    const baileysAvailable = _getActiveSessions && _getActiveSessions().length > 0;
    
    // Si no hay sesiones Baileys, forzar Cloud API
    if (!baileysAvailable) return true;
    
    // Intercalar basado en porcentaje
    const percentage = config.WHATSAPP_CLOUD_PERCENTAGE || 50;
    hybridCounter++;
    
    // Cada 100 mensajes, resetear contador
    if (hybridCounter >= 100) hybridCounter = 0;
    
    // Si percentage = 50, mensajes 0-49 van por Cloud API, 50-99 por Baileys
    return (hybridCounter % 100) < percentage;
}

/**
 * Envía mensaje usando el método híbrido (Cloud API o Baileys)
 */
async function sendMessageHybrid(phoneNumber, message, session = null) {
    const useCloudApi = shouldUseCloudApi();
    
    if (useCloudApi) {
        console.log(`☁️ [HÍBRIDO] Usando Cloud API para ${phoneNumber}`);
        // Usa sendMessage que detecta automáticamente si es alerta GPS y usa template
        const result = await cloudApi.sendMessage(phoneNumber, message);
        
        if (result.success) {
            logMessageSent('cloud-api', phoneNumber, message, 'sent');
            return { ...result, method: 'cloud-api' };
        }
        
        // Si Cloud API falla y hay sesiones Baileys, intentar con Baileys
        if (_getActiveSessions && _getActiveSessions().length > 0) {
            console.log(`⚠️ [HÍBRIDO] Cloud API falló, intentando con Baileys...`);
            // Continuar abajo con Baileys
        } else {
            return { ...result, method: 'cloud-api' };
        }
    }
    
    // Usar Baileys
    if (session && _sendMessageWithRetry) {
        console.log(`📱 [HÍBRIDO] Usando Baileys (${session.name}) para ${phoneNumber}`);
        const formattedNumber = formatPhoneNumber(phoneNumber);
        const result = await _sendMessageWithRetry(session, formattedNumber, message, 3);
        return { ...result, method: 'baileys', session: session.name };
    }
    
    return { success: false, error: new Error('No hay método de envío disponible'), method: 'none' };
}

/**
 * Inyecta las dependencias del módulo core
 */
function injectDependencies(deps) {
    _getActiveSessions = deps.getActiveSessions;
    _sendMessageWithRetry = deps.sendMessageWithRetry;
    _sendMessageWithRotation = deps.sendMessageWithRotation;
    _getRestingSession = deps.getRestingSession || null;
}

/**
 * Agrega un mensaje a la cola y lo envía inmediatamente por Cloud API
 * Si Cloud API falla, queda en cola para reintento en el timer
 */
async function addToConsolidation(phoneNumber, message) {
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return { success: false, error: 'Numero invalido' };
    }

    const result = await database.enqueueMessage(formattedNumber, message);
    
    if (result.success) {
        console.log(`[COLA] Mensaje guardado en BD para ${formattedNumber} (${result.charCount} chars)`);
        
        // Intentar envío inmediato por Cloud API
        try {
            const cloudApiAvailable = cloudApi.isConfigured() && cloudApi.isAvailable();
            const cloudApiLimitReached = cloudApi.isMonthlyLimitReached();
            
            if (cloudApiAvailable && !cloudApiLimitReached && !isQuietHours()) {
                const alertData = cloudApi.parseAlertMessage(message);
                let sendResult;
                
                if (alertData) {
                    sendResult = await cloudApi.sendAlertTemplate(formattedNumber, alertData);
                } else {
                    sendResult = await cloudApi.sendTextMessage(formattedNumber, message);
                }
                
                if (sendResult.success) {
                    await database.markMessagesSent([result.id]);
                    console.log(`[COLA] ✅ Enviado inmediatamente por Cloud API → ${formattedNumber}`);
                    // Log ÚNICO con resultado final: enviado
                    logMessageSent('cloud-api', formattedNumber, message, 'sent', null, false, 1);
                    return { 
                        success: true, 
                        sentImmediately: true,
                        method: 'cloud-api'
                    };
                } else {
                    console.log(`[COLA] ⚠️ Cloud API falló, queda en cola para reintento: ${sendResult.error?.message || 'Error'}`);
                }
            }
        } catch (err) {
            console.error(`[COLA] ⚠️ Error en envío inmediato, queda en cola: ${err.message}`);
        }
        
        // Solo loguear como 'queued' si NO se pudo enviar inmediatamente
        logMessageSent('consolidation', formattedNumber, message, 'queued');
        return { 
            success: true, 
            consolidated: true, 
            arrivedAt: result.arrivedAt,
            charCount: result.charCount,
            pendingCount: result.total,
            pendingNumbers: result.pendingNumbers,
            sendInMinutes: batchIntervalMinutes 
        };
    }
    
    return { success: false, error: result.error };
}

/**
 * Verifica si estamos en horario de descanso (quiet hours)
 */
function isQuietHours() {
    const now = new Date();
    const hour = now.getHours();
    const start = config.QUIET_HOURS_START || 23;
    const end = config.QUIET_HOURS_END || 7;
    
    if (start > end) {
        // Rango cruza medianoche (ej: 23 a 7)
        return hour >= start || hour < end;
    } else {
        // Rango normal
        return hour >= start && hour < end;
    }
}

/**
 * Verifica si una sesión ha excedido su límite por hora
 */
function hasExceededHourlyLimit(session) {
    const maxPerHour = config.MAX_MESSAGES_PER_SESSION_PER_HOUR || 15;
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Inicializar historial si no existe
    if (!session.messageTimestamps) {
        session.messageTimestamps = [];
    }
    
    // Limpiar timestamps antiguos
    session.messageTimestamps = session.messageTimestamps.filter(ts => ts > oneHourAgo);
    
    return session.messageTimestamps.length >= maxPerHour;
}

/**
 * Registra un mensaje enviado para tracking de límites
 */
function trackMessageSent(session) {
    if (!session.messageTimestamps) {
        session.messageTimestamps = [];
    }
    session.messageTimestamps.push(Date.now());
}

/**
 * Procesa todos los mensajes pendientes en BD
 * Agrupa por numero y envia con balanceo round-robin en RONDAS
 * Procesa mensajes pendientes en BD - Envía cada uno como template individual por Cloud API
 * Sin consolidación: cada alerta GPS se envía como template individual
 * Fallback a Baileys solo si Cloud API no está disponible
 */
async function processConsolidationQueue() {
    if (!_getActiveSessions || !_sendMessageWithRetry) {
        console.error('[COLA] Dependencias no inyectadas');
        return;
    }

    // Verificar si estamos en horario de descanso
    if (isQuietHours()) {
        console.log(`[ANTI-SPAM] Horario de descanso activo (${config.QUIET_HOURS_START}:00 - ${config.QUIET_HOURS_END}:00). Saltando procesamiento.`);
        return;
    }

    // Obtener TODOS los mensajes individuales pendientes (no agrupados)
    const pendingMessages = await database.getQueuedMessages(200, 'pending');
    
    if (!pendingMessages || pendingMessages.length === 0) {
        return;
    }

    // Verificar disponibilidad de Cloud API
    await cloudApi.updateMonthlyConversationsCache();
    
    const cloudApiAvailable = cloudApi.isConfigured() && cloudApi.isAvailable();
    const cloudApiAccountReady = cloudApi.isAccountReady ? cloudApi.isAccountReady() : true;
    const cloudApiLimitReached = cloudApi.isMonthlyLimitReached();
    const cloudApiReady = cloudApiAvailable && cloudApiAccountReady && !cloudApiLimitReached;
    
    // Fallback: sesiones Baileys (solo si Cloud API no disponible)
    const allActiveSessions = _getActiveSessions();
    const activeSessions = allActiveSessions.filter(s => !hasExceededHourlyLimit(s));
    
    if (cloudApiLimitReached) {
        const limitInfo = cloudApi.getMonthlyLimitInfo();
        console.log(`[COLA] 🛑 Cloud API PAUSADA: Límite mensual alcanzado (${limitInfo.current}/${limitInfo.limit} conversaciones). Usa el dashboard para continuar.`);
    }

    // Si no hay ningún método disponible, dejar en cola
    if (!cloudApiReady && activeSessions.length === 0) {
        console.log(`[COLA] ⏸️ Sin canales disponibles. ${pendingMessages.length} mensajes esperando en cola.`);
        return;
    }

    const totalMessages = pendingMessages.length;
    const method = cloudApiReady ? 'Cloud API (templates)' : `Baileys (${activeSessions.length} sesiones)`;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[COLA] Procesando ${totalMessages} mensajes individuales por ${method}`);
    const apiStats = cloudApi.getStats();
    if (cloudApiReady) {
        console.log(`[ESTADO] Cloud API: ${apiStats.hourlyCount}/${apiStats.hourlyLimit} msgs/hora`);
    }
    console.log(`${'='.repeat(60)}\n`);
    
    // Construir rondas de envío (3 mensajes en paralelo por ronda si Cloud API)
    const msgsPerRound = cloudApiReady ? 3 : activeSessions.length;
    const rounds = [];
    
    for (let i = 0; i < pendingMessages.length; i += msgsPerRound) {
        rounds.push(pendingMessages.slice(i, i + msgsPerRound));
    }
    
    console.log(`[COLA] ${totalMessages} mensajes en ${rounds.length} rondas (${msgsPerRound} por ronda)\n`);
    
    let totalSuccess = 0;
    let totalFailed = 0;
    
    for (let r = 0; r < rounds.length; r++) {
        const round = rounds[r];
        
        console.log(`[RONDA ${r + 1}/${rounds.length}] Enviando ${round.length} mensajes...`);
        
        const sendPromises = round.map((msg, idx) => (async () => {
            const phoneNumber = msg.phone_number;
            const messageText = msg.message;
            const messageId = msg.id;
            
            if (cloudApiReady) {
                // Enviar por Cloud API como template individual
                const alertData = cloudApi.parseAlertMessage(messageText);
                let sendResult;
                
                if (alertData) {
                    sendResult = await cloudApi.sendAlertTemplate(phoneNumber, alertData);
                } else {
                    sendResult = await cloudApi.sendTextMessage(phoneNumber, messageText);
                }
                
                if (sendResult.success) {
                    await database.markMessagesSent([messageId]);
                    console.log(`  ✅ ☁️ → ${phoneNumber} ✓`);
                    logMessageSent('cloud-api', phoneNumber, messageText, 'sent', null, false, 1);
                    return { success: true };
                } else {
                    console.error(`  ❌ ☁️ → ${phoneNumber}: ${sendResult.error?.message || 'Error'}`);
                    return { success: false };
                }
            } else {
                // Fallback: enviar por Baileys
                const session = activeSessions[idx % activeSessions.length];
                if (!session || hasExceededHourlyLimit(session)) {
                    return { success: false };
                }
                
                try {
                    const formattedNumber = formatPhoneNumber(phoneNumber);
                    const sendResult = await _sendMessageWithRetry(session, formattedNumber, messageText, 3);
                    
                    if (sendResult.success) {
                        await database.markMessagesSent([messageId]);
                        trackMessageSent(session);
                        console.log(`  ✅ 📱 ${session.name} → ${phoneNumber} ✓`);
                        logMessageSent(session.name, phoneNumber, messageText, 'sent', null, false, 1);
                        return { success: true };
                    } else {
                        console.error(`  ❌ 📱 ${session.name} → ${phoneNumber}: ${sendResult.error?.message}`);
                        return { success: false };
                    }
                } catch (error) {
                    console.error(`  ❌ 📱 ${session.name} → ${phoneNumber}: ${error.message}`);
                    return { success: false };
                }
            }
        })());
        
        const results = await Promise.all(sendPromises);
        const ok = results.filter(r => r.success).length;
        const fail = results.filter(r => !r.success).length;
        totalSuccess += ok;
        totalFailed += fail;
        
        console.log(`[RONDA ${r + 1}/${rounds.length}] ✓ ${ok} exitosos | ✗ ${fail} fallidos`);
        
        // Delay entre rondas
        if (r < rounds.length - 1) {
            const delayMs = cloudApiReady ? 2000 : getRandomDelay(); // Cloud API no necesita tanto delay
            console.log(`[ANTI-SPAM] Esperando ${Math.round(delayMs/1000)}s...`);
            await sleep(delayMs);
        }
    }
    
    console.log(`\n[RESUMEN] ✓ ${totalSuccess} exitosos | ✗ ${totalFailed} fallidos`);
    console.log(`${'='.repeat(60)}\n`);
}

/**
 * Inicia el procesador de consolidacion
 */
function startConsolidationProcessor() {
    if (consolidationTimer) {
        clearInterval(consolidationTimer);
    }

    const intervalMs = batchIntervalMinutes * 60 * 1000;
    console.log(`[CONSOLIDACION] Procesador iniciado (cada ${batchIntervalMinutes} minutos)`);
    
    setTimeout(() => processConsolidationQueue(), 5000);
    
    consolidationTimer = setInterval(() => {
        processConsolidationQueue();
    }, intervalMs);
}

/**
 * Obtiene el estado actual de la consolidacion desde BD
 */
async function getConsolidationStatus() {
    const numbersData = await database.getQueuedNumbers();
    const stats = await database.getQueueStats();
    const delayMinutes = batchIntervalMinutes || 3;
    
    const status = numbersData.map(num => ({
        phoneNumber: num.phone_number,
        messageCount: num.msg_count,
        firstMessage: num.first_at,
        maxWaitMinutes: delayMinutes
    }));
    
    return {
        pending: status,
        totalMessages: stats.total,
        totalNumbers: stats.pendingNumbers,
        totalChars: stats.totalChars,
        intervalMinutes: delayMinutes
    };
}

/**
 * Encola un mensaje para ser enviado en lote
 */
async function queueMessage(phoneNumber, message) {
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return { success: false, error: 'Número inválido' };
    }

    logMessageSent('queue', formattedNumber, message, 'queued');
    const result = await database.enqueueMessage(formattedNumber, message);
    console.log(`📥 Mensaje encolado (BD) para ${formattedNumber}. Total pendientes: ${result.total}`);
    return { success: true, queued: true, total: result.total, pendingNumbers: result.pendingNumbers, nextBatchIn: batchIntervalMinutes };
}

/**
 * Procesa la cola de mensajes y los envía agrupados
 */
async function processMessageQueue() {
    if (!_sendMessageWithRotation) {
        console.error('[BATCH] Dependencias no inyectadas');
        return;
    }

    const numbers = await database.getQueuedNumbers();
    if (!numbers || numbers.length === 0) return;

    console.log(`\n📦 Procesando cola persistente (${numbers.length} números pendientes)...`);

    for (const number of numbers) {
        const rows = await database.getMessagesForNumber(number);
        if (!rows || rows.length === 0) continue;

        const combinedMessage = rows.map(r => r.message).join('\n\n');
        console.log(`📤 Enviando lote de ${rows.length} mensajes a ${number}`);

        try {
            const result = await _sendMessageWithRotation(number, combinedMessage);
            if (result.success) {
                await database.clearQueueForNumber(number);
            } else {
                console.error(`❌ Error enviando lote a ${number}, se mantiene en cola: ${result.error?.message}`);
            }
        } catch (error) {
            console.error(`❌ Error procesando lote para ${number}: ${error.message}`);
        }

        const delayMs = getRandomDelay();
        console.log(`[ANTI-SPAM] Esperando ${Math.round(delayMs/1000)} segundos antes del siguiente envío...`);
        await sleep(delayMs);
    }
}

/**
 * Configura el intervalo de procesamiento por lotes
 */
function setBatchInterval(minutes) {
    const newMinutes = parseInt(minutes);
    if (isNaN(newMinutes) || newMinutes < 1 || newMinutes > 60) {
        return { success: false, error: 'El intervalo debe ser entre 1 y 60 minutos' };
    }

    batchIntervalMinutes = newMinutes;
    startBatchProcessor();
    
    console.log(`⏱️ Intervalo de envío por lotes actualizado a ${batchIntervalMinutes} minutos`);
    return { success: true, interval: batchIntervalMinutes };
}

/**
 * Inicia el procesador de lotes
 */
function startBatchProcessor() {
    if (batchTimer) {
        clearInterval(batchTimer);
    }

    console.log(`🚀 Iniciando procesador de lotes (cada ${batchIntervalMinutes} minutos)`);
    
    batchTimer = setInterval(() => {
        processMessageQueue();
    }, batchIntervalMinutes * 60 * 1000);
}

/**
 * Obtiene la configuración actual de lotes
 */
async function getBatchSettings() {
    const stats = await database.getQueueStats();
    return {
        interval: batchIntervalMinutes,
        queueSize: stats.total,
        pendingNumbers: stats.pendingNumbers
    };
}

/**
 * Obtiene el estado del modo híbrido (Cloud API + Baileys)
 */
function getHybridStatus() {
    const cloudStats = cloudApi.getStats();
    const baileysCount = _getActiveSessions ? _getActiveSessions().length : 0;
    
    return {
        enabled: config.HYBRID_MODE_ENABLED,
        cloudApi: {
            configured: cloudStats.configured,
            available: cloudStats.available,
            messagesSent: cloudStats.messagesSent,
            hourlyCount: cloudStats.hourlyCount,
            hourlyLimit: cloudStats.hourlyLimit,
            hourlyRemaining: cloudStats.hourlyRemaining
        },
        baileys: {
            activeSessions: baileysCount,
            maxPerSessionPerHour: config.MAX_MESSAGES_PER_SESSION_PER_HOUR
        },
        distribution: {
            cloudPercentage: config.WHATSAPP_CLOUD_PERCENTAGE || 50,
            baileysPercentage: 100 - (config.WHATSAPP_CLOUD_PERCENTAGE || 50)
        },
        estimatedCapacity: {
            cloudPerHour: cloudStats.available ? cloudStats.hourlyLimit : 0,
            baileysPerHour: baileysCount * (config.MAX_MESSAGES_PER_SESSION_PER_HOUR || 20),
            totalPerHour: (cloudStats.available ? cloudStats.hourlyLimit : 0) + 
                          (baileysCount * (config.MAX_MESSAGES_PER_SESSION_PER_HOUR || 20))
        }
    };
}

module.exports = {
    // Consolidación
    addToConsolidation,
    processConsolidationQueue,
    startConsolidationProcessor,
    getConsolidationStatus,
    // Cola/Batch
    queueMessage,
    processMessageQueue,
    setBatchInterval,
    startBatchProcessor,
    getBatchSettings,
    // Modo Híbrido
    getHybridStatus,
    shouldUseCloudApi,
    sendMessageHybrid,
    // Anti-spam
    isQuietHours,
    hasExceededHourlyLimit,
    trackMessageSent,
    getRandomDelay,
    addMessageVariation,
    // Inyección de dependencias
    injectDependencies,
    // Utilidades
    formatPhoneNumber,
    sleep,
    // Cloud API (re-exportar)
    cloudApi
};
