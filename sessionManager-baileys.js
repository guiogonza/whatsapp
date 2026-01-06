/**

 * Gestor de Sesiones de WhatsApp usando Baileys

 * Maneja la creaci\xc3\xb3n, rotaci\xc3\xb3n y monitoreo de sesiones

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

// Configurar proxy si está disponible
const PROXY_URL = process.env.ALL_PROXY || process.env.SOCKS_PROXY || null;
const proxyAgent = PROXY_URL  new SocksProxyAgent(PROXY_URL) : null;
if (proxyAgent) {
    console.log('🌐 Proxy SOCKS5 configurado:', PROXY_URL);
}

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



// Almac\xc3\xa9n de sesiones

const sessions = {};



// \xc3\x8dndice de sesi\xc3\xb3n activa para rotaci\xc3\xb3n

let currentSessionIndex = 0;

let lastRotationTime = new Date();

let rotationInterval = null;



// Buffer de mensajes recientes para el monitor

let recentMessages = [];

const MAX_RECENT_MESSAGES = 100;



// Cola persistente manejada v\xc3\xada BD

let batchIntervalMinutes = 3;
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
 * Agrupa por numero y envia con balanceo round-robin
 */
async function processConsolidationQueue() {
    const numbersData = database.getQueuedNumbers();
    
    if (!numbersData || numbersData.length === 0) {
        return;
    }

    console.log(`\n[CONSOLIDACION] Procesando ${numbersData.length} numeros pendientes...`);
    
    const icon = config.MESSAGE_CONSOLIDATION_ICON || '📍';

    for (const numData of numbersData) {
        const phoneNumber = numData.phone_number;
        const messages = database.getMessagesForNumber(phoneNumber);
        
        if (!messages || messages.length === 0) continue;

        // Formatear cada mensaje con icono y hora de llegada
        const formattedMessages = messages.map(msg => {
            return `${icon} [${msg.arrived_at}]\n${msg.message}`;
        });
        
        // Unir todos los mensajes
        const combinedMessage = formattedMessages.join('\n\n');
        const msgCount = messages.length;
        const messageIds = messages.map(m => m.id);

        console.log(`[CONSOLIDACION] Enviando ${msgCount} mensajes a ${phoneNumber}`);

        try {
            // Enviar con balanceo round-robin (cada numero usa sesion diferente)
            const result = await sendMessageWithRotation(phoneNumber, combinedMessage);
            
            if (result.success) {
                // Marcar como enviados en BD
                database.markMessagesSent(messageIds);
                console.log(`[CONSOLIDACION] OK - ${msgCount} msgs enviados a ${phoneNumber} via ${result.sessionUsed}`);
                
                // Registrar en monitor como enviado
                logMessageSent(result.sessionUsed, phoneNumber, `[${msgCount} mensajes consolidados]`, 'sent');
            } else {
                console.error(`[CONSOLIDACION] ERROR enviando a ${phoneNumber}: ${result.error.message}`);
            }
        } catch (error) {
            console.error(`[CONSOLIDACION] ERROR para ${phoneNumber}: ${error.message}`);
        }

        // Pequeña pausa entre numeros para no saturar
        await sleep(500);
    }
    
    console.log(`[CONSOLIDACION] Procesamiento completado\n`);
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

        return { success: false, error: 'N\xc3\xbamero inv\xc3\xa1lido' };

    }

    // Registrar en monitor inmediatamente como 'queued'

    logMessageSent('queue', formattedNumber, message, 'queued');

    // Persistir en BD

    const result = database.enqueueMessage(formattedNumber, message);

    console.log(` Mensaje encolado (BD) para ${formattedNumber}. Total pendientes: ${result.total}`);

    return { success: true, queued: true, total: result.total, pendingNumbers: result.pendingNumbers, nextBatchIn: batchIntervalMinutes };

}



/**

 * Procesa la cola de mensajes y los env\xc3\xada agrupados

 */

async function processMessageQueue() {

    const numbers = database.getQueuedNumbers();

    if (!numbers || numbers.length === 0) return;



    console.log(`\n Procesando cola persistente (${numbers.length} n\xc3\xbameros pendientes)...`);



    for (const number of numbers) {

        const rows = database.getMessagesForNumber(number);

        if (!rows || rows.length === 0) continue;



        const combinedMessage = rows.map(r => r.message).join('\n\n');

        console.log(` Enviando lote de ${rows.length} mensajes a ${number}`);



        try {

            const result = await sendMessageWithRotation(number, combinedMessage);

            if (result.success) {

                database.clearQueueForNumber(number);

            } else {

                console.error(` Error enviando lote a ${number}, se mantiene en cola: ${result.error.message}`);

            }

        } catch (error) {

            console.error(` Error procesando lote para ${number}: ${error.message}`);

        }



        await sleep(1000);

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

    

    console.log(`\xc3\xb1 Intervalo de env\xc3\xado por lotes actualizado a ${batchIntervalMinutes} minutos`);

    return { success: true, interval: batchIntervalMinutes };

}



/**

 * Inicia el procesador de lotes

 */

function startBatchProcessor() {

    if (batchTimer) {

        clearInterval(batchTimer);

    }



    console.log(` Iniciando procesador de lotes (cada ${batchIntervalMinutes} minutos)`);

    

    batchTimer = setInterval(() => {

        processMessageQueue();

    }, batchIntervalMinutes * 60 * 1000);

}



/**

 * Obtiene la configuraci\xc3\xb3n actual de lotes

 */

function getBatchSettings() {

    const stats = database.getQueueStats();

    return {

        interval: batchIntervalMinutes,

        queueSize: stats.total,

        pendingNumbers: stats.pendingNumbers

    };

}



// ======================== FUNCIONES DE ROTACIN ========================



/**

 * Obtiene todas las sesiones que est\xc3\xa1n activas (READY)

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

 * Obtiene la sesi\xc3\xb3n activa actual para env\xc3\xado de mensajes

 * @returns {Object|null} - Sesi\xc3\xb3n activa o null

 */

function getCurrentSession() {

    const activeSessions = getActiveSessions();

    if (activeSessions.length === 0) return null;

    

    // Asegurar que el \xc3\xadndice est\xc3\xa9 dentro del rango

    if (currentSessionIndex >= activeSessions.length) {

        currentSessionIndex = 0;

    }

    

    return activeSessions[currentSessionIndex];

}



/**

 * Rota a la siguiente sesi\xc3\xb3n activa

 */

function rotateSession() {

    // Funci\xc3\xb3n mantenida por compatibilidad, pero el balanceo es autom\xc3\xa1tico

    const activeSessions = getActiveSessions();

    if (activeSessions.length <= 1) return;

    

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();

}



/**

 * Inicia el intervalo de rotaci\xc3\xb3n autom\xc3\xa1tica de sesiones

 */

function startSessionRotation() {

    console.log(' Balanceo round-robin activo: cada mensaje usa una sesi\xc3\xb3n diferente');

    // Ya no usamos rotaci\xc3\xb3n por tiempo, solo round-robin por mensaje

}



/**

 * Detiene el intervalo de rotaci\xc3\xb3n

 */

function stopSessionRotation() {

    if (rotationInterval) {

        clearInterval(rotationInterval);

        rotationInterval = null;

    }

}



/**

 * Obtiene informaci\xc3\xb3n sobre la rotaci\xc3\xb3n actual

 */

function getRotationInfo() {

    const activeSessions = getActiveSessions();

    const currentSession = getCurrentSession();

    

    return {

        currentSession: currentSession.name || null,

        currentIndex: currentSessionIndex,

        totalActiveSessions: activeSessions.length,

        activeSessions: activeSessions.map(s => s.name),

        lastRotation: lastRotationTime.toISOString(),

        rotationIntervalMinutes: config.SESSION_ROTATION_INTERVAL,

        nextRotation: new Date(lastRotationTime.getTime() + config.SESSION_ROTATION_INTERVAL * 60 * 1000).toISOString(),

        loadBalancingEnabled: config.LOAD_BALANCING_ENABLED,

        balancingMode: config.LOAD_BALANCING_ENABLED  'round-robin-per-message' : 'time-based'

    };

}



// ======================== CREACIN DE SESIONES ========================



/**

 * Carga todas las sesiones existentes en el disco

 */

async function loadSessionsFromDisk() {

    try {

        // Asegurar que el directorio existe

        await fs.mkdir(config.SESSION_DATA_PATH, { recursive: true });

        

        const files = await fs.readdir(config.SESSION_DATA_PATH);

        console.log(` Buscando sesiones en ${config.SESSION_DATA_PATH}...`);

        

        let loadedCount = 0;

        

        for (const file of files) {

            // Ignorar archivos ocultos o que no sean carpetas

            if (file.startsWith('.')) continue;

            

            const fullPath = path.join(config.SESSION_DATA_PATH, file);

            try {

                const stat = await fs.stat(fullPath);

                

                if (stat.isDirectory()) {

                    // Verificar si tiene creds.json (indicador de sesi\xc3\xb3n v\xc3\xa1lida)

                    const credsPath = path.join(fullPath, 'creds.json');

                    try {

                        await fs.access(credsPath);

                        console.log(` Cargando sesi\xc3\xb3n encontrada: ${file}`);

                        await createSession(file);

                        loadedCount++;

                    } catch (e) {

                        console.log(` Carpeta ${file} ignorada (no tiene credenciales v\xc3\xa1lidas). Eliminando...`);

                        try {

                            await fs.rm(fullPath, { recursive: true, force: true });

                            console.log(` Carpeta inv\xc3\xa1lida ${file} eliminada`);

                        } catch (delErr) {

                            console.error(` Error eliminando carpeta inv\xc3\xa1lida ${file}:`, delErr.message);

                        }

                    }

                }

            } catch (err) {

                console.error(`Error procesando ${file}:`, err.message);

            }

        }

        

        console.log(` Se cargaron ${loadedCount} sesiones del disco`);

        return loadedCount;

    } catch (error) {

        console.error(' Error cargando sesiones del disco:', error.message);

        return 0;

    }

}



/**

 * Crea una nueva sesi\xc3\xb3n de WhatsApp con Baileys

 */

async function createSession(sessionName) {

    console.log(`\n Iniciando sesi\xc3\xb3n ${sessionName} con Baileys...`);

    

    if (sessions[sessionName]) {

        console.log(` La sesi\xc3\xb3n ${sessionName} ya existe`);

        return sessions[sessionName];

    }

    

    try {

        // Crear directorio de autenticaci\xc3\xb3n

        const authPath = path.join(config.SESSION_DATA_PATH, sessionName);

        await fs.mkdir(authPath, { recursive: true });

        

        // Crear estado de autenticaci\xc3\xb3n

        const { state, saveCreds } = await useMultiFileAuthState(authPath);

        

        // Obtener la versi\xc3\xb3n m\xc3\xa1s reciente de Baileys

        const { version, isLatest } = await fetchLatestBaileysVersion();

        console.log(`\xc3\xb1 Usando WA v${version.join('.')}, isLatest: ${isLatest}`);

        

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

        // Agregar proxy si está configurado
        if (proxyAgent) {
            socketConfig.agent = proxyAgent;
            console.log('🌐 Usando proxy para sesión:', sessionName);
        }

        const socket = makeWASocket(socketConfig);

        

        // Crear sesi\xc3\xb3n

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

        

        // Manejar eventos de conexi\xc3\xb3n

        socket.ev.on('connection.update', async (update) => {

            const { connection, lastDisconnect, qr, isNewLogin } = update;

            

            console.log(` ${sessionName} connection.update:`, JSON.stringify({ connection, qr: !!qr, isNewLogin, statusCode: lastDisconnect.error.output.statusCode }));

            

            if (qr) {

                session.qr = qr;

                session.qrCount++;

                session.state = config.SESSION_STATES.WAITING_FOR_QR;

                console.log(`\xc3\xb1 QR generado para ${sessionName} (${session.qrCount})`);

            }

            

            if (connection === 'close') {

                const statusCode = lastDisconnect.error.output.statusCode;

                let shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;



                // Si es loggedOut/401 justo despu\xc3\xa9s de un restart, forzamos reintento (hasta 3 veces)

                if (isLoggedOut && session.retryCount < 3) {

                    console.log(` ${sessionName} recibi\xc3\xb3 estado ${statusCode} (loggedOut). Intentando rescate r\xc3\xa1pido (${session.retryCount + 1}/3)...`);

                    shouldReconnect = true;

                }

                

                console.log(` ${sessionName} desconectado. Status: ${statusCode}. Reconectar: ${shouldReconnect}`);

                notifySessionDisconnect(sessionName, statusCode);



                if (shouldReconnect) {

                    const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

                    const isQRConnectionClose = statusCode === DisconnectReason.connectionClosed || statusCode === 428;

                    

                    // Caso 1: Cierre normal durante lectura de QR

                    if (session.qr && isQRConnectionClose && !isRestartRequired) {

                        console.log(`\xc3\xb3 ${sessionName} cierre temporal durante QR, esperando reconexi\xc3\xb3n autom\xc3\xa1tica...`);

                        session.state = config.SESSION_STATES.WAITING_FOR_QR;

                        return;

                    }

                    

                    // Caso 2: restartRequired despu\xc3\xa9s de hacer pairing: recrear socket conservando credenciales

                    if (isRestartRequired) {

                        session.state = config.SESSION_STATES.RECONNECTING;

                        session.retryCount++;

                        if (session.retryCount <= 5) {

                            console.log(` ${sessionName} necesita restart (515). Reintentando en 2s (${session.retryCount}/5)...`);

                            // Cerramos socket previo pero NO borramos carpeta de auth

                            if (session.socket) {

                                try { await session.socket.ws.close(); } catch (e) {}

                            }

                            await sleep(2000);

                            // Reemplazar la entrada para permitir nueva instancia

                            delete sessions[sessionName];

                            await createSession(sessionName);

                        } else {

                            session.state = config.SESSION_STATES.ERROR;

                            console.log(` ${sessionName} super\xc3\xb3 el l\xc3\xadmite de reintentos (5) tras restartRequired`);

                        }

                        return;

                    }

                    

                    // Caso 3: 401/loggedOut inmediatamente despu\xc3\xa9s de restartRequired, intentamos rescatar credenciales (hasta 3 reintentos r\xc3\xa1pidos)

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

                        console.log(` ${sessionName} recibi\xc3\xb3 401 tras restartRequired. Intento de rescate ${session.retryCount}/3 en 3s...`);

                        if (session.socket) {

                            try { await session.socket.ws.close(); } catch (e) {}

                        }

                        await sleep(3000);

                        delete sessions[sessionName];

                        await createSession(sessionName);

                        return;

                    }



                    // Caso 3b: Si ya intentamos rescatar 3 veces y contin\xc3\xbaa 401, limpiamos credenciales y pedimos nuevo QR

                    if (isLoggedOut && session.retryCount >= 3) {

                        session.state = config.SESSION_STATES.RECONNECTING;

                        console.log(` ${sessionName} contin\xc3\xbaa con 401 tras ${session.retryCount} intentos. Limpiando datos y solicitando nuevo QR...`);

                        try {

                            // Cerrar socket previo

                            if (session.socket) {

                                try { await session.socket.ws.close(); } catch (e) {}

                            }

                            // Eliminar datos de autenticaci\xc3\xb3n

                            await deleteSessionData(sessionName);

                        } catch (cleanErr) {

                            console.error(` Error limpiando datos de ${sessionName}: ${cleanErr.message}`);

                        }

                        // Reiniciar sesi\xc3\xb3n desde cero

                        delete sessions[sessionName];

                        await createSession(sessionName);

                        return;

                    }



                    // Otros errores: reconectar manual con backoff

                    session.state = config.SESSION_STATES.RECONNECTING;

                    session.retryCount++;



                    if (session.retryCount <= 5) {

                        console.log(` Reintentando conexi\xc3\xb3n ${sessionName} (${session.retryCount}/5) en 5s...`);

                        if (session.socket) {

                            try { await session.socket.ws.close(); } catch (e) {}

                        }

                        await sleep(5000);

                        delete sessions[sessionName];

                        await createSession(sessionName);

                    } else {

                        session.state = config.SESSION_STATES.ERROR;

                        console.log(` ${sessionName} super\xc3\xb3 el l\xc3\xadmite de reintentos (5)`);

                    }

                } else {

                    session.state = config.SESSION_STATES.DISCONNECTED;

                    delete sessions[sessionName];

                    console.log(` ${sessionName} cerr\xc3\xb3 sesi\xc3\xb3n. Manteniendo datos de autenticaci\xc3\xb3n para diagn\xc3\xb3stico.`);

                }

            }

            

            if (connection === 'open') {

                session.state = config.SESSION_STATES.READY;

                session.retryCount = 0;

                session.qr = null;

                session.qrCount = 0;

                

                // Obtener informaci\xc3\xb3n del usuario

                const user = socket.user;

                if (user) {

                    session.phoneNumber = user.id.split(':')[0];

                    session.info = {

                        wid: user.id,

                        phone: session.phoneNumber,

                        pushname: user.name || 'Usuario'

                    };

                    

                    console.log(` ${sessionName} conectado: ${session.phoneNumber}`);

                    // Guardar credenciales por seguridad tras conexi\xc3\xb3n

                    try { await saveCreds(); } catch (e) {}

                }

            }

        });

        

        // Guardar credenciales cuando cambien

        socket.ev.on('creds.update', saveCreds);

        

        // Manejar mensajes entrantes

        socket.ev.on('messages.upsert', async (m) => {

            const message = m.messages[0];

            if (!message.key.fromMe && m.type === 'notify') {

                console.log(` ${sessionName} recibi\xc3\xb3 mensaje de ${message.key.remoteJid}`);

                session.lastActivity = new Date();



                // Extraer texto del mensaje si existe

                const msgObj = message.message || {};

                const incomingText = msgObj.conversation 

                    || msgObj.extendedTextMessage.text 

                    || msgObj.imageMessage.caption 

                    || msgObj.videoMessage.caption 

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

                

                // Auto-respuesta si est\xc3\xa1 configurada

                if (config.AUTO_RESPONSE && message.message) {

                    try {

                        await socket.sendMessage(message.key.remoteJid, {

                            text: config.AUTO_RESPONSE

                        });

                    } catch (error) {

                        console.error(`Error enviando auto-respuesta: ${error.message}`);

                    }

                }

            }

        });

        

        return session;

        

    } catch (error) {

        console.error(` Error creando sesi\xc3\xb3n ${sessionName}:`, error.message);

        if (sessions[sessionName]) {

            sessions[sessionName].state = config.SESSION_STATES.ERROR;

        }

        throw error;

    }

}



/**

 * Obtiene el c\xc3\xb3digo QR en formato base64

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

 * Cierra una sesi\xc3\xb3n

 */

async function closeSession(sessionName, shouldLogout = true) {

    const session = sessions[sessionName];

    if (!session) {

        console.log(` Sesi\xc3\xb3n ${sessionName} no existe`);

        return false;

    }

    

    
    // Marcar la sesion como siendo eliminada para evitar reconexion automatica
    session.isBeingDeleted = true;
    try {

        if (session.socket) {

            if (shouldLogout) {

                console.log(` Cerrando sesi\xc3\xb3n ${sessionName} con logout...`);

                await session.socket.logout();

            } else {

                console.log(` Cerrando conexi\xc3\xb3n ${sessionName} (sin logout)...`);

                session.socket.end(undefined);

            }

        }

        

        session.state = config.SESSION_STATES.DISCONNECTED;

        delete sessions[sessionName];

        

        console.log(` Sesi\xc3\xb3n ${sessionName} cerrada exitosamente`);

        return true;

    } catch (error) {

        console.error(`Error cerrando sesi\xc3\xb3n ${sessionName}:`, error.message);

        return false;

    }

}



/**

 * Elimina los datos de autenticaci\xc3\xb3n de una sesi\xc3\xb3n

 */

async function deleteSessionData(sessionName) {

    const authPath = path.join(config.SESSION_DATA_PATH, sessionName);

    

    try {

        await fs.rm(authPath, { recursive: true, force: true });

        console.log(` Datos de ${sessionName} eliminados`);

        return true;

    } catch (error) {

        console.error(`Error eliminando datos de ${sessionName}:`, error.message);

        return false;

    }

}



// ======================== ENV\xc3\x8dO DE MENSAJES ========================



/**

 * Env\xc3\xada mensaje con reintentos y manejo de errores

 */

async function sendMessageWithRetry(session, phoneNumber, message, maxRetries = 3) {

    let lastError = null;

    

    for (let attempt = 1; attempt <= maxRetries; attempt++) {

        try {

            if (session.state !== config.SESSION_STATES.READY || !session.socket) {

                throw new Error('Sesi\xc3\xb3n no est\xc3\xa1 lista');

            }

            

            // Formatear n\xc3\xbamero para Baileys (debe incluir @s.whatsapp.net)

            const formattedJid = phoneNumber.includes('@') 

                 phoneNumber 

                : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;

            

            // Enviar mensaje

            const result = await session.socket.sendMessage(formattedJid, {

                text: message

            });

            

            console.log(` ${session.name}: Mensaje enviado a ${phoneNumber}`);

            return { success: true, messageResult: result };

            

        } catch (error) {

            lastError = error;

            const errorMsg = error.message || String(error);

            

            console.log(`${session.name}: Error en intento ${attempt}/${maxRetries}: ${errorMsg}`);

            

            if (attempt < maxRetries) {

                // Delay progresivo m\xc3\xa1s natural

                await sleep(3000 * attempt);

            }

        }

    }

    

    return { success: false, error: lastError };

}



/**

 * Env\xc3\xada mensaje con media (imagen, video, audio, documento)

 */

async function sendMediaMessage(session, phoneNumber, mediaBuffer, mimetype, caption = '') {

    try {

        if (session.state !== config.SESSION_STATES.READY || !session.socket) {

            throw new Error('Sesi\xc3\xb3n no est\xc3\xa1 lista');

        }

        

        const formattedJid = phoneNumber.includes('@') 

             phoneNumber 

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

        

        console.log(` ${session.name}: Media enviado a ${phoneNumber}`);

        return { success: true, messageResult: result };

        

    } catch (error) {

        console.error(` ${session.name}: Error enviando media:`, error.message);

        return { success: false, error };

    }

}



/**

 * Obtiene la siguiente sesi\xc3\xb3n usando balanceo round-robin

 * @returns {Object|null} - Sesi\xc3\xb3n para usar o null

 */

function getNextSessionRoundRobin() {

    const activeSessions = getActiveSessions();

    if (activeSessions.length === 0) return null;

    

    // Asegurar que el \xc3\xadndice est\xc3\xa9 dentro del rango

    if (currentSessionIndex >= activeSessions.length) {

        currentSessionIndex = 0;

    }

    

    const session = activeSessions[currentSessionIndex];

    

    // Rotar al siguiente \xc3\xadndice para el pr\xc3\xb3ximo mensaje

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();

    

    return session;

}



/**

 * Env\xc3\xada mensaje usando rotaci\xc3\xb3n autom\xc3\xa1tica de sesiones

 * Con balanceo round-robin: cada mensaje usa una sesi\xc3\xb3n diferente

 * @param {string} phoneNumber - N\xc3\xbamero de tel\xc3\xa9fono

 * @param {string} message - Mensaje a enviar

 * @returns {Object} - Resultado del env\xc3\xado

 */

async function sendMessageWithRotation(phoneNumber, message) {

    // Usar balanceo round-robin (cada mensaje rota a la siguiente sesi\xc3\xb3n)

    const activeSessions = getActiveSessions();



    if (activeSessions.length === 0) {

        return {

            success: false,

            error: new Error('No hay sesiones activas disponibles')

        };

    }



    // Seleccionar sesi\xc3\xb3n actual y luego avanzar el \xc3\xadndice

    if (currentSessionIndex >= activeSessions.length) currentSessionIndex = 0;

    const session = activeSessions[currentSessionIndex];

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();



    console.log(` Enviando via ${session.name} (idx ${currentSessionIndex}/${activeSessions.length})`);



    const formattedNumber = formatPhoneNumber(phoneNumber);

    if (!formattedNumber) {

        return {

            success: false,

            error: new Error('N\xc3\xbamero de tel\xc3\xa9fono inv\xc3\xa1lido')

        };

    }



    const result = await sendMessageWithRetry(session, formattedNumber, message, 3);



    if (result.success) {

        // Registrar mensaje

        logMessageSent(session.name, formattedNumber, message, 'sent');



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

        logMessageSent(session.name, formattedNumber, message, 'failed', result.error.message);

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
    const codeText = statusCode !== undefined && statusCode !== null  statusCode : 'N/A';
    
    let message = ` *ALERTA: SESIN DESCONECTADA*\n\n` +
                  ` ${nowStr}\n\n` +
                  ` Sesin: *${sessionName}*\n` +
                  ` Status Code: ${codeText}\n\n` +
                  ` Total: ${sessionsStatus.length} |  Activas: ${active.length} |  Inactivas: ${inactive.length}\n\n`;
    
    if (active.length > 0) {
        message += "*Sesiones Activas:*\n";
        active.forEach((s, i) => {
            const info = sessionsObj[s.name].info || {};
            const label = info.pushname  ` (${info.pushname})` : '';
            message += `${i + 1}.  *${s.name}*${label}\n`;
        });
    } else {
        message += "*Sesiones Activas:*\n- Sin sesiones activas\n";
    }
    
    if (inactive.length > 0) {
        message += "\n*Requieren atencin:*\n";
        inactive.forEach((s, i) => {
            const icon = s.state == config.SESSION_STATES.WAITING_FOR_QR  '' : (s.state == config.SESSION_STATES.RECONNECTING  '' : '');
            message += `${i + 1}. ${icon} *${s.name}* - ${s.state}\n`;
        });
    }
    
    sendNotificationToAdmin(message);
}

// ======================== NOTIFICACIONES ========================



/**

 * Env\xc3\xada SMS usando API de Hablame.co

 */

async function sendSMSNotification(message) {

    if (!config.SMS_API_KEY) {

        console.log(' API Key de Hablame.co no configurada');

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

            console.log(' SMS enviado exitosamente');

            return true;

        }

        return false;

    } catch (error) {

        console.log(` Error enviando SMS: ${error.message}`);

        return false;

    }

}



/**

 * Env\xc3\xada notificaci\xc3\xb3n al administrador

 */

async function sendNotificationToAdmin(message) {

    const formattedNumber = formatPhoneNumber(config.NOTIFICATION_NUMBER);

    if (!formattedNumber) {

        console.log(' N\xc3\xbamero de notificaci\xc3\xb3n no configurado');

        return false;

    }

    

    // Intentar con la primera sesi\xc3\xb3n disponible

    const session = getCurrentSession();

    if (!session) {

        console.log(' No hay sesiones disponibles para enviar notificaci\xc3\xb3n');

        return await sendSMSNotification(message);

    }

    

    try {

        const result = await sendMessageWithRetry(session, formattedNumber, message, 1);

        if (!result.success) {

            return await sendSMSNotification(message);

        }

        return true;

    } catch (error) {

        console.log(` Error enviando notificaci\xc3\xb3n: ${error.message}`);

        return await sendSMSNotification(message);

    }

}



// ======================== INFORMACIN Y ESTADO ========================



/**

 * Obtiene todas las sesiones

 */

function getAllSessions() {

    return sessions;

}



/**

 * Obtiene una sesi\xc3\xb3n por nombre

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

        messagesCount: session.messages.length || 0,

        lastActivity: session.lastActivity,

        uptime: Date.now() - session.startTime.getTime(),

        retryCount: session.retryCount

    }));

}



// ======================== EXPORTACIN ========================



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
    getConsolidationStatus

};


