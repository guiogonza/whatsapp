const express = require('express');
const http = require('http');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const multer = require('multer');

// Configuración de multer para subida de archivos
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 16 * 1024 * 1024 // 16MB máximo
    },
    fileFilter: (req, file, cb) => {
        // Tipos de archivo permitidos
        const allowedMimes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/3gpp',
            'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`), false);
        }
    }
});

// Configuración de variables de entorno
const dotenv = require('dotenv');
dotenv.config();

// Configuración de la aplicación
const app = express();
const PORT = process.env.PORT || 3010;
const SESSION_DATA_PATH = path.join(__dirname, 'whatsapp-sessions');

// Variables de configuración de consola
const CONSOLE_CLEAR_ENABLED = process.env.CONSOLE_CLEAR_ENABLED === 'true';
const CONSOLE_CLEAR_INTERVAL = parseInt(process.env.CONSOLE_CLEAR_INTERVAL_MINUTES) || 5;

// Variables de estado global
let consoleLogCount = 0;
let lastClearTime = new Date();
let consoleClearInterval = null;
let sessionMonitorInterval = null;

// Función para monitorear estado de sesiones
async function monitorSessions() {
    const sessionNames = Object.keys(sessions);
    
    for (const sessionName of sessionNames) {
        const session = sessions[sessionName];
        
        // Solo verificar sesiones que están marcadas como READY
        if (session.state === SESSION_STATES.READY && session.client) {
            try {
                const state = await session.client.getState();
                
                if (state !== 'CONNECTED') {
                    console.log(`⚠️ Sesión ${sessionName} se detectó desconectada (estado: ${state})`);
                    session.state = SESSION_STATES.DISCONNECTED;
                    session.qr = null;
                }
            } catch (error) {
                console.log(`⚠️ Sesión ${sessionName} no responde, marcando como desconectada`);
                session.state = SESSION_STATES.DISCONNECTED;
                session.qr = null;
            }
        }
    }
}

// Configurar monitoreo de sesiones cada 30 segundos
sessionMonitorInterval = setInterval(monitorSessions, 30000);
console.log('Monitor de sesiones activo (verifica cada 30 segundos)');


// Función para limpiar consola
function clearConsole() {
    if (CONSOLE_CLEAR_ENABLED) {
        console.clear();
        consoleLogCount = 0;
        lastClearTime = new Date();
        console.log(`Consola limpiada automáticamente. Próxima limpieza en ${CONSOLE_CLEAR_INTERVAL} minutos.`);
    }
}

// Configurar limpieza automática de consola
if (CONSOLE_CLEAR_ENABLED) {
    consoleClearInterval = setInterval(clearConsole, CONSOLE_CLEAR_INTERVAL * 60 * 1000);
    console.log(`Limpieza automática de consola habilitada cada ${CONSOLE_CLEAR_INTERVAL} minutos`);
}

// Interceptar console.log para conteo
const originalConsoleLog = console.log;
console.log = function(...args) {
    consoleLogCount++;
    originalConsoleLog.apply(console, args);
};

// Asegurar que existe la carpeta de sesiones
async function ensureSessionDirectory() {
    try {
        await fs.access(SESSION_DATA_PATH);
    } catch {
        await fs.mkdir(SESSION_DATA_PATH, { recursive: true });
        console.log(`Carpeta de sesiones creada en: ${SESSION_DATA_PATH}`);
    }
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.static(path.join(__dirname, 'public')));

// Estados de sesión
const SESSION_STATES = {
    STARTING: 'STARTING',
    LOADING: 'LOADING',
    WAITING_FOR_QR: 'WAITING_FOR_QR',
    READY: 'READY',
    DISCONNECTED: 'DISCONNECTED',
    ERROR: 'ERROR',
    RECONNECTING: 'RECONNECTING'
};

// Almacén de sesiones activas
const sessions = {};

// Función para validar nombre de sesión
function validateSessionName(sessionName) {
    if (!sessionName) return { valid: false, error: 'Se requiere el nombre de la sesión' };
    if (typeof sessionName !== 'string') return { valid: false, error: 'El nombre debe ser una cadena de texto' };
    if (sessionName.length < 3) return { valid: false, error: 'El nombre debe tener al menos 3 caracteres' };
    if (sessionName.length > 20) return { valid: false, error: 'El nombre no puede tener más de 20 caracteres' };
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
        return { valid: false, error: 'Nombre inválido. Use solo letras, números, guiones y guiones bajos' };
    }
    return { valid: true };
}

// Función para formatear número de teléfono
function formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    const cleaned = phoneNumber.toString().replace(/[^\d]/g, '');
    if (cleaned.length < 10 || cleaned.length > 15) return null;
    return phoneNumber.endsWith('@c.us') ? phoneNumber : `${cleaned}@c.us`;
}

// Función para verificar si el cliente está realmente listo para enviar mensajes
async function isClientTrulyReady(session, skipStoreCheck = false) {
    if (!session || !session.client) return false;
    
    try {
        // Verificar que el cliente tenga info básica
        const info = session.client.info;
        if (!info || !info.wid) {
            console.log(`Cliente ${session.name}: sin info de usuario`);
            return false;
        }
        
        // Si skipStoreCheck es true, solo verificamos que haya info (más permisivo)
        if (skipStoreCheck) {
            return true;
        }
        
        // Verificación opcional del Store (solo informativa, no bloqueante)
        if (session.client.pupPage) {
            try {
                const storeState = await session.client.pupPage.evaluate(() => {
                    // Verificar múltiples formas de detectar conexión
                    if (window.Store && window.Store.State) {
                        if (window.Store.State.Socket) {
                            return window.Store.State.Socket.state;
                        }
                        // Fallback: verificar si hay conexión de otra forma
                        if (window.Store.Stream) {
                            return window.Store.Stream.displayInfo ? 'CONNECTED' : 'UNKNOWN';
                        }
                    }
                    // Si el Store no está disponible pero hay módulos WA
                    if (window.WWebJS || window.webpackChunkwhatsapp_web_client) {
                        return 'WA_LOADED';
                    }
                    return 'STORE_NOT_FOUND';
                });
                
                // Log informativo pero no bloqueamos
                if (storeState !== 'CONNECTED' && storeState !== 'WA_LOADED') {
                    console.log(`Cliente ${session.name}: Estado Store=${storeState} (continuando de todos modos)`);
                }
            } catch (evalError) {
                // Si hay error evaluando, continuamos de todas formas ya que tenemos info
                console.log(`Cliente ${session.name}: No se pudo verificar Store (continuando): ${evalError.message}`);
            }
        }
        
        // Si llegamos aquí y tenemos info, el cliente está listo
        return true;
    } catch (error) {
        console.log(`Error verificando cliente ${session.name}: ${error.message}`);
        return false;
    }
}

// Función para esperar que el cliente esté listo
async function waitForClientReady(session, maxWaitMs = 30000, skipStoreCheck = false) {
    const startTime = Date.now();
    const checkInterval = 2000;
    
    while (Date.now() - startTime < maxWaitMs) {
        const isReady = await isClientTrulyReady(session, skipStoreCheck);
        if (isReady) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    return false;
}

// Función para enviar mensaje con reintentos y manejo de WidFactory
async function sendMessageWithRetry(session, formattedNumber, message, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // En el primer intento, verificar normalmente
            // En reintentos, ser más permisivo (skipStoreCheck = true si hay info)
            const skipStoreCheck = attempt > 1 && session.client && session.client.info;
            const isReady = await isClientTrulyReady(session, skipStoreCheck);
            
            if (!isReady) {
                console.log(`${session.name}: Cliente no listo en intento ${attempt}, esperando...`);
                
                // Esperar que se reconecte (más permisivo en reintentos)
                const becameReady = await waitForClientReady(session, 10000, skipStoreCheck);
                
                if (!becameReady) {
                    // Si tenemos info del cliente, intentar enviar de todas formas
                    if (session.client && session.client.info && session.client.info.wid) {
                        console.log(`${session.name}: Intentando enviar aunque verificación falló...`);
                    } else {
                        throw new Error('Cliente no está listo después de esperar');
                    }
                }
            }
            
            // Intentar enviar el mensaje
            const messageResult = await session.client.sendMessage(formattedNumber, message);
            return { success: true, messageResult };
            
        } catch (error) {
            lastError = error;
            const errorMsg = error.message || String(error);
            
            console.log(`${session.name}: Error en intento ${attempt}/${maxRetries}: ${errorMsg}`);
            
            // Si es error de WidFactory o similar, esperar más antes de reintentar
            if (errorMsg.includes('WidFactory') || 
                errorMsg.includes('Cannot read properties of undefined') ||
                errorMsg.includes('Evaluation failed')) {
                
                console.log(`${session.name}: Error de conexión WhatsApp detectado, esperando reconexión...`);
                
                // Esperar más tiempo para que WhatsApp Web se estabilice
                await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
                
                // Intentar refrescar la página si es posible
                if (session.client.pupPage && attempt < maxRetries) {
                    try {
                        console.log(`${session.name}: Intentando refrescar conexión...`);
                        await session.client.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
                        await new Promise(resolve => setTimeout(resolve, 10000));
                    } catch (refreshError) {
                        console.log(`${session.name}: Error refrescando: ${refreshError.message}`);
                    }
                }
            } else if (attempt < maxRetries) {
                // Para otros errores, espera más corta
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }
    }
    
    return { success: false, error: lastError };
}

// Función para verificar estado del cliente
async function checkClientReady(sessionName) {
    const session = sessions[sessionName];
    if (!session || !session.client) return false;

    try {
        const info = session.client.info;
        if (info && info.wid) {
            console.log(`Cliente verificado como listo: ${sessionName}`);
            session.state = SESSION_STATES.READY;
            session.userInfo = {
                pushname: info.pushname,
                wid: info.wid.user,
                platform: info.platform
            };
            return true;
        }
    } catch (error) {
        console.log(`Cliente aún no está completamente listo ${sessionName}: ${error.message}`);
    }
    return false;
}

// Función para inicializar cliente - OPTIMIZADA
async function initializeClient(sessionName) {
    const validation = validateSessionName(sessionName);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    let readyTimeout = null;
    let verificationInterval = null;
    let readyCheckInterval = null;

    try {
        console.log(`Iniciando cliente WhatsApp para: ${sessionName}`);

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: sessionName,
                dataPath: SESSION_DATA_PATH
            }),
            puppeteer: {
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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
                timeout: 60000
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/AnjasWijayaIN/webjs-version/main/version.json'
            }
        });

        // Función para limpiar timeouts
        const clearTimeouts = () => {
            if (readyTimeout) { clearTimeout(readyTimeout); readyTimeout = null; }
            if (verificationInterval) { clearInterval(verificationInterval); verificationInterval = null; }
            if (readyCheckInterval) { clearInterval(readyCheckInterval); readyCheckInterval = null; }
        };

        // EVENTO QR
        client.on('qr', (qr) => {
            console.log(`QR generado para ${sessionName}`);
            sessions[sessionName].qr = qr;
            sessions[sessionName].state = SESSION_STATES.WAITING_FOR_QR;
            sessions[sessionName].lastActivity = new Date();
        });

        // EVENTO AUTHENTICATED
        client.on('authenticated', () => {
            console.log(`Autenticación exitosa para ${sessionName}`);
            sessions[sessionName].state = SESSION_STATES.LOADING;
            sessions[sessionName].qr = null;
            sessions[sessionName].lastActivity = new Date();

            // Verificar cada 5 segundos si está listo
            readyCheckInterval = setInterval(async () => {
                const isReady = await checkClientReady(sessionName);
                if (isReady && readyCheckInterval) {
                    clearInterval(readyCheckInterval);
                    readyCheckInterval = null;
                }
            }, 5000);

            // Timeout para forzar READY si no se dispara automáticamente
            readyTimeout = setTimeout(() => {
                if (sessions[sessionName] && sessions[sessionName].state === SESSION_STATES.LOADING) {
                    console.log(`Forzando estado READY para ${sessionName} después de 45 segundos`);
                    sessions[sessionName].state = SESSION_STATES.READY;
                    if (readyCheckInterval) {
                        clearInterval(readyCheckInterval);
                        readyCheckInterval = null;
                    }
                }
            }, 45000);
        });

        // EVENTO READY
        client.on('ready', async () => {
            console.log(`Cliente listo: ${sessionName}`);
            sessions[sessionName].state = SESSION_STATES.READY;
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
                console.log(`${sessionName} conectado como: ${info.pushname}`);
            } catch (error) {
                console.log(`Cliente conectado correctamente: ${sessionName}`);
            }
            
            // Esperar un poco más para que WhatsApp Web esté completamente inicializado
            setTimeout(async () => {
                const trulyReady = await isClientTrulyReady(sessions[sessionName]);
                console.log(`${sessionName} verificación profunda: ${trulyReady ? 'LISTO' : 'AÚN CARGANDO'}`);
            }, 5000);
        });

        // EVENTO DISCONNECTED
        client.on('disconnected', (reason) => {
            console.log(`${sessionName} desconectado: ${reason}`);

            if (sessions[sessionName]) {
                sessions[sessionName].state = SESSION_STATES.DISCONNECTED;
                sessions[sessionName].qr = null;
                sessions[sessionName].lastActivity = new Date();
            }

            clearTimeouts();
        });

        // EVENTO AUTH_FAILURE
        client.on('auth_failure', (message) => {
            console.error(`Fallo de autenticación en ${sessionName}: ${message}`);

            if (sessions[sessionName]) {
                sessions[sessionName].state = SESSION_STATES.ERROR;
                sessions[sessionName].qr = null;
                sessions[sessionName].error = `Auth failure: ${message}`;
                sessions[sessionName].lastActivity = new Date();
            }

            clearTimeouts();
        });

        // EVENTO LOADING_SCREEN
        client.on('loading_screen', (percent, message) => {
            console.log(`${sessionName} cargando: ${percent}% - ${message}`);
        });
        
        // EVENTO CHANGE_STATE - para detectar reconexiones
        client.on('change_state', (state) => {
            console.log(`${sessionName} cambio de estado: ${state}`);
            if (sessions[sessionName]) {
                sessions[sessionName].connectionState = state;
            }
        });

        // MANEJO DE MENSAJES
        client.on('message', async (msg) => {
            if (msg.fromMe) return;

            try {
                const contact = await msg.getContact();
                console.log(`Mensaje de ${contact.pushname || contact.number} para ${sessionName}: ${msg.body.substring(0, 50)}...`);

                const autoResponse = process.env.AUTO_RESPONSE;
                if (autoResponse && autoResponse.trim()) {
                    await msg.reply(autoResponse);

                    if (!sessions[sessionName].messages) sessions[sessionName].messages = [];
                    sessions[sessionName].messages.push({
                        timestamp: new Date(),
                        from: msg.from,
                        contact: contact.pushname || contact.number,
                        message: msg.body,
                        response: autoResponse,
                        direction: 'IN',
                        type: msg.type
                    });

                    // Mantener solo los últimos 100 mensajes
                    if (sessions[sessionName].messages.length > 100) {
                        sessions[sessionName].messages = sessions[sessionName].messages.slice(-100);
                    }
                }

                sessions[sessionName].lastActivity = new Date();
            } catch (error) {
                console.error(`Error procesando mensaje para ${sessionName}: ${error.message}`);
            }
        });

        // Inicializar cliente
        await client.initialize();
        sessions[sessionName].client = client;

        return client;
    } catch (error) {
        if (readyTimeout) clearTimeout(readyTimeout);
        if (verificationInterval) clearInterval(verificationInterval);
        if (readyCheckInterval) clearInterval(readyCheckInterval);

        if (sessions[sessionName]) {
            sessions[sessionName].state = SESSION_STATES.ERROR;
            sessions[sessionName].error = error.message;
        }

        console.error(`Error inicializando ${sessionName}: ${error.message}`);
        throw error;
    }
}

// Cargar sesiones existentes al inicio
async function loadExistingSessions() {
    try {
        await ensureSessionDirectory();

        const sessionFolders = await fs.readdir(SESSION_DATA_PATH);
        const validSessions = sessionFolders.filter(folder =>
            folder.startsWith('session-') &&
            fsSync.statSync(path.join(SESSION_DATA_PATH, folder)).isDirectory()
        );

        console.log(`Encontradas ${validSessions.length} sesiones existentes`);

        for (const folder of validSessions) {
            const sessionName = folder.replace('session-', '');
            console.log(`Cargando sesión existente: ${sessionName}`);

            sessions[sessionName] = {
                name: sessionName,
                client: null,
                qr: null,
                state: SESSION_STATES.LOADING,
                messages: [],
                lastActivity: new Date(),
                error: null
            };

            try {
                await initializeClient(sessionName);
            } catch (error) {
                console.error(`Error cargando ${sessionName}: ${error.message}`);
                if (sessions[sessionName]) {
                    sessions[sessionName].state = SESSION_STATES.ERROR;
                    sessions[sessionName].error = error.message;
                }
            }

            // Pausa entre cargas para evitar saturar
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

    } catch (error) {
        console.error(`Error cargando sesiones existentes: ${error.message}`);
    }
}

// ======================== ENDPOINTS API ========================

// Health check
app.get('/health', async (req, res) => {
    // Verificar estado real de las sesiones
    const sessionStates = await Promise.all(Object.keys(sessions).map(async key => {
        const session = sessions[key];
        let actualState = session.state;
        
        // Si está marcada como READY, verificar que realmente lo esté
        if (session.state === SESSION_STATES.READY && session.client) {
            try {
                const state = await session.client.getState();
                if (state !== 'CONNECTED') {
                    actualState = SESSION_STATES.DISCONNECTED;
                    session.state = SESSION_STATES.DISCONNECTED;
                }
            } catch (error) {
                actualState = SESSION_STATES.DISCONNECTED;
                session.state = SESSION_STATES.DISCONNECTED;
            }
        }
        
        return {
            name: key,
            state: actualState
        };
    }));
    
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        sessions: {
            count: Object.keys(sessions).length,
            ready: sessionStates.filter(s => s.state === SESSION_STATES.READY).length,
            states: sessionStates
        },
        console: {
            clearEnabled: CONSOLE_CLEAR_ENABLED,
            clearInterval: CONSOLE_CLEAR_INTERVAL,
            logCount: consoleLogCount,
            lastClearTime: lastClearTime.toISOString()
        },
        system: {
            platform: process.platform,
            nodeVersion: process.version,
            memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
            uptime: `${(process.uptime() / 60).toFixed(1)} minutos`
        }
    });
});

// Configuración de consola
app.get('/api/console/config', (req, res) => {
    res.json({
        clearEnabled: CONSOLE_CLEAR_ENABLED,
        intervalMinutes: CONSOLE_CLEAR_INTERVAL,
        logCount: consoleLogCount,
        lastClearTime: lastClearTime.toISOString()
    });
});

// Limpiar consola manualmente
app.post('/api/console/clear', (req, res) => {
    try {
        console.clear();
        consoleLogCount = 0;
        lastClearTime = new Date();

        res.json({
            success: true,
            message: 'Consola limpiada manualmente',
            timestamp: lastClearTime.toISOString()
        });

        console.log('Consola limpiada manualmente desde API');
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obtener todas las sesiones
app.get('/api/sessions', async (req, res) => {
    try {
        const sessionsArray = await Promise.all(Object.values(sessions).map(async session => {
            // Verificar estado real del cliente si está marcado como READY
            let actualState = session.state;
            
            if (session.state === SESSION_STATES.READY && session.client) {
                try {
                    // Verificar si el cliente realmente está conectado
                    const state = await session.client.getState();
                    if (state !== 'CONNECTED') {
                        console.log(`Sesión ${session.name} reportaba READY pero está ${state}`);
                        actualState = SESSION_STATES.DISCONNECTED;
                        session.state = SESSION_STATES.DISCONNECTED;
                    }
                } catch (error) {
                    // Si hay error obteniendo el estado, la sesión está desconectada
                    console.log(`Sesión ${session.name} no responde, marcando como DISCONNECTED`);
                    actualState = SESSION_STATES.DISCONNECTED;
                    session.state = SESSION_STATES.DISCONNECTED;
                }
            }
            
            return {
                name: session.name,
                state: actualState,
                hasQR: !!session.qr && session.state === SESSION_STATES.WAITING_FOR_QR,
                messageCount: session.messages ? session.messages.length : 0,
                lastActivity: session.lastActivity,
                error: session.error,
                userInfo: session.userInfo || null
            };
        }));

        res.json(sessionsArray);
    } catch (error) {
        console.error(`Error obteniendo sesiones: ${error.message}`);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Iniciar nueva sesión
app.post('/api/sessions/start', async (req, res) => {
    const { sessionName } = req.body;

    const validation = validateSessionName(sessionName);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    if (sessions[sessionName]) {
        return res.status(400).json({ error: `La sesión ${sessionName} ya existe` });
    }

    try {
        console.log(`Creando nueva sesión: ${sessionName}`);

        sessions[sessionName] = {
            name: sessionName,
            client: null,
            qr: null,
            state: SESSION_STATES.STARTING,
            messages: [],
            lastActivity: new Date(),
            error: null
        };

        // Inicializar en background
        initializeClient(sessionName).catch(error => {
            console.error(`Error en inicialización background de ${sessionName}: ${error.message}`);
        });

        res.json({
            success: true,
            message: `Sesión ${sessionName} iniciada. Generando código QR...`,
            sessionName
        });
    } catch (error) {
        console.error(`Error iniciando ${sessionName}: ${error.message}`);
        if (sessions[sessionName]) delete sessions[sessionName];
        res.status(500).json({ error: `Error al iniciar sesión: ${error.message}` });
    }
});

// Obtener código QR
app.get('/api/session/:sessionName/qr', async (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];

    if (!session.qr || session.state !== SESSION_STATES.WAITING_FOR_QR) {
        return res.status(404).json({
            error: 'No hay código QR disponible',
            state: session.state
        });
    }

    try {
        const qrDataURL = await qrcode.toDataURL(session.qr, {
            width: 256,
            margin: 2
        });
        res.type('text/plain').send(qrDataURL);
    } catch (error) {
        console.error(`Error generando QR para ${sessionName}: ${error.message}`);
        res.status(500).json({ error: `Error generando QR: ${error.message}` });
    }
});

// Enviar mensaje individual - OPTIMIZADO CON MANEJO DE WidFactory
app.post('/api/session/send-message', async (req, res) => {
    const { sessionName, phoneNumber, message } = req.body;

    if (!sessionName || !phoneNumber || !message) {
        return res.status(400).json({
            error: 'Se requiere sessionName, phoneNumber y message'
        });
    }

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];

    if (session.state !== SESSION_STATES.READY) {
        return res.status(400).json({
            error: `Sesión no está lista. Estado actual: ${session.state}`,
            currentState: session.state
        });
    }

    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return res.status(400).json({
            error: 'Número de teléfono inválido. Debe tener entre 10 y 15 dígitos'
        });
    }

    try {
        // Verificar que el número esté registrado con manejo de errores
        let isRegistered = false;
        try {
            isRegistered = await session.client.isRegisteredUser(formattedNumber);
        } catch (regError) {
            // Si falla la verificación por WidFactory, intentar enviar de todas formas
            if (regError.message && regError.message.includes('WidFactory')) {
                console.log(`${sessionName}: Error verificando registro (WidFactory), intentando enviar directamente...`);
                isRegistered = true; // Asumir registrado e intentar
            } else {
                throw regError;
            }
        }
        
        if (!isRegistered) {
            return res.status(400).json({
                error: `El número ${phoneNumber} no está registrado en WhatsApp`
            });
        }

        // Usar la función de envío con reintentos
        const result = await sendMessageWithRetry(session, formattedNumber, message, 3);
        
        if (!result.success) {
            throw result.error || new Error('Error desconocido al enviar mensaje');
        }

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

        // Mantener solo los últimos 100 mensajes
        if (session.messages.length > 100) {
            session.messages = session.messages.slice(-100);
        }

        console.log(`Mensaje enviado desde ${sessionName} a ${phoneNumber}`);

        res.json({
            success: true,
            message: `Mensaje enviado exitosamente a ${phoneNumber}`,
            timestamp: new Date().toISOString(),
            messageId: result.messageResult.id.id
        });

    } catch (error) {
        console.error(`Error enviando mensaje desde ${sessionName}: ${error.message}`);

        // Detectar si necesita reconexión
        const errorMsg = error.message || String(error);
        if (errorMsg.includes('WidFactory') || errorMsg.includes('Evaluation failed')) {
            // Marcar la sesión para reconexión
            session.needsReconnect = true;
            
            return res.status(503).json({
                error: `Sesión ${sessionName} necesita reconectarse. Por favor, espere unos segundos e intente de nuevo.`,
                code: 'SESSION_NEEDS_RECONNECT',
                retryAfter: 10
            });
        }
        
        if (errorMsg.includes('not registered') || errorMsg.includes('no longer')) {
            res.status(400).json({
                error: `El número ${phoneNumber} no está disponible en WhatsApp`
            });
        } else {
            res.status(500).json({
                error: `Error enviando mensaje: ${error.message}`
            });
        }
    }
});

// Enviar archivo/imagen - NUEVO ENDPOINT
app.post('/api/session/send-file', upload.single('file'), async (req, res) => {
    const { sessionName, phoneNumber, caption } = req.body;
    const file = req.file;

    if (!sessionName || !phoneNumber) {
        return res.status(400).json({
            error: 'Se requiere sessionName y phoneNumber'
        });
    }

    if (!file) {
        return res.status(400).json({
            error: 'Se requiere un archivo'
        });
    }

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];

    if (session.state !== SESSION_STATES.READY) {
        return res.status(400).json({
            error: `Sesión no está lista. Estado actual: ${session.state}`,
            currentState: session.state
        });
    }

    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return res.status(400).json({
            error: 'Número de teléfono inválido. Debe tener entre 10 y 15 dígitos'
        });
    }

    try {
        // Verificar que el número esté registrado
        let isRegistered = false;
        try {
            isRegistered = await session.client.isRegisteredUser(formattedNumber);
        } catch (regError) {
            if (regError.message && regError.message.includes('WidFactory')) {
                console.log(`${sessionName}: Error verificando registro (WidFactory), intentando enviar directamente...`);
                isRegistered = true;
            } else {
                throw regError;
            }
        }

        if (!isRegistered) {
            return res.status(400).json({
                error: `El número ${phoneNumber} no está registrado en WhatsApp`
            });
        }

        // Crear MessageMedia desde el buffer del archivo
        const media = new MessageMedia(
            file.mimetype,
            file.buffer.toString('base64'),
            file.originalname
        );

        // Determinar tipo de archivo para logging
        const fileType = file.mimetype.startsWith('image/') ? 'imagen' :
                        file.mimetype.startsWith('video/') ? 'video' :
                        file.mimetype.startsWith('audio/') ? 'audio' : 'documento';

        console.log(`${sessionName}: Enviando ${fileType} (${file.originalname}, ${(file.size / 1024).toFixed(1)}KB) a ${phoneNumber}`);

        // Opciones de envío
        const sendOptions = {};
        if (caption && caption.trim()) {
            sendOptions.caption = caption.trim();
        }

        // Enviar archivo con reintentos
        let messageResult = null;
        let lastError = null;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const skipStoreCheck = attempt > 1 && session.client && session.client.info;
                const isReady = await isClientTrulyReady(session, skipStoreCheck);
                
                if (!isReady && attempt === 1) {
                    console.log(`${sessionName}: Cliente no listo, esperando...`);
                    await waitForClientReady(session, 10000, true);
                }
                
                messageResult = await session.client.sendMessage(formattedNumber, media, sendOptions);
                break; // Éxito, salir del loop
                
            } catch (error) {
                lastError = error;
                console.log(`${sessionName}: Error en intento ${attempt}/3: ${error.message}`);
                
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
                }
            }
        }

        if (!messageResult) {
            throw lastError || new Error('Error al enviar archivo después de 3 intentos');
        }

        // Registrar envío
        if (!session.messages) session.messages = [];
        session.messages.push({
            timestamp: new Date(),
            to: formattedNumber,
            type: 'file',
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            caption: caption || null,
            direction: 'OUT',
            messageId: messageResult.id.id,
            status: 'sent'
        });

        session.lastActivity = new Date();

        // Mantener solo los últimos 100 mensajes
        if (session.messages.length > 100) {
            session.messages = session.messages.slice(-100);
        }

        console.log(`${fileType.charAt(0).toUpperCase() + fileType.slice(1)} enviado desde ${sessionName} a ${phoneNumber}`);

        res.json({
            success: true,
            message: `${fileType.charAt(0).toUpperCase() + fileType.slice(1)} enviado exitosamente a ${phoneNumber}`,
            timestamp: new Date().toISOString(),
            messageId: messageResult.id.id,
            fileInfo: {
                name: file.originalname,
                size: file.size,
                type: file.mimetype
            }
        });

    } catch (error) {
        console.error(`Error enviando archivo desde ${sessionName}: ${error.message}`);

        const errorMsg = error.message || String(error);
        if (errorMsg.includes('WidFactory') || errorMsg.includes('Evaluation failed')) {
            session.needsReconnect = true;
            return res.status(503).json({
                error: `Sesión ${sessionName} necesita reconectarse. Por favor, espere unos segundos e intente de nuevo.`,
                code: 'SESSION_NEEDS_RECONNECT',
                retryAfter: 10
            });
        }

        res.status(500).json({
            error: `Error enviando archivo: ${error.message}`
        });
    }
});

// Envío masivo optimizado con manejo de WidFactory
app.post('/api/session/send-bulk', async (req, res) => {
    const { sessionName, contacts, message, delay = 3000 } = req.body;

    if (!sessionName || !contacts || !message) {
        return res.status(400).json({
            error: 'Se requiere sessionName, contacts y message'
        });
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'contacts debe ser un array no vacío' });
    }

    if (contacts.length > 50) {
        return res.status(400).json({ error: 'Máximo 50 contactos por envío masivo' });
    }

    if (!sessions[sessionName] || sessions[sessionName].state !== SESSION_STATES.READY) {
        return res.status(400).json({
            error: `Sesión ${sessionName} no está lista`
        });
    }

    const session = sessions[sessionName];
    const results = { sent: 0, failed: 0, errors: [], needsReconnect: false };

    try {
        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const formattedNumber = formatPhoneNumber(contact);

            if (!formattedNumber) {
                results.failed++;
                results.errors.push(`Número inválido: ${contact}`);
                continue;
            }

            try {
                // Verificar registro con manejo de WidFactory
                let isRegistered = false;
                try {
                    isRegistered = await session.client.isRegisteredUser(formattedNumber);
                } catch (regError) {
                    if (regError.message && regError.message.includes('WidFactory')) {
                        console.log(`${sessionName}: Error verificando ${contact} (WidFactory), intentando enviar...`);
                        isRegistered = true;
                    } else {
                        throw regError;
                    }
                }
                
                if (!isRegistered) {
                    results.failed++;
                    results.errors.push(`No registrado: ${contact}`);
                    continue;
                }

                // Usar envío con reintentos
                const sendResult = await sendMessageWithRetry(session, formattedNumber, message, 2);
                
                if (sendResult.success) {
                    results.sent++;
                    console.log(`Mensaje masivo ${i+1}/${contacts.length} enviado a ${contact}`);
                } else {
                    results.failed++;
                    const errMsg = sendResult.error ? sendResult.error.message : 'Error desconocido';
                    results.errors.push(`Error en ${contact}: ${errMsg}`);
                    
                    // Si es error de WidFactory persistente, marcar para reconexión
                    if (errMsg.includes('WidFactory')) {
                        results.needsReconnect = true;
                    }
                }

                // Delay entre mensajes
                if (i < contacts.length - 1 && delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

            } catch (error) {
                results.failed++;
                results.errors.push(`Error en ${contact}: ${error.message}`);
                console.error(`Error enviando a ${contact}: ${error.message}`);
                
                if (error.message && error.message.includes('WidFactory')) {
                    results.needsReconnect = true;
                }
            }
        }

        session.lastActivity = new Date();

        const response = {
            success: results.sent > 0,
            results,
            message: `Envío masivo completado: ${results.sent} enviados, ${results.failed} fallidos`
        };
        
        if (results.needsReconnect) {
            response.warning = 'Algunos mensajes fallaron por problemas de conexión. Considere reiniciar la sesión.';
        }

        res.json(response);

    } catch (error) {
        console.error(`Error en envío masivo para ${sessionName}: ${error.message}`);
        res.status(500).json({
            error: `Error en envío masivo: ${error.message}`,
            results
        });
    }
});

// Endpoint para obtener grupos de WhatsApp
app.get('/api/session/:sessionName/groups', async (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: 'Sesion no encontrada' });
    }

    const session = sessions[sessionName];
    if (!session.client || session.state !== 'READY') {
        return res.status(400).json({ error: 'La sesion no esta lista' });
    }

    try {
        const chats = await session.client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(group => ({
                id: group.id._serialized,
                name: group.name,
                participants: group.participants ? group.participants.length : 0
            }));

        res.json({ success: true, groups });
    } catch (error) {
        console.error('Error obteniendo grupos:', error);
        res.status(500).json({ error: error.message });
    }
});


// Endpoint para reconectar sesión manualmente
app.post('/api/session/:sessionName/reconnect', async (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];
    
    try {
        console.log(`Reconectando sesión: ${sessionName}`);
        session.state = SESSION_STATES.RECONNECTING;
        
        // Intentar refrescar la página de Puppeteer
        if (session.client && session.client.pupPage) {
            await session.client.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            // Verificar si está listo
            const isReady = await isClientTrulyReady(session);
            
            if (isReady) {
                session.state = SESSION_STATES.READY;
                session.needsReconnect = false;
                
                res.json({
                    success: true,
                    message: `Sesión ${sessionName} reconectada exitosamente`
                });
            } else {
                session.state = SESSION_STATES.ERROR;
                res.status(500).json({
                    error: 'No se pudo reconectar. Intente eliminar y recrear la sesión.'
                });
            }
        } else {
            res.status(400).json({
                error: 'No hay cliente activo para reconectar'
            });
        }
    } catch (error) {
        console.error(`Error reconectando ${sessionName}: ${error.message}`);
        session.state = SESSION_STATES.ERROR;
        res.status(500).json({
            error: `Error reconectando: ${error.message}`
        });
    }
});

// Obtener estado de sesión
app.get('/api/session/:sessionName/status', async (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];
    
    // Verificación profunda del estado
    let trulyReady = false;
    if (session.state === SESSION_STATES.READY) {
        trulyReady = await isClientTrulyReady(session);
    }

    res.json({
        name: sessionName,
        state: session.state,
        messageCount: session.messages ? session.messages.length : 0,
        isReady: session.state === SESSION_STATES.READY,
        isTrulyReady: trulyReady,
        hasQR: !!session.qr && session.state === SESSION_STATES.WAITING_FOR_QR,
        lastActivity: session.lastActivity,
        error: session.error,
        userInfo: session.userInfo || null,
        needsReconnect: session.needsReconnect || false
    });
});

// Forzar estado READY
app.post('/api/session/:sessionName/force-ready', (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];

    if (session.state === SESSION_STATES.LOADING && session.client) {
        console.log(`Forzando estado READY manualmente: ${sessionName}`);
        session.state = SESSION_STATES.READY;
        session.qr = null;

        res.json({
            success: true,
            message: `Sesión ${sessionName} marcada como lista`,
            state: session.state
        });
    } else {
        res.status(400).json({
            error: `No se puede forzar. Estado actual: ${session.state}`
        });
    }
});

// Eliminar sesión
app.post('/api/session/delete', async (req, res) => {
    const { sessionName } = req.body;

    const validation = validateSessionName(sessionName);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    try {
        console.log(`Eliminando sesión: ${sessionName}`);

        // Cerrar cliente
        if (sessions[sessionName].client) {
            try {
                await sessions[sessionName].client.destroy();
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.warn(`Error cerrando cliente ${sessionName}: ${error.message}`);
            }
        }

        // Eliminar de memoria
        delete sessions[sessionName];

        // Eliminar carpeta de sesión
        const sessionPath = path.join(SESSION_DATA_PATH, `session-${sessionName}`);
        try {
            await fs.access(sessionPath);
            await fs.rm(sessionPath, { recursive: true, force: true });
            console.log(`Carpeta de sesión ${sessionName} eliminada`);
        } catch (error) {
            console.warn(`No se pudo eliminar carpeta de ${sessionName}: ${error.message}`);
        }

        res.json({
            success: true,
            message: `Sesión ${sessionName} eliminada exitosamente`
        });

    } catch (error) {
        console.error(`Error eliminando ${sessionName}: ${error.message}`);
        res.status(500).json({
            error: `Error eliminando sesión: ${error.message}`
        });
    }
});

// Servir archivos estáticos
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware de manejo de errores
app.use((error, req, res, next) => {
    console.error(`Error no manejado en ${req.method} ${req.path}: ${error.message}`);
    res.status(500).json({
        error: 'Error interno del servidor'
    });
});

// ======================== INICIALIZACIÓN ========================

async function startServer() {
    try {
        await ensureSessionDirectory();
        await loadExistingSessions();

        const server = http.createServer(app);

        server.listen(PORT, () => {
            console.log(`Servidor WhatsApp Bot iniciado en puerto ${PORT}`);
            console.log(`Panel de control: http://localhost:${PORT}`);
            console.log(`Health check: http://localhost:${PORT}/health`);
            console.log(`Sesiones activas: ${Object.keys(sessions).length}`);
        });

        return server;
    } catch (error) {
        console.error(`Error iniciando servidor: ${error.message}`);
        process.exit(1);
    }
}

// Función de limpieza
async function cleanup() {
    console.log('Cerrando servidor y sesiones...');

    if (consoleClearInterval) {
        clearInterval(consoleClearInterval);
    }

    const cleanupPromises = Object.keys(sessions).map(async (sessionName) => {
        try {
            if (sessions[sessionName].client) {
                await sessions[sessionName].client.destroy();
            }
        } catch (error) {
            console.error(`Error cerrando sesión ${sessionName}: ${error.message}`);
        }
    });

    await Promise.allSettled(cleanupPromises);
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('Servidor cerrado correctamente');
    process.exit(0);
}

// Manejadores de señales
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (error) => {
    console.error(`Error no capturado: ${error.message}`);
});
process.on('unhandledRejection', (reason) => {
    console.error(`Promesa rechazada no manejada: ${reason}`);
});

// Iniciar servidor
startServer();
