﻿/**
 * WhatsApp Bot Server con Baileys
 * 
 * CaracterÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â­sticas principales:
 * - ImplementaciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n con Baileys (mÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â¡s seguro y difÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â­cil de detectar)
 * - RotaciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n automÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â¡tica de sesiones
 * - CÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³digo modular y organizado
 * - Monitoreo de sesiones activas
 * - EnvÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â­o masivo con distribuciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n entre sesiones
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

// ConfiguraciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n
const config = require('./config');

// Gestor de sesiones con Baileys
const sessionManager = require('./sessionManager-baileys');

const database = require('./database-postgres');

// Webhook para WhatsApp Cloud API
const webhook = require('./lib/session/webhook');

// Utilidades centralizadas
const { formatPhoneNumber } = require('./lib/session/utils');

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
 * Limpia la consola si estÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â¡ habilitado
 */
function clearConsole() {
    if (!config.CONSOLE_CLEAR_ENABLED) return;
    
    const minutesSinceLastClear = (Date.now() - lastClearTime.getTime()) / 1000 / 60;
    
    if (minutesSinceLastClear >= config.CONSOLE_CLEAR_INTERVAL) {
        console.clear();
        console.log(`ÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚Â§ÃƒÂ‚Ã‚Â¹ Consola limpiada (${consoleLogCount} logs desde ÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Âºltima limpieza)`);
        console.log(`ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂÃƒÂ‚Ã‚Â° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`);
        
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
    
    console.log('\nÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚Â“ÃƒÂ‚Ã‚ÂŠ === MONITOR DE SESIONES ===');
    console.log(`ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂÃƒÂ‚Ã‚Â° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    console.log(`ÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚Â“ÃƒÂ‚Ã‚Â± Total sesiones: ${Object.keys(sessions).length}`);
    console.log(`ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂœÃƒÂ‚Ã‚Â… Sesiones activas: ${activeSessions.length}`);
    
    for (const [name, session] of Object.entries(sessions)) {
        const uptimeMinutes = Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60);
        const status = session.state === config.SESSION_STATES.READY ? 'ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂœÃƒÂ‚Ã‚Â…' : 'ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂÃƒÂ‚Ã‚ÂŒ';
        
        console.log(`${status} ${name}: ${session.state} | TelÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â©fono: ${session.phoneNumber || 'N/A'} | Uptime: ${uptimeMinutes}m | Mensajes: ${session.messages?.length || 0}`);
    }
    
    const rotationInfo = sessionManager.getRotationInfo();
    console.log(`\nÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚Â”ÃƒÂ‚Ã‚Â„ SesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n actual: ${rotationInfo.currentSession || 'N/A'}`);
    console.log(`ÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚Â“ÃƒÂ‚Ã‚ÂŠ Balanceo: ${rotationInfo.balancingMode}`);
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

        // Emojis usando codigos Unicode para evitar problemas de codificacion
        const EMOJI = {
            CHART: '\uD83D\uDCCA',     // 
            CLOCK: '\u23F0',           // 
            GRAPH: '\uD83D\uDCC8',     // 
            CHECK: '\u2705',           // 
            WARNING: '\u26A0\uFE0F',   // 
            PHONE: '\uD83D\uDCF1',     // 
            REFRESH: '\uD83D\uDD04'    // 
        };

        const nowStr = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
        let msg = `${EMOJI.CHART} *REPORTE DE SESIONES*\n\n` +
                  `${EMOJI.CLOCK} ${nowStr}\n\n` +
                  `${EMOJI.GRAPH} Total: ${total} | ${EMOJI.CHECK} Activas: ${active.length} | ${EMOJI.WARNING} Inactivas: ${inactive.length}\n\n`;

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
            msg += "\n*Requieren atencion:*\n- Sin sesiones inactivas\n";
        } else {
            msg += "\n*Requieren atencion:*\n";
            inactive.forEach((s, i) => {
                const icon = s.state == config.SESSION_STATES.WAITING_FOR_QR ? EMOJI.PHONE : (s.state == config.SESSION_STATES.RECONNECTING ? EMOJI.REFRESH : EMOJI.WARNING);
                msg += `${i + 1}. ${icon} *${s.name}* - ${s.state}\n`;
            });
        }

        sessionManager.sendNotificationToAdmin(msg);
    } catch (error) {
        console.error('Error enviando notificacion de sesiones:', error.message);
    }
}




// ======================== RUTAS - SESIONES ========================

// Cache de IP pública (se actualiza cada 30 segundos para reflejar cambios de proxy)
let cachedPublicIP = null;
let cachedProxyStatus = null;
let lastIPCheck = 0;
const IP_CACHE_DURATION = 30 * 1000; // 30 segundos para detectar cambios rápidamente
const net = require('net');

/**
 * Verifica si el proxy SOCKS5 está disponible
 */
async function checkProxyAvailable(proxyUrl) {
    if (!proxyUrl) return false;
    
    try {
        const proxyMatch = proxyUrl.match(/socks5?:\/\/([^:]+):(\d+)/);
        if (!proxyMatch) return false;
        
        const [, host, port] = proxyMatch;
        
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(3000);
            
            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });
            
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.connect(parseInt(port), host);
        });
    } catch (error) {
        return false;
    }
}

async function getPublicIP() {
    const now = Date.now();
    if (cachedPublicIP && (now - lastIPCheck) < IP_CACHE_DURATION) {
        return { ip: cachedPublicIP, usingProxy: cachedProxyStatus };
    }
    try {
        const https = require('https');
        const PROXY_URL = process.env.ALL_PROXY || process.env.SOCKS_PROXY || null;
        let agent = null;
        let usingProxy = false;
        
        // Verificar si el proxy está disponible antes de usarlo
        if (PROXY_URL) {
            const proxyAvailable = await checkProxyAvailable(PROXY_URL);
            if (proxyAvailable) {
                const { SocksProxyAgent } = require('socks-proxy-agent');
                agent = new SocksProxyAgent(PROXY_URL);
                usingProxy = true;
                console.log('🌐 Proxy disponible, obteniendo IP a través del proxy (Colombia)');
            } else {
                console.log('⚠️ Proxy no disponible, obteniendo IP directa del VPS');
            }
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
        cachedProxyStatus = usingProxy;
        lastIPCheck = now;
        return { ip, usingProxy };
    } catch (error) {
        console.error('Error obteniendo IP pública:', error.message);
        return { ip: cachedPublicIP || 'No disponible', usingProxy: cachedProxyStatus || false };
    }
}

/**
 * GET /api/network/ip - Obtiene la IP pública actual
 */
app.get('/api/network/ip', async (req, res) => {
    try {
        const { ip, usingProxy } = await getPublicIP();
        res.json({ success: true, ip, usingProxy });
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
        const allSessions = sessionManager.getAllSessions();
        const { getAllSessionProxyIPs } = require('./lib/session/proxy');
        
        // Obtener IPs de proxies para cada sesión
        const proxyIPs = await getAllSessionProxyIPs();
        
        // Obtener estadísticas de la BD para cada sesión
        const dbSessionStats = await database.getSessionStats();
        
        // Agregar conteo de mensajes enviados desde inicio de sesión y IP del proxy a cada sesión
        const sessionsWithInfo = sessions.map(session => {
            const fullSession = allSessions[session.name];
            const dbStats = dbSessionStats[session.name] || { sentCount: 0, receivedCount: 0, consolidatedCount: 0 };
            
            return {
                ...session,
                // Usar valores de BD (históricos) en lugar de solo memoria
                messagesSentCount: dbStats.sentCount,
                messagesReceivedCount: dbStats.receivedCount,
                consolidatedCount: dbStats.consolidatedCount,
                proxyInfo: proxyIPs[session.name] || { ip: null, proxyUrl: null, location: 'VPS Directo', country: 'VPS', city: 'Directo', countryCode: '' }
            };
        });
        
        const { ip: publicIP, usingProxy } = await getPublicIP();
        res.json({
            success: true,
            sessions: sessionsWithInfo,
            networkInfo: {
                publicIP,
                usingProxy,
                location: usingProxy ? 'Colombia (via Proxy)' : 'VPS Directo',
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
 * POST /api/sessions/create - Crea una nueva sesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n
 */
app.post('/api/sessions/create', async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'El nombre de la sesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n es requerido'
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
 * GET /api/sessions/:name/qr - Obtiene el cÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³digo QR de una sesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n
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
 * GET /api/sessions/:name/status - Obtiene el estado de una sesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n
 */
app.get('/api/sessions/:name/status', (req, res) => {
    try {
        const { name } = req.params;
        const session = sessionManager.getSession(name);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'SesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n no encontrada'
            });
        }
        
        res.json({
            success: true,
            session: {
                name: session.name,
                state: session.state,
                phoneNumber: session.phoneNumber,
                qrReady: !!session.qr,
                messagesCount: session.messagesSentCount || 0,
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
 * DELETE /api/sessions/:name - Cierra y elimina una sesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n
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
 * GET /api/sessions/rotation/info - InformaciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n de rotaciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n de sesiones
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
 * GET /api/proxy/status - Estado de los proxies SOCKS5
 */
app.get('/api/proxy/status', (req, res) => {
    try {
        const proxyStatus = sessionManager.getProxyStatus();
        const assignments = sessionManager.getSessionProxyAssignments();
        
        res.json({
            success: true,
            proxy: {
                ...proxyStatus,
                sessionAssignments: Object.fromEntries(assignments)
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
 * GET /api/hybrid/status - Estado del modo híbrido (Cloud API + Baileys)
 */
app.get('/api/hybrid/status', (req, res) => {
    try {
        const hybridStatus = sessionManager.getHybridStatus();
        
        res.json({
            success: true,
            hybrid: hybridStatus
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ======================== WEBHOOK WHATSAPP CLOUD API ========================

/**
 * GET /webhook - Verificación del webhook por Meta (ruta principal)
 */
app.get('/webhook', (req, res) => {
    webhook.verifyWebhook(req, res);
});

/**
 * POST /webhook - Recibe notificaciones de Meta (mensajes, estados)
 */
app.post('/webhook', (req, res) => {
    webhook.handleWebhook(req, res);
});

/**
 * GET /webhook/whatsapp - Verificación del webhook por Meta (ruta alternativa)
 */
app.get('/webhook/whatsapp', (req, res) => {
    webhook.verifyWebhook(req, res);
});

/**
 * POST /webhook/whatsapp - Recibe notificaciones de Meta (mensajes, estados)
 */
app.post('/webhook/whatsapp', (req, res) => {
    webhook.handleWebhook(req, res);
});

/**
 * GET /api/webhook/messages - Obtiene mensajes recibidos via webhook
 */
app.get('/api/webhook/messages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const messages = await webhook.getReceivedMessagesFromDB(limit);
        
        res.json({
            success: true,
            count: messages.length,
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
 * GET /api/webhook/config - Obtiene configuración del webhook
 */
app.get('/api/webhook/config', (req, res) => {
    res.json({
        success: true,
        webhookUrl: '/webhook/whatsapp',
        verifyToken: webhook.getVerifyToken(),
        instructions: {
            step1: 'Ve a developers.facebook.com > tu app > WhatsApp > Configuración',
            step2: 'En "Webhook", haz clic en "Configurar webhook"',
            step3: 'URL de devolución: https://TU_DOMINIO/webhook/whatsapp',
            step4: 'Token de verificación: ' + webhook.getVerifyToken(),
            step5: 'Suscríbete a: messages, message_status'
        }
    });
});

/**
 * POST /api/cloud/send - Enviar mensaje via WhatsApp Cloud API
 */
app.post('/api/cloud/send', async (req, res) => {
    try {
        const { to, type, message, template } = req.body;
        
        if (!to) {
            return res.status(400).json({ success: false, error: 'Número de destino requerido' });
        }
        
        const cloudApi = require('./lib/session/whatsapp-cloud-api');
        let result;
        
        if (type === 'template') {
            result = await cloudApi.sendTemplateMessage(to, template || 'hello_world');
        } else {
            result = await cloudApi.sendTextMessage(to, message);
        }
        
        if (result.success) {
            // Guardar en BD
            const db = require('./database-postgres');
            try {
                await db.query(`
                    INSERT INTO webhook_messages (wa_message_id, from_number, to_number, message_type, message_body, direction, status, timestamp)
                    VALUES ($1, $2, $3, $4, $5, 'outgoing', 'sent', NOW())
                `, [result.messageId, config.WHATSAPP_CLOUD_PHONE_ID, to, type || 'text', message || `[Template: ${template || 'hello_world'}]`]);
            } catch (dbErr) {
                console.error('Error guardando mensaje saliente:', dbErr);
            }
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/cloud/stats - Estadísticas de WhatsApp Cloud API
 */
app.get('/api/cloud/stats', async (req, res) => {
    try {
        const cloudApi = require('./lib/session/whatsapp-cloud-api');
        const stats = cloudApi.getStats();
        
        // Obtener conteo de mensajes enviados desde la BD
        const db = require('./database-postgres');
        let dbStats = { total: 0, today: 0, thisHour: 0 };
        
        try {
            // Total de mensajes enviados por Cloud API
            const totalResult = await db.query(`
                SELECT COUNT(*) as count FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent'
            `);
            dbStats.total = parseInt(totalResult.rows[0]?.count || 0);
            
            // Mensajes de hoy
            const todayResult = await db.query(`
                SELECT COUNT(*) as count FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND created_at >= CURRENT_DATE
            `);
            dbStats.today = parseInt(todayResult.rows[0]?.count || 0);
            
            // Mensajes de la última hora
            const hourResult = await db.query(`
                SELECT COUNT(*) as count FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND created_at >= NOW() - INTERVAL '1 hour'
            `);
            dbStats.thisHour = parseInt(hourResult.rows[0]?.count || 0);
            
            // Mensajes por día (últimos 7 días)
            const dailyResult = await db.query(`
                SELECT DATE(created_at) as date, COUNT(*) as count 
                FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND created_at >= NOW() - INTERVAL '7 days'
                GROUP BY DATE(created_at) 
                ORDER BY date DESC
            `);
            dbStats.daily = dailyResult.rows;
            
        } catch (dbErr) {
            console.error('Error obteniendo estadísticas de BD:', dbErr);
        }
        
        res.json({
            success: true,
            cloudApi: stats,
            database: dbStats,
            phoneNumber: config.WHATSAPP_CLOUD_PHONE_ID,
            hybridMode: config.HYBRID_MODE_ENABLED,
            percentage: config.WHATSAPP_CLOUD_PERCENTAGE || 50
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/cloud/enable - Habilitar Cloud API (marcar cuenta como lista)
 */
app.post('/api/cloud/enable', (req, res) => {
    try {
        const cloudApi = require('./lib/session/whatsapp-cloud-api');
        cloudApi.setAccountReady(true);
        res.json({ 
            success: true, 
            message: 'Cloud API habilitada. Los mensajes ahora se enviarán por Cloud API.',
            stats: cloudApi.getStats()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/cloud/disable - Deshabilitar Cloud API (marcar cuenta como no lista)
 */
app.post('/api/cloud/disable', (req, res) => {
    try {
        const cloudApi = require('./lib/session/whatsapp-cloud-api');
        const { reason } = req.body;
        cloudApi.setAccountReady(false, reason || 'Deshabilitada manualmente');
        res.json({ 
            success: true, 
            message: 'Cloud API deshabilitada. Los mensajes irán solo por Baileys o quedarán en cola.',
            stats: cloudApi.getStats()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/sessions/cleanup - Ejecuta el limpiador de sesiones estancadas manualmente
 */
app.post('/api/sessions/cleanup', async (req, res) => {
    try {
        const cleaned = await sessionManager.runStaleSessionCleaner();
        res.json({
            success: true,
            message: `Limpiador ejecutado. ${cleaned} sesiones eliminadas.`,
            sessionsRemoved: cleaned
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
 * Limpia el formato del mensaje de GPS (quita timezone feo)
 */
function cleanGPSMessage(message) {
    if (!message) return message;
    
    // Patrón: [Mon Jan 19 2026 15:54:21 GMT-0500 (Colombia Standard Time)]
    // Convertir a: 19-01-2026 15:54:21
    const gpsPattern = /\[?\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})\s*GMT[^\]]*(?:\([^)]*\))?\]?/gi;
    
    const months = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };
    
    return message.replace(gpsPattern, (match, month, day, year, time) => {
        const mm = months[month] || month;
        const dd = day.padStart(2, '0');
        return `${dd}-${mm}-${year} ${time}`;
    });
}

/**
 * POST /api/messages/send - Envia un mensaje de texto
 * Por defecto consolida mensajes del mismo numero antes de enviar
 * Opciones:
 *   - immediate: true = envia sin esperar consolidacion (bypass)
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
        
        // Limpiar formato de mensaje GPS
        const cleanedMessage = cleanGPSMessage(message);
        
        // SIEMPRE consolidar - sin opcion de bypass
        const result = await sessionManager.addToConsolidation(phoneNumber, cleanedMessage);
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
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/session/send-message - EnvÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â­a un mensaje desde una sesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n especÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â­fica
 */
app.post('/api/session/send-message', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y message son requeridos'
            });
        }

        // Limpiar formato de mensaje GPS
        const cleanedMessage = cleanGPSMessage(message);

        // SIEMPRE consolidar - sin opcion de bypass
        const result = await sessionManager.addToConsolidation(phoneNumber, cleanedMessage);
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
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/session/send-file - EnvÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â­a un archivo (imagen/video/audio/documento) desde una sesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n especÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â­fica
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
            return res.status(400).json({ success: false, error: 'SesiÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n no disponible o no estÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â¡ lista' });
        }

        const formattedNumber = formatPhoneNumber(phoneNumber);
        if (!formattedNumber) {
            return res.status(400).json({ success: false, error: 'NÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Âºmero de telÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â©fono invÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â¡lido' });
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
 * POST /api/messages/send-bulk - Envia mensajes masivos (todos van a consolidacion)
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
                error: `Maximo ${config.MAX_BULK_CONTACTS} contactos por envio`
            });
        }
        
        const results = [];
        
        // SIEMPRE consolidar - sin opcion de bypass
        for (const contact of contacts) {
            const phoneNumber = contact.phoneNumber || contact.phone || contact;
            if (!phoneNumber) continue;
            
            const result = await sessionManager.addToConsolidation(phoneNumber, message);
            results.push({
                phoneNumber,
                success: result.success,
                consolidated: true,
                pendingCount: result.pendingCount
            });
        }
        
        const successCount = results.filter(r => r.success).length;
        res.json({
            success: true,
            consolidated: true,
            total: contacts.length,
            queued: successCount,
            failed: contacts.length - successCount,
            message: `${successCount} mensajes agregados a consolidacion`,
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
 * GET /api/messages/consolidation - Estado actual de la consolidaciÃ³n de mensajes
 */
app.get('/api/messages/consolidation', async (req, res) => {
    try {
        const status = await sessionManager.getConsolidationStatus();
        const batchSettings = await sessionManager.getBatchSettings();
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
 * GET /api/rotation - InformaciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n resumida para el monitor
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
app.get('/api/monitor/messages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 500;
        const offset = parseInt(req.query.offset) || 0;
        const result = await database.getMessagesByFilter({ limit, offset });
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
app.get('/api/monitor/history', async (req, res) => {
    try {
        // Leer agregados persistentes desde la BD para no depender del buffer en memoria
        const period = req.query.period || 'day';
        const range = req.query.range || 'today';
        const data = await database.getAnalytics({ period, range, top: 10 });

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
 * GET /api/analytics/stats - EstadÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â­sticas generales
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
app.get(['/api/settings/consolidation', '/api/settings/batch'], async (req, res) => {
    try {
        const settings = await sessionManager.getBatchSettings();
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
        
        // Actualizar configuraciÃ³n
        config.NOTIFICATION_INTERVAL_MINUTES = interval;
        
        // Reiniciar intervalo de notificaciones
        if (notificationInterval) {
            clearInterval(notificationInterval);
        }
        notificationInterval = setInterval(sendSessionsStatusNotification, interval * 60000);
        
        console.log(`âœ… Intervalo de notificaciones actualizado a ${interval} minutos`);
        
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

/**
 * GET /api/settings/session-timeout - Obtiene tiempo de sesión
 */
app.get('/api/settings/session-timeout', (req, res) => {
    try {
        res.json({
            success: true,
            timeout: Math.floor(config.SESSION_TIMEOUT_MINUTES)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/settings/session-timeout - Actualiza tiempo de sesión
 */
app.post('/api/settings/session-timeout', (req, res) => {
    try {
        const { timeout } = req.body;
        
        if (!timeout || ![5, 10, 20, 30].includes(timeout)) {
            return res.status(400).json({
                success: false,
                error: 'Tiempo de sesión debe ser 5, 10, 20 o 30 minutos'
            });
        }
        
        // Actualizar configuración
        config.SESSION_TIMEOUT_MINUTES = timeout;
        
        console.log(`✅ Tiempo de sesión actualizado a ${timeout} minutos`);
        
        res.json({
            success: true,
            message: `Tiempo de sesión configurado a ${timeout} minutos`,
            timeout
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
app.get('/api/queue/messages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const status = req.query.status || 'pending';
        const messages = await database.getQueuedMessages(limit, status);
        const stats = await database.getQueueStats();
        
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
app.post('/api/queue/mark-all-sent', async (req, res) => {
    try {
        const count = await database.markAllPendingAsSent();
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
app.get('/api/messages/phones', async (req, res) => {
    try {
        const phones = await database.getUniquePhoneNumbers();
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
 * GET /api/messages/sessions - Obtiene sesiones únicas
 */
app.get('/api/messages/sessions', async (req, res) => {
    try {
        const sessions = await database.getUniqueSessions();
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
 * GET /api/messages/search - Busca mensajes con filtros
 */
app.get('/api/messages/search', async (req, res) => {
    try {
        const { phone, session, startDate, endDate, limit, offset } = req.query;
        
        const result = await database.getMessagesByFilter({
            phoneNumber: phone,
            session,
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

// ======================== CONVERSACIÓN IA ANTI-BAN ========================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Genera una respuesta usando OpenAI ChatGPT
 */
async function generateAIResponse(conversationHistory, style = 'casual') {
    const stylePrompts = {
        casual: 'Responde de manera casual, amigable y natural como un amigo colombiano. Usa expresiones coloquiales ocasionalmente.',
        formal: 'Responde de manera formal y profesional, pero manteniendo un tono amigable.',
        funny: 'Responde de manera graciosa y divertida, usando humor ligero.',
        short: 'Responde de manera breve y concisa, máximo 1-2 oraciones.'
    };
    
    try {
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
                        content: `Eres un participante en una conversación de WhatsApp. ${stylePrompts[style] || stylePrompts.casual} Mantén las respuestas cortas (máximo 50 palabras). No uses emojis en exceso. Responde solo el mensaje, sin explicaciones adicionales.`
                    },
                    ...conversationHistory.map(msg => ({
                        role: msg.isMe ? 'assistant' : 'user',
                        content: msg.text
                    }))
                ],
                max_tokens: 100,
                temperature: 0.8
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Error OpenAI:', data.error);
            throw new Error(data.error.message);
        }
        
        return data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error generando respuesta IA:', error.message);
        // Respuestas de fallback si falla la API
        const fallbackResponses = [
            'Sí, tienes razón',
            'Qué interesante',
            'Claro, entiendo',
            'Buena idea',
            'Me parece bien',
            'Ya veo',
            'Qué bien',
            'Ah ok'
        ];
        return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
    }
}

/**
 * POST /api/conversation/start - Inicia conversación IA entre sesiones
 */
app.post('/api/conversation/start', async (req, res) => {
    try {
        const { sessions: sessionNames, topic, messageCount = 5, delay = 15, style = 'casual' } = req.body;
        
        // Verificar que la API key esté configurada
        if (!OPENAI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'OPENAI_API_KEY no está configurada. Agrégala al archivo .env'
            });
        }
        
        if (!sessionNames || sessionNames.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Se requieren al menos 2 sesiones'
            });
        }
        
        if (!topic) {
            return res.status(400).json({
                success: false,
                error: 'Se requiere un tema de conversación'
            });
        }
        
        // Verificar que las sesiones existan y estén activas
        const allSessions = sessionManager.getAllSessions();
        const validSessions = sessionNames.filter(name => 
            allSessions[name] && allSessions[name].state === config.SESSION_STATES.READY
        );
        
        if (validSessions.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Se necesitan al menos 2 sesiones activas'
            });
        }
        
        // Obtener números de teléfono de las sesiones
        const sessionPhones = {};
        for (const name of validSessions) {
            const session = allSessions[name];
            if (session.phoneNumber) {
                sessionPhones[name] = session.phoneNumber;
            }
        }
        
        if (Object.keys(sessionPhones).length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Las sesiones no tienen números de teléfono configurados'
            });
        }
        
        // Registrar los números de las sesiones para evitar auto-respuesta
        sessionManager.setActiveConversationPhones(Object.values(sessionPhones));
        
        const messages = [];
        const conversationHistory = [];
        let totalMessagesSent = 0;
        
        // Primera sesión envía el tema inicial
        const sessionList = Object.keys(sessionPhones);
        let currentSenderIndex = 0;
        
        console.log(`\n🤖 Iniciando conversación IA entre ${sessionList.length} sesiones`);
        console.log(`📝 Tema: "${topic}"`);
        console.log(`💬 Mensajes por sesión: ${messageCount}`);
        
        // Mensaje inicial
        let currentMessage = topic;
        
        // Total de mensajes a enviar (messageCount por cada sesión)
        const totalMessages = messageCount * sessionList.length;
        
        for (let i = 0; i < totalMessages; i++) {
            const senderName = sessionList[currentSenderIndex];
            const receiverIndex = (currentSenderIndex + 1) % sessionList.length;
            const receiverName = sessionList[receiverIndex];
            
            const senderPhone = sessionPhones[senderName];
            const receiverPhone = sessionPhones[receiverName];
            const senderSession = allSessions[senderName];
            
            try {
                // Enviar mensaje
                const formattedReceiver = receiverPhone + '@s.whatsapp.net';
                await senderSession.socket.sendMessage(formattedReceiver, {
                    text: currentMessage
                });
                
                console.log(`✅ ${senderName} → ${receiverName}: ${currentMessage.substring(0, 50)}...`);
                
                messages.push({
                    from: senderName,
                    to: receiverName,
                    text: currentMessage,
                    direction: 'sent',
                    timestamp: new Date().toISOString()
                });
                
                conversationHistory.push({
                    text: currentMessage,
                    isMe: currentSenderIndex === 0
                });
                
                totalMessagesSent++;
                
                // Esperar antes del siguiente mensaje
                if (i < totalMessages - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay * 1000));
                    
                    // Generar respuesta con IA
                    currentMessage = await generateAIResponse(conversationHistory, style);
                }
                
                // Rotar al siguiente sender
                currentSenderIndex = receiverIndex;
                
            } catch (error) {
                console.error(`❌ Error enviando mensaje: ${error.message}`);
                messages.push({
                    from: senderName,
                    to: receiverName,
                    text: currentMessage,
                    error: error.message,
                    direction: 'failed'
                });
            }
        }
        
        // Limpiar los números de conversación activa
        sessionManager.clearActiveConversationPhones();
        
        console.log(`🏁 Conversación completada: ${totalMessagesSent} mensajes enviados\n`);
        
        res.json({
            success: true,
            totalMessages: totalMessagesSent,
            messages
        });
        
    } catch (error) {
        sessionManager.clearActiveConversationPhones();
        console.error('Error en conversación IA:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/openai/balance - Obtiene información de uso y balance de OpenAI
 */
app.get('/api/openai/balance', async (req, res) => {
    try {
        if (!OPENAI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'OPENAI_API_KEY no está configurada'
            });
        }
        
        // Intentar obtener información de billing/subscription
        try {
            const billingResponse = await fetch('https://api.openai.com/v1/dashboard/billing/subscription', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            });
            
            if (billingResponse.ok) {
                const billingData = await billingResponse.json();
                
                // Intentar obtener también el uso del mes actual
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                
                const usageResponse = await fetch(
                    `https://api.openai.com/v1/dashboard/billing/usage?start_date=${startOfMonth.toISOString().split('T')[0]}&end_date=${endOfMonth.toISOString().split('T')[0]}`,
                    {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${OPENAI_API_KEY}`
                        }
                    }
                );
                
                let usageData = null;
                if (usageResponse.ok) {
                    usageData = await usageResponse.json();
                }
                
                return res.json({
                    success: true,
                    apiConfigured: true,
                    balance: billingData,
                    usage: usageData,
                    dashboardUrl: 'https://platform.openai.com/usage'
                });
            }
        } catch (billingError) {
            console.log('No se pudo obtener información de billing:', billingError.message);
        }
        
        // Fallback: intentar obtener créditos disponibles (para cuentas con créditos de prueba)
        try {
            const creditResponse = await fetch('https://api.openai.com/v1/dashboard/billing/credit_grants', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            });
            
            if (creditResponse.ok) {
                const creditData = await creditResponse.json();
                return res.json({
                    success: true,
                    apiConfigured: true,
                    credits: creditData,
                    dashboardUrl: 'https://platform.openai.com/usage'
                });
            }
        } catch (creditError) {
            console.log('No se pudo obtener información de créditos:', creditError.message);
        }
        
        // Si no se puede obtener información detallada, devolver información básica
        res.json({
            success: true,
            apiConfigured: true,
            model: 'gpt-3.5-turbo',
            message: 'API key configurada correctamente',
            note: 'Para ver el saldo y uso detallado, visita el dashboard de OpenAI',
            dashboardUrl: 'https://platform.openai.com/usage'
        });
        
    } catch (error) {
        console.error('Error obteniendo balance OpenAI:', error.message);
        
        res.json({
            success: true,
            apiConfigured: !!OPENAI_API_KEY,
            message: OPENAI_API_KEY ? 'API key configurada - Visita el dashboard para ver el saldo' : 'API key no configurada',
            dashboardUrl: 'https://platform.openai.com/usage',
            error: error.message
        });
    }
});

// ======================== DATABASE STATUS ========================

/**
 * GET /api/database/status - Obtener estado detallado de la base de datos
 */
app.get('/api/database/status', async (req, res) => {
    try {
        const status = await database.getDatabaseStatus();
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            connected: false,
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

// ======================== INICIALIZACIÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â“N ========================

/**
 * Inicia los intervalos de monitoreo
 */
function startMonitoring() {
    // Limpiar consola periÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³dicamente
    if (config.CONSOLE_CLEAR_ENABLED) {
        consoleClearInterval = setInterval(clearConsole, 60000);
    }
    
    // Monitoreo de sesiones
    sessionMonitorInterval = setInterval(monitorSessions, config.SESSION_MONITOR_INTERVAL * 60000);

    // Notificaciones de estado de sesiones
    notificationInterval = setInterval(sendSessionsStatusNotification, config.NOTIFICATION_INTERVAL_MINUTES * 60000);
    
    console.log('ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂœÃƒÂ‚Ã‚Â… Monitoreo iniciado');
}

/**
 * Detiene los intervalos de monitoreo
 */
function stopMonitoring() {
    if (consoleClearInterval) clearInterval(consoleClearInterval);
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    if (notificationInterval) clearInterval(notificationInterval);
    sessionManager.stopSessionRotation();
    
    console.log('ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂÃƒÂ‚Ã‚Â¹ÃƒÂƒÃ‚Â¯ÃƒÂ‚Ã‚Â¸ÃƒÂ‚Ã‚Â Monitoreo detenido');
}

/**
 * Inicializa el servidor
 */
async function initialize() {
    try {
        console.log('\nÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚ÂšÃƒÂ‚Ã‚Â€ Iniciando WhatsApp Bot Server con Baileys...\n');
        
        // Inicializar base de datos
        // Inicializar base de datos PostgreSQL
        await database.initDatabase();

        // Cargar sesiones existentes
        await sessionManager.loadSessionsFromDisk();
        
        // Iniciar servidor HTTP
        server.listen(config.PORT, () => {
            console.log(`ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂœÃƒÂ‚Ã‚Â… Servidor escuchando en puerto ${config.PORT}`);
            console.log(`ÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚ÂŒÃƒÂ‚Ã‚Â http://localhost:${config.PORT}`);
            console.log(`ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂÃƒÂ‚Ã‚Â° ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n`);
        });
        
        // Iniciar monitoreo
        startMonitoring();
        
        // Iniciar rotaciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n de sesiones
        sessionManager.startSessionRotation();
        
        // Iniciar procesador de consolidación de mensajes (persistente en BD)
        sessionManager.startConsolidationProcessor();

        console.log('ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂœÃƒÂ‚Ã‚Â… Sistema iniciado correctamente\n');
        
    } catch (error) {
        console.error('ÃƒÂƒÃ‚Â¢ÃƒÂ‚Ã‚ÂÃƒÂ‚Ã‚ÂŒ Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Manejo de seÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â±ales de cierre
process.on('SIGINT', async () => {
    console.log('\n\nÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚Â›ÃƒÂ‚Ã‚Â‘ Recibida seÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â±al SIGINT, cerrando servidor...');
    stopMonitoring();
    
    // Cerrar todas las sesiones
    const sessions = sessionManager.getAllSessions();
    for (const name of Object.keys(sessions)) {
        await sessionManager.closeSession(name, false);
    }
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n\nÃƒÂƒÃ‚Â°ÃƒÂ‚Ã‚ÂŸÃƒÂ‚Ã‚Â›ÃƒÂ‚Ã‚Â‘ Recibida seÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â±al SIGTERM, cerrando servidor...');
    stopMonitoring();
    
    const sessions = sessionManager.getAllSessions();
    for (const name of Object.keys(sessions)) {
        await sessionManager.closeSession(name, false);
    }
    
    process.exit(0);
});

// Iniciar aplicaciÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Â³n
initialize();

module.exports = app;

// ======================== ANALYTICS (compatibilidad) ========================
// Endpoint ÃƒÂƒÃ‚ÂƒÃƒÂ‚Ã‚Âºnico "/analytics" esperado por public/js/analytics.js
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

