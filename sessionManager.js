/**
 * Gestor de Sesiones de WhatsApp
 * Maneja la creación, rotación y monitoreo de sesiones
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
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
        s.state === config.SESSION_STATES.READY && s.client
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

// ======================== VERIFICACIÓN DE CLIENTE ========================

/**
 * Verifica si el cliente está realmente listo para enviar mensajes
 */
async function isClientTrulyReady(session, skipStoreCheck = false) {
    if (!session || !session.client) return false;
    
    try {
        const info = session.client.info;
        if (!info || !info.wid) {
            return false;
        }
        
        if (skipStoreCheck) return true;
        
        if (session.client.pupPage) {
            try {
                const storeState = await session.client.pupPage.evaluate(() => {
                    if (window.Store && window.Store.State && window.Store.State.Socket) {
                        return window.Store.State.Socket.state;
                    }
                    if (window.Store && window.Store.Stream && window.Store.Stream.displayInfo) {
                        return 'CONNECTED';
                    }
                    if (window.WWebJS || window.webpackChunkwhatsapp_web_client) {
                        return 'WA_LOADED';
                    }
                    return 'STORE_NOT_FOUND';
                });
                
                if (storeState !== 'CONNECTED' && storeState !== 'WA_LOADED') {
                    console.log(`Cliente ${session.name}: Estado Store=${storeState}`);
                }
            } catch (evalError) {
                // Continuar si hay error evaluando
            }
        }
        
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Espera que el cliente esté listo
 */
async function waitForClientReady(session, maxWaitMs = 30000, skipStoreCheck = false) {
    const startTime = Date.now();
    const checkInterval = 2000;
    
    while (Date.now() - startTime < maxWaitMs) {
        if (await isClientTrulyReady(session, skipStoreCheck)) {
            return true;
        }
        await sleep(checkInterval);
    }
    
    return false;
}

// ======================== ENVÍO DE MENSAJES ========================

/**
 * Envía mensaje con reintentos y manejo de errores
 */
async function sendMessageWithRetry(session, formattedNumber, message, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const skipStoreCheck = attempt > 1 && session.client && session.client.info;
            const isReady = await isClientTrulyReady(session, skipStoreCheck);
            
            if (!isReady) {
                console.log(`${session.name}: Cliente no listo en intento ${attempt}, esperando...`);
                const becameReady = await waitForClientReady(session, 10000, skipStoreCheck);
                
                if (!becameReady && !(session.client && session.client.info && session.client.info.wid)) {
                    throw new Error('Cliente no está listo después de esperar');
                }
            }
            
            const messageResult = await session.client.sendMessage(formattedNumber, message);
            return { success: true, messageResult };
            
        } catch (error) {
            lastError = error;
            const errorMsg = error.message || String(error);
            
            console.log(`${session.name}: Error en intento ${attempt}/${maxRetries}: ${errorMsg}`);
            
            if (errorMsg.includes('WidFactory') || 
                errorMsg.includes('Cannot read properties of undefined') ||
                errorMsg.includes('Evaluation failed')) {
                
                await sleep(5000 * attempt);
                
                if (session.client.pupPage && attempt < maxRetries) {
                    try {
                        await session.client.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
                        await sleep(10000);
                    } catch (refreshError) {
                        console.log(`${session.name}: Error refrescando: ${refreshError.message}`);
                    }
                }
            } else if (attempt < maxRetries) {
                await sleep(2000 * attempt);
            }
        }
    }
    
    return { success: false, error: lastError };
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
    const session = config.LOAD_BALANCING_ENABLED 
        ? getNextSessionRoundRobin() 
        : getCurrentSession();
    
    if (!session) {
        return { 
            success: false, 
            error: new Error('No hay sesiones activas disponibles') 
        };
    }
    
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return { 
            success: false, 
            error: new Error('Número de teléfono inválido') 
        };
    }
    
    const activeSessions = getActiveSessions();
    console.log(`📤 Enviando mensaje via sesión: ${session.name} (${currentSessionIndex}/${activeSessions.length} sesiones activas)`);
    
    const result = await sendMessageWithRetry(session, formattedNumber, message, 3);
    
    if (result.success) {
        // Registrar mensaje
        if (!session.messages) session.messages = [];
        session.messages.push({
            timestamp: new Date(),
            to: formattedNumber,
            message: message,
            direction: 'OUT',
            messageId: result.messageResult.id.id,
            status: 'sent'
        });
        
        session.lastActivity = new Date();
        
        // Mantener historial limitado
        if (session.messages.length > config.MAX_MESSAGE_HISTORY) {
            session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);
        }
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
        const response = await fetch(config.SMS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Hablame-Key': config.SMS_API_KEY
            },
            body: JSON.stringify({
                messages: [{ to: config.NOTIFICATION_NUMBER, text: cleanMessage }],
                priority: true,
                sendDate: 'Now'
            })
        });

        const result = await response.json();
        
        if (response.ok && result.statusCode === 200 && result.payLoad?.messages?.[0]?.statusId === 1) {
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
    const activeSessions = getActiveSessions();
    
    if (activeSessions.length === 0) {
        console.log('⚠️ No hay sesiones activas, intentando SMS...');
        return await sendSMSNotification(message);
    }
    
    const notifySession = activeSessions[0];
    const formattedNumber = formatPhoneNumber(config.NOTIFICATION_NUMBER);
    
    if (!formattedNumber) {
        console.log('⚠️ Número de notificación inválido');
        return false;
    }
    
    try {
        await notifySession.client.sendMessage(formattedNumber, message);
        console.log(`✅ Notificación enviada usando sesión ${notifySession.name}`);
        return true;
    } catch (error) {
        console.log(`❌ Error enviando notificación: ${error.message}`);
        return await sendSMSNotification(message);
    }
}

// ======================== MONITOREO ========================

/**
 * Monitorea el estado de las sesiones
 */
async function monitorSessions() {
    const sessionNames = Object.keys(sessions);
    
    for (const sessionName of sessionNames) {
        const session = sessions[sessionName];
        
        if (session.state === config.SESSION_STATES.READY && session.client) {
            try {
                const state = await session.client.getState();
                
                if (state !== 'CONNECTED') {
                    console.log(`⚠️ Sesión ${sessionName} desconectada (estado: ${state})`);
                    session.state = config.SESSION_STATES.DISCONNECTED;
                    session.qr = null;
                    
                    await sendNotificationToAdmin(
                        `🚨 *ALERTA*\n\nSesión *${sessionName}* desconectada.\n📅 ${getColombiaDate()}\n📊 Estado: ${state}`
                    );
                }
            } catch (error) {
                const previousState = session.state;
                session.state = config.SESSION_STATES.DISCONNECTED;
                session.qr = null;
                
                if (previousState === config.SESSION_STATES.READY) {
                    await sendNotificationToAdmin(
                        `🚨 *ALERTA*\n\nSesión *${sessionName}* no responde.\n📅 ${getColombiaDate()}\n❌ ${error.message}`
                    );
                }
            }
        }
    }
}

/**
 * Verifica sesiones inactivas y envía reporte
 */
async function checkInactiveSessions() {
    const allSessions = Object.values(sessions);
    const activeSessions = allSessions.filter(s => s.state === config.SESSION_STATES.READY);
    const inactiveSessions = allSessions.filter(s => s.state !== config.SESSION_STATES.READY);
    
    let statusReport = `📊 *REPORTE DE SESIONES*\n\n`;
    statusReport += `⏰ ${getColombiaDate()}\n\n`;
    statusReport += `📈 Total: ${allSessions.length} | ✅ Activas: ${activeSessions.length} | ⚠️ Inactivas: ${inactiveSessions.length}\n\n`;
    
    // Info de rotación
    const rotationInfo = getRotationInfo();
    statusReport += `🔄 *Rotación activa*\n`;
    statusReport += `Sesión actual: ${rotationInfo.currentSession || 'N/A'}\n`;
    statusReport += `Próxima rotación: ${new Date(rotationInfo.nextRotation).toLocaleTimeString('es-CO')}\n\n`;
    
    if (activeSessions.length > 0) {
        statusReport += `*Sesiones Activas:*\n`;
        activeSessions.forEach((session, index) => {
            statusReport += `${index + 1}. ✅ *${session.name}*`;
            if (session.userInfo?.pushname) statusReport += ` (${session.userInfo.pushname})`;
            statusReport += `\n`;
        });
    }
    
    if (inactiveSessions.length > 0) {
        statusReport += `\n*Requieren atención:*\n`;
        inactiveSessions.forEach((session, index) => {
            const icons = {
                [config.SESSION_STATES.WAITING_FOR_QR]: '📱',
                [config.SESSION_STATES.DISCONNECTED]: '🔌',
                [config.SESSION_STATES.ERROR]: '⚠️',
                [config.SESSION_STATES.STARTING]: '🔄',
                [config.SESSION_STATES.LOADING]: '⏳'
            };
            statusReport += `${index + 1}. ${icons[session.state] || '❌'} *${session.name}* - ${session.state}\n`;
        });
    }
    
    await sendNotificationToAdmin(statusReport);
    console.log(`📊 Reporte enviado: ${activeSessions.length} activas, ${inactiveSessions.length} inactivas`);
}

// ======================== INICIALIZACIÓN DE CLIENTE ========================

/**
 * Inicializa un cliente de WhatsApp
 */
async function initializeClient(sessionName) {
    let readyTimeout = null;
    let readyCheckInterval = null;

    try {
        console.log(`Iniciando cliente WhatsApp: ${sessionName}`);

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: sessionName,
                dataPath: config.SESSION_DATA_PATH
            }),
            puppeteer: {
                headless: true,
                executablePath: config.PUPPETEER_PATH,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--single-process'
                ],
                timeout: config.PUPPETEER_TIMEOUT,
                // Configurar zona horaria Colombia para evitar errores de sincronización
                env: {
                    ...process.env,
                    TZ: 'America/Bogota'
                }
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/AnjasWijayaIN/webjs-version/main/version.json'
            }
        });

        const clearTimeouts = () => {
            if (readyTimeout) { clearTimeout(readyTimeout); readyTimeout = null; }
            if (readyCheckInterval) { clearInterval(readyCheckInterval); readyCheckInterval = null; }
        };

        // Eventos
        client.on('qr', (qr) => {
            console.log(`QR generado: ${sessionName}`);
            sessions[sessionName].qr = qr;
            sessions[sessionName].state = config.SESSION_STATES.WAITING_FOR_QR;
            sessions[sessionName].lastActivity = new Date();
        });

        client.on('authenticated', () => {
            console.log(`Autenticado: ${sessionName}`);
            sessions[sessionName].state = config.SESSION_STATES.LOADING;
            sessions[sessionName].qr = null;
            sessions[sessionName].lastActivity = new Date();

            readyCheckInterval = setInterval(async () => {
                if (await checkClientReady(sessionName) && readyCheckInterval) {
                    clearInterval(readyCheckInterval);
                    readyCheckInterval = null;
                }
            }, 5000);

            readyTimeout = setTimeout(() => {
                if (sessions[sessionName]?.state === config.SESSION_STATES.LOADING) {
                    console.log(`Forzando READY: ${sessionName}`);
                    sessions[sessionName].state = config.SESSION_STATES.READY;
                    clearTimeouts();
                }
            }, 45000);
        });

        client.on('ready', async () => {
            console.log(`✅ Cliente listo: ${sessionName}`);
            sessions[sessionName].state = config.SESSION_STATES.READY;
            sessions[sessionName].qr = null;
            sessions[sessionName].lastActivity = new Date();
            clearTimeouts();

            try {
                const info = client.info;
                sessions[sessionName].userInfo = {
                    pushname: info.pushname,
                    wid: info.wid.user,
                    platform: info.platform
                };
            } catch (error) {
                console.log(`Cliente conectado: ${sessionName}`);
            }
        });

        client.on('disconnected', async (reason) => {
            console.log(`❌ ${sessionName} desconectado: ${reason}`);
            if (sessions[sessionName]) {
                sessions[sessionName].state = config.SESSION_STATES.DISCONNECTED;
                sessions[sessionName].qr = null;
                sessions[sessionName].lastActivity = new Date();
                
                await sendNotificationToAdmin(
                    `🚨 *ALERTA*\n\nSesión *${sessionName}* desconectada.\n📅 ${getColombiaDate()}\n📝 Razón: ${reason}`
                );
            }
            clearTimeouts();
        });

        client.on('auth_failure', (message) => {
            console.error(`Auth failure ${sessionName}: ${message}`);
            if (sessions[sessionName]) {
                sessions[sessionName].state = config.SESSION_STATES.ERROR;
                sessions[sessionName].qr = null;
                sessions[sessionName].error = `Auth failure: ${message}`;
            }
            clearTimeouts();
        });

        client.on('loading_screen', (percent, message) => {
            console.log(`${sessionName} cargando: ${percent}% - ${message}`);
        });

        client.on('change_state', (state) => {
            if (sessions[sessionName]) {
                sessions[sessionName].connectionState = state;
            }
        });

        client.on('message', async (msg) => {
            if (msg.fromMe) return;

            try {
                const contact = await msg.getContact();
                console.log(`📩 ${sessionName} ← ${contact.pushname || contact.number}: ${msg.body.substring(0, 50)}...`);

                if (config.AUTO_RESPONSE) {
                    await msg.reply(config.AUTO_RESPONSE);

                    if (!sessions[sessionName].messages) sessions[sessionName].messages = [];
                    sessions[sessionName].messages.push({
                        timestamp: new Date(),
                        from: msg.from,
                        contact: contact.pushname || contact.number,
                        message: msg.body,
                        response: config.AUTO_RESPONSE,
                        direction: 'IN',
                        type: msg.type
                    });

                    if (sessions[sessionName].messages.length > config.MAX_MESSAGE_HISTORY) {
                        sessions[sessionName].messages = sessions[sessionName].messages.slice(-config.MAX_MESSAGE_HISTORY);
                    }
                }

                sessions[sessionName].lastActivity = new Date();
            } catch (error) {
                console.error(`Error procesando mensaje: ${error.message}`);
            }
        });

        await client.initialize();
        sessions[sessionName].client = client;

        return client;
    } catch (error) {
        if (readyTimeout) clearTimeout(readyTimeout);
        if (readyCheckInterval) clearInterval(readyCheckInterval);

        if (sessions[sessionName]) {
            sessions[sessionName].state = config.SESSION_STATES.ERROR;
            sessions[sessionName].error = error.message;
        }

        throw error;
    }
}

/**
 * Verifica estado del cliente
 */
async function checkClientReady(sessionName) {
    const session = sessions[sessionName];
    if (!session || !session.client) return false;

    if (session.state === config.SESSION_STATES.DISCONNECTED || 
        session.state === config.SESSION_STATES.ERROR) {
        return false;
    }

    try {
        const info = session.client.info;
        if (info && info.wid) {
            session.state = config.SESSION_STATES.READY;
            session.userInfo = {
                pushname: info.pushname,
                wid: info.wid.user,
                platform: info.platform
            };
            return true;
        }
    } catch (error) {
        // Cliente aún no listo
    }
    return false;
}

/**
 * Asegura que existe la carpeta de sesiones
 */
async function ensureSessionDirectory() {
    try {
        await fs.access(config.SESSION_DATA_PATH);
    } catch {
        await fs.mkdir(config.SESSION_DATA_PATH, { recursive: true });
        console.log(`Carpeta de sesiones creada: ${config.SESSION_DATA_PATH}`);
    }
}

/**
 * Carga sesiones existentes al inicio
 */
async function loadExistingSessions() {
    try {
        await ensureSessionDirectory();

        const sessionFolders = await fs.readdir(config.SESSION_DATA_PATH);
        const validSessions = sessionFolders.filter(folder =>
            folder.startsWith('session-') &&
            fsSync.statSync(path.join(config.SESSION_DATA_PATH, folder)).isDirectory()
        );

        console.log(`Encontradas ${validSessions.length} sesiones existentes`);

        for (const folder of validSessions) {
            const sessionName = folder.replace('session-', '');
            console.log(`Cargando sesión: ${sessionName}`);

            sessions[sessionName] = {
                name: sessionName,
                client: null,
                qr: null,
                state: config.SESSION_STATES.LOADING,
                messages: [],
                lastActivity: new Date(),
                error: null
            };

            try {
                await initializeClient(sessionName);
            } catch (error) {
                console.error(`Error cargando ${sessionName}: ${error.message}`);
                sessions[sessionName].state = config.SESSION_STATES.ERROR;
                sessions[sessionName].error = error.message;
            }

            await sleep(3000);
        }
    } catch (error) {
        console.error(`Error cargando sesiones: ${error.message}`);
    }
}

/**
 * Valida nombre de sesión
 */
function validateSessionName(sessionName) {
    if (!sessionName) return { valid: false, error: 'Se requiere el nombre de la sesión' };
    if (typeof sessionName !== 'string') return { valid: false, error: 'El nombre debe ser texto' };
    if (sessionName.length < 3) return { valid: false, error: 'Mínimo 3 caracteres' };
    if (sessionName.length > 20) return { valid: false, error: 'Máximo 20 caracteres' };
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
        return { valid: false, error: 'Solo letras, números, guiones y guiones bajos' };
    }
    return { valid: true };
}

// Exportar todo
module.exports = {
    sessions,
    getActiveSessions,
    getCurrentSession,
    getNextSessionRoundRobin,
    rotateSession,
    startSessionRotation,
    stopSessionRotation,
    getRotationInfo,
    isClientTrulyReady,
    waitForClientReady,
    sendMessageWithRetry,
    sendMessageWithRotation,
    sendNotificationToAdmin,
    monitorSessions,
    checkInactiveSessions,
    initializeClient,
    checkClientReady,
    ensureSessionDirectory,
    loadExistingSessions,
    validateSessionName,
    logMessageSent,
    getRecentMessages,
    MessageMedia
};
