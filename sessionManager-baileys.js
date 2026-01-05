/**
 * Gestor de Sesiones de WhatsApp usando Baileys
 * Maneja la creación, rotación y monitoreo de sesiones
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
const { formatPhoneNumber, sleep, getColombiaDate } = require('./utils');
const database = require('./database');

// Almacén de sesiones
const sessions = {};

// Índice de sesión activa para rotación
let currentSessionIndex = 0;
let lastRotationTime = new Date();
let rotationInterval = null;

// Buffer de mensajes recientes para el monitor
let recentMessages = [];
const MAX_RECENT_MESSAGES = 100;

// Cola de mensajes para envío por lotes
const messageQueue = {};
let batchIntervalMinutes = 3;
let batchTimer = null;

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
        return { success: false, error: 'Número inválido' };
    }

    if (!messageQueue[formattedNumber]) {
        messageQueue[formattedNumber] = [];
    }

    messageQueue[formattedNumber].push({
        message,
        timestamp: new Date()
    });

    console.log(`📥 Mensaje encolado para ${formattedNumber}. Total en cola para este número: ${messageQueue[formattedNumber].length}`);
    
    return { 
        success: true, 
        queued: true, 
        queueSize: messageQueue[formattedNumber].length,
        nextBatchIn: batchIntervalMinutes 
    };
}

/**
 * Procesa la cola de mensajes y los envía agrupados
 */
async function processMessageQueue() {
    const numbers = Object.keys(messageQueue);
    if (numbers.length === 0) return;

    console.log(`\n📦 Procesando cola de mensajes (${numbers.length} números pendientes)...`);

    for (const number of numbers) {
        const messages = messageQueue[number];
        if (!messages || messages.length === 0) continue;

        // Agrupar mensajes
        // Si hay muchos mensajes, podemos separarlos por saltos de línea dobles
        const combinedMessage = messages.map(m => m.message).join('\n\n');
        
        console.log(`📤 Enviando lote de ${messages.length} mensajes a ${number}`);
        
        // Usar la función de envío con rotación existente
        // Esto mantiene el balanceo de carga
        try {
            const result = await sendMessageWithRotation(number, combinedMessage);
            
            if (result.success) {
                // Eliminar de la cola si se envió con éxito
                delete messageQueue[number];
            } else {
                console.error(`❌ Error enviando lote a ${number}, se mantendrá en cola: ${result.error?.message}`);
            }
        } catch (error) {
            console.error(`❌ Error procesando lote para ${number}: ${error.message}`);
        }
        
        // Pequeña pausa entre números para no saturar
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
    return {
        interval: batchIntervalMinutes,
        queueSize: Object.keys(messageQueue).reduce((acc, key) => acc + messageQueue[key].length, 0),
        pendingNumbers: Object.keys(messageQueue).length
    };
}

// ======================== FUNCIONES DE ROTACIÓN ========================

/**
 * Obtiene todas las sesiones que están activas (READY)
 * @returns {Array} - Array de sesiones activas
 */
function getActiveSessions() {
    return Object.values(sessions).filter(s => 
        s.state === config.SESSION_STATES.READY && s.socket
    );
}

/**
 * Obtiene la sesión activa actual para envío de mensajes
 * @returns {Object|null} - Sesión activa o null
 */
function getCurrentSession() {
    const activeSessions = getActiveSessions();
    if (activeSessions.length === 0) return null;
    
    // Asegurar que el índice esté dentro del rango
    if (currentSessionIndex >= activeSessions.length) {
        currentSessionIndex = 0;
    }
    
    return activeSessions[currentSessionIndex];
}

/**
 * Rota a la siguiente sesión activa
 */
function rotateSession() {
    // Función mantenida por compatibilidad, pero el balanceo es automático
    const activeSessions = getActiveSessions();
    if (activeSessions.length <= 1) return;
    
    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;
    lastRotationTime = new Date();
}

/**
 * Inicia el intervalo de rotación automática de sesiones
 */
function startSessionRotation() {
    console.log('🔄 Balanceo round-robin activo: cada mensaje usa una sesión diferente');
    // Ya no usamos rotación por tiempo, solo round-robin por mensaje
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

// ======================== CREACIÓN DE SESIONES ========================

/**
 * Carga todas las sesiones existentes en el disco
 */
async function loadSessionsFromDisk() {
    try {
        // Asegurar que el directorio existe
        await fs.mkdir(config.SESSION_DATA_PATH, { recursive: true });
        
        const files = await fs.readdir(config.SESSION_DATA_PATH);
        console.log(`📂 Buscando sesiones en ${config.SESSION_DATA_PATH}...`);
        
        let loadedCount = 0;
        
        for (const file of files) {
            // Ignorar archivos ocultos o que no sean carpetas
            if (file.startsWith('.')) continue;
            
            const fullPath = path.join(config.SESSION_DATA_PATH, file);
            try {
                const stat = await fs.stat(fullPath);
                
                if (stat.isDirectory()) {
                    // Verificar si tiene creds.json (indicador de sesión válida)
                    const credsPath = path.join(fullPath, 'creds.json');
                    try {
                        await fs.access(credsPath);
                        console.log(`🔄 Cargando sesión encontrada: ${file}`);
                        await createSession(file);
                        loadedCount++;
                    } catch (e) {
                        console.log(`⚠️ Carpeta ${file} ignorada (no tiene credenciales válidas). Eliminando...`);
                        try {
                            await fs.rm(fullPath, { recursive: true, force: true });
                            console.log(`🗑️ Carpeta inválida ${file} eliminada`);
                        } catch (delErr) {
                            console.error(`❌ Error eliminando carpeta inválida ${file}:`, delErr.message);
                        }
                    }
                }
            } catch (err) {
                console.error(`Error procesando ${file}:`, err.message);
            }
        }
        
        console.log(`✅ Se cargaron ${loadedCount} sesiones del disco`);
        return loadedCount;
    } catch (error) {
        console.error('❌ Error cargando sesiones del disco:', error.message);
        return 0;
    }
}

/**
 * Crea una nueva sesión de WhatsApp con Baileys
 */
async function createSession(sessionName) {
    console.log(`\n🚀 Iniciando sesión ${sessionName} con Baileys...`);
    
    if (sessions[sessionName]) {
        console.log(`⚠️ La sesión ${sessionName} ya existe`);
        return sessions[sessionName];
    }
    
    try {
        // Crear directorio de autenticación
        const authPath = path.join(config.SESSION_DATA_PATH, sessionName);
        await fs.mkdir(authPath, { recursive: true });
        
        // Crear estado de autenticación
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        // Obtener la versión más reciente de Baileys
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📱 Usando WA v${version.join('.')}, isLatest: ${isLatest}`);
        
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
        
        // Crear sesión
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
        
        // Manejar eventos de conexión
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, isNewLogin } = update;
            
            console.log(`🔄 ${sessionName} connection.update:`, JSON.stringify({ connection, qr: !!qr, isNewLogin, statusCode: lastDisconnect?.error?.output?.statusCode }));
            
            if (qr) {
                session.qr = qr;
                session.qrCount++;
                session.state = config.SESSION_STATES.WAITING_FOR_QR;
                console.log(`📱 QR generado para ${sessionName} (${session.qrCount})`);
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                console.log(`❌ ${sessionName} desconectado. Status: ${statusCode}. Reconectar: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
                    const isQRConnectionClose = statusCode === DisconnectReason.connectionClosed || statusCode === 428;
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
                    
                    // Caso 1: Cierre normal durante lectura de QR
                    if (session.qr && isQRConnectionClose && !isRestartRequired) {
                        console.log(`⏳ ${sessionName} cierre temporal durante QR, esperando reconexión automática...`);
                        session.state = config.SESSION_STATES.WAITING_FOR_QR;
                        return;
                    }
                    
                    // Caso 2: restartRequired después de hacer pairing: recrear socket conservando credenciales
                    if (isRestartRequired) {
                        session.state = config.SESSION_STATES.RECONNECTING;
                        session.retryCount++;
                        if (session.retryCount <= 5) {
                            console.log(`🔄 ${sessionName} necesita restart (515). Reintentando en 2s (${session.retryCount}/5)...`);
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
                            console.log(`❌ ${sessionName} superó el límite de reintentos (5) tras restartRequired`);
                        }
                        return;
                    }
                    
                    // Caso 3: 401/loggedOut inmediatamente después de restartRequired, intentamos rescatar credenciales (hasta 3 reintentos rápidos)
                    if (isLoggedOut && session.retryCount < 3) {
                        session.state = config.SESSION_STATES.RECONNECTING;
                        session.retryCount++;
                        console.log(`⚠️ ${sessionName} recibió 401 tras restartRequired. Intento de rescate ${session.retryCount}/3 en 3s...`);
                        if (session.socket) {
                            try { await session.socket.ws?.close(); } catch (e) {}
                        }
                        await sleep(3000);
                        delete sessions[sessionName];
                        await createSession(sessionName);
                        return;
                    }

                    // Otros errores: reconectar manual con backoff
                    session.state = config.SESSION_STATES.RECONNECTING;
                    session.retryCount++;

                    if (session.retryCount <= 5) {
                        console.log(`🔄 Reintentando conexión ${sessionName} (${session.retryCount}/5) en 5s...`);
                        if (session.socket) {
                            try { await session.socket.ws?.close(); } catch (e) {}
                        }
                        await sleep(5000);
                        delete sessions[sessionName];
                        await createSession(sessionName);
                    } else {
                        session.state = config.SESSION_STATES.ERROR;
                        console.log(`❌ ${sessionName} superó el límite de reintentos (5)`);
                    }
                } else {
                    session.state = config.SESSION_STATES.DISCONNECTED;
                    delete sessions[sessionName];
                    console.log(`🔌 ${sessionName} cerró sesión. Eliminando datos...`);
                }
            }
            
            if (connection === 'open') {
                session.state = config.SESSION_STATES.READY;
                session.retryCount = 0;
                session.qr = null;
                session.qrCount = 0;
                
                // Obtener información del usuario
                const user = socket.user;
                if (user) {
                    session.phoneNumber = user.id.split(':')[0];
                    session.info = {
                        wid: user.id,
                        phone: session.phoneNumber,
                        pushname: user.name || 'Usuario'
                    };
                    
                    console.log(`✅ ${sessionName} conectado: ${session.phoneNumber}`);
                }
            }
        });
        
        // Guardar credenciales cuando cambien
        socket.ev.on('creds.update', saveCreds);
        
        // Manejar mensajes entrantes
        socket.ev.on('messages.upsert', async (m) => {
            const message = m.messages[0];
            if (!message.key.fromMe && m.type === 'notify') {
                console.log(`📨 ${sessionName} recibió mensaje de ${message.key.remoteJid}`);
                session.lastActivity = new Date();
                
                // Auto-respuesta si está configurada
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
        console.error(`❌ Error creando sesión ${sessionName}:`, error.message);
        if (sessions[sessionName]) {
            sessions[sessionName].state = config.SESSION_STATES.ERROR;
        }
        throw error;
    }
}

/**
 * Obtiene el código QR en formato base64
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
 * Cierra una sesión
 */
async function closeSession(sessionName, shouldLogout = true) {
    const session = sessions[sessionName];
    if (!session) {
        console.log(`⚠️ Sesión ${sessionName} no existe`);
        return false;
    }
    
    try {
        if (session.socket) {
            if (shouldLogout) {
                console.log(`🔌 Cerrando sesión ${sessionName} con logout...`);
                await session.socket.logout();
            } else {
                console.log(`🔌 Cerrando conexión ${sessionName} (sin logout)...`);
                session.socket.end(undefined);
            }
        }
        
        session.state = config.SESSION_STATES.DISCONNECTED;
        delete sessions[sessionName];
        
        console.log(`🔌 Sesión ${sessionName} cerrada exitosamente`);
        return true;
    } catch (error) {
        console.error(`Error cerrando sesión ${sessionName}:`, error.message);
        return false;
    }
}

/**
 * Elimina los datos de autenticación de una sesión
 */
async function deleteSessionData(sessionName) {
    const authPath = path.join(config.SESSION_DATA_PATH, sessionName);
    
    try {
        await fs.rm(authPath, { recursive: true, force: true });
        console.log(`🗑️ Datos de ${sessionName} eliminados`);
        return true;
    } catch (error) {
        console.error(`Error eliminando datos de ${sessionName}:`, error.message);
        return false;
    }
}

// ======================== ENVÍO DE MENSAJES ========================

/**
 * Envía mensaje con reintentos y manejo de errores
 */
async function sendMessageWithRetry(session, phoneNumber, message, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (session.state !== config.SESSION_STATES.READY || !session.socket) {
                throw new Error('Sesión no está lista');
            }
            
            // Formatear número para Baileys (debe incluir @s.whatsapp.net)
            const formattedJid = phoneNumber.includes('@') 
                ? phoneNumber 
                : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;
            
            // Enviar mensaje
            const result = await session.socket.sendMessage(formattedJid, {
                text: message
            });
            
            console.log(`✅ ${session.name}: Mensaje enviado a ${phoneNumber}`);
            return { success: true, messageResult: result };
            
        } catch (error) {
            lastError = error;
            const errorMsg = error.message || String(error);
            
            console.log(`${session.name}: Error en intento ${attempt}/${maxRetries}: ${errorMsg}`);
            
            if (attempt < maxRetries) {
                // Delay progresivo más natural
                await sleep(3000 * attempt);
            }
        }
    }
    
    return { success: false, error: lastError };
}

/**
 * Envía mensaje con media (imagen, video, audio, documento)
 */
async function sendMediaMessage(session, phoneNumber, mediaBuffer, mimetype, caption = '') {
    try {
        if (session.state !== config.SESSION_STATES.READY || !session.socket) {
            throw new Error('Sesión no está lista');
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
        
        console.log(`✅ ${session.name}: Media enviado a ${phoneNumber}`);
        return { success: true, messageResult: result };
        
    } catch (error) {
        console.error(`❌ ${session.name}: Error enviando media:`, error.message);
        return { success: false, error };
    }
}

/**
 * Obtiene la siguiente sesión usando balanceo round-robin
 * @returns {Object|null} - Sesión para usar o null
 */
function getNextSessionRoundRobin() {
    const activeSessions = getActiveSessions();
    if (activeSessions.length === 0) return null;
    
    // Asegurar que el índice esté dentro del rango
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
 * Envía mensaje usando rotación automática de sesiones
 * Con balanceo round-robin: cada mensaje usa una sesión diferente
 * @param {string} phoneNumber - Número de teléfono
 * @param {string} message - Mensaje a enviar
 * @returns {Object} - Resultado del envío
 */
async function sendMessageWithRotation(phoneNumber, message) {
    // Usar balanceo round-robin (cada mensaje rota a la siguiente sesión)
    const activeSessions = getActiveSessions();
    
    if (activeSessions.length === 0) {
        return { 
            success: false, 
            error: new Error('No hay sesiones activas disponibles') 
        };
    }

    // Balanceo Round Robin: Seleccionar la siguiente sesión
    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;
    const session = activeSessions[currentSessionIndex];
    
    console.log(`📤 Enviando via ${session.name} [${currentSessionIndex + 1}/${activeSessions.length}] (Round Robin)`);
    
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return { 
            success: false, 
            error: new Error('Número de teléfono inválido') 
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

// ======================== NOTIFICACIONES ========================

/**
 * Envía SMS usando API de Hablame.co
 */
async function sendSMSNotification(message) {
    if (!config.SMS_API_KEY) {
        console.log('⚠️ API Key de Hablame.co no configurada');
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
            console.log('✅ SMS enviado exitosamente');
            return true;
        }
        return false;
    } catch (error) {
        console.log(`❌ Error enviando SMS: ${error.message}`);
        return false;
    }
}

/**
 * Envía notificación al administrador
 */
async function sendNotificationToAdmin(message) {
    const formattedNumber = formatPhoneNumber(config.NOTIFICATION_NUMBER);
    if (!formattedNumber) {
        console.log('⚠️ Número de notificación no configurado');
        return false;
    }
    
    // Intentar con la primera sesión disponible
    const session = getCurrentSession();
    if (!session) {
        console.log('⚠️ No hay sesiones disponibles para enviar notificación');
        return await sendSMSNotification(message);
    }
    
    try {
        const result = await sendMessageWithRetry(session, formattedNumber, message, 1);
        if (!result.success) {
            return await sendSMSNotification(message);
        }
        return true;
    } catch (error) {
        console.log(`⚠️ Error enviando notificación: ${error.message}`);
        return await sendSMSNotification(message);
    }
}

// ======================== INFORMACIÓN Y ESTADO ========================

/**
 * Obtiene todas las sesiones
 */
function getAllSessions() {
    return sessions;
}

/**
 * Obtiene una sesión por nombre
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

// ======================== EXPORTACIÓN ========================

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
    queueMessage,
    setBatchInterval,
    getBatchSettings,
    startBatchProcessor
};
