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
    
    const rotationInfo = sessionManager.getRotationInfo();
    const readySessions = sessionStates.filter(s => s.state === config.SESSION_STATES.READY);
    
    // Determinar el estado del sistema
    let systemStatus = 'CRITICAL';
    if (readySessions.length > 0) {
        systemStatus = readySessions.length >= 2 ? 'HEALTHY' : 'WARNING';
    }
    
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        sessions: {
            count: Object.keys(sessions).length,
            ready: readySessions.length,
            states: sessionStates
        },
        rotation: rotationInfo,
        // Campos adicionales para el dashboard de analytics
        system_status: {
            status: systemStatus,
            active_sessions: readySessions.length,
            total_sessions: Object.keys(sessions).length
        },
        rotation_info: {
            current_session: rotationInfo.currentSession,
            messages_sent_current: 0, // No tenemos contador por sesión
            max_per_session: 100,
            next_rotation: rotationInfo.nextRotation
        },
        available_sessions: rotationInfo.activeSessions || [],
        server_url: `http://localhost:${config.PORT}`,
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

// Base de datos para analytics
const database = require('./database');

// Endpoint de analytics para el dashboard
app.get('/analytics', (req, res) => {
    try {
        const { period, range, top, start_date, end_date } = req.query;
        const data = database.getAnalytics({
            period: period || 'day',
            range: range || 'today',
            top: top || 10,
            startDate: start_date,
            endDate: end_date
        });
        res.json(data);
    } catch (error) {
        console.error('Error en analytics:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint de configuración de rotación para el dashboard
app.post('/rotation-config', (req, res) => {
    try {
        const { force_rotation, reset_counter } = req.body;
        
        if (force_rotation) {
            sessionManager.rotateSession();
        }
        
        // reset_counter no aplica en esta implementación ya que no hay contador por sesión
        
        res.json({
            success: true,
            message: force_rotation ? 'Sesión rotada' : 'Configuración actualizada',
            ...sessionManager.getRotationInfo()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
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

// También para compatibilidad
app.post('/api/sessions/rotation/rotate', (req, res) => {
    sessionManager.rotateSession();
    res.json({
        success: true,
        message: 'Sesión rotada manualmente',
        ...sessionManager.getRotationInfo()
    });
});

// ======================== ENDPOINTS DE MONITOR ========================

// Obtener mensajes recientes
app.get('/api/monitor/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const messages = sessionManager.getRecentMessages(limit);
    res.json({ messages, total: messages.length });
});

// Obtener estadísticas del monitor
app.get('/api/monitor/stats', async (req, res) => {
    try {
        const { sessions } = sessionManager;
        const rotationInfo = sessionManager.getRotationInfo();
        const sessionsStats = Object.values(sessions).map(s => ({
            name: s.name,
            state: s.state,
            messageCount: s.messages ? s.messages.length : 0
        }));
        
        const totalMessages = sessionsStats.reduce((sum, s) => sum + s.messageCount, 0);
        
        res.json({
            activeSession: rotationInfo.currentSession,
            nextRotation: rotationInfo.nextRotation,
            rotationIntervalMinutes: rotationInfo.rotationIntervalMinutes,
            totalMessages,
            sessions: sessionsStats
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener historial agrupado por fecha y sesión
app.get('/api/monitor/history', async (req, res) => {
    try {
        const { sessions } = sessionManager;
        const messages = sessionManager.getRecentMessages(1000); // Obtener más mensajes para historial
        
        // Agrupar por fecha
        const byDate = {};
        const bySession = {};
        
        messages.forEach(msg => {
            // Por fecha (YYYY-MM-DD)
            const date = msg.timestamp.substring(0, 10);
            if (!byDate[date]) {
                byDate[date] = { total: 0, success: 0, error: 0 };
            }
            byDate[date].total++;
            if (msg.status === 'success') byDate[date].success++;
            else byDate[date].error++;
            
            // Por sesión
            if (!bySession[msg.session]) {
                bySession[msg.session] = { total: 0, success: 0, error: 0 };
            }
            bySession[msg.session].total++;
            if (msg.status === 'success') bySession[msg.session].success++;
            else bySession[msg.session].error++;
        });
        
        // Estadísticas de sesiones activas
        const sessionsInfo = Object.values(sessions).map(s => ({
            name: s.name,
            state: s.state,
            messageCount: s.messages ? s.messages.length : 0,
            isActive: s.name === sessionManager.getRotationInfo().currentSession
        }));
        
        res.json({
            byDate: Object.entries(byDate).map(([date, stats]) => ({ date, ...stats }))
                .sort((a, b) => b.date.localeCompare(a.date)),
            bySession: Object.entries(bySession).map(([session, stats]) => ({ session, ...stats }))
                .sort((a, b) => b.total - a.total),
            sessions: sessionsInfo,
            totalMessages: messages.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ======================== FIN ENDPOINTS DE MONITOR ========================

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(config.PUBLIC_PATH, 'index.html'));
});

// Dashboard de analytics
app.get('/analytics.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'analytics.html'));
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
        // Inicializar base de datos de analytics
        await database.initDatabase();
        
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
