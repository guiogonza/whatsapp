/**

 * Gestor de Sesiones de WhatsApp usando Baileys

 * Maneja la creaciÃÂÃÂ³n, rotaciÃÂÃÂ³n y monitoreo de sesiones

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



// AlmacÃÂÃÂ©n de sesiones

const sessions = {};



// ÃÂÃÂndice de sesiÃÂÃÂ³n activa para rotaciÃÂÃÂ³n

let currentSessionIndex = 0;

let lastRotationTime = new Date();

let rotationInterval = null;



// Buffer de mensajes recientes para el monitor

let recentMessages = [];

const MAX_RECENT_MESSAGES = 100;



// Cola persistente manejada vÃÂÃÂ­a BD

let batchIntervalMinutes = 3;
let batchTimer = null;
const DISCONNECT_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
const lastDisconnectNotify = new Map();


/**

 * Registra un mensaje enviado en el buffer del monitor y en la BD

 */

function logMessageSent(sessionName, destination, message, status, errorMessage = null) {

    // Guardar en buffer de memoria para el monitor

    recentMessages.unshift({

        timestamp: new Date().toISOString(),

        session: sessionName,

        destination,

        message: message.substring(0, 100),

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

    // Guardar en buffer de memoria para el monitor

    recentMessages.unshift({

        timestamp: new Date().toISOString(),

        session: sessionName,

        origin,

        message: (message || '').substring(0, 100),

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



// ======================== PROCESAMIENTO POR LOTES (BATCH) ========================



/**

 * Encola un mensaje para ser enviado en lote

 */

function queueMessage(phoneNumber, message) {

    const formattedNumber = formatPhoneNumber(phoneNumber);

    if (!formattedNumber) {

        return { success: false, error: 'NÃÂÃÂºmero invÃÂÃÂ¡lido' };

    }

    // Registrar en monitor inmediatamente como 'queued'

    logMessageSent('queue', formattedNumber, message, 'queued');

    // Persistir en BD

    const result = database.enqueueMessage(formattedNumber, message);

    console.log(`ÃÂ°ÃÂÃÂÃÂ¥ Mensaje encolado (BD) para ${formattedNumber}. Total pendientes: ${result.total}`);

    return { success: true, queued: true, total: result.total, pendingNumbers: result.pendingNumbers, nextBatchIn: batchIntervalMinutes };

}



/**

 * Procesa la cola de mensajes y los envÃÂÃÂ­a agrupados

 */

async function processMessageQueue() {

    const numbers = database.getQueuedNumbers();

    if (!numbers || numbers.length === 0) return;



    console.log(`\nÃÂ°ÃÂÃÂÃÂ¦ Procesando cola persistente (${numbers.length} nÃÂÃÂºmeros pendientes)...`);



    for (const number of numbers) {

        const rows = database.getMessagesForNumber(number);

        if (!rows || rows.length === 0) continue;



        const combinedMessage = rows.map(r => r.message).join('\n\n');

        console.log(`ÃÂ°ÃÂÃÂÃÂ¤ Enviando lote de ${rows.length} mensajes a ${number}`);



        try {

            const result = await sendMessageWithRotation(number, combinedMessage);

            if (result.success) {

                database.clearQueueForNumber(number);

            } else {

                console.error(`ÃÂ¢ÃÂÃÂ Error enviando lote a ${number}, se mantiene en cola: ${result.error?.message}`);

            }

        } catch (error) {

            console.error(`ÃÂ¢ÃÂÃÂ Error procesando lote para ${number}: ${error.message}`);

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

    

    console.log(`ÃÂ¢ÃÂÃÂ±ÃÂ¯ÃÂ¸ÃÂ Intervalo de envÃÂÃÂ­o por lotes actualizado a ${batchIntervalMinutes} minutos`);

    return { success: true, interval: batchIntervalMinutes };

}



/**

 * Inicia el procesador de lotes

 */

function startBatchProcessor() {

    if (batchTimer) {

        clearInterval(batchTimer);

    }



    console.log(`ÃÂ°ÃÂÃÂÃÂ Iniciando procesador de lotes (cada ${batchIntervalMinutes} minutos)`);

    

    batchTimer = setInterval(() => {

        processMessageQueue();

    }, batchIntervalMinutes * 60 * 1000);

}



/**

 * Obtiene la configuraciÃÂÃÂ³n actual de lotes

 */

function getBatchSettings() {

    const stats = database.getQueueStats();

    return {

        interval: batchIntervalMinutes,

        queueSize: stats.total,

        pendingNumbers: stats.pendingNumbers

    };

}



// ======================== FUNCIONES DE ROTACIÃÂÃÂN ========================



/**

 * Obtiene todas las sesiones que estÃÂÃÂ¡n activas (READY)

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

 * Obtiene la sesiÃÂÃÂ³n activa actual para envÃÂÃÂ­o de mensajes

 * @returns {Object|null} - SesiÃÂÃÂ³n activa o null

 */

function getCurrentSession() {

    const activeSessions = getActiveSessions();

    if (activeSessions.length === 0) return null;

    

    // Asegurar que el ÃÂÃÂ­ndice estÃÂÃÂ© dentro del rango

    if (currentSessionIndex >= activeSessions.length) {

        currentSessionIndex = 0;

    }

    

    return activeSessions[currentSessionIndex];

}



/**

 * Rota a la siguiente sesiÃÂÃÂ³n activa

 */

function rotateSession() {

    // FunciÃÂÃÂ³n mantenida por compatibilidad, pero el balanceo es automÃÂÃÂ¡tico

    const activeSessions = getActiveSessions();

    if (activeSessions.length <= 1) return;

    

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();

}



/**

 * Inicia el intervalo de rotaciÃÂÃÂ³n automÃÂÃÂ¡tica de sesiones

 */

function startSessionRotation() {

    console.log('ÃÂ°ÃÂÃÂÃÂ Balanceo round-robin activo: cada mensaje usa una sesiÃÂÃÂ³n diferente');

    // Ya no usamos rotaciÃÂÃÂ³n por tiempo, solo round-robin por mensaje

}



/**

 * Detiene el intervalo de rotaciÃÂÃÂ³n

 */

function stopSessionRotation() {

    if (rotationInterval) {

        clearInterval(rotationInterval);

        rotationInterval = null;

    }

}



/**

 * Obtiene informaciÃÂÃÂ³n sobre la rotaciÃÂÃÂ³n actual

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



// ======================== CREACIÃÂÃÂN DE SESIONES ========================



/**

 * Carga todas las sesiones existentes en el disco

 */

async function loadSessionsFromDisk() {

    try {

        // Asegurar que el directorio existe

        await fs.mkdir(config.SESSION_DATA_PATH, { recursive: true });

        

        const files = await fs.readdir(config.SESSION_DATA_PATH);

        console.log(`ÃÂ°ÃÂÃÂÃÂ Buscando sesiones en ${config.SESSION_DATA_PATH}...`);

        

        let loadedCount = 0;

        

        for (const file of files) {

            // Ignorar archivos ocultos o que no sean carpetas

            if (file.startsWith('.')) continue;

            

            const fullPath = path.join(config.SESSION_DATA_PATH, file);

            try {

                const stat = await fs.stat(fullPath);

                

                if (stat.isDirectory()) {

                    // Verificar si tiene creds.json (indicador de sesiÃÂÃÂ³n vÃÂÃÂ¡lida)

                    const credsPath = path.join(fullPath, 'creds.json');

                    try {

                        await fs.access(credsPath);

                        console.log(`ÃÂ°ÃÂÃÂÃÂ Cargando sesiÃÂÃÂ³n encontrada: ${file}`);

                        await createSession(file);

                        loadedCount++;

                    } catch (e) {

                        console.log(`ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ Carpeta ${file} ignorada (no tiene credenciales vÃÂÃÂ¡lidas). Eliminando...`);

                        try {

                            await fs.rm(fullPath, { recursive: true, force: true });

                            console.log(`ÃÂ°ÃÂÃÂÃÂÃÂ¯ÃÂ¸ÃÂ Carpeta invÃÂÃÂ¡lida ${file} eliminada`);

                        } catch (delErr) {

                            console.error(`ÃÂ¢ÃÂÃÂ Error eliminando carpeta invÃÂÃÂ¡lida ${file}:`, delErr.message);

                        }

                    }

                }

            } catch (err) {

                console.error(`Error procesando ${file}:`, err.message);

            }

        }

        

        console.log(`ÃÂ¢ÃÂÃÂ Se cargaron ${loadedCount} sesiones del disco`);

        return loadedCount;

    } catch (error) {

        console.error('ÃÂ¢ÃÂÃÂ Error cargando sesiones del disco:', error.message);

        return 0;

    }

}



/**

 * Crea una nueva sesiÃÂÃÂ³n de WhatsApp con Baileys

 */

async function createSession(sessionName) {

    console.log(`\nÃÂ°ÃÂÃÂÃÂ Iniciando sesiÃÂÃÂ³n ${sessionName} con Baileys...`);

    

    if (sessions[sessionName]) {

        console.log(`ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ La sesiÃÂÃÂ³n ${sessionName} ya existe`);

        return sessions[sessionName];

    }

    

    try {

        // Crear directorio de autenticaciÃÂÃÂ³n

        const authPath = path.join(config.SESSION_DATA_PATH, sessionName);

        await fs.mkdir(authPath, { recursive: true });

        

        // Crear estado de autenticaciÃÂÃÂ³n

        const { state, saveCreds } = await useMultiFileAuthState(authPath);

        

        // Obtener la versiÃÂÃÂ³n mÃÂÃÂ¡s reciente de Baileys

        const { version, isLatest } = await fetchLatestBaileysVersion();

        console.log(`ÃÂ°ÃÂÃÂÃÂ± Usando WA v${version.join('.')}, isLatest: ${isLatest}`);

        

        // Crear logger con nivel debug para diagnosticar

        const logger = pino({ level: 'debug' });

        

        // Crear socket de WhatsApp

        const socket = makeWASocket({

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

        });

        

        // Crear sesiÃÂÃÂ³n

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

        

        // Manejar eventos de conexiÃÂÃÂ³n

        socket.ev.on('connection.update', async (update) => {

            const { connection, lastDisconnect, qr, isNewLogin } = update;

            

            console.log(`ÃÂ°ÃÂÃÂÃÂ ${sessionName} connection.update:`, JSON.stringify({ connection, qr: !!qr, isNewLogin, statusCode: lastDisconnect?.error?.output?.statusCode }));

            

            if (qr) {

                session.qr = qr;

                session.qrCount++;

                session.state = config.SESSION_STATES.WAITING_FOR_QR;

                console.log(`ÃÂ°ÃÂÃÂÃÂ± QR generado para ${sessionName} (${session.qrCount})`);

            }

            

            if (connection === 'close') {

                const statusCode = lastDisconnect?.error?.output?.statusCode;

                let shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;



                // Si es loggedOut/401 justo despuÃÂÃÂ©s de un restart, forzamos reintento (hasta 3 veces)

                if (isLoggedOut && session.retryCount < 3) {

                    console.log(`ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ ${sessionName} recibiÃÂÃÂ³ estado ${statusCode} (loggedOut). Intentando rescate rÃÂÃÂ¡pido (${session.retryCount + 1}/3)...`);

                    shouldReconnect = true;

                }

                

                console.log(`ÃÂ¢ÃÂÃÂ ${sessionName} desconectado. Status: ${statusCode}. Reconectar: ${shouldReconnect}`);

                notifySessionDisconnect(sessionName, statusCode);



                if (shouldReconnect) {

                    const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

                    const isQRConnectionClose = statusCode === DisconnectReason.connectionClosed || statusCode === 428;

                    

                    // Caso 1: Cierre normal durante lectura de QR

                    if (session.qr && isQRConnectionClose && !isRestartRequired) {

                        console.log(`ÃÂ¢ÃÂÃÂ³ ${sessionName} cierre temporal durante QR, esperando reconexiÃÂÃÂ³n automÃÂÃÂ¡tica...`);

                        session.state = config.SESSION_STATES.WAITING_FOR_QR;

                        return;

                    }

                    

                    // Caso 2: restartRequired despuÃÂÃÂ©s de hacer pairing: recrear socket conservando credenciales

                    if (isRestartRequired) {

                        session.state = config.SESSION_STATES.RECONNECTING;

                        session.retryCount++;

                        if (session.retryCount <= 5) {

                            console.log(`ÃÂ°ÃÂÃÂÃÂ ${sessionName} necesita restart (515). Reintentando en 2s (${session.retryCount}/5)...`);

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

                            console.log(`ÃÂ¢ÃÂÃÂ ${sessionName} superÃÂÃÂ³ el lÃÂÃÂ­mite de reintentos (5) tras restartRequired`);

                        }

                        return;

                    }

                    

                    // Caso 3: 401/loggedOut inmediatamente despuÃÂÃÂ©s de restartRequired, intentamos rescatar credenciales (hasta 3 reintentos rÃÂÃÂ¡pidos)

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

                        console.log(`ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ ${sessionName} recibiÃÂÃÂ³ 401 tras restartRequired. Intento de rescate ${session.retryCount}/3 en 3s...`);

                        if (session.socket) {

                            try { await session.socket.ws?.close(); } catch (e) {}

                        }

                        await sleep(3000);

                        delete sessions[sessionName];

                        await createSession(sessionName);

                        return;

                    }



                    // Caso 3b: Si ya intentamos rescatar 3 veces y continÃÂÃÂºa 401, limpiamos credenciales y pedimos nuevo QR

                    if (isLoggedOut && session.retryCount >= 3) {

                        session.state = config.SESSION_STATES.RECONNECTING;

                        console.log(`ÃÂ°ÃÂÃÂ§ÃÂ¹ ${sessionName} continÃÂÃÂºa con 401 tras ${session.retryCount} intentos. Limpiando datos y solicitando nuevo QR...`);

                        try {

                            // Cerrar socket previo

                            if (session.socket) {

                                try { await session.socket.ws?.close(); } catch (e) {}

                            }

                            // Eliminar datos de autenticaciÃÂÃÂ³n

                            await deleteSessionData(sessionName);

                        } catch (cleanErr) {

                            console.error(`ÃÂ¢ÃÂÃÂ Error limpiando datos de ${sessionName}: ${cleanErr.message}`);

                        }

                        // Reiniciar sesiÃÂÃÂ³n desde cero

                        delete sessions[sessionName];

                        await createSession(sessionName);

                        return;

                    }



                    // Otros errores: reconectar manual con backoff

                    session.state = config.SESSION_STATES.RECONNECTING;

                    session.retryCount++;



                    if (session.retryCount <= 5) {

                        console.log(`ÃÂ°ÃÂÃÂÃÂ Reintentando conexiÃÂÃÂ³n ${sessionName} (${session.retryCount}/5) en 5s...`);

                        if (session.socket) {

                            try { await session.socket.ws?.close(); } catch (e) {}

                        }

                        await sleep(5000);

                        delete sessions[sessionName];

                        await createSession(sessionName);

                    } else {

                        session.state = config.SESSION_STATES.ERROR;

                        console.log(`ÃÂ¢ÃÂÃÂ ${sessionName} superÃÂÃÂ³ el lÃÂÃÂ­mite de reintentos (5)`);

                    }

                } else {

                    session.state = config.SESSION_STATES.DISCONNECTED;

                    delete sessions[sessionName];

                    console.log(`ÃÂ°ÃÂÃÂÃÂ ${sessionName} cerrÃÂÃÂ³ sesiÃÂÃÂ³n. Manteniendo datos de autenticaciÃÂÃÂ³n para diagnÃÂÃÂ³stico.`);

                }

            }

            

            if (connection === 'open') {

                session.state = config.SESSION_STATES.READY;

                session.retryCount = 0;

                session.qr = null;

                session.qrCount = 0;

                

                // Obtener informaciÃÂÃÂ³n del usuario

                const user = socket.user;

                if (user) {

                    session.phoneNumber = user.id.split(':')[0];

                    session.info = {

                        wid: user.id,

                        phone: session.phoneNumber,

                        pushname: user.name || 'Usuario'

                    };

                    

                    console.log(`ÃÂ¢ÃÂÃÂ ${sessionName} conectado: ${session.phoneNumber}`);

                    // Guardar credenciales por seguridad tras conexiÃÂÃÂ³n

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

                console.log(`ÃÂ°ÃÂÃÂÃÂ¨ ${sessionName} recibiÃÂÃÂ³ mensaje de ${message.key.remoteJid}`);

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

                

                // Auto-respuesta si estÃÂÃÂ¡ configurada

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

        console.error(`ÃÂ¢ÃÂÃÂ Error creando sesiÃÂÃÂ³n ${sessionName}:`, error.message);

        if (sessions[sessionName]) {

            sessions[sessionName].state = config.SESSION_STATES.ERROR;

        }

        throw error;

    }

}



/**

 * Obtiene el cÃÂÃÂ³digo QR en formato base64

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

 * Cierra una sesiÃÂÃÂ³n

 */

async function closeSession(sessionName, shouldLogout = true) {

    const session = sessions[sessionName];

    if (!session) {

        console.log(`ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ SesiÃÂÃÂ³n ${sessionName} no existe`);

        return false;

    }

    

    
    // Marcar la sesion como siendo eliminada para evitar reconexion automatica
    session.isBeingDeleted = true;
    try {

        if (session.socket) {

            if (shouldLogout) {

                console.log(`ÃÂ°ÃÂÃÂÃÂ Cerrando sesiÃÂÃÂ³n ${sessionName} con logout...`);

                await session.socket.logout();

            } else {

                console.log(`ÃÂ°ÃÂÃÂÃÂ Cerrando conexiÃÂÃÂ³n ${sessionName} (sin logout)...`);

                session.socket.end(undefined);

            }

        }

        

        session.state = config.SESSION_STATES.DISCONNECTED;

        delete sessions[sessionName];

        

        console.log(`ÃÂ°ÃÂÃÂÃÂ SesiÃÂÃÂ³n ${sessionName} cerrada exitosamente`);

        return true;

    } catch (error) {

        console.error(`Error cerrando sesiÃÂÃÂ³n ${sessionName}:`, error.message);

        return false;

    }

}



/**

 * Elimina los datos de autenticaciÃÂÃÂ³n de una sesiÃÂÃÂ³n

 */

async function deleteSessionData(sessionName) {

    const authPath = path.join(config.SESSION_DATA_PATH, sessionName);

    

    try {

        await fs.rm(authPath, { recursive: true, force: true });

        console.log(`ÃÂ°ÃÂÃÂÃÂÃÂ¯ÃÂ¸ÃÂ Datos de ${sessionName} eliminados`);

        return true;

    } catch (error) {

        console.error(`Error eliminando datos de ${sessionName}:`, error.message);

        return false;

    }

}



// ======================== ENVÃÂÃÂO DE MENSAJES ========================



/**

 * EnvÃÂÃÂ­a mensaje con reintentos y manejo de errores

 */

async function sendMessageWithRetry(session, phoneNumber, message, maxRetries = 3) {

    let lastError = null;

    

    for (let attempt = 1; attempt <= maxRetries; attempt++) {

        try {

            if (session.state !== config.SESSION_STATES.READY || !session.socket) {

                throw new Error('SesiÃÂÃÂ³n no estÃÂÃÂ¡ lista');

            }

            

            // Formatear nÃÂÃÂºmero para Baileys (debe incluir @s.whatsapp.net)

            const formattedJid = phoneNumber.includes('@') 

                ? phoneNumber 

                : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;

            

            // Enviar mensaje

            const result = await session.socket.sendMessage(formattedJid, {

                text: message

            });

            

            console.log(`ÃÂ¢ÃÂÃÂ ${session.name}: Mensaje enviado a ${phoneNumber}`);

            return { success: true, messageResult: result };

            

        } catch (error) {

            lastError = error;

            const errorMsg = error.message || String(error);

            

            console.log(`${session.name}: Error en intento ${attempt}/${maxRetries}: ${errorMsg}`);

            

            if (attempt < maxRetries) {

                // Delay progresivo mÃÂÃÂ¡s natural

                await sleep(3000 * attempt);

            }

        }

    }

    

    return { success: false, error: lastError };

}



/**

 * EnvÃÂÃÂ­a mensaje con media (imagen, video, audio, documento)

 */

async function sendMediaMessage(session, phoneNumber, mediaBuffer, mimetype, caption = '') {

    try {

        if (session.state !== config.SESSION_STATES.READY || !session.socket) {

            throw new Error('SesiÃÂÃÂ³n no estÃÂÃÂ¡ lista');

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

        

        console.log(`ÃÂ¢ÃÂÃÂ ${session.name}: Media enviado a ${phoneNumber}`);

        return { success: true, messageResult: result };

        

    } catch (error) {

        console.error(`ÃÂ¢ÃÂÃÂ ${session.name}: Error enviando media:`, error.message);

        return { success: false, error };

    }

}



/**

 * Obtiene la siguiente sesiÃÂÃÂ³n usando balanceo round-robin

 * @returns {Object|null} - SesiÃÂÃÂ³n para usar o null

 */

function getNextSessionRoundRobin() {

    const activeSessions = getActiveSessions();

    if (activeSessions.length === 0) return null;

    

    // Asegurar que el ÃÂÃÂ­ndice estÃÂÃÂ© dentro del rango

    if (currentSessionIndex >= activeSessions.length) {

        currentSessionIndex = 0;

    }

    

    const session = activeSessions[currentSessionIndex];

    

    // Rotar al siguiente ÃÂÃÂ­ndice para el prÃÂÃÂ³ximo mensaje

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();

    

    return session;

}



/**

 * EnvÃÂÃÂ­a mensaje usando rotaciÃÂÃÂ³n automÃÂÃÂ¡tica de sesiones

 * Con balanceo round-robin: cada mensaje usa una sesiÃÂÃÂ³n diferente

 * @param {string} phoneNumber - NÃÂÃÂºmero de telÃÂÃÂ©fono

 * @param {string} message - Mensaje a enviar

 * @returns {Object} - Resultado del envÃÂÃÂ­o

 */

async function sendMessageWithRotation(phoneNumber, message) {

    // Usar balanceo round-robin (cada mensaje rota a la siguiente sesiÃÂÃÂ³n)

    const activeSessions = getActiveSessions();



    if (activeSessions.length === 0) {

        return {

            success: false,

            error: new Error('No hay sesiones activas disponibles')

        };

    }



    // Seleccionar sesiÃÂÃÂ³n actual y luego avanzar el ÃÂÃÂ­ndice

    if (currentSessionIndex >= activeSessions.length) currentSessionIndex = 0;

    const session = activeSessions[currentSessionIndex];

    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;

    lastRotationTime = new Date();



    console.log(`ÃÂ°ÃÂÃÂÃÂ¤ Enviando via ${session.name} (idx ${currentSessionIndex}/${activeSessions.length})`);



    const formattedNumber = formatPhoneNumber(phoneNumber);

    if (!formattedNumber) {

        return {

            success: false,

            error: new Error('NÃÂÃÂºmero de telÃÂÃÂ©fono invÃÂÃÂ¡lido')

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
    
    let message = `🚨 *ALERTA: SESIÓN DESCONECTADA*\n\n` +
                  `⏰ ${nowStr}\n\n` +
                  `❌ Sesión: *${sessionName}*\n` +
                  `📊 Status Code: ${codeText}\n\n` +
                  `📈 Total: ${sessionsStatus.length} | ✅ Activas: ${active.length} | ⚠️ Inactivas: ${inactive.length}\n\n`;
    
    if (active.length > 0) {
        message += "*Sesiones Activas:*\n";
        active.forEach((s, i) => {
            const info = sessionsObj[s.name]?.info || {};
            const label = info.pushname ? ` (${info.pushname})` : '';
            message += `${i + 1}. ✅ *${s.name}*${label}\n`;
        });
    } else {
        message += "*Sesiones Activas:*\n- Sin sesiones activas\n";
    }
    
    if (inactive.length > 0) {
        message += "\n*Requieren atención:*\n";
        inactive.forEach((s, i) => {
            const icon = s.state == config.SESSION_STATES.WAITING_FOR_QR ? '📱' : (s.state == config.SESSION_STATES.RECONNECTING ? '🔄' : '⚠️');
            message += `${i + 1}. ${icon} *${s.name}* - ${s.state}\n`;
        });
    }
    
    sendNotificationToAdmin(message);
}

// ======================== NOTIFICACIONES ========================



/**

 * EnvÃÂÃÂ­a SMS usando API de Hablame.co

 */

async function sendSMSNotification(message) {

    if (!config.SMS_API_KEY) {

        console.log('ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ API Key de Hablame.co no configurada');

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

            console.log('ÃÂ¢ÃÂÃÂ SMS enviado exitosamente');

            return true;

        }

        return false;

    } catch (error) {

        console.log(`ÃÂ¢ÃÂÃÂ Error enviando SMS: ${error.message}`);

        return false;

    }

}



/**

 * EnvÃÂÃÂ­a notificaciÃÂÃÂ³n al administrador

 */

async function sendNotificationToAdmin(message) {

    const formattedNumber = formatPhoneNumber(config.NOTIFICATION_NUMBER);

    if (!formattedNumber) {

        console.log('ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ NÃÂÃÂºmero de notificaciÃÂÃÂ³n no configurado');

        return false;

    }

    

    // Intentar con la primera sesiÃÂÃÂ³n disponible

    const session = getCurrentSession();

    if (!session) {

        console.log('ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ No hay sesiones disponibles para enviar notificaciÃÂÃÂ³n');

        return await sendSMSNotification(message);

    }

    

    try {

        const result = await sendMessageWithRetry(session, formattedNumber, message, 1);

        if (!result.success) {

            return await sendSMSNotification(message);

        }

        return true;

    } catch (error) {

        console.log(`ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ Error enviando notificaciÃÂÃÂ³n: ${error.message}`);

        return await sendSMSNotification(message);

    }

}



// ======================== INFORMACIÃÂÃÂN Y ESTADO ========================



/**

 * Obtiene todas las sesiones

 */

function getAllSessions() {

    return sessions;

}



/**

 * Obtiene una sesiÃÂÃÂ³n por nombre

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

        messagesCount: session.messages?.length || 0,

        lastActivity: session.lastActivity,

        uptime: Date.now() - session.startTime.getTime(),

        retryCount: session.retryCount

    }));

}



// ======================== EXPORTACIÃÂÃÂN ========================



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

    startBatchProcessor

};


