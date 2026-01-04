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
    const activeSessions = getActiveSessions();
    if (activeSessions.length <= 1) {
        console.log('📌 Solo hay una sesión activa, no se requiere rotación');
        return;
    }
    
    const previousIndex = currentSessionIndex;
    currentSessionIndex = (currentSessionIndex + 1) % activeSessions.length;
    lastRotationTime = new Date();
    
    const previousSession = activeSessions[previousIndex];
    const newSession = activeSessions[currentSessionIndex];
    
    console.log(`🔄 Rotación de sesión: ${previousSession?.name || 'N/A'} → ${newSession?.name || 'N/A'}`);
    console.log(`📊 Sesiones activas: ${activeSessions.map(s => s.name).join(', ')}`);
}

/**
 * Inicia el intervalo de rotación automática de sesiones
 */
function startSessionRotation() {
    // Si el intervalo es 0, el balanceo es automático por mensaje
    if (config.SESSION_ROTATION_INTERVAL === 0) {
        console.log('🔄 Balanceo round-robin activo: cada mensaje usa una sesión diferente');
        return;
    }
    
    if (rotationInterval) {
        clearInterval(rotationInterval);
    }
    
    const intervalMs = config.SESSION_ROTATION_INTERVAL * 60 * 1000;
    
    rotationInterval = setInterval(() => {
        rotateSession();
    }, intervalMs);
    
    console.log(`⏱️ Rotación de sesiones activa (cada ${config.SESSION_ROTATION_INTERVAL} minutos)`);
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
        const { version } = await fetchLatestBaileysVersion();
        
        // Crear logger silencioso
        const logger = pino({ level: 'silent' });
        
        // Crear socket de WhatsApp
        const socket = makeWASocket({
            version,
            logger,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: true,
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
            const { connection, lastDisconnect, qr } = update;
            
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
                    session.state = config.SESSION_STATES.RECONNECTING;
                    session.retryCount++;
                    
                    if (session.retryCount <= 3) {
                        console.log(`🔄 Reintentando conexión ${sessionName} (${session.retryCount}/3)...`);
                        await sleep(5000);
                        await createSession(sessionName);
                    } else {
                        session.state = config.SESSION_STATES.ERROR;
                        console.log(`❌ ${sessionName} superó el límite de reintentos`);
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
async function closeSession(sessionName) {
    const session = sessions[sessionName];
    if (!session) {
        console.log(`⚠️ Sesión ${sessionName} no existe`);
        return false;
    }
    
    try {
        if (session.socket) {
            await session.socket.logout();
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
    logMessageSent
};
