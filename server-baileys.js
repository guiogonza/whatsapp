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
const multer = require('multer');

// Configuración
const config = require('./config');

// Gestor de sesiones con Baileys
const sessionManager = require('./sessionManager-baileys');

const database = require('./database');

// Utilidad simple para formatear números de teléfono
const formatPhoneNumber = (phone) => {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned.startsWith('57')) cleaned = '57' + cleaned;
    return cleaned + '@s.whatsapp.net';
};

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
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

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
        console.log(`ƒ°‚Ÿ‚§‚¹ Consola limpiada (${consoleLogCount} logs desde última limpieza)`);
        console.log(`ƒ¢‚‚° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`);
        
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
    
    console.log('\nƒ°‚Ÿ‚“‚Š === MONITOR DE SESIONES ===');
    console.log(`ƒ¢‚‚° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    console.log(`ƒ°‚Ÿ‚“‚± Total sesiones: ${Object.keys(sessions).length}`);
    console.log(`✅ Sesiones activas: ${activeSessions.length}`);
    
    for (const [name, session] of Object.entries(sessions)) {
        const uptimeMinutes = Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60);
        const status = session.state === config.SESSION_STATES.READY ? '✅' : 'ƒ¢‚‚Œ';
        
        console.log(`${status} ${name}: ${session.state} | Teléfono: ${session.phoneNumber || 'N/A'} | Uptime: ${uptimeMinutes}m | Mensajes: ${session.messages?.length || 0}`);
    }
    
    const rotationInfo = sessionManager.getRotationInfo();
    console.log(`\nƒ°‚Ÿ‚”‚„ Sesión actual: ${rotationInfo.currentSession || 'N/A'}`);
    console.log(`ƒ°‚Ÿ‚“‚Š Balanceo: ${rotationInfo.balancingMode}`);
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
        let msg = "\uD83D\uDCCA *REPORTE DE SESIONES*\n\n" +
                  `\uD83D\uDD50 ${nowStr}\n\n` +
                  `\uD83D\uDCC8 Total: ${total} | \u2705 Activas: ${active.length} | \u26A0\uFE0F Inactivas: ${inactive.length}\n\n`;

        if (active.length === 0) {
            msg += "*Sesiones Activas:*\n\u2022 Sin sesiones activas\n";
        } else {
            msg += "*Sesiones Activas:*\n";
            active.forEach((s, i) => {
                const info = sessionsObj[s.name]?.info || {};
                const label = info.pushname ? ` (${info.pushname})` : '';
                msg += `${i + 1}. \u2705 *${s.name}*${label}\n`;
            });
        }

        if (inactive.length === 0) {
            msg += "\n*Requieren atenci\u00F3n:*\n\u2022 Sin sesiones inactivas\n";
        } else {
            msg += "\n*Requieren atenci\u00F3n:*\n";
            inactive.forEach((s, i) => {
                const icon = s.state == config.SESSION_STATES.WAITING_FOR_QR ? '\uD83D\uDCF1' : (s.state == config.SESSION_STATES.RECONNECTING ? '\uD83D\uDD04' : '\u26A0\uFE0F');
                msg += `${i + 1}. ${icon} *${s.name}* - ${s.state}\n`;
            });
        }

        sessionManager.sendNotificationToAdmin(msg);
    } catch (error) {
        console.error('Error enviando notificacion de sesiones:', error.message);
    }
}




// ======================== RUTAS - SESIONES ========================

// Cache de IP pública (se actualiza cada 5 minutos)
let cachedPublicIP = null;
let lastIPCheck = 0;
const IP_CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

async function getPublicIP() {
    const now = Date.now();
    if (cachedPublicIP && (now - lastIPCheck) < IP_CACHE_DURATION) {
        return cachedPublicIP;
    }
    try {
        const https = require('https');
        const PROXY_URL = process.env.ALL_PROXY || process.env.SOCKS_PROXY || null;
        let agent = null;
        
        // Usar proxy si está configurado
        if (PROXY_URL) {
            const { SocksProxyAgent } = require('socks-proxy-agent');
            agent = new SocksProxyAgent(PROXY_URL);
        }
        
        const ip = await new Promise((resolve, reject) => {
            const options = { agent };
            https.get('https://api.ipify.org', options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data.trim()));
            }).on('error', reject);
        });
        cachedPublicIP = ip;
        lastIPCheck = now;
        return ip;
    } catch (error) {
        console.error('Error obteniendo IP pública:', error.message);
        return cachedPublicIP || 'No disponible';
    }
}

/**
 * GET /api/network/ip - Obtiene la IP pública actual
 */
app.get('/api/network/ip', async (req, res) => {
    try {
        const ip = await getPublicIP();
        res.json({ success: true, ip });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/sessions - Lista todas las sesiones
 */
app.get('/api/sessions', async (req, res) => {
    try {
        const sessions = sessionManager.getSessionsStatus();
        const publicIP = await getPublicIP();
        res.json({
            success: true,
            sessions,
            networkInfo: {
                publicIP,
                lastChecked: new Date(lastIPCheck).toISOString()
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
        
        // Intentar cerrar la sesion (puede no existir en memoria si el servidor se reinicio)
        const sessionClosed = await sessionManager.closeSession(name);

        // Siempre intentar eliminar los datos si deleteData=true
        let dataDeleted = false;
        if (deleteData === 'true') {
            dataDeleted = await sessionManager.deleteSessionData(name);
        }

        res.json({
            success: true,
            sessionClosed,
            dataDeleted,
            message: `Sesion ${name} eliminada exitosamente`
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
 * POST /api/messages/send - Envia un mensaje de texto
 * Por defecto consolida mensajes del mismo numero antes de enviar
 * Opciones:
 *   - immediate: true = envia sin esperar consolidacion (bypass)
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
        
        // Modo 1: Envio inmediato sin consolidacion (bypass)
        if (immediate === true || immediate === 'true') {
            const result = await sessionManager.sendMessageWithRotation(phoneNumber, message);
            
            if (result.success) {
                res.json({
                    success: true,
                    sessionUsed: result.sessionUsed,
                    message: 'Mensaje enviado exitosamente (inmediato sin consolidacion)'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: result.error?.message || 'Error enviando mensaje'
                });
            }
        } 
        // Modo 2 (DEFAULT): Consolidar mensajes del mismo numero antes de enviar
        else {
            const result = sessionManager.addToConsolidation(phoneNumber, message);
            if (result.success) {
                res.json({ 
                    success: true, 
                    consolidated: true, 
                    message: `Mensaje agregado a consolidacion (${result.pendingCount} msgs pendientes, envio en ${result.sendInMinutes} min)`,
                    details: result 
                });
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
 * POST /api/session/send-message - Envía un mensaje desde una sesión específica
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
                error: 'Sesión no disponible o no está lista'
            });
        }

        const formattedNumber = formatPhoneNumber(phoneNumber);
        if (!formattedNumber) {
            return res.status(400).json({ success: false, error: 'Número de teléfono inválido' });
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
 * POST /api/session/send-file - Envía un archivo (imagen/video/audio/documento) desde una sesión específica
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
            return res.status(400).json({ success: false, error: 'Sesión no disponible o no está lista' });
        }

        const formattedNumber = formatPhoneNumber(phoneNumber);
        if (!formattedNumber) {
            return res.status(400).json({ success: false, error: 'Número de teléfono inválido' });
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

/**
 * GET /api/messages/consolidation - Estado actual de la consolidación de mensajes
 */
app.get('/api/messages/consolidation', (req, res) => {
    try {
        const status = sessionManager.getConsolidationStatus();
        const batchSettings = sessionManager.getBatchSettings();
        res.json({
            success: true,
            consolidationDelayMinutes: batchSettings.interval,
            icon: config.MESSAGE_CONSOLIDATION_ICON || 'ðŸ“',
            pending: status
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
 * GET /api/rotation - Información resumida para el monitor
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
 * GET /api/monitor/history - Agregados simples por fecha y por sesión
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

// ======================== RUTAS - CONFIGURACION ========================

/**
 * GET /api/settings/consolidation - Obtiene configuracion de consolidacion
 * GET /api/settings/batch - (alias mantenido por compatibilidad)
 */
app.get(['/api/settings/consolidation', '/api/settings/batch'], (req, res) => {
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
 * POST /api/settings/consolidation - Actualiza configuracion de consolidacion
 * POST /api/settings/batch - (alias mantenido por compatibilidad)
 */
app.post(['/api/settings/consolidation', '/api/settings/batch'], (req, res) => {
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
                message: 'Intervalo de consolidacion actualizado correctamente',
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

/**
 * GET /api/settings/notification-interval - Obtiene intervalo de notificaciones
 */
app.get('/api/settings/notification-interval', (req, res) => {
    try {
        res.json({
            success: true,
            interval: Math.floor(config.NOTIFICATION_INTERVAL_MINUTES)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/settings/notification-interval - Actualiza intervalo de notificaciones
 */
app.post('/api/settings/notification-interval', (req, res) => {
    try {
        const { interval } = req.body;
        
        if (!interval || ![1, 5, 30, 60].includes(interval)) {
            return res.status(400).json({
                success: false,
                error: 'Intervalo debe ser 1, 5, 30 o 60 minutos'
            });
        }
        
        // Actualizar configuración
        config.NOTIFICATION_INTERVAL_MINUTES = interval;
        
        // Reiniciar intervalo de notificaciones
        if (notificationInterval) {
            clearInterval(notificationInterval);
        }
        notificationInterval = setInterval(sendSessionsStatusNotification, interval * 60000);
        
        console.log(`✅ Intervalo de notificaciones actualizado a ${interval} minutos`);
        
        res.json({
            success: true,
            message: `Notificaciones configuradas cada ${interval} minutos`,
            interval
        });
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
 * Query params:
 *   - limit: número máximo de resultados (default: 50)
 *   - status: 'pending', 'sent', 'all' (default: 'pending')
 */
app.get('/api/queue/messages', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const status = req.query.status || 'pending';
        const messages = database.getQueuedMessages(limit, status);
        const stats = database.getQueueStats();
        
        res.json({
            success: true,
            stats,
            messages,
            filter: status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/queue/mark-all-sent - Marca todos los mensajes pendientes como enviados manualmente
 */
app.post('/api/queue/mark-all-sent', (req, res) => {
    try {
        const count = database.markAllPendingAsSent();
        res.json({
            success: true,
            message: `${count} mensajes marcados como enviados manualmente`,
            markedCount: count
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================== BÚSQUEDA DE MENSAJES ========================

/**
 * GET /api/messages/phones - Obtiene números únicos
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

// ======================== INICIALIZACIƒƒ‚“N ========================

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

    // Notificaciones de estado de sesiones
    notificationInterval = setInterval(sendSessionsStatusNotification, config.NOTIFICATION_INTERVAL_MINUTES * 60000);
    
    console.log('✅ Monitoreo iniciado');
}

/**
 * Detiene los intervalos de monitoreo
 */
function stopMonitoring() {
    if (consoleClearInterval) clearInterval(consoleClearInterval);
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    if (notificationInterval) clearInterval(notificationInterval);
    sessionManager.stopSessionRotation();
    
    console.log('ƒ¢‚‚¹ƒ¯‚¸‚ Monitoreo detenido');
}

/**
 * Inicializa el servidor
 */
async function initialize() {
    try {
        console.log('\nƒ°‚Ÿ‚š‚€ Iniciando WhatsApp Bot Server con Baileys...\n');
        
        // Inicializar base de datos
        await database.init();

        // Cargar sesiones existentes
        await sessionManager.loadSessionsFromDisk();
        
        // Iniciar servidor HTTP
        server.listen(config.PORT, () => {
            console.log(`✅ Servidor escuchando en puerto ${config.PORT}`);
            console.log(`ƒ°‚Ÿ‚Œ‚ http://localhost:${config.PORT}`);
            console.log(`ƒ¢‚‚° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`);
        });
        
        // Iniciar monitoreo
        startMonitoring();
        
        // Iniciar rotación de sesiones
        sessionManager.startSessionRotation();
        
        // Iniciar procesador de consolidación de mensajes (persistente en BD)
        sessionManager.startConsolidationProcessor();

        console.log('✅ Sistema iniciado correctamente\n');
        
    } catch (error) {
        console.error('ƒ¢‚‚Œ Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Manejo de seƒƒ‚±ales de cierre
process.on('SIGINT', async () => {
    console.log('\n\nƒ°‚Ÿ‚›‚‘ Recibida seƒƒ‚±al SIGINT, cerrando servidor...');
    stopMonitoring();
    
    // Cerrar todas las sesiones
    const sessions = sessionManager.getAllSessions();
    for (const name of Object.keys(sessions)) {
        await sessionManager.closeSession(name, false);
    }
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n\nƒ°‚Ÿ‚›‚‘ Recibida seƒƒ‚±al SIGTERM, cerrando servidor...');
    stopMonitoring();
    
    const sessions = sessionManager.getAllSessions();
    for (const name of Object.keys(sessions)) {
        await sessionManager.closeSession(name, false);
    }
    
    process.exit(0);
});

// Iniciar aplicación
initialize();

module.exports = app;

// ======================== ANALYTICS (compatibilidad) ========================
// Endpoint único "/analytics" esperado por public/js/analytics.js
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
