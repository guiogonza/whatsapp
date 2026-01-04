/**
 * WhatsApp Bot Server con Baileys
 * 
 * Características principales:
 * - Implementación con Baileys (más seguro y difícil de detectar)
 * - Rotación automática de sesiones
 * - Código modular y organizado
 * - Monitoreo de sesiones activas
 * - Envío masivo con distribución entre sesiones
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

// Configuración
const config = require('./config');

// Gestor de sesiones con Baileys
const sessionManager = require('./sessionManager-baileys');

// Utilidades
const { formatPhoneNumber } = require('./utils');
const database = require('./database');

// Inicialización de Express
const app = express();
const server = http.createServer(app);

// ======================== ESTADO GLOBAL ========================

let consoleLogCount = 0;
let lastClearTime = new Date();
let consoleClearInterval = null;
let sessionMonitorInterval = null;

// ======================== MIDDLEWARE ========================

app.use(express.json({ limit: '16mb' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.static(config.PUBLIC_PATH));

// ======================== FUNCIONES AUXILIARES ========================

/**
 * Limpia la consola si está habilitado
 */
function clearConsole() {
    if (!config.CONSOLE_CLEAR_ENABLED) return;
    
    const minutesSinceLastClear = (Date.now() - lastClearTime.getTime()) / 1000 / 60;
    
    if (minutesSinceLastClear >= config.CONSOLE_CLEAR_INTERVAL) {
        console.clear();
        console.log(`🧹 Consola limpiada (${consoleLogCount} logs desde última limpieza)`);
        console.log(`⏰ ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`);
        
        consoleLogCount = 0;
        lastClearTime = new Date();
    }
}

/**
 * Monitorea el estado de las sesiones
 */
async function monitorSessions() {
    const sessions = sessionManager.getAllSessions();
    const activeSessions = sessionManager.getActiveSessions();
    
    console.log('\n📊 === MONITOR DE SESIONES ===');
    console.log(`⏰ ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    console.log(`📱 Total sesiones: ${Object.keys(sessions).length}`);
    console.log(`✅ Sesiones activas: ${activeSessions.length}`);
    
    for (const [name, session] of Object.entries(sessions)) {
        const uptimeMinutes = Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60);
        const status = session.state === config.SESSION_STATES.READY ? '✅' : '❌';
        
        console.log(`${status} ${name}: ${session.state} | Teléfono: ${session.phoneNumber || 'N/A'} | Uptime: ${uptimeMinutes}m | Mensajes: ${session.messages?.length || 0}`);
    }
    
    const rotationInfo = sessionManager.getRotationInfo();
    console.log(`\n🔄 Sesión actual: ${rotationInfo.currentSession || 'N/A'}`);
    console.log(`📊 Balanceo: ${rotationInfo.balancingMode}`);
    console.log('==========================\n');
}

// ======================== RUTAS - SESIONES ========================

/**
 * GET /api/sessions - Lista todas las sesiones
 */
app.get('/api/sessions', (req, res) => {
    try {
        const sessions = sessionManager.getSessionsStatus();
        res.json({
            success: true,
            sessions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/sessions/create - Crea una nueva sesión
 */
app.post('/api/sessions/create', async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'El nombre de la sesión es requerido'
            });
        }
        
        const session = await sessionManager.createSession(name);
        
        res.json({
            success: true,
            session: {
                name: session.name,
                state: session.state
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/sessions/:name/qr - Obtiene el código QR de una sesión
 */
app.get('/api/sessions/:name/qr', async (req, res) => {
    try {
        const { name } = req.params;
        const qrCode = await sessionManager.getQRCode(name);
        
        if (!qrCode) {
            return res.status(404).json({
                success: false,
                error: 'QR no disponible'
            });
        }
        
        res.json({
            success: true,
            qr: qrCode
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/sessions/:name/status - Obtiene el estado de una sesión
 */
app.get('/api/sessions/:name/status', (req, res) => {
    try {
        const { name } = req.params;
        const session = sessionManager.getSession(name);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Sesión no encontrada'
            });
        }
        
        res.json({
            success: true,
            session: {
                name: session.name,
                state: session.state,
                phoneNumber: session.phoneNumber,
                qrReady: !!session.qr,
                messagesCount: session.messages?.length || 0,
                lastActivity: session.lastActivity,
                uptime: Date.now() - session.startTime.getTime()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/sessions/:name - Cierra y elimina una sesión
 */
app.delete('/api/sessions/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const { deleteData } = req.query;
        
        await sessionManager.closeSession(name);
        
        if (deleteData === 'true') {
            await sessionManager.deleteSessionData(name);
        }
        
        res.json({
            success: true,
            message: `Sesión ${name} cerrada exitosamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/sessions/rotation/info - Información de rotación de sesiones
 */
app.get('/api/sessions/rotation/info', (req, res) => {
    try {
        const info = sessionManager.getRotationInfo();
        res.json({
            success: true,
            rotation: info
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/sessions/rotation/rotate - Fuerza la rotación de sesión
 */
app.post('/api/sessions/rotation/rotate', (req, res) => {
    try {
        sessionManager.rotateSession();
        const info = sessionManager.getRotationInfo();
        
        res.json({
            success: true,
            message: 'Rotación realizada exitosamente',
            rotation: info
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================== RUTAS - MENSAJES ========================

/**
 * POST /api/messages/send - Envía un mensaje de texto
 */
app.post('/api/messages/send', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        
        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y message son requeridos'
            });
        }
        
        const result = await sessionManager.sendMessageWithRotation(phoneNumber, message);
        
        if (result.success) {
            res.json({
                success: true,
                sessionUsed: result.sessionUsed,
                message: 'Mensaje enviado exitosamente'
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error?.message || 'Error enviando mensaje'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/messages/send-bulk - Envía mensajes masivos
 */
app.post('/api/messages/send-bulk', async (req, res) => {
    try {
        const { contacts, message } = req.body;
        
        if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Se requiere un array de contactos'
            });
        }
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'El mensaje es requerido'
            });
        }
        
        if (contacts.length > config.MAX_BULK_CONTACTS) {
            return res.status(400).json({
                success: false,
                error: `Máximo ${config.MAX_BULK_CONTACTS} contactos por envío`
            });
        }
        
        const results = [];
        
        for (const contact of contacts) {
            const phoneNumber = contact.phoneNumber || contact.phone || contact;
            
            if (!phoneNumber) continue;
            
            // Delay aleatorio entre mensajes (3-8 segundos)
            const delay = 3000 + Math.random() * 5000;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            const result = await sessionManager.sendMessageWithRotation(phoneNumber, message);
            
            results.push({
                phoneNumber,
                success: result.success,
                sessionUsed: result.sessionUsed,
                error: result.error?.message
            });
        }
        
        const successCount = results.filter(r => r.success).length;
        
        res.json({
            success: true,
            total: contacts.length,
            sent: successCount,
            failed: contacts.length - successCount,
            results
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/messages/recent - Obtiene mensajes recientes
 */
app.get('/api/messages/recent', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const messages = sessionManager.getRecentMessages(limit);
        
        res.json({
            success: true,
            messages
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================== RUTAS - ANALYTICS ========================

/**
 * GET /api/analytics/stats - Estadísticas generales
 */
app.get('/api/analytics/stats', async (req, res) => {
    try {
        const stats = await database.getStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/analytics/messages - Historial de mensajes
 */
app.get('/api/analytics/messages', async (req, res) => {
    try {
        const { limit = 100, session, status, startDate, endDate } = req.query;
        
        const messages = await database.getMessages({
            limit: parseInt(limit),
            session,
            status,
            startDate,
            endDate
        });
        
        res.json({
            success: true,
            messages
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================== HEALTH CHECK ========================

app.get('/health', (req, res) => {
    const sessions = sessionManager.getAllSessions();
    const activeSessions = sessionManager.getActiveSessions();
    
    const sessionList = Object.entries(sessions).map(([name, session]) => ({
        name,
        state: session.state,
        phoneNumber: session.phoneNumber,
        uptime: Date.now() - session.startTime.getTime()
    }));
    
    const rotationInfo = sessionManager.getRotationInfo();
    
    const systemStatus = activeSessions.length === 0 ? 'CRITICAL' 
        : activeSessions.length >= 2 ? 'HEALTHY' 
        : 'WARNING';
    
    res.json({
        status: 'ok',
        system: systemStatus,
        timestamp: new Date().toISOString(),
        sessions: {
            total: Object.keys(sessions).length,
            active: activeSessions.length,
            list: sessionList
        },
        rotation: rotationInfo,
        uptime: process.uptime()
    });
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(config.PUBLIC_PATH, 'index.html'));
});

// ======================== INICIALIZACIÓN ========================

/**
 * Inicia los intervalos de monitoreo
 */
function startMonitoring() {
    // Limpiar consola periódicamente
    if (config.CONSOLE_CLEAR_ENABLED) {
        consoleClearInterval = setInterval(clearConsole, 60000);
    }
    
    // Monitoreo de sesiones
    sessionMonitorInterval = setInterval(monitorSessions, config.SESSION_MONITOR_INTERVAL * 60000);
    
    console.log('✅ Monitoreo iniciado');
}

/**
 * Detiene los intervalos de monitoreo
 */
function stopMonitoring() {
    if (consoleClearInterval) clearInterval(consoleClearInterval);
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    sessionManager.stopSessionRotation();
    
    console.log('⏹️ Monitoreo detenido');
}

/**
 * Inicializa el servidor
 */
async function initialize() {
    try {
        console.log('\n🚀 Iniciando WhatsApp Bot Server con Baileys...\n');
        
        // Inicializar base de datos
        await database.init();
        
        // Iniciar servidor HTTP
        server.listen(config.PORT, () => {
            console.log(`✅ Servidor escuchando en puerto ${config.PORT}`);
            console.log(`🌐 http://localhost:${config.PORT}`);
            console.log(`⏰ ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`);
        });
        
        // Iniciar monitoreo
        startMonitoring();
        
        // Iniciar rotación de sesiones
        sessionManager.startSessionRotation();
        
        console.log('✅ Sistema iniciado correctamente\n');
        
    } catch (error) {
        console.error('❌ Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Manejo de señales de cierre
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Recibida señal SIGINT, cerrando servidor...');
    stopMonitoring();
    
    // Cerrar todas las sesiones
    const sessions = sessionManager.getAllSessions();
    for (const name of Object.keys(sessions)) {
        await sessionManager.closeSession(name);
    }
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Recibida señal SIGTERM, cerrando servidor...');
    stopMonitoring();
    
    const sessions = sessionManager.getAllSessions();
    for (const name of Object.keys(sessions)) {
        await sessionManager.closeSession(name);
    }
    
    process.exit(0);
});

// Iniciar aplicación
initialize();

module.exports = app;
