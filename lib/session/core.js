/**
 * Módulo Core de Sesiones
 * Maneja la creación, conexión y gestión de sesiones de WhatsApp con Baileys
 */

const { DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const adapterFactory = require('./adapters');
const fs = require('fs').promises;
const path = require('path');
const qrcode = require('qrcode');

const config = require('../../config');
const { getProxyAgentForSession, releaseProxyForSession, maskProxy } = require('./proxy');
const { logMessageSent, logMessageReceived } = require('./logging');
const { sendMessageWithRetry, sendNotificationToAdmin } = require('./messaging');
const { formatPhoneNumber, sleep } = require('./utils');
const rotation = require('./rotation');

// Almacén de sesiones
const sessions = {};

// Mapeo LID ↔ PN (Phone Number) para resolver IDs de WhatsApp
const lidToPhoneMap = new Map();
const phoneToLidMap = new Map();

/**
 * Registra un mapeo LID ↔ PN
 */
function registerLidMapping(lid, phone) {
    if (lid && phone) {
        const cleanLid = lid.toString().split(':')[0].split('@')[0];
        const cleanPhone = phone.toString().split(':')[0].split('@')[0];
        lidToPhoneMap.set(cleanLid, cleanPhone);
        phoneToLidMap.set(cleanPhone, cleanLid);
        console.log(`🔗 Mapeo registrado: LID ${cleanLid} ↔ PN ${cleanPhone}`);
    }
}

/**
 * Resuelve un LID a número de teléfono
 */
function resolvePhoneFromLid(lid) {
    const cleanLid = lid.toString().split(':')[0].split('@')[0];
    return lidToPhoneMap.get(cleanLid) || null;
}

// Tracking de sesiones en uso manual
const manualUseSessions = new Map();
const MANUAL_USE_TIMEOUT = 5 * 60 * 1000;

// Tracking de respuestas automáticas por conversación
const autoResponseCounters = new Map();

// Cooldown para notificaciones de desconexión (30 minutos)
const DISCONNECT_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;
const lastDisconnectNotify = new Map();

// Tracking de errores 403 (Forbidden) por sesión
const forbiddenCounts = new Map();

// Tracking de contadores de 401 (loggedOut) persistente entre recreaciones
// IMPORTANTE: Este mapa NO se borra al recrear la sesión para detectar loops infinitos
const persistentLoggedOutCounts = new Map();
const persistentRetryCounts = new Map();
const MAX_PERSISTENT_401_COUNT = 10; // Máximo total de 401s antes de marcar para limpieza

// Tracking de sesiones estancadas (no conectan después de cierto tiempo)
const sessionStartingTimestamps = new Map();
const STALE_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
const STALE_SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Revisar cada 5 minutos
let staleSessionCleanerInterval = null;

// Conversación IA Anti-Ban
let activeConversationPhones = new Set();

// Inyectar sesiones al módulo de rotación
rotation.injectSessions(sessions);

/**
 * Carga todas las sesiones existentes en el disco
 */
async function loadSessionsFromDisk() {
    try {
        await fs.mkdir(config.SESSION_DATA_PATH, { recursive: true });
        
        const files = await fs.readdir(config.SESSION_DATA_PATH);
        console.log(`📂 Buscando sesiones en ${config.SESSION_DATA_PATH}...`);
        
        let loadedCount = 0;
        
        for (const file of files) {
            if (file.startsWith('.')) continue;
            
            const fullPath = path.join(config.SESSION_DATA_PATH, file);
            try {
                const stat = await fs.stat(fullPath);
                
                if (stat.isDirectory()) {
                    // Detectar tipo de adaptador guardado
                    let savedAdapterType = null;
                    try {
                        savedAdapterType = (await fs.readFile(path.join(fullPath, '.adapter-type'), 'utf-8')).trim();
                        adapterFactory.setAdapterForSession(file, savedAdapterType);
                    } catch (e) {}
                    
                    // Verificar credenciales según el tipo de adaptador
                    const hasBaileysAuth = await fs.access(path.join(fullPath, 'creds.json')).then(() => true).catch(() => false);
                    const hasWWJSAuth = savedAdapterType === 'whatsapp-web-js';
                    const hasValidAuth = hasBaileysAuth || hasWWJSAuth;
                    
                    if (hasValidAuth) {
                        console.log(`📱 Cargando sesión: ${file} (adaptador: ${savedAdapterType || 'auto'})`);
                        await createSession(file);
                        loadedCount++;
                    } else {
                        console.log(`⚠️ Carpeta ${file} ignorada (sin credenciales válidas). Eliminando...`);
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
        
        // Iniciar el limpiador de sesiones estancadas
        startStaleSessionCleaner();
        
        return loadedCount;
    } catch (error) {
        console.error('❌ Error cargando sesiones del disco:', error.message);
        return 0;
    }
}

/**
 * Ejecuta la limpieza de sesiones estancadas (puede llamarse manualmente)
 */
async function runStaleSessionCleaner() {
    console.log('🧹 Ejecutando limpiador de sesiones estancadas...');
    const now = Date.now();
    const staleSessions = [];
    
    // Primero: revisar sesiones en el mapa de timestamps
    for (const [sessionName, startTime] of sessionStartingTimestamps.entries()) {
        const session = sessions[sessionName];
        const elapsedMs = now - startTime;
        
        // Si la sesión no existe o ya está conectada, limpiar el tracking
        if (!session || session.state === config.SESSION_STATES.READY) {
            sessionStartingTimestamps.delete(sessionName);
            continue;
        }
        
        // Si lleva más de 5 minutos sin conectarse
        if (elapsedMs > STALE_SESSION_TIMEOUT_MS) {
            staleSessions.push({
                name: sessionName,
                state: session?.state,
                elapsedMinutes: Math.floor(elapsedMs / 60000)
            });
        }
    }
    
    // Segundo: revisar TODAS las sesiones en estado ERROR que NO están en el mapa
    for (const [sessionName, session] of Object.entries(sessions)) {
        if (session.state === config.SESSION_STATES.ERROR && !sessionStartingTimestamps.has(sessionName)) {
            console.log(`⚠️ Sesión ${sessionName} en ERROR sin timestamp registrado. Agregando para limpieza...`);
            // Agregarla al mapa con timestamp actual para que se limpie en 5 minutos
            // O si ya tiene startTime antiguo, limpiar inmediatamente
            const sessionAge = session.startTime ? (now - new Date(session.startTime).getTime()) : 0;
            if (sessionAge > STALE_SESSION_TIMEOUT_MS) {
                staleSessions.push({
                    name: sessionName,
                    state: session.state,
                    elapsedMinutes: Math.floor(sessionAge / 60000)
                });
            } else {
                sessionStartingTimestamps.set(sessionName, Date.now());
            }
        }
    }
    
    // Eliminar sesiones estancadas
    for (const stale of staleSessions) {
        console.log(`⏰ Sesión ${stale.name} estancada por ${stale.elapsedMinutes}+ minutos (estado: ${stale.state}). Eliminando...`);
        
        try {
            await closeSession(stale.name);
            await deleteSessionData(stale.name);
            sessionStartingTimestamps.delete(stale.name);
            console.log(`🗑️ Sesión estancada ${stale.name} eliminada exitosamente`);
        } catch (err) {
            console.error(`❌ Error eliminando sesión estancada ${stale.name}:`, err.message);
        }
    }
    
    if (staleSessions.length > 0) {
        console.log(`🧹 Limpiador: ${staleSessions.length} sesiones estancadas eliminadas`);
    } else {
        console.log('🧹 Limpiador: No hay sesiones estancadas');
    }
    
    return staleSessions.length;
}

/**
 * Inicia el limpiador periódico de sesiones estancadas
 * Elimina sesiones que llevan más de 5 minutos sin conectarse
 */
function startStaleSessionCleaner() {
    if (staleSessionCleanerInterval) {
        clearInterval(staleSessionCleanerInterval);
    }
    
    console.log('🧹 Iniciando limpiador de sesiones estancadas (cada 5 minutos)');
    
    staleSessionCleanerInterval = setInterval(runStaleSessionCleaner, STALE_SESSION_CHECK_INTERVAL_MS);
}

/**
 * Crea un logger personalizado que captura mapeos LID↔PN
 */
function createLidCapturingLogger() {
    const baseLogger = pino({ level: 'debug' });
    return {
        level: 'debug',
        fatal: baseLogger.fatal.bind(baseLogger),
        error: baseLogger.error.bind(baseLogger),
        warn: baseLogger.warn.bind(baseLogger),
        info: (obj, msg) => {
            if (obj?.pnUser && obj?.lidUser) registerLidMapping(obj.lidUser, obj.pnUser);
            baseLogger.info(obj, msg);
        },
        debug: (obj, msg) => {
            if (obj?.pnUser && obj?.lidUser) registerLidMapping(obj.lidUser, obj.pnUser);
            baseLogger.debug(obj, msg);
        },
        trace: baseLogger.trace.bind(baseLogger),
        child: (bindings) => {
            if (bindings?.pnUser && bindings?.lidUser) registerLidMapping(bindings.lidUser, bindings.pnUser);
            return baseLogger.child(bindings);
        }
    };
}

/**
 * Crea una nueva sesión de WhatsApp con adaptadores multi-librería
 * Rota automáticamente entre Baileys Standard, Baileys Stealth y whatsapp-web.js
 */
async function createSession(sessionName) {
    console.log(`\n📱 Iniciando sesión ${sessionName}...`);
    
    if (sessions[sessionName]) {
        console.log(`⚠️ La sesión ${sessionName} ya existe`);
        return sessions[sessionName];
    }
    
    try {
        const authPath = path.join(config.SESSION_DATA_PATH, sessionName);
        await fs.mkdir(authPath, { recursive: true });
        
        // Seleccionar adaptador (round-robin entre librerías disponibles)
        const adapter = adapterFactory.getAdapterForSession(sessionName);
        console.log(`🔧 Adaptador seleccionado: ${adapter.getType()}`);
        
        // Logger personalizado que captura mapeos LID↔PN
        const logger = createLidCapturingLogger();
        
        // Obtener proxy único para esta sesión
        const currentProxyAgent = await getProxyAgentForSession(sessionName);
        if (currentProxyAgent) {
            console.log(`🌐 Proxy SOCKS5 asignado a sesión: ${sessionName} (IP única)`);
        } else {
            console.log('🌐 Usando conexión directa para sesión:', sessionName, '(IP VPS)');
        }
        
        // Conectar usando el adaptador seleccionado
        const { socket, saveCreds, adapterType } = await adapter.connect(authPath, {
            logger,
            agent: currentProxyAgent
        });
        
        // Guardar tipo de adaptador para reconexiones
        try {
            await fs.writeFile(path.join(authPath, '.adapter-type'), adapterType, 'utf-8');
        } catch (e) {}
        
        const session = {
            name: sessionName,
            socket,
            adapterType,
            state: config.SESSION_STATES.STARTING,
            qr: null,
            qrCount: 0,
            phoneNumber: null,
            info: null,
            startTime: new Date(),
            lastActivity: new Date(),
            messages: [],
            messagesSentCount: 0,
            messagesReceivedCount: 0,
            consolidatedCount: 0,
            retryCount: 0,
            authPath,
            saveCreds,
            loggedOutCount: 0
        };
        
        // Registrar timestamp de inicio para detectar sesiones estancadas
        sessionStartingTimestamps.set(sessionName, Date.now());
        
        sessions[sessionName] = session;
        
        // Manejar eventos de conexión
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, isNewLogin } = update;
            
            console.log(`📶 ${sessionName} connection.update:`, JSON.stringify({ connection, qr: !!qr, isNewLogin, statusCode: lastDisconnect?.error?.output?.statusCode }));
            
            if (qr) {
                session.qr = qr;
                session.qrCount++;
                session.state = config.SESSION_STATES.WAITING_FOR_QR;
                console.log(`📱 QR generado para ${sessionName} (${session.qrCount})`);
            }
            
            if (connection === 'close') {
                await handleConnectionClose(session, sessionName, lastDisconnect);
            }
            
            if (connection === 'open') {
                session.state = config.SESSION_STATES.READY;
                session.retryCount = 0;
                session.qr = null;
                session.qrCount = 0;
                session.loggedOutCount = 0;
                
                // Limpiar timestamp de sesión estancada ya que está conectada
                sessionStartingTimestamps.delete(sessionName);
                
                // Limpiar contadores persistentes de 401 ya que la sesión conectó exitosamente
                persistentLoggedOutCounts.delete(sessionName);
                persistentRetryCounts.delete(sessionName);
                
                const user = socket.user;
                if (user) {
                    session.phoneNumber = user.id.split(':')[0];
                    session.lid = socket.authState?.creds?.me?.lid ? socket.authState.creds.me.lid.split(':')[0] : null;
                    session.info = {
                        wid: user.id,
                        phone: session.phoneNumber,
                        lid: session.lid,
                        pushname: user.name || 'Usuario'
                    };
                    
                    console.log(`✅ ${sessionName} conectado: ${session.phoneNumber}`);
                    try { await saveCreds(); } catch (e) {}
                }
            }
        });
        
        socket.ev.on('creds.update', saveCreds);
        
        // Manejar mensajes entrantes
        socket.ev.on('messages.upsert', async (m) => {
            await handleIncomingMessage(session, sessionName, m, socket);
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
 * Maneja el cierre de conexión
 */
async function handleConnectionClose(session, sessionName, lastDisconnect) {
    // PRIMERO: Verificar si la sesión está siendo eliminada (prioridad máxima)
    if (session.isBeingDeleted) {
        console.log(`🗑️ Sesión ${sessionName} marcada para eliminación, no se reconectará`);
        session.state = config.SESSION_STATES.DISCONNECTED;
        sessionStartingTimestamps.delete(sessionName);
        delete sessions[sessionName];
        return;
    }

    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const errorMessage = lastDisconnect?.error?.message || '';
    let shouldReconnect = statusCode !== DisconnectReason.loggedOut;
    const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
    const isForbidden = statusCode === 403; // Número bloqueado/baneado
    const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
    
    // IMPORTANTE: El 515 con "Stream Errored" después de un nuevo login es NORMAL
    // Solo es error de sincronización real si es 440 o tiene "sync" sin ser 515
    const isSyncError = statusCode === 440 || (errorMessage.includes('sync') && !isRestartRequired);

    // Si es 515 (restart required), NO es un error de sincronización - solo necesita reconectar
    // Este es el comportamiento normal después de escanear QR
    if (isRestartRequired) {
        console.log(`🔄 ${sessionName} requiere restart (código ${statusCode}). Reconectando SIN eliminar datos...`);
        session.state = config.SESSION_STATES.RECONNECTING;
        session.retryCount = (session.retryCount || 0) + 1;
        
        if (session.retryCount <= 5) {
            if (session.socket) {
                try { await session.socket.ws?.close(); } catch (e) {}
            }
            await sleep(2000);
            delete sessions[sessionName];
            await createSession(sessionName);
        } else {
            session.state = config.SESSION_STATES.ERROR;
            sessionStartingTimestamps.set(sessionName, Date.now());
            console.log(`❌ ${sessionName} superó el límite de reintentos (5) tras restartRequired`);
        }
        return;
    }

    // Manejar error de sincronización REAL (440) - "Se cerró la sesión de tus dispositivos"
    if (isSyncError) {
        console.log(`🔄 ${sessionName} error de sincronización detectado (código ${statusCode}). Limpiando sesión...`);
        console.log(`⚠️ Este error ocurre cuando WhatsApp no puede verificar la sincronización entre dispositivos.`);
        console.log(`📱 La sesión necesita ser revinculada escaneando el QR nuevamente.`);
        
        session.state = config.SESSION_STATES.WAITING_FOR_QR;
        
        try {
            if (session.socket) {
                try { await session.socket.ws?.close(); } catch (e) {}
            }
            // Eliminar datos de autenticación para forzar nuevo QR
            await deleteSessionData(sessionName);
            releaseProxyForSession(sessionName);
        } catch (cleanErr) {
            console.error(`❌ Error limpiando datos de ${sessionName}: ${cleanErr.message}`);
        }
        
        // Esperar antes de recrear para evitar rate limiting
        await sleep(5000);
        delete sessions[sessionName];
        await createSession(sessionName);
        return;
    }

    // Manejar 403 (Forbidden) - número bloqueado por WhatsApp
    if (isForbidden) {
        const count = (forbiddenCounts.get(sessionName) || 0) + 1;
        forbiddenCounts.set(sessionName, count);
        console.log(`🚫 ${sessionName} recibió 403 (Forbidden) - intento ${count}/5`);
        
        if (count >= 5) {
            console.log(`⛔ ${sessionName} bloqueado por WhatsApp (403 x${count}). Eliminando sesión...`);
            session.state = config.SESSION_STATES.ERROR;
            sessionStartingTimestamps.set(sessionName, Date.now());
            forbiddenCounts.delete(sessionName);
            if (session.socket) {
                try { await session.socket.ws?.close(); } catch (e) {}
            }
            return;
        }
        
        // Esperar más tiempo entre intentos para 403
        const waitTime = count * 30; // 30s, 60s, 90s, 120s
        console.log(`⏳ Esperando ${waitTime}s antes de reintentar (403)...`);
        await sleep(waitTime * 1000);
        delete sessions[sessionName];
        await createSession(sessionName);
        return;
    }

    if (isLoggedOut && session.retryCount < 3) {
        console.log(`⚠️ ${sessionName} recibió estado ${statusCode} (loggedOut). Intentando rescate rápido (${session.retryCount + 1}/3)...`);
        shouldReconnect = true;
    }
    
    console.log(`❌ ${sessionName} desconectado. Status: ${statusCode}. Reconectar: ${shouldReconnect}`);
    notifySessionDisconnect(sessionName, statusCode);

    if (shouldReconnect) {
        const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
        const isQRConnectionClose = statusCode === DisconnectReason.connectionClosed || statusCode === 428;
        
        if (session.qr && isQRConnectionClose && !isRestartRequired) {
            console.log(`⏳ ${sessionName} cierre temporal durante QR, esperando reconexión automática...`);
            session.state = config.SESSION_STATES.WAITING_FOR_QR;
            return;
        }
        
        if (isRestartRequired) {
            session.state = config.SESSION_STATES.RECONNECTING;
            session.retryCount++;
            if (session.retryCount <= 5) {
                console.log(`🔄 ${sessionName} necesita restart (515). Reintentando en 2s (${session.retryCount}/5)...`);
                if (session.socket) {
                    try { await session.socket.ws?.close(); } catch (e) {}
                }
                await sleep(2000);
                delete sessions[sessionName];
                await createSession(sessionName);
            } else {
                session.state = config.SESSION_STATES.ERROR;
                console.log(`❌ ${sessionName} superó el límite de reintentos (5) tras restartRequired`);
            }
            return;
        }

        if (isLoggedOut) {
            // Usar contadores PERSISTENTES que no se pierden al recrear la sesión
            const persistentCount = (persistentLoggedOutCounts.get(sessionName) || 0) + 1;
            persistentLoggedOutCounts.set(sessionName, persistentCount);
            
            const persistentRetry = (persistentRetryCounts.get(sessionName) || 0) + 1;
            persistentRetryCounts.set(sessionName, persistentRetry);
            
            session.loggedOutCount = persistentCount;
            session.retryCount = persistentRetry;
            
            console.log(`⚠️ ${sessionName} recibió 401 (conteo persistente: ${persistentCount}/${MAX_PERSISTENT_401_COUNT}, retry: ${persistentRetry})`);
            
            // Si recibe 401 más de MAX_PERSISTENT_401_COUNT veces en total, eliminar permanentemente
            if (persistentCount >= MAX_PERSISTENT_401_COUNT) {
                console.log(`⛔ ${sessionName} recibió 401 ${persistentCount} veces en total. ELIMINANDO SESIÓN PERMANENTEMENTE.`);
                session.state = config.SESSION_STATES.ERROR;
                
                // Limpiar contadores persistentes
                persistentLoggedOutCounts.delete(sessionName);
                persistentRetryCounts.delete(sessionName);
                
                // Cerrar socket y eliminar datos
                if (session.socket) {
                    try { await session.socket.ws?.close(); } catch (e) {}
                }
                try {
                    await deleteSessionData(sessionName);
                } catch (e) {}
                
                delete sessions[sessionName];
                sessionStartingTimestamps.delete(sessionName);
                console.log(`🗑️ Sesión ${sessionName} eliminada permanentemente por loop de 401`);
                return;
            }
            
            // Primeros 3 intentos de rescate rápido
            if (persistentRetry <= 3) {
                session.state = config.SESSION_STATES.RECONNECTING;
                console.log(`⚠️ ${sessionName} recibió 401 (loggedOut ${persistentCount}x). Intento de rescate ${persistentRetry}/3 en 3s...`);
                if (session.socket) {
                    try { await session.socket.ws?.close(); } catch (e) {}
                }
                await sleep(3000);
                delete sessions[sessionName];
                await createSession(sessionName);
                return;
            }
            
            // Después de 3 intentos, limpiar datos y pedir nuevo QR (solo 1 vez, si persistentRetry == 4)
            if (persistentRetry === 4) {
                session.state = config.SESSION_STATES.WAITING_FOR_QR;
                console.log(`🧹 ${sessionName} continúa con 401 tras 3 intentos. Limpiando datos y esperando nuevo QR...`);
                try {
                    if (session.socket) {
                        try { await session.socket.ws?.close(); } catch (e) {}
                    }
                    await deleteSessionData(sessionName);
                } catch (cleanErr) {
                    console.error(`❌ Error limpiando datos de ${sessionName}: ${cleanErr.message}`);
                }
                delete sessions[sessionName];
                await createSession(sessionName);
                return;
            }
            
            // Si persistentRetry > 4, marcar para limpieza y dejar de intentar
            console.log(`⛔ ${sessionName} persistentRetry=${persistentRetry}. Marcando para limpieza...`);
            session.state = config.SESSION_STATES.ERROR;
            sessionStartingTimestamps.set(sessionName, Date.now());
            if (session.socket) {
                try { await session.socket.ws?.close(); } catch (e) {}
            }
            return;
        }

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
            // Registrar para que el limpiador de sesiones estancadas la elimine
            sessionStartingTimestamps.set(sessionName, Date.now());
            if (session.socket) {
                try { await session.socket.ws?.close(); } catch (e) {}
            }
            console.log(`❌ ${sessionName} superó el límite de reintentos (5). Será eliminada por el limpiador.`);
        }
    } else {
        session.state = config.SESSION_STATES.DISCONNECTED;
        delete sessions[sessionName];
        console.log(`📴 ${sessionName} cerró sesión. Manteniendo datos de autenticación para diagnóstico.`);
    }
}

/**
 * Maneja los mensajes entrantes
 */
async function handleIncomingMessage(session, sessionName, m, socket) {
    const message = m.messages[0];
    
    // Detectar cuando el usuario envía un mensaje desde su celular
    if (message.key.fromMe && m.type === 'notify') {
        console.log(`👤📤 ${sessionName} envió mensaje desde celular - marcando como uso manual`);
        markSessionAsManualUse(sessionName);
    }

    if (!message.key.fromMe && m.type === 'notify') {
        const remoteJid = message.key.remoteJid;
        
        // Resolver número real si es un LID (Linked ID)
        let senderPhone = remoteJid;
        let senderNumber = '';
        
        if (remoteJid.endsWith('@lid')) {
            // Es un LID, intentar obtener el número real del mapeo
            const lidNumber = remoteJid.replace('@lid', '');
            
            // Primero: usar nuestro mapeo LID→PN
            const resolvedPhone = resolvePhoneFromLid(lidNumber);
            if (resolvedPhone) {
                senderNumber = resolvedPhone;
                senderPhone = `${resolvedPhone}@s.whatsapp.net`;
                console.log(`🔗 LID ${lidNumber} resuelto a número: ${senderNumber} (desde mapeo)`);
            }
            
            // Alternativa: usar participant si es grupo
            if (!senderNumber && message.key.participant) {
                senderPhone = message.key.participant;
                senderNumber = message.key.participant.replace('@s.whatsapp.net', '').replace('@c.us', '').split(':')[0];
                console.log(`🔗 Usando participant como número: ${senderNumber}`);
            }
            
            // Si no se pudo resolver, extraer el LID como fallback
            if (!senderNumber) {
                senderNumber = lidNumber;
                console.log(`⚠️ No se pudo resolver LID ${lidNumber} a número real`);
            }
        } else {
            // Es un número normal @s.whatsapp.net
            senderNumber = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').split(':')[0];
        }
        
        console.log(`💬📥 ${sessionName} recibió mensaje de ${remoteJid} (número: ${senderNumber})`);
        
        // Incrementar contador de mensajes recibidos
        session.messagesReceivedCount = (session.messagesReceivedCount || 0) + 1;
        session.lastActivity = new Date();

        const msgObj = message.message || {};
        const incomingText = msgObj.conversation 
            || msgObj.extendedTextMessage?.text 
            || msgObj.imageMessage?.caption 
            || msgObj.videoMessage?.caption 
            || '';

        logMessageReceived(sessionName, message.key.remoteJid, incomingText);
        
        if (!session.messages) session.messages = [];
        session.messages.push({
            timestamp: new Date(),
            from: message.key.remoteJid,
            message: incomingText || '[mensaje sin texto]',
            direction: 'IN',
            status: 'received'
        });
        
        if (session.messages.length > config.MAX_MESSAGE_HISTORY) {
            session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);
        }

        // Auto-respuesta inteligente (senderPhone y senderNumber ya calculados arriba)
        const isFromActiveSession = isSessionPhone(senderPhone);
        const isFromConversation = isActiveConversationPhone(senderPhone);
        const senderSessionName = getSessionNameByPhone(senderPhone);
        const senderInManualUse = senderSessionName ? isSessionInManualUse(senderSessionName) : false;
        const thisSessionInManualUse = isSessionInManualUse(sessionName);
        
        // Verificar si el número está en la lista de respuesta IA automática
        const isAIAutoResponseNumber = config.AI_AUTO_RESPONSE_NUMBERS.includes(senderNumber);
        
        console.log(`📨 Mensaje de ${senderPhone} | EsSesión: ${isFromActiveSession} | EsConversaciónIA: ${isFromConversation} | RemitenteManual: ${senderInManualUse} | ReceptorManual: ${thisSessionInManualUse} | IAAutoResp: ${isAIAutoResponseNumber}`);
        
        if (message.message) {
            // Respuesta IA automática para números específicos
            if (isAIAutoResponseNumber && !isFromConversation) {
                console.log(`🤖✨ Número ${senderNumber} está en lista de IA automática - generando respuesta...`);
                await handleAIAutoResponse(session, sessionName, message, socket, senderPhone);
            } else if (isFromActiveSession && !isFromConversation) {
                if (thisSessionInManualUse) {
                    console.log(`👤 ${sessionName} está en uso manual - NO responderá automáticamente`);
                } else {
                    await handleAutoResponse(session, sessionName, message, socket, senderSessionName, senderPhone);
                }
            } else if (isFromConversation) {
                console.log(`⏭️ Mensaje en conversación IA activa: ${senderPhone}`);
            } else if (config.AUTO_RESPONSE && !isFromActiveSession) {
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
}

/**
 * Maneja respuesta IA automática para números específicos
 */
async function handleAIAutoResponse(session, sessionName, message, socket, senderPhone) {
    try {
        const messageText = message.message.conversation || 
                          message.message.extendedTextMessage?.text || 
                          message.message.imageMessage?.caption ||
                          message.message.videoMessage?.caption ||
                          '';
        
        if (!messageText) {
            console.log(`📎 Mensaje sin texto de ${senderPhone}, no se genera respuesta IA`);
            return;
        }
        
        console.log(`💭 Generando respuesta IA para mensaje: "${messageText.substring(0, 50)}..."`);
        
        const aiResponse = await generateSimpleAIResponse(messageText, session.messages.slice(-10));
        
        // Delay aleatorio entre 3-8 segundos para parecer más natural
        const delay = Math.floor(Math.random() * 5000) + 3000;
        console.log(`⏱️ Esperando ${delay/1000}s antes de responder...`);
        
        setTimeout(async () => {
            try {
                await socket.sendMessage(message.key.remoteJid, {
                    text: aiResponse
                });
                // Incrementar contador de mensajes enviados
                session.messagesSentCount = (session.messagesSentCount || 0) + 1;
                console.log(`✅🤖 ${sessionName} respondió con IA a ${senderPhone}: "${aiResponse.substring(0, 80)}..."`);
            } catch (err) {
                console.error(`Error enviando respuesta IA: ${err.message}`);
            }
        }, delay);
    } catch (error) {
        console.error(`Error en handleAIAutoResponse: ${error.message}`);
    }
}

/**
 * Maneja respuestas automáticas entre sesiones
 */
async function handleAutoResponse(session, sessionName, message, socket, senderSessionName, senderPhone) {
    const conversationKey = [senderSessionName, sessionName].sort().join('-');
    const counter = autoResponseCounters.get(conversationKey) || { count: 0, lastActivity: Date.now() };
    
    if (Date.now() - counter.lastActivity > 30 * 60 * 1000) {
        counter.count = 0;
    }
    
    const AUTO_RESPONSE_LIMIT = 5;
    
    if (counter.count >= AUTO_RESPONSE_LIMIT) {
        console.log(`⏸️ ${sessionName} alcanzó límite de ${AUTO_RESPONSE_LIMIT} respuestas automáticas con ${senderSessionName}`);
    } else {
        console.log(`🤖 Conversación IA: ${sessionName} responderá a sesión ${senderSessionName || senderPhone} (${counter.count + 1}/${AUTO_RESPONSE_LIMIT})`);
        try {
            const messageText = message.message.conversation || 
                              message.message.extendedTextMessage?.text || 
                              'Mensaje';
            
            const aiResponse = await generateSimpleAIResponse(messageText, session.messages.slice(-5));
            
            const delay = Math.floor(Math.random() * 10000) + 5000;
            setTimeout(async () => {
                try {
                    await socket.sendMessage(message.key.remoteJid, {
                        text: aiResponse
                    });
                    
                    counter.count++;
                    counter.lastActivity = Date.now();
                    autoResponseCounters.set(conversationKey, counter);
                    
                    // Incrementar contador de mensajes enviados
                    session.messagesSentCount = (session.messagesSentCount || 0) + 1;
                    
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
    
    session.isBeingDeleted = true;
    try {
        if (session.socket) {
            if (shouldLogout) {
                console.log(`📴 Cerrando sesión ${sessionName} con logout...`);
                try {
                    await session.socket.logout();
                } catch (logoutErr) {
                    console.log(`⚠️ Error en logout de ${sessionName}: ${logoutErr.message}. Continuando con cierre...`);
                }
            } else {
                console.log(`📴 Cerrando conexión ${sessionName} (sin logout)...`);
                try {
                    session.socket.end(undefined);
                } catch (endErr) {
                    console.log(`⚠️ Error cerrando socket de ${sessionName}: ${endErr.message}`);
                }
            }
        }
        
        session.state = config.SESSION_STATES.DISCONNECTED;
        console.log(`📴 Sesión ${sessionName} cerrada exitosamente`);
        return true;
    } catch (error) {
        console.error(`Error cerrando sesión ${sessionName}:`, error.message);
        return false;
    } finally {
        // IMPORTANTE: Siempre eliminar la sesión del objeto sessions,
        // incluso si hubo errores durante el cierre
        delete sessions[sessionName];
        sessionStartingTimestamps.delete(sessionName);
        releaseProxyForSession(sessionName);
    }
}

/**
 * Elimina los datos de autenticación de una sesión
 */
async function deleteSessionData(sessionName) {
    const authPath = path.join(config.SESSION_DATA_PATH, sessionName);
    
    try {
        // Liberar el proxy asignado a esta sesión
        releaseProxyForSession(sessionName);
        
        await fs.rm(authPath, { recursive: true, force: true });
        console.log(`🗑️ Datos de ${sessionName} eliminados`);
        return true;
    } catch (error) {
        console.error(`Error eliminando datos de ${sessionName}:`, error.message);
        return false;
    }
}

/**
 * Notifica desconexión de sesión
 */
function notifySessionDisconnect(sessionName, statusCode) {
    const now = Date.now();
    const lastAt = lastDisconnectNotify.get(sessionName) || 0;
    if (now - lastAt < DISCONNECT_NOTIFY_COOLDOWN_MS) return;
    lastDisconnectNotify.set(sessionName, now);

    const sessionsStatus = getSessionsStatus();
    const active = rotation.getActiveSessions();
    const inactive = sessionsStatus.filter(s => s.state !== config.SESSION_STATES.READY);
    
    const nowStr = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const codeText = statusCode !== undefined && statusCode !== null ? statusCode : 'N/A';
    
    const EMOJI = {
        WARNING: '\u26A0\uFE0F',
        CLOCK: '\u23F0',
        PHONE: '\uD83D\uDCF1',
        CODE: '\uD83D\uDCBB',
        CHART: '\uD83D\uDCCA',
        CHECK: '\u2705',
        ALERT: '\uD83D\uDEA8',
        TOOLS: '\uD83D\uDD27'
    };
    
    let message = `${EMOJI.CHART} *REPORTE SESIONES*\n\n` +
                  `${EMOJI.CLOCK} ${nowStr}\n\n` +
                  `${EMOJI.PHONE} Sesion: *${sessionName}*\n` +
                  `${EMOJI.CODE} Status Code: ${codeText}\n\n` +
                  `${EMOJI.CHART} Total: ${sessionsStatus.length} | ${EMOJI.CHECK} Activas: ${active.length} | ${EMOJI.WARNING} Inactivas: ${inactive.length}\n\n`;
    
    if (active.length > 0) {
        message += "*Sesiones Activas:*\n";
        active.forEach((s, i) => {
            const info = sessions[s.name]?.info || {};
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

// ======================== FUNCIONES DE ESTADO ========================

function getAllSessions() {
    return sessions;
}

function getSession(sessionName) {
    return sessions[sessionName];
}

function getSessionsStatus() {
    const maxPerHour = config.MAX_MESSAGES_PER_SESSION_PER_HOUR || 60;
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    return Object.entries(sessions).map(([name, session]) => {
        // Calcular mensajes enviados en la última hora
        const timestamps = session.messageTimestamps || [];
        const recentMessages = timestamps.filter(ts => ts > oneHourAgo);
        const hourlyCount = recentMessages.length;
        const hourlyLimitReached = hourlyCount >= maxPerHour;
        
        // Calcular tiempo hasta que se libere un slot (cuando expire el mensaje más antiguo)
        let resetTimeMs = 0;
        if (hourlyLimitReached && recentMessages.length > 0) {
            // Ordenar timestamps de menor a mayor
            const sortedTimestamps = [...recentMessages].sort((a, b) => a - b);
            // El mensaje más antiguo expirará en: (timestamp + 1 hora) - ahora
            const oldestTimestamp = sortedTimestamps[0];
            resetTimeMs = Math.max(0, (oldestTimestamp + 60 * 60 * 1000) - now);
        }
        
        return {
            name,
            state: session.state,
            phoneNumber: session.phoneNumber,
            qrReady: !!session.qr,
            messagesCount: session.messagesSentCount || 0,
            lastActivity: session.lastActivity,
            uptime: Date.now() - session.startTime.getTime(),
            retryCount: session.retryCount,
            // Información de límite horario
            hourlyCount,
            hourlyLimit: maxPerHour,
            hourlyLimitReached,
            resetTimeMs // Tiempo en ms hasta que se libere un slot
        };
    });
}

// ======================== USO MANUAL ========================

function markSessionAsManualUse(sessionName) {
    if (manualUseSessions.has(sessionName)) {
        clearTimeout(manualUseSessions.get(sessionName).timeout);
    }
    
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

function isSessionInManualUse(sessionName) {
    return manualUseSessions.has(sessionName);
}

function getSessionNameByPhone(phone) {
    if (!phone) return null;
    
    const cleaned = phone.split('@')[0].split(':')[0].replace(/\D/g, '');
    
    for (const [sessionName, session] of Object.entries(sessions)) {
        if (session.state === config.SESSION_STATES.READY) {
            if (session.phoneNumber) {
                const sessionCleaned = session.phoneNumber.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (cleaned === sessionCleaned) {
                    return sessionName;
                }
            }
            
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

// ======================== CONVERSACIÓN IA ========================

async function generateSimpleAIResponse(incomingMessage, recentMessages = []) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (OPENAI_API_KEY) {
        try {
            const conversationHistory = recentMessages
                .filter(msg => msg.text)
                .slice(-3)
                .map(msg => ({
                    role: msg.direction === 'sent' ? 'assistant' : 'user',
                    content: msg.text
                }));
            
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
        }
    }
    
    // Respuestas predefinidas
    const lowerMessage = incomingMessage.toLowerCase();
    
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
    
    const genericResponses = [
        'Sí, tienes razón', 'Qué interesante', 'Claro!', 'Verdad?', 'Eso mismo pensaba',
        'Me parece bien', 'Listo!', 'Bacano!', 'Entiendo', 'Aja', 'Ya veo',
        'Totalmente', 'Por supuesto', 'Sin duda', 'Exacto'
    ];
    
    return genericResponses[Math.floor(Math.random() * genericResponses.length)];
}

function setActiveConversationPhones(phones) {
    activeConversationPhones = new Set(phones.map(p => p.replace(/\D/g, '')));
    console.log(`🤖 Conversación IA activa con ${activeConversationPhones.size} números`);
}

function clearActiveConversationPhones() {
    activeConversationPhones.clear();
    console.log('🤖 Conversación IA finalizada');
}

function isActiveConversationPhone(phone) {
    if (!phone) return false;
    const cleaned = phone.replace(/\D/g, '').replace(/@.*/, '');
    return activeConversationPhones.has(cleaned);
}

function isSessionPhone(phone) {
    if (!phone) return false;
    
    const cleaned = phone.split('@')[0].split(':')[0].replace(/\D/g, '');
    
    if (!cleaned) return false;
    
    for (const session of Object.values(sessions)) {
        if (session.state === config.SESSION_STATES.READY) {
            if (session.phoneNumber) {
                const sessionCleaned = session.phoneNumber.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (cleaned === sessionCleaned) {
                    return true;
                }
            }
            
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

module.exports = {
    // Sesiones
    sessions,
    createSession,
    loadSessionsFromDisk,
    closeSession,
    deleteSessionData,
    getSession,
    getAllSessions,
    getSessionsStatus,
    getQRCode,
    // Estado manual
    markSessionAsManualUse,
    isSessionInManualUse,
    getSessionNameByPhone,
    // Limpiador
    runStaleSessionCleaner,
    // Conversación IA
    generateSimpleAIResponse,
    setActiveConversationPhones,
    clearActiveConversationPhones,
    isActiveConversationPhone,
    isSessionPhone
};
