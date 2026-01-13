/**
 * Módulo de Cola y Consolidación de Mensajes
 * Maneja el encolado, consolidación y procesamiento por lotes
 */

const config = require('../../config');
const database = require('../../database');
const { logMessageSent } = require('./logging');

// Utilidades
const formatPhoneNumber = (phone) => {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned.startsWith('57')) cleaned = '57' + cleaned;
    return cleaned + '@s.whatsapp.net';
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Timer para el procesador de consolidación
let consolidationTimer = null;
let batchTimer = null;
let batchIntervalMinutes = config.CONSOLIDATION_INTERVAL_MINUTES || 3;

// Estas funciones serán inyectadas desde core.js para evitar dependencias circulares
let _getActiveSessions = null;
let _sendMessageWithRetry = null;
let _sendMessageWithRotation = null;

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
function addToConsolidation(phoneNumber, message) {
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return { success: false, error: 'Numero invalido' };
    }

    const result = database.enqueueMessage(formattedNumber, message);
    
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
 * Procesa todos los mensajes pendientes en BD
 * Agrupa por numero y envia con balanceo round-robin en RONDAS
 */
async function processConsolidationQueue() {
    if (!_getActiveSessions || !_sendMessageWithRetry) {
        console.error('[CONSOLIDACION] Dependencias no inyectadas');
        return;
    }

    const numbersData = database.getQueuedNumbers();
    
    if (!numbersData || numbersData.length === 0) {
        return;
    }

    const activeSessions = _getActiveSessions();
    if (activeSessions.length === 0) {
        console.error('[CONSOLIDACION] No hay sesiones activas disponibles');
        return;
    }

    console.log(`\n[CONSOLIDACION] Procesando ${numbersData.length} numeros pendientes con ${activeSessions.length} sesiones...`);
    
    const icon = config.MESSAGE_CONSOLIDATION_ICON || '';
    let numberIndex = 0;
    let roundNumber = 1;

    while (numberIndex < numbersData.length) {
        const currentActiveSessions = _getActiveSessions();
        if (currentActiveSessions.length === 0) {
            console.error('[CONSOLIDACION] No hay sesiones activas, deteniendo proceso');
            break;
        }

        console.log(`\n[RONDA ${roundNumber}] Enviando con ${currentActiveSessions.length} sesiones en paralelo...`);
        
        const sendPromises = [];
        
        for (let i = 0; i < currentActiveSessions.length && numberIndex < numbersData.length; i++) {
            const session = currentActiveSessions[i];
            const numData = numbersData[numberIndex];
            const phoneNumber = numData.phone_number;
            
            const messages = database.getMessagesForNumber(phoneNumber);
            if (!messages || messages.length === 0) {
                numberIndex++;
                continue;
            }

            const formattedMessages = messages.map(msg => {
                return `${icon} [${msg.arrived_at}]\n${msg.message}`;
            });
            
            const combinedMessage = formattedMessages.join('\n\n');
            const msgCount = messages.length;
            const messageIds = messages.map(m => m.id);

            console.log(`  → ${session.name}: ${msgCount} msgs a ${phoneNumber}`);

            const sendPromise = (async () => {
                try {
                    const formattedNumber = formatPhoneNumber(phoneNumber);
                    const result = await _sendMessageWithRetry(session, formattedNumber, combinedMessage, 3);
                    
                    if (result.success) {
                        database.markMessagesSent(messageIds);
                        // Incrementar contador de consolidados (1 por envío consolidado)
                        session.consolidatedCount = (session.consolidatedCount || 0) + 1;
                        // Incrementar contador de mensajes enviados por la cantidad de mensajes individuales
                        // (Nota: sendMessageWithRetry incrementa 1, así que agregamos msgCount - 1 adicionales)
                        session.messagesSentCount = (session.messagesSentCount || 0) + (msgCount - 1);
                        console.log(`  ✅ ${session.name}: ${msgCount} msgs → ${phoneNumber}`);
                        logMessageSent(session.name, phoneNumber, `[${msgCount} mensajes consolidados]`, 'sent');
                        return { success: true, session: session.name, phone: phoneNumber, msgCount };
                    } else {
                        console.error(`  ❌ ${session.name}: Error → ${phoneNumber}: ${result.error?.message}`);
                        return { success: false, session: session.name, phone: phoneNumber, error: result.error };
                    }
                } catch (error) {
                    console.error(`  ❌ ${session.name}: Excepción → ${phoneNumber}: ${error.message}`);
                    return { success: false, session: session.name, phone: phoneNumber, error };
                }
            })();

            sendPromises.push(sendPromise);
            numberIndex++;
        }

        if (sendPromises.length > 0) {
            const results = await Promise.all(sendPromises);
            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;
            
            console.log(`[RONDA ${roundNumber}] Completada: ${successful} exitosos, ${failed} fallidos`);
            
            if (numberIndex < numbersData.length) {
                console.log(`[ANTI-SPAM] Esperando 50 segundos antes de la siguiente ronda...`);
                await sleep(50000);
                roundNumber++;
            }
        }
    }
    
    console.log(`[CONSOLIDACION] Procesamiento completado (${roundNumber} rondas)\n`);
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
function getConsolidationStatus() {
    const numbersData = database.getQueuedNumbers();
    const stats = database.getQueueStats();
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
function queueMessage(phoneNumber, message) {
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return { success: false, error: 'Número inválido' };
    }

    logMessageSent('queue', formattedNumber, message, 'queued');
    const result = database.enqueueMessage(formattedNumber, message);
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

    const numbers = database.getQueuedNumbers();
    if (!numbers || numbers.length === 0) return;

    console.log(`\n📦 Procesando cola persistente (${numbers.length} números pendientes)...`);

    for (const number of numbers) {
        const rows = database.getMessagesForNumber(number);
        if (!rows || rows.length === 0) continue;

        const combinedMessage = rows.map(r => r.message).join('\n\n');
        console.log(`📤 Enviando lote de ${rows.length} mensajes a ${number}`);

        try {
            const result = await _sendMessageWithRotation(number, combinedMessage);
            if (result.success) {
                database.clearQueueForNumber(number);
            } else {
                console.error(`❌ Error enviando lote a ${number}, se mantiene en cola: ${result.error?.message}`);
            }
        } catch (error) {
            console.error(`❌ Error procesando lote para ${number}: ${error.message}`);
        }

        console.log(`[ANTI-SPAM] Esperando 50 segundos antes del siguiente envío...`);
        await sleep(50000);
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
function getBatchSettings() {
    const stats = database.getQueueStats();
    return {
        interval: batchIntervalMinutes,
        queueSize: stats.total,
        pendingNumbers: stats.pendingNumbers
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
    // Inyección de dependencias
    injectDependencies,
    // Utilidades
    formatPhoneNumber,
    sleep
};
