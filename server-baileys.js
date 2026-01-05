/**
 * WhatsApp Bot Server con Baileys
 * 
 * CaracterÃÂ­sticas principales:
 * - ImplementaciÃÂ³n con Baileys (mÃÂ¡s seguro y difÃÂ­cil de detectar)
 * - RotaciÃÂ³n automÃÂ¡tica de sesiones
 * - CÃÂ³digo modular y organizado
 * - Monitoreo de sesiones activas
 * - EnvÃÂ­o masivo con distribuciÃÂ³n entre sesiones
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

// ConfiguraciÃÂ³n
const config = require('./config');

// Gestor de sesiones con Baileys
const sessionManager = require('./sessionManager-baileys');

// Utilidades
const { formatPhoneNumber } = require('./utils');
const database = require('./database');

// InicializaciÃÂ³n de Express
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
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.static(config.PUBLIC_PATH));

// ======================== FUNCIONES AUXILIARES ========================

/**
 * Limpia la consola si estÃÂ¡ habilitado
 */
function clearConsole() {
    if (!config.CONSOLE_CLEAR_ENABLED) return;
    
    const minutesSinceLastClear = (Date.now() - lastClearTime.getTime()) / 1000 / 60;
    
    if (minutesSinceLastClear >= config.CONSOLE_CLEAR_INTERVAL) {
        console.clear();
        console.log(`Ã°ÂÂ§Â¹ Consola limpiada (${consoleLogCount} logs desde ÃÂºltima limpieza)`);
        console.log(`Ã¢ÂÂ° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`);
        
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
    
    console.log('\nÃ°ÂÂÂ === MONITOR DE SESIONES ===');
    console.log(`Ã¢ÂÂ° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    console.log(`Ã°ÂÂÂ± Total sesiones: ${Object.keys(sessions).length}`);
    console.log(`Ã¢ÂÂ Sesiones activas: ${activeSessions.length}`);
    
    for (const [name, session] of Object.entries(sessions)) {
        const uptimeMinutes = Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60);
        const status = session.state === config.SESSION_STATES.READY ? 'Ã¢ÂÂ' : 'Ã¢ÂÂ';
        
        console.log(`${status} ${name}: ${session.state} | TelÃÂ©fono: ${session.phoneNumber || 'N/A'} | Uptime: ${uptimeMinutes}m | Mensajes: ${session.messages?.length || 0}`);
    }
    
    const rotationInfo = sessionManager.getRotationInfo();
    console.log(`\nÃ°ÂÂÂ SesiÃÂ³n actual: ${rotationInfo.currentSession || 'N/A'}`);
    console.log(`Ã°ÂÂÂ Balanceo: ${rotationInfo.balancingMode}`);
    console.log('==========================\n');
}

function sendSessionsStatusNotification() {
    try {
        const sessionsStatus = sessionManager.getSessionsStatus();
        const sessionsObj = sessionManager.getAllSessions();
        const rotationInfo = sessionManager.getRotationInfo();
        const total = sessionsStatus.length;
        const active = sessionsStatus.filter(s => s.state === config.SESSION_STATES.READY);
        const inactive = sessionsStatus.filter(s => s.state !== config.SESSION_STATES.READY);

        const nowStr = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
        let msg = "?? *REPORTE DE SESIONES*

" +
                  `? ${nowStr}

` +
                  `?? Total: ${total} | ? Activas: ${active.length} | ?? Inactivas: ${inactive.length}

`;

        msg += `Sesi?n actual: ${rotationInfo.currentSession || 'N/A'}
`;
        if (rotationInfo.nextRotation) {
            const next = new Date(rotationInfo.nextRotation).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Bogota' });
            msg += `Pr?xima rotaci?n: ${next}

`;
        } else {
            msg += "Pr?xima rotaci?n: N/A

";
        }

        msg += "*Sesiones Activas:*
";
        if (active.length === 0) {
            msg += "? Sin sesiones activas
";
        } else {
            active.forEach((s, i) => {
                const info = sessionsObj[s.name]?.info || {};
                const label = info.pushname ? ` (${info.pushname})` : '';
                msg += `${i + 1}. ? *${s.name}*${label}
`;
            });
        }

        msg += "
*Requieren atenci?n:*
";
        if (inactive.length === 0) {
            msg += "? Sin sesiones inactivas
";
        } else {
            inactive.forEach((s, i) => {
                const icon = s.state === config.SESSION_STATES.WAITING_FOR_QR ? '??' : (s.state === config.SESSION_STATES.RECONNECTING ? '??' : '??');
                msg += `${i + 1}. ${icon} *${s.name}* - ${s.state}
`;
            });
        }

        sessionManager.sendNotificationToAdmin(msg);
    } catch (error) {
        console.error('Error enviando notificacion de sesiones:', error.message);
    }
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
 * POST /api/sessions/create - Crea una nueva sesiÃÂ³n
 */
app.post('/api/sessions/create', async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'El nombre de la sesiÃÂ³n es requerido'
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
 * GET /api/sessions/:name/qr - Obtiene el cÃÂ³digo QR de una sesiÃÂ³n
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
 * GET /api/sessions/:name/status - Obtiene el estado de una sesiÃÂ³n
 */
app.get('/api/sessions/:name/status', (req, res) => {
    try {
        const { name } = req.params;
        const session = sessionManager.getSession(name);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'SesiÃÂ³n no encontrada'
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
 * DELETE /api/sessions/:name - Cierra y elimina una sesiÃÂ³n
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
            message: `SesiÃÂ³n ${name} cerrada exitosamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/sessions/rotation/info - InformaciÃÂ³n de rotaciÃÂ³n de sesiones
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
 * POST /api/sessions/rotation/rotate - Fuerza la rotaciÃÂ³n de sesiÃÂ³n
 */
app.post('/api/sessions/rotation/rotate', (req, res) => {
    try {
        sessionManager.rotateSession();
        const info = sessionManager.getRotationInfo();
        
        res.json({
            success: true,
            message: 'RotaciÃÂ³n realizada exitosamente',
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
 * POST /api/messages/send - EnvÃÂ­a un mensaje de texto
 */
app.post('/api/messages/send', async (req, res) => {
    try {
        const { phoneNumber, message, immediate } = req.body;
        
        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y message son requeridos'
            });
        }
        
        // Si immediate es true, enviar directamente. Si no, encolar.
        if (immediate === true || immediate === 'true') {
            const result = await sessionManager.sendMessageWithRotation(phoneNumber, message);
            
            if (result.success) {
                res.json({
                    success: true,
                    sessionUsed: result.sessionUsed,
                    message: 'Mensaje enviado exitosamente (inmediato)'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: result.error?.message || 'Error enviando mensaje'
                });
            }
        } else {
            // Encolar persistente y registrar en monitor
            const result = sessionManager.queueMessage(phoneNumber, message);
            if (result.success) {
                res.json({ success: true, queued: true, message: 'Mensaje encolado (persistente)', details: result });
            } else {
                res.status(500).json({ success: false, error: result.error });
            }
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/session/send-message - EnvÃÂ­a un mensaje desde una sesiÃÂ³n especÃÂ­fica
 */
app.post('/api/session/send-message', async (req, res) => {
    try {
        const { sessionName, phoneNumber, message } = req.body;

        if (!sessionName || !phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'sessionName, phoneNumber y message son requeridos'
            });
        }

        const session = sessionManager.getSession(sessionName);
        if (!session || session.state !== config.SESSION_STATES.READY || !session.socket) {
            return res.status(400).json({
                success: false,
                error: 'SesiÃÂ³n no disponible o no estÃÂ¡ lista'
            });
        }

        const formattedNumber = formatPhoneNumber(phoneNumber);
        if (!formattedNumber) {
            return res.status(400).json({ success: false, error: 'NÃÂºmero de telÃÂ©fono invÃÂ¡lido' });
        }

        const result = await sessionManager.sendMessageWithRetry(session, formattedNumber, message, 3);

        if (result.success) {
            sessionManager.logMessageSent(session.name, formattedNumber, message, 'sent');
            if (!session.messages) session.messages = [];
            session.messages.push({
                timestamp: new Date(),
                to: formattedNumber,
                message,
                direction: 'OUT',
                status: 'sent'
            });
            session.lastActivity = new Date();
            if (session.messages.length > config.MAX_MESSAGE_HISTORY) {
                session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);
            }
            return res.json({ success: true, message: 'Mensaje enviado exitosamente', sessionUsed: session.name });
        }

        return res.status(500).json({ success: false, error: result.error?.message || 'Error enviando mensaje' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/session/send-file - EnvÃÂ­a un archivo (imagen/video/audio/documento) desde una sesiÃÂ³n especÃÂ­fica
 * Campos esperados (multipart/form-data): sessionName, phoneNumber, caption (opcional), file
 */
app.post('/api/session/send-file', upload.single('file'), async (req, res) => {
    try {
        const { sessionName, phoneNumber, caption } = req.body || {};
        const file = req.file;

        if (!sessionName || !phoneNumber || !file) {
            return res.status(400).json({
                success: false,
                error: 'sessionName, phoneNumber y file son requeridos'
            });
        }

        const session = sessionManager.getSession(sessionName);
        if (!session || session.state !== config.SESSION_STATES.READY || !session.socket) {
            return res.status(400).json({ success: false, error: 'SesiÃÂ³n no disponible o no estÃÂ¡ lista' });
        }

        const formattedNumber = formatPhoneNumber(phoneNumber);
        if (!formattedNumber) {
            return res.status(400).json({ success: false, error: 'NÃÂºmero de telÃÂ©fono invÃÂ¡lido' });
        }

        const result = await sessionManager.sendMediaMessage(
            session,
            formattedNumber,
            file.buffer,
            file.mimetype || 'application/octet-stream',
            caption || ''
        );

        if (result.success) {
            sessionManager.logMessageSent(session.name, formattedNumber, caption || '[media]', 'sent');
            if (!session.messages) session.messages = [];
            session.messages.push({
                timestamp: new Date(),
                to: formattedNumber,
                message: caption || '[media]',
                direction: 'OUT',
                status: 'sent'
            });
            session.lastActivity = new Date();
            if (session.messages.length > config.MAX_MESSAGE_HISTORY) {
                session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);
            }
            return res.json({ success: true, message: 'Archivo enviado exitosamente', sessionUsed: session.name });
        }

        return res.status(500).json({ success: false, error: result.error?.message || 'Error enviando archivo' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/messages/send-bulk - EnvÃÂ­a mensajes masivos
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
                error: `MÃÂ¡ximo ${config.MAX_BULK_CONTACTS} contactos por envÃÂ­o`
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

// ======================== RUTAS - MONITOR (UI) ========================

/**
 * GET /api/rotation - InformaciÃÂ³n resumida para el monitor
 */
app.get('/api/rotation', (req, res) => {
    try {
        const info = sessionManager.getRotationInfo();
        res.json({
            currentSession: info.currentSession,
            nextRotation: info.nextRotation,
            totalActiveSessions: info.totalActiveSessions
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/monitor/messages - Todos los mensajes para el monitor (desde la BD)
 * Query: limit, offset
 */
app.get('/api/monitor/messages', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 500;
        const offset = parseInt(req.query.offset) || 0;
        const result = database.getMessagesByFilter({ limit, offset });
        // Adaptar formato para el monitor
        const messages = (result.messages || []).map(m => ({
            timestamp: m.timestamp,
            session: m.session,
            destination: m.phone_number || '',
            message: m.message_preview || '',
            status: m.status || 'unknown'
        }));
        res.json({ success: true, messages, total: result.total });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/monitor/history - Agregados simples por fecha y por sesiÃÂ³n
 */
app.get('/api/monitor/history', (req, res) => {
    try {
        // Leer agregados persistentes desde la BD para no depender del buffer en memoria
        const period = req.query.period || 'day';
        const range = req.query.range || 'today';
        const data = database.getAnalytics({ period, range, top: 10 });

        const byDate = (data.timeline || []).map(t => {
            const total = Number(t.total || 0);
            const errores = Number(t.errores || 0);
            const enCola = Number(t.en_cola || 0);
            // Considerar 'success' como total - errores - en_cola (incluye enviados y recibidos)
            const success = Math.max(total - errores - enCola, 0);
            return {
                date: t.periodo,
                total,
                success,
                error: errores
            };
        }).sort((a, b) => new Date(a.date) - new Date(b.date));

        const bySession = (data.sessions_stats || []).map(s => ({
            session: s.session,
            total: Number(s.total || 0),
            success: Number(s.enviados || 0),
            error: Number(s.errores || 0)
        })).sort((a, b) => b.total - a.total);

        const sessionsObj = sessionManager.getAllSessions();
        const rotation = sessionManager.getRotationInfo();
        const sessions = Object.entries(sessionsObj).map(([name, s]) => ({
            name,
            state: s.state,
            isActive: rotation.currentSession === name
        }));

        res.json({ success: true, byDate, bySession, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ======================== RUTAS - ANALYTICS ========================

/**
 * GET /api/analytics/stats - EstadÃÂ­sticas generales
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
        const { period = 'day', range = 'today', top = 10, start_date, end_date } = req.query;
        const options = { period, range, top: parseInt(top) };
        if (period === 'custom' && start_date && end_date) {
            options.startDate = start_date;
            options.endDate = end_date;
        }
        const data = await database.getAnalytics(options);
        res.json({ success: true, ...data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /analytics - Endpoint compatible con frontend (analytics.js)
 */
app.get('/analytics', async (req, res) => {
    try {
        const { period = 'day', range = 'today', top = 10, start_date, end_date } = req.query;
        const options = { period, range, top: parseInt(top) };
        if (period === 'custom' && start_date && end_date) {
            options.startDate = start_date;
            options.endDate = end_date;
        }
        const data = await database.getAnalytics(options);
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ======================== RUTAS - CONFIGURACIÃÂN ========================

/**
 * GET /api/settings/batch - Obtiene configuraciÃÂ³n de lotes
 */
app.get('/api/settings/batch', (req, res) => {
    try {
        const settings = sessionManager.getBatchSettings();
        res.json({
            success: true,
            settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/settings/batch - Actualiza configuraciÃÂ³n de lotes
 */
app.post('/api/settings/batch', (req, res) => {
    try {
        const { interval } = req.body;
        
        if (!interval) {
            return res.status(400).json({
                success: false,
                error: 'interval es requerido'
            });
        }
        
        const result = sessionManager.setBatchInterval(interval);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Intervalo actualizado correctamente',
                interval: result.interval
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================== COLA DE MENSAJES ========================

/**
 * GET /api/queue/messages - Obtiene mensajes en cola
 */
app.get('/api/queue/messages', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const messages = database.getQueuedMessages(limit);
        const stats = database.getQueueStats();
        
        res.json({
            success: true,
            stats,
            messages
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================== BÃÂSQUEDA DE MENSAJES ========================

/**
 * GET /api/messages/phones - Obtiene nÃÂºmeros ÃÂºnicos
 */
app.get('/api/messages/phones', (req, res) => {
    try {
        const phones = database.getUniquePhoneNumbers();
        res.json({
            success: true,
            phones
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/messages/search - Busca mensajes con filtros
 */
app.get('/api/messages/search', (req, res) => {
    try {
        const { phone, startDate, endDate, limit, offset } = req.query;
        
        const result = database.getMessagesByFilter({
            phoneNumber: phone,
            startDate,
            endDate,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0
        });
        
        res.json({
            success: true,
            ...result
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
    
    // Campos adicionales para compatibilidad con frontend analytics.js
    const availableSessions = sessionList.filter(s => s.state === config.SESSION_STATES.READY).map(s => s.name);
    const rotationInfoCompat = {
        current_session: rotationInfo.currentSession,
        messages_sent_current: 0,
        max_per_session: 100
    };

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
        rotation_info: rotationInfoCompat,
        available_sessions: availableSessions,
        uptime: process.uptime()
    });
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(config.PUBLIC_PATH, 'index.html'));
});

// ======================== INICIALIZACIÃÂN ========================

/**
 * Inicia los intervalos de monitoreo
 */
function startMonitoring() {
    // Limpiar consola periÃÂ³dicamente
    if (config.CONSOLE_CLEAR_ENABLED) {
        consoleClearInterval = setInterval(clearConsole, 60000);
    }
    
    // Monitoreo de sesiones
    sessionMonitorInterval = setInterval(monitorSessions, config.SESSION_MONITOR_INTERVAL * 60000);

    // Notificaciones de estado de sesiones
    notificationInterval = setInterval(sendSessionsStatusNotification, config.NOTIFICATION_INTERVAL_MINUTES * 60000);
    
    console.log('Ã¢ÂÂ Monitoreo iniciado');
}

/**
 * Detiene los intervalos de monitoreo
 */
function stopMonitoring() {
    if (consoleClearInterval) clearInterval(consoleClearInterval);
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    if (notificationInterval) clearInterval(notificationInterval);
    sessionManager.stopSessionRotation();
    
    console.log('Ã¢ÂÂ¹Ã¯Â¸Â Monitoreo detenido');
}

/**
 * Inicializa el servidor
 */
async function initialize() {
    try {
        console.log('\nÃ°ÂÂÂ Iniciando WhatsApp Bot Server con Baileys...\n');
        
        // Inicializar base de datos
        await database.init();

        // Cargar sesiones existentes
        await sessionManager.loadSessionsFromDisk();
        
        // Iniciar servidor HTTP
        server.listen(config.PORT, () => {
            console.log(`Ã¢ÂÂ Servidor escuchando en puerto ${config.PORT}`);
            console.log(`Ã°ÂÂÂ http://localhost:${config.PORT}`);
            console.log(`Ã¢ÂÂ° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`);
        });
        
        // Iniciar monitoreo
        startMonitoring();
        
        // Iniciar rotaciÃÂ³n de sesiones
        sessionManager.startSessionRotation();
        
        // Iniciar procesador de lotes
        sessionManager.startBatchProcessor();

        console.log('Ã¢ÂÂ Sistema iniciado correctamente\n');
        
    } catch (error) {
        console.error('Ã¢ÂÂ Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Manejo de seÃÂ±ales de cierre
process.on('SIGINT', async () => {
    console.log('\n\nÃ°ÂÂÂ Recibida seÃÂ±al SIGINT, cerrando servidor...');
    stopMonitoring();
    
    // Cerrar todas las sesiones
    const sessions = sessionManager.getAllSessions();
    for (const name of Object.keys(sessions)) {
        await sessionManager.closeSession(name, false);
    }
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n\nÃ°ÂÂÂ Recibida seÃÂ±al SIGTERM, cerrando servidor...');
    stopMonitoring();
    
    const sessions = sessionManager.getAllSessions();
    for (const name of Object.keys(sessions)) {
        await sessionManager.closeSession(name, false);
    }
    
    process.exit(0);
});

// Iniciar aplicaciÃÂ³n
initialize();

module.exports = app;

// ======================== ANALYTICS (compatibilidad) ========================
// Endpoint ÃÂºnico "/analytics" esperado por public/js/analytics.js
app.get('/analytics', async (req, res) => {
    try {
        const { period = 'day', range = 'today', top = 10, start_date, end_date } = req.query;
        const options = { period, range, top: parseInt(top) };
        if (period === 'custom' && start_date && end_date) {
            options.startDate = start_date;
            options.endDate = end_date;
        }
        const data = await database.getAnalytics(options);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
