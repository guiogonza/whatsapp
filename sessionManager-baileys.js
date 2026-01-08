/**

 * Gestor de Sesiones de WhatsApp usando Baileys

 * Maneja la creaciï¿½?ï¿½?ï¿½?Â³n, rotaciï¿½?ï¿½?ï¿½?Â³n y monitoreo de sesiones

 */



const makeWASocket = require('@whiskeysockets/baileys').default;

const { 

    useMultiFileAuthState, 

    DisconnectReason, 

    makeInMemoryStore,

    delay,

    getAggregateVotesInPollMessage,

    makeCacheableSignalKeyStore,

    fetchLatestBaileysVersion

} = require('@whiskeysockets/baileys');

const { SocksProxyAgent } = require('socks-proxy-agent');
const net = require('net');

// Configurar proxy si está disponible
const PROXY_URL = process.env.ALL_PROXY || process.env.SOCKS_PROXY || null;
let proxyAgent = null;
let proxyAvailable = false;
let lastProxyCheck = 0;
const PROXY_CHECK_INTERVAL = 30 * 1000; // Verificar cada 30 segundos

/**
 * Verifica si el servidor proxy SOCKS5 está disponible
 * @returns {Promise<boolean>}
 */
async function checkProxyAvailability() {
    if (!PROXY_URL) return false;
    
    try {
        // Extraer host y puerto del URL del proxy
        const proxyMatch = PROXY_URL.match(/socks5?:\/\/([^:]+):(\d+)/);
        if (!proxyMatch) {
            console.log('⚠️ URL de proxy inválida:', PROXY_URL);
            return false;
        }
        
        const [, host, port] = proxyMatch;
        
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(3000); // 3 segundos de timeout
            
            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });
            
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.connect(parseInt(port), host);
        });
    } catch (error) {
        return false;
    }
}

/**
 * Obtiene el agente de proxy si está disponible, null si no
 * @returns {Promise<SocksProxyAgent|null>}
 */
async function getProxyAgent() {
    if (!PROXY_URL) return null;
    
    const now = Date.now();
    
    // Verificar disponibilidad del proxy periódicamente
    if (now - lastProxyCheck > PROXY_CHECK_INTERVAL) {
        lastProxyCheck = now;
        const wasAvailable = proxyAvailable;
        proxyAvailable = await checkProxyAvailability();
        
        if (proxyAvailable && !wasAvailable) {
            console.log('✅ Proxy SOCKS5 conectado:', PROXY_URL, '(IP Colombia)');
            proxyAgent = new SocksProxyAgent(PROXY_URL);
        } else if (!proxyAvailable && wasAvailable) {
            console.log('⚠️ Proxy SOCKS5 desconectado, usando IP del VPS');
            proxyAgent = null;
        }
    }
    
    return proxyAvailable ? proxyAgent : null;
}

// Verificación inicial del proxy
(async () => {
    if (PROXY_URL) {
        console.log('🔍 Verificando disponibilidad del proxy:', PROXY_URL);
        proxyAvailable = await checkProxyAvailability();
        if (proxyAvailable) {
            proxyAgent = new SocksProxyAgent(PROXY_URL);
            console.log('✅ Proxy SOCKS5 disponible:', PROXY_URL, '(IP Colombia)');
        } else {
            console.log('⚠️ Proxy SOCKS5 no disponible, usando IP del VPS directamente');
        }
    } else {
        console.log('ℹ️ Sin proxy configurado, usando IP del VPS directamente');
    }
})();

const pino = require('pino');

const fs = require('fs').promises;

const fsSync = require('fs');

const path = require('path');

const qrcode = require('qrcode');

const config = require('./config');

const database = require('./database');

// Utilidades simples
const formatPhoneNumber = (phone) => {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned.startsWith('57')) cleaned = '57' + cleaned;
    return cleaned + '@s.whatsapp.net';
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getColombiaDate = () => {
    return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
};



// Almacï¿½?ï¿½?ï¿½?Â©n de sesiones

const sessions = {};



// ï¿½?ï¿½?ï¿½?Ândice de sesiï¿½?ï¿½?ï¿½?Â³n activa para rotaciï¿½?ï¿½?ï¿½?Â³n

let currentSessionIndex = 0;

let lastRotationTime = new Date();

let rotationInterval = null;



// Buffer de mensajes recientes para el monitor

let recentMessages = [];

const MAX_RECENT_MESSAGES = 100;

// Tracking de sesiones en uso manual (humano escribiendo desde celular)
const manualUseSessions = new Map(); // sessionName -> { lastActivity: timestamp, timeout: timeoutId }
const MANUAL_USE_TIMEOUT = 5 * 60 * 1000; // 5 minutos de inactividad para considerar que dejó de usar manualmente

// Tracking de respuestas automáticas por conversación
const autoResponseCounters = new Map(); // conversationKey -> { count: number, lastActivity: timestamp }



// Cola persistente manejada via BD - usa config para el intervalo

let batchIntervalMinutes = config.CONSOLIDATION_INTERVAL_MINUTES || 3;
let batchTimer = null;
const DISCONNECT_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
const lastDisconnectNotify = new Map();


/**

 * Registra un mensaje enviado en el buffer del monitor y en la BD

 */

function logMessageSent(sessionName, destination, message, status, errorMessage = null) {

    // Calcular cantidad de caracteres
    const charCount = (message || '').length;

    // Guardar en buffer de memoria para el monitor

    recentMessages.unshift({

        timestamp: new Date().toISOString(),

        session: sessionName,

        destination,

        message: message.substring(0, 100),

        charCount: charCount,

        status

    });

    if (recentMessages.length > MAX_RECENT_MESSAGES) recentMessages.pop();

    

    // Guardar en base de datos para analytics

    try {

        database.logMessage(sessionName, destination, message, status, errorMessage);

    } catch (err) {

        console.error('Error guardando mensaje en BD:', err.message);

    }

}



/**

 * Registra un mensaje entrante en el buffer del monitor y en la BD

 */

function logMessageReceived(sessionName, origin, message) {

    // Calcular cantidad de caracteres
    const charCount = (message || '').length;

    // Guardar en buffer de memoria para el monitor

    recentMessages.unshift({

        timestamp: new Date().toISOString(),

        session: sessionName,

        origin,

        message: (message || '').substring(0, 100),

        charCount: charCount,

        status: 'received'

    });

    if (recentMessages.length > MAX_RECENT_MESSAGES) recentMessages.pop();



    // Guardar en base de datos para analytics

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




// ======================== CONSOLIDACION DE MENSAJES CON BD (PERSISTENTE) ========================

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

// Timer para el procesador de consolidación
let consolidationTimer = null;

/**
 * Agrega un mensaje a la cola de consolidacion (BD persistente)
 * Los mensajes se guardan con arrived_at y se procesan cada X minutos
 */
function addToConsolidation(phoneNumber, message) {
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return { success: false, error: 'Numero invalido' };
    }

    // Guardar en BD con hora de llegada
    const result = database.enqueueMessage(formattedNumber, message);
    
    if (result.success) {
        console.log(`[CONSOLIDACION] Mensaje guardado en BD para ${formattedNumber} (${result.charCount} chars, total pendientes: ${result.total})`);
        
        // Registrar en monitor como 'queued'
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
 * Cada ronda envia 1 mensaje por sesion en paralelo, luego espera 50s
 */
async function processConsolidationQueue() {
    const numbersData = database.getQueuedNumbers();
    
    if (!numbersData || numbersData.length === 0) {
        return;
    }

    const activeSessions = getActiveSessions();
    if (activeSessions.length === 0) {
        console.error('[CONSOLIDACION] No hay sesiones activas disponibles');
        return;
    }

    console.log(`\n[CONSOLIDACION] Procesando ${numbersData.length} numeros pendientes con ${activeSessions.length} sesiones...`);
    
    const icon = config.MESSAGE_CONSOLIDATION_ICON || '';
    let numberIndex = 0;
    let roundNumber = 1;

    // Procesar en rondas: cada ronda usa todas las sesiones en paralelo
    while (numberIndex < numbersData.length) {
        const currentActiveSessions = getActiveSessions(); // Re-verificar sesiones activas
        if (currentActiveSessions.length === 0) {
            console.error('[CONSOLIDACION] No hay sesiones activas, deteniendo proceso');
            break;
        }

        console.log(`\n[RONDA ${roundNumber}] Enviando con ${currentActiveSessions.length} sesiones en paralelo...`);
        
        // Preparar envíos paralelos (1 por sesión)
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

            // Formatear mensajes consolidados
            const formattedMessages = messages.map(msg => {
                return `${icon} [${msg.arrived_at}]\n${msg.message}`;
            });
            
            const combinedMessage = formattedMessages.join('\n\n');
            const msgCount = messages.length;
            const messageIds = messages.map(m => m.id);

            console.log(`  → ${session.name}: ${msgCount} msgs a ${phoneNumber}`);

            // Crear promesa de envío
            const sendPromise = (async () => {
                try {
                    const formattedNumber = formatPhoneNumber(phoneNumber);
                    const result = await sendMessageWithRetry(session, formattedNumber, combinedMessage, 3);
                    
                    if (result.success) {
                        database.markMessagesSent(messageIds);
                        console.log(`  ✅ ${session.name}: ${msgCount} msgs → ${phoneNumber}`);
                        logMessageSent(session.name, phoneNumber, `[${msgCount} mensajes consolidados]`, 'sent');
                        return { success: true, session: session.name, phone: phoneNumber };
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

        // Ejecutar todos los envíos de esta ronda en paralelo
        if (sendPromises.length > 0) {
            const results = await Promise.all(sendPromises);
            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;
            
            console.log(`[RONDA ${roundNumber}] Completada: ${successful} exitosos, ${failed} fallidos`);
            
            // Delay de 50 segundos entre rondas (no entre mensajes individuales)
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
    
    // Procesar inmediatamente si hay pendientes al iniciar
    setTimeout(() => processConsolidationQueue(), 5000);
    
    // Luego cada X minutos
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

// ======================== PROCESAMIENTO POR LOTES (BATCH) ========================



/**

 * Encola un mensaje para ser enviado en lote

 */

function queueMessage(phoneNumber, message) {

    const formattedNumber = formatPhoneNumber(phoneNumber);

    if (!formattedNumber) {

        return { success: false, error: 'Nï¿½?ï¿½?ï¿½?Âºmero invï¿½?ï¿½?ï¿½?Â¡lido' };

    }

    // Registrar en monitor inmediatamente como 'queued'

    logMessageSent('queue', formattedNumber, message, 'queued');

    // Persistir en BD

    const result = database.enqueueMessage(formattedNumber, message);

    console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?Â¥ Mensaje encolado (BD) para ${formattedNumber}. Total pendientes: ${result.total}`);

    return { success: true, queued: true, total: result.total, pendingNumbers: result.pendingNumbers, nextBatchIn: batchIntervalMinutes };

}



/**

 * Procesa la cola de mensajes y los envï¿½?ï¿½?ï¿½?Â­a agrupados

 */

async function processMessageQueue() {

    const numbers = database.getQueuedNumbers();

    if (!numbers || numbers.length === 0) return;



    console.log(`\nï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?Â¦ Procesando cola persistente (${numbers.length} nï¿½?ï¿½?ï¿½?Âºmeros pendientes)...`);



    for (const number of numbers) {

        const rows = database.getMessagesForNumber(number);

        if (!rows || rows.length === 0) continue;



        const combinedMessage = rows.map(r => r.message).join('\n\n');

        console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?Â¤ Enviando lote de ${rows.length} mensajes a ${number}`);



        try {

            const result = await sendMessageWithRotation(number, combinedMessage);

            if (result.success) {

                database.clearQueueForNumber(number);

            } else {

                console.error(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? Error enviando lote a ${number}, se mantiene en cola: ${result.error?.message}`);

            }

        } catch (error) {

            console.error(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? Error procesando lote para ${number}: ${error.message}`);

        }



        // Delay de 50 segundos entre mensajes para evitar spam (2000 msgs/día = 1 cada 43s, usamos 50s de seguridad)
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

    

    console.log(`ï¿½?Â¢ï¿½?Âï¿½?Â±ï¿½?Â¯ï¿½?Â¸ï¿½?Â Intervalo de envï¿½?ï¿½?ï¿½?Â­o por lotes actualizado a ${batchIntervalMinutes} minutos`);

    return { success: true, interval: batchIntervalMinutes };

}



/**

 * Inicia el procesador de lotes

 */

function startBatchProcessor() {

    if (batchTimer) {

        clearInterval(batchTimer);

    }



    console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Iniciando procesador de lotes (cada ${batchIntervalMinutes} minutos)`);

    

    batchTimer = setInterval(() => {

        processMessageQueue();

    }, batchIntervalMinutes * 60 * 1000);

}



/**

 * Obtiene la configuraciï¿½?ï¿½?ï¿½?Â³n actual de lotes

 */

function getBatchSettings() {

    const stats = database.getQueueStats();

    return {

        interval: batchIntervalMinutes,

        queueSize: stats.total,

        pendingNumbers: stats.pendingNumbers

    };

}



// ======================== FUNCIONES DE ROTACIï¿½?ï¿½?ï¿½?ï¿½?N ========================



/**

 * Obtiene todas las sesiones que estï¿½?ï¿½?ï¿½?Â¡n activas (READY)

 * @returns {Array} - Array de sesiones activas

 */

function getActiveSessions() {

    // Orden estable por nombre para balanceo predecible

    return Object.keys(sessions)

        .sort((a, b) => a.localeCompare(b))

        .map(name => sessions[name])

        .filter(s => s.state === config.SESSION_STATES.READY && s.socket);

}



/**

 * Obtiene la sesiï¿½?ï¿½?ï¿½?Â³n activa actual para envï¿½?ï¿½?ï¿½?Â­o de mensajes

 * @returns {Object|null} - Sesiï¿½?ï¿½?ï¿½?Â³n activa o null

 */

function getCurrentSession() {

    const activeSessions = getActiveSessions();

    if (activeSessions.length === 0) return null;

    

    // Asegurar que el ï¿½?ï¿½?ï¿½?Â­ndice estï¿½?ï¿½?ï¿½?Â© dentro del rango

    if (currentSessionIndex >= activeSessions.length) {

        currentSessionIndex = 0;

    }

    

    return activeSessions[currentSessionIndex];

}



/**

 * Rota a la siguiente sesiï¿½?ï¿½?ï¿½?Â³n activa

 */

function rotateSession() {

    // Funciï¿½?ï¿½?ï¿½?Â³n mantenida por compatibilidad, pero el balanceo es automï¿½?ï¿½?ï¿½?Â¡tico

    const activeSessions = getActiveSessions();

    if (activeSessions.length <= 1) return;

    

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();

}



/**

 * Inicia el intervalo de rotaciï¿½?ï¿½?ï¿½?Â³n automï¿½?ï¿½?ï¿½?Â¡tica de sesiones

 */

function startSessionRotation() {

    console.log('ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Balanceo round-robin activo: cada mensaje usa una sesiï¿½?ï¿½?ï¿½?Â³n diferente');

    // Ya no usamos rotaciï¿½?ï¿½?ï¿½?Â³n por tiempo, solo round-robin por mensaje

}



/**

 * Detiene el intervalo de rotaciï¿½?ï¿½?ï¿½?Â³n

 */

function stopSessionRotation() {

    if (rotationInterval) {

        clearInterval(rotationInterval);

        rotationInterval = null;

    }

}



/**

 * Obtiene informaciï¿½?ï¿½?ï¿½?Â³n sobre la rotaciï¿½?ï¿½?ï¿½?Â³n actual

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



// ======================== CREACIï¿½?ï¿½?ï¿½?ï¿½?N DE SESIONES ========================



/**

 * Carga todas las sesiones existentes en el disco

 */

async function loadSessionsFromDisk() {

    try {

        // Asegurar que el directorio existe

        await fs.mkdir(config.SESSION_DATA_PATH, { recursive: true });

        

        const files = await fs.readdir(config.SESSION_DATA_PATH);

        console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Buscando sesiones en ${config.SESSION_DATA_PATH}...`);

        

        let loadedCount = 0;

        

        for (const file of files) {

            // Ignorar archivos ocultos o que no sean carpetas

            if (file.startsWith('.')) continue;

            

            const fullPath = path.join(config.SESSION_DATA_PATH, file);

            try {

                const stat = await fs.stat(fullPath);

                

                if (stat.isDirectory()) {

                    // Verificar si tiene creds.json (indicador de sesiï¿½?ï¿½?ï¿½?Â³n vï¿½?ï¿½?ï¿½?Â¡lida)

                    const credsPath = path.join(fullPath, 'creds.json');

                    try {

                        await fs.access(credsPath);

                        console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Cargando sesiï¿½?ï¿½?ï¿½?Â³n encontrada: ${file}`);

                        await createSession(file);

                        loadedCount++;

                    } catch (e) {

                        console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â Carpeta ${file} ignorada (no tiene credenciales vï¿½?ï¿½?ï¿½?Â¡lidas). Eliminando...`);

                        try {

                            await fs.rm(fullPath, { recursive: true, force: true });

                            console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?Â¯ï¿½?Â¸ï¿½?Â Carpeta invï¿½?ï¿½?ï¿½?Â¡lida ${file} eliminada`);

                        } catch (delErr) {

                            console.error(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? Error eliminando carpeta invï¿½?ï¿½?ï¿½?Â¡lida ${file}:`, delErr.message);

                        }

                    }

                }

            } catch (err) {

                console.error(`Error procesando ${file}:`, err.message);

            }

        }

        

        console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?ï¿½? Se cargaron ${loadedCount} sesiones del disco`);

        return loadedCount;

    } catch (error) {

        console.error('ï¿½?Â¢ï¿½?Âï¿½?ï¿½? Error cargando sesiones del disco:', error.message);

        return 0;

    }

}



/**

 * Crea una nueva sesiï¿½?ï¿½?ï¿½?Â³n de WhatsApp con Baileys

 */

async function createSession(sessionName) {

    console.log(`\nï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Iniciando sesiï¿½?ï¿½?ï¿½?Â³n ${sessionName} con Baileys...`);

    

    if (sessions[sessionName]) {

        console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â La sesiï¿½?ï¿½?ï¿½?Â³n ${sessionName} ya existe`);

        return sessions[sessionName];

    }

    

    try {

        // Crear directorio de autenticaciï¿½?ï¿½?ï¿½?Â³n

        const authPath = path.join(config.SESSION_DATA_PATH, sessionName);

        await fs.mkdir(authPath, { recursive: true });

        

        // Crear estado de autenticaciï¿½?ï¿½?ï¿½?Â³n

        const { state, saveCreds } = await useMultiFileAuthState(authPath);

        

        // Obtener la versiï¿½?ï¿½?ï¿½?Â³n mï¿½?ï¿½?ï¿½?Â¡s reciente de Baileys

        const { version, isLatest } = await fetchLatestBaileysVersion();

        console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?Â± Usando WA v${version.join('.')}, isLatest: ${isLatest}`);

        

        // Crear logger con nivel debug para diagnosticar

        const logger = pino({ level: 'debug' });

        

        // Crear socket de WhatsApp

        const socketConfig = {

            version,

            logger,

            printQRInTerminal: false,

            browser: ['WhatsApp Bot', 'Chrome', '10.0'],

            auth: {

                creds: state.creds,

                keys: makeCacheableSignalKeyStore(state.keys, logger)

            },

            generateHighQualityLinkPreview: true,

            getMessage: async (key) => {

                return { conversation: '' };

            }

        };

        // Agregar proxy si está disponible (verificación dinámica)
        const currentProxyAgent = await getProxyAgent();
        if (currentProxyAgent) {
            socketConfig.agent = currentProxyAgent;
            console.log('🌐 Usando proxy SOCKS5 para sesión:', sessionName, '(IP Colombia)');
        } else {
            console.log('🌐 Usando conexión directa para sesión:', sessionName, '(IP VPS)');
        }

        const socket = makeWASocket(socketConfig);

        

        // Crear sesiï¿½?ï¿½?ï¿½?Â³n

        const session = {

            name: sessionName,

            socket,

            state: config.SESSION_STATES.STARTING,

            qr: null,

            qrCount: 0,

            phoneNumber: null,

            info: null,

            startTime: new Date(),

            lastActivity: new Date(),

            messages: [],

            retryCount: 0,

            authPath,

            saveCreds

        };

        

        sessions[sessionName] = session;

        

        // Manejar eventos de conexiï¿½?ï¿½?ï¿½?Â³n

        socket.ev.on('connection.update', async (update) => {

            const { connection, lastDisconnect, qr, isNewLogin } = update;

            

            console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? ${sessionName} connection.update:`, JSON.stringify({ connection, qr: !!qr, isNewLogin, statusCode: lastDisconnect?.error?.output?.statusCode }));

            

            if (qr) {

                session.qr = qr;

                session.qrCount++;

                session.state = config.SESSION_STATES.WAITING_FOR_QR;

                console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?Â± QR generado para ${sessionName} (${session.qrCount})`);

            }

            

            if (connection === 'close') {

                const statusCode = lastDisconnect?.error?.output?.statusCode;

                let shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;



                // Si es loggedOut/401 justo despuï¿½?ï¿½?ï¿½?Â©s de un restart, forzamos reintento (hasta 3 veces)

                if (isLoggedOut && session.retryCount < 3) {

                    console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â ${sessionName} recibiï¿½?ï¿½?ï¿½?Â³ estado ${statusCode} (loggedOut). Intentando rescate rï¿½?ï¿½?ï¿½?Â¡pido (${session.retryCount + 1}/3)...`);

                    shouldReconnect = true;

                }

                

                console.log(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? ${sessionName} desconectado. Status: ${statusCode}. Reconectar: ${shouldReconnect}`);

                notifySessionDisconnect(sessionName, statusCode);



                if (shouldReconnect) {

                    const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

                    const isQRConnectionClose = statusCode === DisconnectReason.connectionClosed || statusCode === 428;

                    

                    // Caso 1: Cierre normal durante lectura de QR

                    if (session.qr && isQRConnectionClose && !isRestartRequired) {

                        console.log(`ï¿½?Â¢ï¿½?Âï¿½?Â³ ${sessionName} cierre temporal durante QR, esperando reconexiï¿½?ï¿½?ï¿½?Â³n automï¿½?ï¿½?ï¿½?Â¡tica...`);

                        session.state = config.SESSION_STATES.WAITING_FOR_QR;

                        return;

                    }

                    

                    // Caso 2: restartRequired despuï¿½?ï¿½?ï¿½?Â©s de hacer pairing: recrear socket conservando credenciales

                    if (isRestartRequired) {

                        session.state = config.SESSION_STATES.RECONNECTING;

                        session.retryCount++;

                        if (session.retryCount <= 5) {

                            console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? ${sessionName} necesita restart (515). Reintentando en 2s (${session.retryCount}/5)...`);

                            // Cerramos socket previo pero NO borramos carpeta de auth

                            if (session.socket) {

                                try { await session.socket.ws?.close(); } catch (e) {}

                            }

                            await sleep(2000);

                            // Reemplazar la entrada para permitir nueva instancia

                            delete sessions[sessionName];

                            await createSession(sessionName);

                        } else {

                            session.state = config.SESSION_STATES.ERROR;

                            console.log(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? ${sessionName} superï¿½?ï¿½?ï¿½?Â³ el lï¿½?ï¿½?ï¿½?Â­mite de reintentos (5) tras restartRequired`);

                        }

                        return;

                    }

                    

                    // Caso 3: 401/loggedOut inmediatamente despuï¿½?ï¿½?ï¿½?Â©s de restartRequired, intentamos rescatar credenciales (hasta 3 reintentos rï¿½?ï¿½?ï¿½?Â¡pidos)

                    // Si la sesion esta siendo eliminada intencionalmente, NO reconectar
                    if (session.isBeingDeleted) {
                        console.log(`Sesion ${sessionName} eliminada intencionalmente, no se reconectara`);
                        session.state = config.SESSION_STATES.DISCONNECTED;
                        delete sessions[sessionName];
                        return;
                    }

                    if (isLoggedOut && session.retryCount < 3) {

                        session.state = config.SESSION_STATES.RECONNECTING;

                        session.retryCount++;

                        console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â ${sessionName} recibiï¿½?ï¿½?ï¿½?Â³ 401 tras restartRequired. Intento de rescate ${session.retryCount}/3 en 3s...`);

                        if (session.socket) {

                            try { await session.socket.ws?.close(); } catch (e) {}

                        }

                        await sleep(3000);

                        delete sessions[sessionName];

                        await createSession(sessionName);

                        return;

                    }



                    // Caso 3b: Si ya intentamos rescatar 3 veces y continï¿½?ï¿½?ï¿½?Âºa 401, limpiamos credenciales y pedimos nuevo QR

                    if (isLoggedOut && session.retryCount >= 3) {

                        session.state = config.SESSION_STATES.RECONNECTING;

                        console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?Â§ï¿½?Â¹ ${sessionName} continï¿½?ï¿½?ï¿½?Âºa con 401 tras ${session.retryCount} intentos. Limpiando datos y solicitando nuevo QR...`);

                        try {

                            // Cerrar socket previo

                            if (session.socket) {

                                try { await session.socket.ws?.close(); } catch (e) {}

                            }

                            // Eliminar datos de autenticaciï¿½?ï¿½?ï¿½?Â³n

                            await deleteSessionData(sessionName);

                        } catch (cleanErr) {

                            console.error(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? Error limpiando datos de ${sessionName}: ${cleanErr.message}`);

                        }

                        // Reiniciar sesiï¿½?ï¿½?ï¿½?Â³n desde cero

                        delete sessions[sessionName];

                        await createSession(sessionName);

                        return;

                    }



                    // Otros errores: reconectar manual con backoff

                    session.state = config.SESSION_STATES.RECONNECTING;

                    session.retryCount++;



                    if (session.retryCount <= 5) {

                        console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Reintentando conexiï¿½?ï¿½?ï¿½?Â³n ${sessionName} (${session.retryCount}/5) en 5s...`);

                        if (session.socket) {

                            try { await session.socket.ws?.close(); } catch (e) {}

                        }

                        await sleep(5000);

                        delete sessions[sessionName];

                        await createSession(sessionName);

                    } else {

                        session.state = config.SESSION_STATES.ERROR;

                        console.log(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? ${sessionName} superï¿½?ï¿½?ï¿½?Â³ el lï¿½?ï¿½?ï¿½?Â­mite de reintentos (5)`);

                    }

                } else {

                    session.state = config.SESSION_STATES.DISCONNECTED;

                    delete sessions[sessionName];

                    console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? ${sessionName} cerrï¿½?ï¿½?ï¿½?Â³ sesiï¿½?ï¿½?ï¿½?Â³n. Manteniendo datos de autenticaciï¿½?ï¿½?ï¿½?Â³n para diagnï¿½?ï¿½?ï¿½?Â³stico.`);

                }

            }

            

            if (connection === 'open') {

                session.state = config.SESSION_STATES.READY;

                session.retryCount = 0;

                session.qr = null;

                session.qrCount = 0;

                

                // Obtener informaciï¿½?ï¿½?ï¿½?Â³n del usuario

                const user = socket.user;

                if (user) {

                    session.phoneNumber = user.id.split(':')[0];
                    // Guardar también el LID si existe
                    session.lid = socket.authState?.creds?.me?.lid ? socket.authState.creds.me.lid.split(':')[0] : null;

                    session.info = {

                        wid: user.id,

                        phone: session.phoneNumber,
                        
                        lid: session.lid,

                        pushname: user.name || 'Usuario'

                    };

                    

                    console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?ï¿½? ${sessionName} conectado: ${session.phoneNumber}`);

                    // Guardar credenciales por seguridad tras conexiï¿½?ï¿½?ï¿½?Â³n

                    try { await saveCreds(); } catch (e) {}

                }

            }

        });

        

        // Guardar credenciales cuando cambien

        socket.ev.on('creds.update', saveCreds);

        

        // Manejar mensajes entrantes

        socket.ev.on('messages.upsert', async (m) => {

            const message = m.messages[0];
            
            // Detectar cuando el usuario envía un mensaje desde su celular
            if (message.key.fromMe && m.type === 'notify') {
                console.log(`👤📤 ${sessionName} envió mensaje desde celular - marcando como uso manual`);
                markSessionAsManualUse(sessionName);
            }

            if (!message.key.fromMe && m.type === 'notify') {

                console.log(`💬📥 ${sessionName} recibió mensaje de ${message.key.remoteJid}`);

                session.lastActivity = new Date();



                // Extraer texto del mensaje si existe

                const msgObj = message.message || {};

                const incomingText = msgObj.conversation 

                    || msgObj.extendedTextMessage?.text 

                    || msgObj.imageMessage?.caption 

                    || msgObj.videoMessage?.caption 

                    || '';



                // Registrar en historial y monitor

                logMessageReceived(sessionName, message.key.remoteJid, incomingText);

                if (!session.messages) session.messages = [];

                session.messages.push({

                    timestamp: new Date(),

                    from: message.key.remoteJid,

                    message: incomingText || '[mensaje sin texto]',

                    direction: 'IN',

                    status: 'received'

                });

                // Mantener historial limitado

                if (session.messages.length > config.MAX_MESSAGE_HISTORY) {

                    session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);

                }

                
                // Auto-respuesta inteligente según el origen del mensaje
                const senderPhone = message.key.remoteJid;
                const isFromActiveSession = isSessionPhone(senderPhone);
                const isFromConversation = isActiveConversationPhone(senderPhone);
                const senderSessionName = getSessionNameByPhone(senderPhone);
                
                // Detectar si el remitente está usando manualmente su sesión
                const senderInManualUse = senderSessionName ? isSessionInManualUse(senderSessionName) : false;
                
                // Detectar si esta sesión receptora está en uso manual
                const thisSessionInManualUse = isSessionInManualUse(sessionName);
                
                // Log para debugging
                console.log(`📨 Mensaje de ${senderPhone} | EsSesión: ${isFromActiveSession} | EsConversaciónIA: ${isFromConversation} | RemitenteManual: ${senderInManualUse} | ReceptorManual: ${thisSessionInManualUse}`);
                
                if (message.message) {
                    // Caso 1: Mensaje de otra sesión activa (conversación entre bots)
                    if (isFromActiveSession && !isFromConversation) {
                        // Si esta sesión receptora está en uso manual, NO responder automáticamente
                        if (thisSessionInManualUse) {
                            console.log(`👤 ${sessionName} está en uso manual - NO responderá automáticamente`);
                        } else {
                            // Verificar límite de mensajes automáticos
                            const conversationKey = [senderSessionName, sessionName].sort().join('-');
                            const counter = autoResponseCounters.get(conversationKey) || { count: 0, lastActivity: Date.now() };
                            
                            // Limpiar contador si han pasado más de 30 minutos sin actividad
                            if (Date.now() - counter.lastActivity > 30 * 60 * 1000) {
                                counter.count = 0;
                            }
                            
                            // Límite de 5 mensajes automáticos por conversación
                            const AUTO_RESPONSE_LIMIT = 5;
                            
                            if (counter.count >= AUTO_RESPONSE_LIMIT) {
                                console.log(`⏸️ ${sessionName} alcanzó límite de ${AUTO_RESPONSE_LIMIT} respuestas automáticas con ${senderSessionName}`);
                            } else {
                                console.log(`🤖 Conversación IA: ${sessionName} responderá a sesión ${senderSessionName || senderPhone} (${counter.count + 1}/${AUTO_RESPONSE_LIMIT})`);
                                try {
                                    // Generar respuesta con IA usando el contexto del mensaje
                                    const messageText = message.message.conversation || 
                                                      message.message.extendedTextMessage?.text || 
                                                      'Mensaje';
                                    
                                    // Usar respuestas generadas con IA simple
                                    const aiResponse = await generateSimpleAIResponse(messageText, session.messages.slice(-5));
                                    
                                    // Responder después de un delay aleatorio (5-15 segundos) para parecer natural
                                    const delay = Math.floor(Math.random() * 10000) + 5000;
                                    setTimeout(async () => {
                                        try {
                                            await socket.sendMessage(message.key.remoteJid, {
                                                text: aiResponse
                                            });
                                            
                                            // Incrementar contador
                                            counter.count++;
                                            counter.lastActivity = Date.now();
                                            autoResponseCounters.set(conversationKey, counter);
                                            
                                            console.log(`✅ ${sessionName} respondió con IA a ${senderSessionName || senderPhone}: "${aiResponse}" (${counter.count}/${AUTO_RESPONSE_LIMIT})`);
                                        } catch (err) {
                                            console.error(`Error enviando respuesta IA: ${err.message}`);
                                        }
                                    }, delay);
                                } catch (error) {
                                    console.error(`Error generando respuesta IA: ${error.message}`);
                                }
                            }
                        }
                    }
                    // Caso 2: Mensaje de conversación IA activa (ya manejado por el endpoint)
                    else if (isFromConversation) {
                        console.log(`⏭️ Mensaje en conversación IA activa: ${senderPhone}`);
                    }
                    // Caso 3: Mensaje de humano externo (auto-respuesta estándar)
                    else if (config.AUTO_RESPONSE && !isFromActiveSession) {
                        try {
                            await socket.sendMessage(message.key.remoteJid, {
                                text: config.AUTO_RESPONSE
                            });
                            console.log(`📤 Auto-respuesta enviada a ${senderPhone}`);
                        } catch (error) {
                            console.error(`Error enviando auto-respuesta: ${error.message}`);
                        }
                    }
                }
            }

        });

        

        return session;

        

    } catch (error) {

        console.error(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? Error creando sesiï¿½?ï¿½?ï¿½?Â³n ${sessionName}:`, error.message);

        if (sessions[sessionName]) {

            sessions[sessionName].state = config.SESSION_STATES.ERROR;

        }

        throw error;

    }

}



/**

 * Obtiene el cï¿½?ï¿½?ï¿½?Â³digo QR en formato base64

 */

async function getQRCode(sessionName) {

    const session = sessions[sessionName];

    if (!session || !session.qr) {

        return null;

    }

    

    try {

        const qrDataURL = await qrcode.toDataURL(session.qr);

        return qrDataURL;

    } catch (error) {

        console.error(`Error generando QR para ${sessionName}:`, error.message);

        return null;

    }

}



/**

 * Cierra una sesiï¿½?ï¿½?ï¿½?Â³n

 */

async function closeSession(sessionName, shouldLogout = true) {

    const session = sessions[sessionName];

    if (!session) {

        console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â Sesiï¿½?ï¿½?ï¿½?Â³n ${sessionName} no existe`);

        return false;

    }

    

    
    // Marcar la sesion como siendo eliminada para evitar reconexion automatica
    session.isBeingDeleted = true;
    try {

        if (session.socket) {

            if (shouldLogout) {

                console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Cerrando sesiï¿½?ï¿½?ï¿½?Â³n ${sessionName} con logout...`);

                await session.socket.logout();

            } else {

                console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Cerrando conexiï¿½?ï¿½?ï¿½?Â³n ${sessionName} (sin logout)...`);

                session.socket.end(undefined);

            }

        }

        

        session.state = config.SESSION_STATES.DISCONNECTED;

        delete sessions[sessionName];

        

        console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½? Sesiï¿½?ï¿½?ï¿½?Â³n ${sessionName} cerrada exitosamente`);

        return true;

    } catch (error) {

        console.error(`Error cerrando sesiï¿½?ï¿½?ï¿½?Â³n ${sessionName}:`, error.message);

        return false;

    }

}



/**

 * Elimina los datos de autenticaciï¿½?ï¿½?ï¿½?Â³n de una sesiï¿½?ï¿½?ï¿½?Â³n

 */

async function deleteSessionData(sessionName) {

    const authPath = path.join(config.SESSION_DATA_PATH, sessionName);

    

    try {

        await fs.rm(authPath, { recursive: true, force: true });

        console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?Â¯ï¿½?Â¸ï¿½?Â Datos de ${sessionName} eliminados`);

        return true;

    } catch (error) {

        console.error(`Error eliminando datos de ${sessionName}:`, error.message);

        return false;

    }

}



// ======================== ENVï¿½?ï¿½?ï¿½?ÂO DE MENSAJES ========================



/**

 * Envï¿½?ï¿½?ï¿½?Â­a mensaje con reintentos y manejo de errores

 */

async function sendMessageWithRetry(session, phoneNumber, message, maxRetries = 3) {

    let lastError = null;

    

    for (let attempt = 1; attempt <= maxRetries; attempt++) {

        try {

            if (session.state !== config.SESSION_STATES.READY || !session.socket) {

                throw new Error('Sesiï¿½?ï¿½?ï¿½?Â³n no estï¿½?ï¿½?ï¿½?Â¡ lista');

            }

            

            // Formatear nï¿½?ï¿½?ï¿½?Âºmero para Baileys (debe incluir @s.whatsapp.net)

            const formattedJid = phoneNumber.includes('@') 

                ? phoneNumber 

                : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;

            

            // Enviar mensaje

            const result = await session.socket.sendMessage(formattedJid, {

                text: message

            });

            

            console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?ï¿½? ${session.name}: Mensaje enviado a ${phoneNumber}`);

            return { success: true, messageResult: result };

            

        } catch (error) {

            lastError = error;

            const errorMsg = error.message || String(error);

            

            console.log(`${session.name}: Error en intento ${attempt}/${maxRetries}: ${errorMsg}`);

            

            if (attempt < maxRetries) {

                // Delay progresivo mï¿½?ï¿½?ï¿½?Â¡s natural

                await sleep(3000 * attempt);

            }

        }

    }

    

    return { success: false, error: lastError };

}



/**

 * Envï¿½?ï¿½?ï¿½?Â­a mensaje con media (imagen, video, audio, documento)

 */

async function sendMediaMessage(session, phoneNumber, mediaBuffer, mimetype, caption = '') {

    try {

        if (session.state !== config.SESSION_STATES.READY || !session.socket) {

            throw new Error('Sesiï¿½?ï¿½?ï¿½?Â³n no estï¿½?ï¿½?ï¿½?Â¡ lista');

        }

        

        const formattedJid = phoneNumber.includes('@') 

            ? phoneNumber 

            : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;

        

        // Determinar tipo de media

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

        

        console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?ï¿½? ${session.name}: Media enviado a ${phoneNumber}`);

        return { success: true, messageResult: result };

        

    } catch (error) {

        console.error(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? ${session.name}: Error enviando media:`, error.message);

        return { success: false, error };

    }

}



/**

 * Obtiene la siguiente sesiï¿½?ï¿½?ï¿½?Â³n usando balanceo round-robin

 * @returns {Object|null} - Sesiï¿½?ï¿½?ï¿½?Â³n para usar o null

 */

function getNextSessionRoundRobin() {

    const activeSessions = getActiveSessions();

    if (activeSessions.length === 0) return null;

    

    // Asegurar que el ï¿½?ï¿½?ï¿½?Â­ndice estï¿½?ï¿½?ï¿½?Â© dentro del rango

    if (currentSessionIndex >= activeSessions.length) {

        currentSessionIndex = 0;

    }

    

    const session = activeSessions[currentSessionIndex];

    

    // Rotar al siguiente ï¿½?ï¿½?ï¿½?Â­ndice para el prï¿½?ï¿½?ï¿½?Â³ximo mensaje

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();

    

    return session;

}



/**

 * Envï¿½?ï¿½?ï¿½?Â­a mensaje usando rotaciï¿½?ï¿½?ï¿½?Â³n automï¿½?ï¿½?ï¿½?Â¡tica de sesiones

 * Con balanceo round-robin: cada mensaje usa una sesiï¿½?ï¿½?ï¿½?Â³n diferente

 * @param {string} phoneNumber - Nï¿½?ï¿½?ï¿½?Âºmero de telï¿½?ï¿½?ï¿½?Â©fono

 * @param {string} message - Mensaje a enviar

 * @returns {Object} - Resultado del envï¿½?ï¿½?ï¿½?Â­o

 */

async function sendMessageWithRotation(phoneNumber, message) {

    // Usar balanceo round-robin (cada mensaje rota a la siguiente sesiï¿½?ï¿½?ï¿½?Â³n)

    const activeSessions = getActiveSessions();



    if (activeSessions.length === 0) {

        return {

            success: false,

            error: new Error('No hay sesiones activas disponibles')

        };

    }



    // Seleccionar sesiï¿½?ï¿½?ï¿½?Â³n actual y luego avanzar el ï¿½?ï¿½?ï¿½?Â­ndice

    if (currentSessionIndex >= activeSessions.length) currentSessionIndex = 0;

    const session = activeSessions[currentSessionIndex];

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();



    console.log(`ï¿½?Â°ï¿½?ï¿½?ï¿½?ï¿½?ï¿½?Â¤ Enviando via ${session.name} (idx ${currentSessionIndex}/${activeSessions.length})`);



    const formattedNumber = formatPhoneNumber(phoneNumber);

    if (!formattedNumber) {

        return {

            success: false,

            error: new Error('Nï¿½?ï¿½?ï¿½?Âºmero de telï¿½?ï¿½?ï¿½?Â©fono invï¿½?ï¿½?ï¿½?Â¡lido')

        };

    }



    const result = await sendMessageWithRetry(session, formattedNumber, message, 3);



    if (result.success) {

        // Registrar mensaje

        logMessageSent(session.name, formattedNumber, message, 'sent');

        // Incrementar contador de mensajes enviados
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



        // Mantener historial limitado

        if (session.messages.length > config.MAX_MESSAGE_HISTORY) {

            session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);

        }

    } else {

        logMessageSent(session.name, formattedNumber, message, 'failed', result.error?.message);

    }



    return { ...result, sessionUsed: session.name };

}



function notifySessionDisconnect(sessionName, statusCode) {
    const now = Date.now();
    const lastAt = lastDisconnectNotify.get(sessionName) || 0;
    if (now - lastAt < DISCONNECT_NOTIFY_COOLDOWN_MS) return;
    lastDisconnectNotify.set(sessionName, now);

    const sessionsObj = getAllSessions();
    const sessionsStatus = getSessionsStatus();
    const active = getActiveSessions();
    const inactive = sessionsStatus.filter(s => s.state !== config.SESSION_STATES.READY);
    
    const nowStr = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const codeText = statusCode !== undefined && statusCode !== null ? statusCode : 'N/A';
    
    // Emojis usando Unicode escapes para evitar problemas de codificacion
    const EMOJI = {
        WARNING: '\u26A0\uFE0F',      // ⚠️
        CLOCK: '\u23F0',              // ⏰
        PHONE: '\uD83D\uDCF1',        // 📱
        CODE: '\uD83D\uDCBB',         // 💻
        CHART: '\uD83D\uDCCA',        // 📊
        CHECK: '\u2705',              // ✅
        ALERT: '\uD83D\uDEA8',        // 🚨
        TOOLS: '\uD83D\uDD27'         // 🔧
    };
    
    let message = `${EMOJI.CHART} *REPORTE SESIONES*\n\n` +
                  `${EMOJI.CLOCK} ${nowStr}\n\n` +
                  `${EMOJI.PHONE} Sesion: *${sessionName}*\n` +
                  `${EMOJI.CODE} Status Code: ${codeText}\n\n` +
                  `${EMOJI.CHART} Total: ${sessionsStatus.length} | ${EMOJI.CHECK} Activas: ${active.length} | ${EMOJI.WARNING} Inactivas: ${inactive.length}\n\n`;
    
    if (active.length > 0) {
        message += "*Sesiones Activas:*\n";
        active.forEach((s, i) => {
            const info = sessionsObj[s.name]?.info || {};
            const label = info.pushname ? ` (${info.pushname})` : '';
            message += `${i + 1}. ${EMOJI.CHECK} *${s.name}*${label}\n`;
        });
    } else {
        message += "*Sesiones Activas:*\n- Sin sesiones activas\n";
    }
    
    if (inactive.length > 0) {
        message += "\n*Requieren atencion:*\n";
        inactive.forEach((s, i) => {
            const icon = s.state == config.SESSION_STATES.WAITING_FOR_QR ? EMOJI.PHONE : (s.state == config.SESSION_STATES.RECONNECTING ? EMOJI.TOOLS : EMOJI.WARNING);
            message += `${i + 1}. ${icon} *${s.name}* - ${s.state}\n`;
        });
    }
    
    sendNotificationToAdmin(message);
}

// ======================== NOTIFICACIONES ========================



/**

 * Envï¿½?ï¿½?ï¿½?Â­a SMS usando API de Hablame.co

 */

async function sendSMSNotification(message) {

    if (!config.SMS_API_KEY) {

        console.log('ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â API Key de Hablame.co no configurada');

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

            console.log('ï¿½?Â¢ï¿½?ï¿½?ï¿½?ï¿½? SMS enviado exitosamente');

            return true;

        }

        return false;

    } catch (error) {

        console.log(`ï¿½?Â¢ï¿½?Âï¿½?ï¿½? Error enviando SMS: ${error.message}`);

        return false;

    }

}



/**

 * Envï¿½?ï¿½?ï¿½?Â­a notificaciï¿½?ï¿½?ï¿½?Â³n al administrador

 */

async function sendNotificationToAdmin(message) {

    const formattedNumber = formatPhoneNumber(config.NOTIFICATION_NUMBER);

    if (!formattedNumber) {

        console.log('ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â Nï¿½?ï¿½?ï¿½?Âºmero de notificaciï¿½?ï¿½?ï¿½?Â³n no configurado');

        return false;

    }

    

    // Intentar con la primera sesiï¿½?ï¿½?ï¿½?Â³n disponible

    const session = getCurrentSession();

    if (!session) {

        console.log('ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â No hay sesiones disponibles para enviar notificaciï¿½?ï¿½?ï¿½?Â³n');

        return await sendSMSNotification(message);

    }

    

    try {

        const result = await sendMessageWithRetry(session, formattedNumber, message, 1);

        if (!result.success) {

            return await sendSMSNotification(message);

        }

        return true;

    } catch (error) {

        console.log(`ï¿½?Â¢ï¿½?ï¿½?ï¿½?Â ï¿½?Â¯ï¿½?Â¸ï¿½?Â Error enviando notificaciï¿½?ï¿½?ï¿½?Â³n: ${error.message}`);

        return await sendSMSNotification(message);

    }

}



// ======================== INFORMACIï¿½?ï¿½?ï¿½?ï¿½?N Y ESTADO ========================



/**

 * Obtiene todas las sesiones

 */

function getAllSessions() {

    return sessions;

}



/**

 * Obtiene una sesiï¿½?ï¿½?ï¿½?Â³n por nombre

 */

function getSession(sessionName) {

    return sessions[sessionName];

}



/**

 * Obtiene el estado de todas las sesiones

 */

function getSessionsStatus() {

    return Object.entries(sessions).map(([name, session]) => ({

        name,

        state: session.state,

        phoneNumber: session.phoneNumber,

        qrReady: !!session.qr,

        messagesCount: session.messagesSentCount || 0,

        lastActivity: session.lastActivity,

        uptime: Date.now() - session.startTime.getTime(),

        retryCount: session.retryCount

    }));

}

/**
 * Marca una sesión como en uso manual (humano escribiendo desde celular)
 */
function markSessionAsManualUse(sessionName) {
    // Limpiar timeout anterior si existe
    if (manualUseSessions.has(sessionName)) {
        clearTimeout(manualUseSessions.get(sessionName).timeout);
    }
    
    // Crear nuevo timeout para desmarcar después de inactividad
    const timeout = setTimeout(() => {
        manualUseSessions.delete(sessionName);
        console.log(`⏰ Sesión ${sessionName} ya no está en uso manual (timeout)`);
    }, MANUAL_USE_TIMEOUT);
    
    manualUseSessions.set(sessionName, {
        lastActivity: Date.now(),
        timeout
    });
    
    console.log(`👤 Sesión ${sessionName} marcada como en uso manual`);
}

/**
 * Verifica si una sesión está siendo usada manualmente por un humano
 */
function isSessionInManualUse(sessionName) {
    return manualUseSessions.has(sessionName);
}

/**
 * Obtiene el nombre de sesión a partir de un phoneNumber
 */
function getSessionNameByPhone(phone) {
    if (!phone) return null;
    
    const cleaned = phone.split('@')[0].split(':')[0].replace(/\D/g, '');
    
    for (const [sessionName, session] of Object.entries(sessions)) {
        if (session.state === config.SESSION_STATES.READY) {
            // Comparar con número PN
            if (session.phoneNumber) {
                const sessionCleaned = session.phoneNumber.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (cleaned === sessionCleaned) {
                    return sessionName;
                }
            }
            
            // Comparar con LID
            if (session.lid) {
                const lidCleaned = session.lid.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (cleaned === lidCleaned) {
                    return sessionName;
                }
            }
        }
    }
    
    return null;
}

/**
 * Genera una respuesta simple con IA para conversaciones automáticas entre sesiones
 * Usa OpenAI si está disponible, sino usa respuestas predefinidas
 */
async function generateSimpleAIResponse(incomingMessage, recentMessages = []) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    // Si hay API key de OpenAI, usar ChatGPT
    if (OPENAI_API_KEY) {
        try {
            const conversationHistory = recentMessages
                .filter(msg => msg.text)
                .slice(-3) // Solo últimos 3 mensajes
                .map(msg => ({
                    role: msg.direction === 'sent' ? 'assistant' : 'user',
                    content: msg.text
                }));
            
            // Agregar el mensaje actual
            conversationHistory.push({
                role: 'user',
                content: incomingMessage
            });
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        {
                            role: 'system',
                            content: 'Eres un usuario colombiano de WhatsApp conversando naturalmente con un amigo. Responde de manera casual, breve (máximo 30 palabras) y natural. Usa expresiones colombianas ocasionalmente como "parcero", "bacano", "chévere", "listo". No uses emojis en exceso.'
                        },
                        ...conversationHistory
                    ],
                    max_tokens: 80,
                    temperature: 0.9
                })
            });
            
            const data = await response.json();
            
            if (data.error) {
                console.error('❌ Error OpenAI:', data.error.message);
                throw new Error(data.error.message);
            }
            
            return data.choices[0].message.content.trim();
        } catch (error) {
            console.error('❌ Error generando respuesta IA con OpenAI:', error.message);
            // Caer a respuestas predefinidas
        }
    }
    
    // Respuestas predefinidas si no hay OpenAI o si falla
    const lowerMessage = incomingMessage.toLowerCase();
    
    // Respuestas basadas en contenido
    if (lowerMessage.includes('hola') || lowerMessage.includes('ola') || lowerMessage.includes('hey')) {
        const greetings = ['Hola! Cómo estás?', 'Hey! Qué más?', 'Hola parcero, todo bien?', 'Qué hubo!', 'Hola! Todo chévere?'];
        return greetings[Math.floor(Math.random() * greetings.length)];
    }
    
    if (lowerMessage.includes('cómo estás') || lowerMessage.includes('como estas') || lowerMessage.includes('qué tal')) {
        const responses = ['Todo bien y vos?', 'Bacano, todo tranquilo', 'Bien bien, ahí vamos', 'Muy bien, gracias!', 'Excelente! Y vos cómo vas?'];
        return responses[Math.floor(Math.random() * responses.length)];
    }
    
    if (lowerMessage.includes('gracias') || lowerMessage.includes('grax')) {
        const thanks = ['De nada!', 'Con gusto!', 'Para eso estamos!', 'Listo parcero!', 'No problem!'];
        return thanks[Math.floor(Math.random() * thanks.length)];
    }
    
    if (lowerMessage.includes('?')) {
        const questions = ['Déjame pensar...', 'Mmm buena pregunta', 'No estoy seguro', 'Me parece que sí', 'Puede ser'];
        return questions[Math.floor(Math.random() * questions.length)];
    }
    
    // Respuestas genéricas
    const genericResponses = [
        'Sí, tienes razón',
        'Qué interesante',
        'Claro!',
        'Verdad?',
        'Eso mismo pensaba',
        'Me parece bien',
        'Listo!',
        'Bacano!',
        'Entiendo',
        'Aja',
        'Ya veo',
        'Totalmente',
        'Por supuesto',
        'Sin duda',
        'Exacto'
    ];
    
    return genericResponses[Math.floor(Math.random() * genericResponses.length)];
}


// ======================== CONVERSACIÓN IA ANTI-BAN ========================

// Variable para almacenar los teléfonos en conversación activa
let activeConversationPhones = new Set();

/**
 * Establece los números de teléfono que están en conversación activa
 * @param {Array} phones - Array de números de teléfono
 */
function setActiveConversationPhones(phones) {
    activeConversationPhones = new Set(phones.map(p => p.replace(/\D/g, '')));
    console.log(`🤖 Conversación IA activa con ${activeConversationPhones.size} números`);
}

/**
 * Limpia los números de conversación activa
 */
function clearActiveConversationPhones() {
    activeConversationPhones.clear();
    console.log('🤖 Conversación IA finalizada');
}

/**
 * Verifica si un número está en conversación activa
 * @param {string} phone - Número de teléfono a verificar
 * @returns {boolean}
 */
function isActiveConversationPhone(phone) {
    if (!phone) return false;
    const cleaned = phone.replace(/\D/g, '').replace(/@.*/, '');
    return activeConversationPhones.has(cleaned);
}

/**
 * Verifica si un número pertenece a una sesión activa
 * @param {string} phone - Número de teléfono a verificar (puede incluir @s.whatsapp.net, :device, etc)
 * @returns {boolean}
 */
function isSessionPhone(phone) {
    if (!phone) return false;
    
    // Extraer solo el identificador, eliminar @s.whatsapp.net, @lid, :device, etc
    const cleaned = phone.split('@')[0].split(':')[0].replace(/\D/g, '');
    
    if (!cleaned) return false;
    
    for (const session of Object.values(sessions)) {
        if (session.state === config.SESSION_STATES.READY) {
            // Comparar con el número de teléfono (PN)
            if (session.phoneNumber) {
                const sessionCleaned = session.phoneNumber.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (cleaned === sessionCleaned) {
                    return true;
                }
            }
            
            // Comparar también con el LID
            if (session.lid) {
                const lidCleaned = session.lid.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (cleaned === lidCleaned) {
                    return true;
                }
            }
        }
    }
    return false;
}

// ======================== EXPORTACIï¿½?ï¿½?ï¿½?ï¿½?N ========================



module.exports = {

    createSession,

    loadSessionsFromDisk,

    closeSession,

    deleteSessionData,

    getSession,

    getAllSessions,

    getSessionsStatus,

    getQRCode,

    getActiveSessions,

    getCurrentSession,

    rotateSession,

    startSessionRotation,

    stopSessionRotation,

    getRotationInfo,

    sendMessageWithRetry,

    sendMessageWithRotation,

    sendMediaMessage,

    sendNotificationToAdmin,

    getRecentMessages,

    logMessageSent,

    logMessageReceived,

    queueMessage,

    setBatchInterval,

    getBatchSettings,

    startBatchProcessor,

    // Consolidacion de mensajes (persistente en BD)
    addToConsolidation,
    processConsolidationQueue,
    startConsolidationProcessor,
    getConsolidationStatus,

    // Conversación IA Anti-Ban
    setActiveConversationPhones,
    clearActiveConversationPhones,
    isActiveConversationPhone

};


