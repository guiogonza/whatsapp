/**
 * WhatsApp Bot Server - Versión Optimizada
 * 
 * Características principales:
 * - Rotación automática de sesiones cada 5 minutos
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

// Gestor de sesiones
const sessionManager = require('./sessionManager');

// Rutas
const sessionsRoutes = require('./routes/sessions');
const messagesRoutes = require('./routes/messages');

// Inicialización de Express
const app = express();

// ======================== ESTADO GLOBAL ========================

let consoleLogCount = 0;
let lastClearTime = new Date();
let consoleClearInterval = null;
let sessionMonitorInterval = null;
let inactiveCheckInterval = null;

// Interceptar console.log para conteo
const originalConsoleLog = console.log;
console.log = function(...args) {
    consoleLogCount++;
    originalConsoleLog.apply(console, args);
};

// ======================== MIDDLEWARE ========================

app.use(express.json({ limit: '10mb' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.static(config.PUBLIC_PATH));

// ======================== RUTAS ========================

// Rutas de sesiones
app.use('/api/sessions', sessionsRoutes);
app.use('/api/session', sessionsRoutes);

// Rutas de mensajes
app.use('/api/session', messagesRoutes);
app.use('/api/messages', messagesRoutes);

// Health check
app.get('/health', async (req, res) => {
    const { sessions } = sessionManager;
    
    const sessionStates = await Promise.all(Object.keys(sessions).map(async key => {
        const session = sessions[key];
        let actualState = session.state;
        
        if (session.state === config.SESSION_STATES.READY && session.client) {
            try {
                const state = await session.client.getState();
                if (state !== 'CONNECTED') {
                    actualState = config.SESSION_STATES.DISCONNECTED;
                    session.state = config.SESSION_STATES.DISCONNECTED;
                }
            } catch (error) {
                actualState = config.SESSION_STATES.DISCONNECTED;
                session.state = config.SESSION_STATES.DISCONNECTED;
            }
        }
        
        return { name: key, state: actualState };
    }));
    
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        sessions: {
            count: Object.keys(sessions).length,
            ready: sessionStates.filter(s => s.state === config.SESSION_STATES.READY).length,
            states: sessionStates
        },
        rotation: sessionManager.getRotationInfo(),
        console: {
            clearEnabled: config.CONSOLE_CLEAR_ENABLED,
            clearInterval: config.CONSOLE_CLEAR_INTERVAL,
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
        clearEnabled: config.CONSOLE_CLEAR_ENABLED,
        intervalMinutes: config.CONSOLE_CLEAR_INTERVAL,
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
            message: 'Consola limpiada',
            timestamp: lastClearTime.toISOString()
        });

        console.log('Consola limpiada desde API');
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Información de rotación
app.get('/api/rotation', (req, res) => {
    res.json(sessionManager.getRotationInfo());
});

// Rotar sesión manualmente
app.post('/api/rotation/rotate', (req, res) => {
    sessionManager.rotateSession();
    res.json({
        success: true,
        message: 'Sesión rotada manualmente',
        ...sessionManager.getRotationInfo()
    });
});

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(config.PUBLIC_PATH, 'index.html'));
});

// Manejo de errores
app.use((error, req, res, next) => {
    console.error(`Error en ${req.method} ${req.path}: ${error.message}`);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// ======================== FUNCIONES DE UTILIDAD ========================

function clearConsole() {
    if (config.CONSOLE_CLEAR_ENABLED) {
        console.clear();
        consoleLogCount = 0;
        lastClearTime = new Date();
        console.log(`Consola limpiada. Próxima limpieza en ${config.CONSOLE_CLEAR_INTERVAL} minutos.`);
    }
}

// ======================== INICIALIZACIÓN ========================

async function startServer() {
    try {
        // Preparar directorio de sesiones
        await sessionManager.ensureSessionDirectory();
        
        // Cargar sesiones existentes
        await sessionManager.loadExistingSessions();

        // Iniciar rotación automática de sesiones
        sessionManager.startSessionRotation();

        // Configurar monitoreo de sesiones (cada 30 minutos)
        sessionMonitorInterval = setInterval(
            sessionManager.monitorSessions, 
            config.SESSION_MONITOR_INTERVAL * 60 * 1000
        );
        console.log(`📡 Monitor de sesiones activo (cada ${config.SESSION_MONITOR_INTERVAL} min)`);

        // Configurar verificación de sesiones inactivas (cada hora)
        inactiveCheckInterval = setInterval(
            sessionManager.checkInactiveSessions, 
            config.INACTIVE_CHECK_INTERVAL * 60 * 1000
        );
        console.log(`📊 Reportes de estado activos (cada ${config.INACTIVE_CHECK_INTERVAL} min)`);

        // Configurar limpieza automática de consola
        if (config.CONSOLE_CLEAR_ENABLED) {
            consoleClearInterval = setInterval(clearConsole, config.CONSOLE_CLEAR_INTERVAL * 60 * 1000);
            console.log(`🧹 Limpieza de consola activa (cada ${config.CONSOLE_CLEAR_INTERVAL} min)`);
        }

        // Crear servidor HTTP
        const server = http.createServer(app);

        server.listen(config.PORT, () => {
            console.log('═══════════════════════════════════════════════════════');
            console.log(`🚀 WhatsApp Bot Server iniciado en puerto ${config.PORT}`);
            console.log(`📱 Panel: http://localhost:${config.PORT}`);
            console.log(`❤️ Health: http://localhost:${config.PORT}/health`);
            console.log(`📊 Sesiones cargadas: ${Object.keys(sessionManager.sessions).length}`);
            console.log(`🔄 Rotación: cada ${config.SESSION_ROTATION_INTERVAL} minutos`);
            console.log('═══════════════════════════════════════════════════════');
            
            // Verificación inicial después de 30 segundos
            setTimeout(() => {
                console.log('🔍 Verificación inicial de sesiones...');
                sessionManager.checkInactiveSessions().catch(err => 
                    console.log(`Error en verificación inicial: ${err.message}`)
                );
            }, 30000);
        });

        return server;
    } catch (error) {
        console.error(`❌ Error iniciando servidor: ${error.message}`);
        process.exit(1);
    }
}

// ======================== LIMPIEZA ========================

async function cleanup() {
    console.log('🛑 Cerrando servidor...');

    // Detener intervalos
    sessionManager.stopSessionRotation();
    if (consoleClearInterval) clearInterval(consoleClearInterval);
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    if (inactiveCheckInterval) clearInterval(inactiveCheckInterval);

    // Cerrar sesiones
    const { sessions } = sessionManager;
    const cleanupPromises = Object.keys(sessions).map(async (sessionName) => {
        try {
            if (sessions[sessionName].client) {
                await sessions[sessionName].client.destroy();
            }
        } catch (error) {
            console.error(`Error cerrando ${sessionName}: ${error.message}`);
        }
    });

    await Promise.allSettled(cleanupPromises);
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
}

// ======================== MANEJADORES DE SEÑALES ========================

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (error) => {
    console.error(`❌ Error no capturado: ${error.message}`);
});
process.on('unhandledRejection', (reason) => {
    console.error(`❌ Promesa rechazada: ${reason}`);
});

// ======================== INICIAR ========================

startServer();
