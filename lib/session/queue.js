/**
 * Módulo de Cola y Consolidación de Mensajes
 * Maneja el encolado, consolidación y procesamiento por lotes
 * Soporta modo HÍBRIDO: Cloud API + Baileys
 */

const config = require('../../config');
const database = require('../../database-postgres');
const { logMessageSent } = require('./logging');
const cloudApi = require('./whatsapp-cloud-api');

// Utilidades
const formatPhoneNumber = (phone) => {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned.startsWith('57')) cleaned = '57' + cleaned;
    return cleaned + '@s.whatsapp.net';
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Genera un delay aleatorio humanizado entre min y max segundos
 * Esto evita patrones detectables por WhatsApp
 */
const getRandomDelay = (minSeconds, maxSeconds) => {
    const min = minSeconds || config.MIN_DELAY_SECONDS || 45;
    const max = maxSeconds || config.MAX_DELAY_SECONDS || 90;
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
    // Variaciones sutiles que no afectan legibilidad
    const variations = [
        () => message + ' ', // espacio al final
        () => message + '​', // zero-width space
        () => message + '\u200B', // otro zero-width
        () => message.replace(/\./g, (m, i) => Math.random() > 0.7 ? '..' : m),
        () => message, // sin cambio
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
        const result = await cloudApi.sendTextMessage(phoneNumber, message);
        
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
}

/**
 * Agrega un mensaje a la cola de consolidacion (BD persistente)
 */
async function addToConsolidation(phoneNumber, message) {
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return { success: false, error: 'Numero invalido' };
    }

    const result = await database.enqueueMessage(formattedNumber, message);
    
    if (result.success) {
        console.log(`[CONSOLIDACION] Mensaje guardado en BD para ${formattedNumber} (${result.charCount} chars, total pendientes: ${result.total})`);
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
 * Soporta modo HÍBRIDO: 50% Cloud API + 50% Baileys (distribuido entre sesiones)
 */
async function processConsolidationQueue() {
    if (!_getActiveSessions || !_sendMessageWithRetry) {
        console.error('[CONSOLIDACION] Dependencias no inyectadas');
        return;
    }

    // Verificar si estamos en horario de descanso
    if (isQuietHours()) {
        console.log(`[ANTI-SPAM] Horario de descanso activo (${config.QUIET_HOURS_START}:00 - ${config.QUIET_HOURS_END}:00). Saltando procesamiento.`);
        return;
    }

    const numbersData = await database.getQueuedNumbers();
    
    if (!numbersData || numbersData.length === 0) {
        return;
    }

    // Verificar disponibilidad de métodos de envío
    const allActiveSessions = _getActiveSessions();
    const activeSessions = allActiveSessions.filter(s => !hasExceededHourlyLimit(s));
    const cloudApiAvailable = cloudApi.isConfigured() && cloudApi.isAvailable();
    const hybridEnabled = config.HYBRID_MODE_ENABLED && cloudApiAvailable;
    
    if (activeSessions.length === 0 && !cloudApiAvailable) {
        if (allActiveSessions.length > 0) {
            console.log(`[ANTI-SPAM] Todas las sesiones han alcanzado su límite de ${config.MAX_MESSAGES_PER_SESSION_PER_HOUR} msgs/hora. Esperando...`);
        } else {
            console.error('[CONSOLIDACION] No hay sesiones activas ni Cloud API disponible');
        }
        return;
    }

    // Calcular distribución inteligente basada en disponibilidad real
    const totalMessages = numbersData.length;
    let cloudPercentage = 0;
    let cloudCount = 0;
    let baileysCount = 0;
    
    if (cloudApiAvailable && activeSessions.length > 0) {
        // Ambos disponibles: usar distribución 50/50 (o la configurada)
        cloudPercentage = config.WHATSAPP_CLOUD_PERCENTAGE || 50;
        cloudCount = Math.floor(totalMessages * (cloudPercentage / 100));
        baileysCount = totalMessages - cloudCount;
    } else if (cloudApiAvailable && activeSessions.length === 0) {
        // Solo Cloud API disponible: 100% Cloud API
        cloudPercentage = 100;
        cloudCount = totalMessages;
        baileysCount = 0;
        console.log(`[HÍBRIDO] No hay sesiones Baileys activas, usando 100% Cloud API`);
    } else if (!cloudApiAvailable && activeSessions.length > 0) {
        // Solo Baileys disponible: 100% Baileys
        cloudPercentage = 0;
        cloudCount = 0;
        baileysCount = totalMessages;
        console.log(`[HÍBRIDO] Cloud API no disponible, usando 100% Baileys`);
    }
    
    // Mostrar estado del modo híbrido
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[CONSOLIDACION] Procesando ${totalMessages} números pendientes`);
    const apiStats = cloudApi.getStats();
    console.log(`[DISTRIBUCIÓN] ${cloudCount} Cloud API (${cloudPercentage}%) | ${baileysCount} Baileys (${100 - cloudPercentage}%)`);
    console.log(`[ESTADO] Cloud API: ${apiStats.hourlyCount}/${apiStats.hourlyLimit} msgs/hora | Baileys: ${activeSessions.length} sesiones activas`);
    if (activeSessions.length > 0) {
        console.log(`[SESIONES] ${activeSessions.map(s => s.name).join(', ')}`);
    }
    console.log(`${'='.repeat(60)}\n`);
    
    const icon = config.MESSAGE_CONSOLIDATION_ICON || '';
    let roundNumber = 1;
    
    // Separar en dos grupos: Cloud API y Baileys
    const cloudMessages = numbersData.slice(0, cloudCount);
    const baileysMessages = numbersData.slice(cloudCount);
    
    // Crear cola de tareas intercaladas: Cloud, Session1, Session2, Cloud, Session1, Session2...
    const taskQueue = [];
    let cloudIdx = 0;
    let baileysIdx = 0;
    let sessionRotation = 0;
    
    // Intercalar mensajes de forma balanceada
    while (cloudIdx < cloudMessages.length || baileysIdx < baileysMessages.length) {
        let addedThisIteration = false;
        
        // Agregar un mensaje Cloud API si hay
        if (cloudIdx < cloudMessages.length && cloudApiAvailable) {
            taskQueue.push({
                type: 'cloud',
                data: cloudMessages[cloudIdx]
            });
            cloudIdx++;
            addedThisIteration = true;
        }
        
        // Agregar un mensaje Baileys (rotando entre sesiones)
        if (baileysIdx < baileysMessages.length && activeSessions.length > 0) {
            taskQueue.push({
                type: 'baileys',
                data: baileysMessages[baileysIdx],
                session: activeSessions[sessionRotation % activeSessions.length]
            });
            baileysIdx++;
            sessionRotation++;
            addedThisIteration = true;
        }
        
        // Evitar loop infinito: si no se puede agregar nada más, salir
        if (!addedThisIteration) {
            console.log(`[CONSOLIDACION] No se pueden procesar ${baileysMessages.length - baileysIdx} mensajes de Baileys (0 sesiones activas)`);
            break;
        }
    }
    
    console.log(`[COLA] ${taskQueue.length} tareas preparadas: ${cloudIdx} Cloud + ${baileysIdx} Baileys\n`);
    
    // Procesar en rondas (máximo 1 Cloud + 1 por cada sesión por ronda)
    let taskIndex = 0;
    const maxPerRound = 1 + activeSessions.length; // 1 cloud + todas las sesiones
    
    while (taskIndex < taskQueue.length) {
        const roundTasks = taskQueue.slice(taskIndex, taskIndex + maxPerRound);
        const sendPromises = [];
        
        console.log(`[RONDA ${roundNumber}] Procesando ${roundTasks.length} mensajes...`);
        
        for (const task of roundTasks) {
            const numData = task.data;
            const phoneNumber = numData.phone_number;
            
            const messages = await database.getMessagesForNumber(phoneNumber);
            if (!messages || messages.length === 0) continue;

            // Solo incluir el mensaje, sin agregar timestamp extra
            // (el mensaje del GPS ya trae su propia hora en "Time: ...")
            const formattedMessages = messages.map(msg => {
                return `${icon}${msg.message}`;
            });
            
            const combinedMessage = formattedMessages.join('\n\n');
            const msgCount = messages.length;
            const messageIds = messages.map(m => m.id);
            
            if (task.type === 'cloud') {
                // Enviar por Cloud API
                console.log(`  ☁️ Cloud API: ${msgCount} msgs → ${phoneNumber}`);
                
                sendPromises.push((async () => {
                    try {
                        const result = await cloudApi.sendTextMessage(phoneNumber, combinedMessage);
                        
                        if (result.success) {
                            await database.markMessagesSent(messageIds);
                            console.log(`  ✅ Cloud API: ${msgCount} msgs → ${phoneNumber} ✓`);
                            logMessageSent('cloud-api', phoneNumber, combinedMessage, 'sent', null, true, msgCount);
                            return { success: true, method: 'cloud-api', phone: phoneNumber, msgCount };
                        } else {
                            console.error(`  ❌ Cloud API: Error → ${phoneNumber}: ${result.error?.message || 'Error desconocido'}`);
                            return { success: false, method: 'cloud-api', phone: phoneNumber, error: result.error };
                        }
                    } catch (error) {
                        console.error(`  ❌ Cloud API: Excepción → ${phoneNumber}: ${error.message}`);
                        return { success: false, method: 'cloud-api', phone: phoneNumber, error };
                    }
                })());
                
            } else {
                // Enviar por Baileys
                const session = task.session;
                
                // Verificar que la sesión no haya excedido límite
                if (hasExceededHourlyLimit(session)) {
                    console.log(`  ⏸️ ${session.name}: Límite horario alcanzado, saltando...`);
                    continue;
                }
                
                console.log(`  📱 ${session.name}: ${msgCount} msgs → ${phoneNumber}`);
                
                sendPromises.push((async () => {
                    try {
                        const formattedNumber = formatPhoneNumber(phoneNumber);
                        const result = await _sendMessageWithRetry(session, formattedNumber, combinedMessage, 3);
                        
                        if (result.success) {
                            await database.markMessagesSent(messageIds);
                            trackMessageSent(session);
                            session.consolidatedCount = (session.consolidatedCount || 0) + 1;
                            session.messagesSentCount = (session.messagesSentCount || 0) + msgCount;
                            console.log(`  ✅ ${session.name}: ${msgCount} msgs → ${phoneNumber} ✓`);
                            logMessageSent(session.name, phoneNumber, combinedMessage, 'sent', null, true, msgCount);
                            return { success: true, method: 'baileys', session: session.name, phone: phoneNumber, msgCount };
                        } else {
                            console.error(`  ❌ ${session.name}: Error → ${phoneNumber}: ${result.error?.message}`);
                            return { success: false, method: 'baileys', session: session.name, phone: phoneNumber, error: result.error };
                        }
                    } catch (error) {
                        console.error(`  ❌ ${session.name}: Excepción → ${phoneNumber}: ${error.message}`);
                        return { success: false, method: 'baileys', session: session.name, phone: phoneNumber, error };
                    }
                })());
            }
        }

        if (sendPromises.length > 0) {
            const results = await Promise.all(sendPromises);
            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;
            const cloudSuccess = results.filter(r => r.success && r.method === 'cloud-api').length;
            const baileysSuccess = results.filter(r => r.success && r.method === 'baileys').length;
            
            console.log(`[RONDA ${roundNumber}] ✓ ${successful} exitosos (☁️${cloudSuccess} 📱${baileysSuccess}) | ✗ ${failed} fallidos`);
            
            taskIndex += roundTasks.length;
            
            if (taskIndex < taskQueue.length) {
                const delayMs = getRandomDelay();
                console.log(`[ANTI-SPAM] Esperando ${Math.round(delayMs/1000)} segundos antes de la siguiente ronda...`);
                await sleep(delayMs);
                roundNumber++;
            }
        } else {
            taskIndex += roundTasks.length;
        }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[CONSOLIDACION] ✓ Procesamiento completado (${roundNumber} rondas)`);
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
