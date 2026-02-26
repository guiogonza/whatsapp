/**
 * WhatsApp Bot Server - REFACTORIZADO
 * 
 * Características principales:
 * - Implementación con Baileys (más seguro y difícil de detectar)
 * - Rotación automática de sesiones
 * - Código modular y organizado
 * - Monitoreo de sesiones activas
 * - Envío masivo con distribución entre sesiones
 * - Sistema GPSwox para asignación de placas
 * - Sistema FX (MetaTrader5) para notificaciones de trading
 * 
 * Arquitectura refactorizada:
 * - routes/ → Definición de rutas
 * - controllers/ → Lógica de negocio
 * - middleware/ → Autenticación y validación
 * - lib/session/ → Módulos de sesión
 * - tests/ → Pruebas automatizadas
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

// Configuración
const config = require('./config');

// Gestor de sesiones
const sessionManager = require('./sessionManager-baileys');

// Base de datos
const database = require('./database-postgres');

// Webhook para WhatsApp Cloud API
const webhook = require('./lib/session/webhook');

// Middleware
const { authenticateAPI } = require('./middleware/auth');

// Rutas
const sessionsRouter = require('./routes/sessions');
const messagesRouter = require('./routes/messages');
const gpswoxRouter = require('./routes/gpswox');
const fxRouter = require('./routes/fx');
const cloudRouter = require('./routes/cloud');
const systemRouter = require('./routes/system');
const settingsRouter = require('./routes/settings');

// Inicialización de Express
const app = express();
const server = http.createServer(app);
const upload = multer();

// ======================== ESTADO GLOBAL ========================

let consoleLogCount = 0;
let lastClearTime = new Date();
let consoleClearInterval = null;
let sessionMonitorInterval = null;
let notificationInterval = null;

// ======================== MIDDLEWARE ========================

app.use(express.json({ limit: '16mb' }));
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Autenticación API
app.use(authenticateAPI);

// Configurar charset UTF-8 para archivos estáticos
app.use(express.static(config.PUBLIC_PATH, {
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        }
    }
}));

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
        const status = session.state === config.SESSION_STATES.READY ? '✅' : '⚠️';

        console.log(`${status} ${name}: ${session.state} | Teléfono: ${session.phoneNumber || 'N/A'} | Uptime: ${uptimeMinutes}m | Mensajes: ${session.messages?.length || 0}`);
    }

    const rotationInfo = sessionManager.getRotationInfo();
    console.log(`\n🔄 Sesión actual: ${rotationInfo.currentSession || 'N/A'}`);
    console.log(`📊 Balanceo: ${rotationInfo.balancingMode}`);
    console.log('==========================\n');
}

/**
 * Envía notificación de estado de sesiones
 */
function sendSessionsStatusNotification() {
    try {
        const sessionsStatus = sessionManager.getSessionsStatus();
        const sessionsObj = sessionManager.getAllSessions();
        const rotationInfo = sessionManager.getRotationInfo();
        const total = sessionsStatus.length;
        const active = sessionsStatus.filter(s => s.state === config.SESSION_STATES.READY);
        const inactive = sessionsStatus.filter(s => s.state !== config.SESSION_STATES.READY);

        const EMOJI = {
            CHART: '📊',
            CLOCK: '⏰',
            GRAPH: '📈',
            CHECK: '✅',
            WARNING: '⚠️',
            PHONE: '📱',
            REFRESH: '🔄'
        };

        const nowStr = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
        let msg = `${EMOJI.CHART} *REPORTE DE SESIONES*\n\n`;
        msg += `${EMOJI.CLOCK} ${nowStr}\n\n`;
        msg += `${EMOJI.GRAPH} Total: ${total} | ${EMOJI.CHECK} Activas: ${active.length} | ${EMOJI.WARNING} Inactivas: ${inactive.length}\n\n`;

        if (active.length === 0) {
            msg += "*Sesiones Activas:*\n- Sin sesiones activas\n";
        } else {
            msg += "*Sesiones Activas:*\n";
            active.forEach((s, i) => {
                const sessionObj = sessionsObj[s.name] || {};
                const info = sessionObj.info || {};
                const label = info.pushname ? ` (${info.pushname})` : '';
                const phoneNumber = info.me?.id?.split('@')[0] || info.me?.user || 'N/A';
                const consolidados = sessionObj.consolidatedCount || 0;
                const recibidos = sessionObj.messagesReceivedCount || 0;
                const enviados = sessionObj.messagesSentCount || 0;
                const proxyInfo = sessionObj.proxyHost ? `${sessionObj.proxyHost}:${sessionObj.proxyPort}` : 'Sin proxy';
                const location = sessionObj.proxyCountry && sessionObj.proxyCity ? `${sessionObj.proxyCity}, ${sessionObj.proxyCountry}` : 'N/A';

                msg += `${i + 1}. ${EMOJI.CHECK} *${s.name}*${label}\n`;
                msg += `   ${EMOJI.PHONE} ${phoneNumber}\n`;
                msg += `   📦 Consolidados: ${consolidados}\n`;
                msg += `   📥 Recibidos: ${recibidos}\n`;
                msg += `   📤 Enviados: ${enviados}\n`;
                msg += `   🌐 IP: ${proxyInfo}\n`;
                msg += `   📍 Ubicación: ${location}\n\n`;
            });
        }

        if (inactive.length === 0) {
            msg += "\n*Requieren atención:*\n- Sin sesiones inactivas\n";
        } else {
            msg += "\n*Requieren atención:*\n";
            inactive.forEach((s, i) => {
                const icon = s.state == config.SESSION_STATES.WAITING_FOR_QR ? EMOJI.PHONE : (s.state == config.SESSION_STATES.RECONNECTING ? EMOJI.REFRESH : EMOJI.WARNING);
                msg += `${i + 1}. ${icon} *${s.name}* - ${s.state}\n`;
            });
        }

        sessionManager.sendNotificationToAdmin(msg);
    } catch (error) {
        console.error('Error enviando notificación de sesiones:', error.message);
    }
}

// ======================== MONTAR RUTAS ========================

// Health check (sin autenticación)
app.get('/health', (req, res) => {
    res.json({ 
        success: true, 
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Rutas de API
app.use('/api/sessions', sessionsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/gpswox', gpswoxRouter);
app.use('/api/fx', fxRouter);
app.use('/api/cloud', cloudRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/network', systemRouter);
app.use('/api/adapters/info', systemRouter);
app.use('/api/proxy/status', systemRouter);

// Alias para compatibilidad
app.get('/api/message-logs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = await database.getMessageLogs(limit);
        res.json({ success: true, logs: logs || [], count: logs ? logs.length : 0 });
    } catch (error) {
        res.json({ success: true, logs: [], count: 0 });
    }
});

// Webhook routes
app.get('/webhook', (req, res) => {
    res.send('Webhook endpoint activo');
});

app.post('/webhook', (req, res) => {
    webhook.handleIncomingWebhook(req, res);
});

app.get('/webhook/whatsapp', (req, res) => {
    webhook.verifyWebhook(req, res);
});

app.post('/webhook/whatsapp', (req, res) => {
    webhook.handleIncomingWebhook(req, res);
});

app.get('/api/webhook/messages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const messages = webhook.getRecentMessages(limit);
        res.json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/webhook/config', (req, res) => {
    try {
        res.json({
            success: true,
            webhookUrl: process.env.WEBHOOK_URL || '',
            verifyToken: config.WEBHOOK_VERIFY_TOKEN,
            configured: webhook.isConfigured(),
            messagesReceived: webhook.getStats().received
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Ruta 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada'
    });
});

// ======================== INICIALIZACIÓN ========================

async function startServer() {
    try {
        console.log('\n🚀 === INICIANDO SERVIDOR WHATSAPP BOT ===\n');

        // Inicializar base de datos
        console.log('📊 Conectando a PostgreSQL...');
        await database.initDatabase();

        // Cargar sesiones del disco
        console.log('📱 Cargando sesiones existentes...');
        await sessionManager.loadSessionsFromDisk();

        // Iniciar procesadores
        console.log('⚙️ Iniciando procesadores...');
        sessionManager.startConsolidationProcessor();
        sessionManager.startBatchProcessor();

        // Configurar limpieza de consola
        if (config.CONSOLE_CLEAR_ENABLED) {
            consoleClearInterval = setInterval(clearConsole, 60 * 1000);
        }

        // Configurar monitoreo de sesiones
        sessionMonitorInterval = setInterval(monitorSessions, config.SESSION_MONITOR_INTERVAL * 60 * 1000);
        
        // Configurar notificaciones periódicas
        if (config.NOTIFICATION_INTERVAL_MINUTES > 0) {
            notificationInterval = setInterval(
                sendSessionsStatusNotification,
                config.NOTIFICATION_INTERVAL_MINUTES * 60 * 1000
            );
        }

        // Iniciar servidor HTTP
        const PORT = config.PORT;
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`\n✅ === SERVIDOR INICIADO ===`);
            console.log(`🌐 Puerto: ${PORT}`);
            console.log(`📍 URL: http://localhost:${PORT}`);
            console.log(`⏰ ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
            console.log('=========================\n');
        });

    } catch (error) {
        console.error('❌ Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Manejo de cierre graceful
process.on('SIGINT', async () => {
    console.log('\n⚠️ Cerrando servidor...');
    
    if (consoleClearInterval) clearInterval(consoleClearInterval);
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    if (notificationInterval) clearInterval(notificationInterval);
    
    await database.closeDatabase();
    server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
    });
});

// Iniciar
startServer();
