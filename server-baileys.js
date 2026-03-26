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
const { checkProxyAvailable } = require('./lib/session/proxy');
const mt5Detector = require('./lib/session/mt5-detector');
const axios = require('axios');

// ---- Caché Redis (opcional - degrada a no-cache si Redis no está disponible) ----
let redisClient = null;
(async () => {
    try {
        const Redis = require('ioredis');
        const client = new Redis({
            host: process.env.REDIS_HOST || 'wpp-redis',
            port: parseInt(process.env.REDIS_PORT) || 6379,
            lazyConnect: true,
            enableOfflineQueue: false,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1
        });
        await client.connect();
        redisClient = client;
        console.log('✅ Redis conectado para caché de analytics');
    } catch (e) {
        console.warn('⚠️  Redis no disponible, analytics sin caché:', e.message);
    }
})();

async function redisGet(key) {
    if (!redisClient) return null;
    try { return await redisClient.get(key); } catch { return null; }
}
async function redisSet(key, value, ttlSeconds) {
    if (!redisClient) return;
    try { await redisClient.setex(key, ttlSeconds, value); } catch { /* ignore */ }
}
async function redisDel(pattern) {
    if (!redisClient) return;
    try {
        const keys = await redisClient.keys(pattern);
        if (keys.length) await redisClient.del(...keys);
    } catch { /* ignore */ }
}

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

// Middleware de autenticación API (opcional, activar con API_KEY en .env)
const API_KEY = process.env.API_KEY || '';
function authenticateAPI(req, res, next) {
    // Rutas públicas: health, webhook, archivos estáticos
    if (req.path === '/health' || req.path.startsWith('/webhook') || !req.path.startsWith('/api/')) {
        return next();
    }
    if (!API_KEY) return next(); // Sin API_KEY = sin autenticación requerida
    const providedKey = req.headers['x-api-key'] || req.query.apiKey;
    if (providedKey !== API_KEY) {
        return res.status(401).json({ success: false, error: 'API key requerida o inválida' });
    }
    next();
}
app.use(authenticateAPI);

// Configurar charset UTF-8 para archivos estáticos
app.use(express.static(config.PUBLIC_PATH, {
    setHeaders: (res, path) => {
        // Evitar que el navegador se quede con una versión vieja del dashboard
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
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
        const active = sessionsStatus.filter(s => s.state === config.SESSION_STATES.READY);

        // Info de descanso rotativo
        const restInfo = sessionManager.getRestingSession ? sessionManager.getRestingSession() : null;

        // Mensaje minimalista: solo nombres de sesiones activas
        const nowStr = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
        let msg = `📊 *Sesiones Activas* (${active.length})\n${nowStr}\n\n`;

        if (active.length === 0) {
            msg += "⚠️ Sin sesiones activas";
        } else {
            // Listar nombres con indicador de descanso
            active.forEach((s, i) => {
                const isResting = restInfo && restInfo.sessionName === s.name;
                const icon = isResting ? '😴' : '✅';
                const restLabel = isResting ? ` _(descansando ${restInfo.minutesRemaining} min)_` : '';
                msg += `${icon} ${s.name}${restLabel}\n`;
            });
        }

        // Agregar resumen de descanso rotativo
        if (restInfo) {
            msg += `\n🔄 *Descanso rotativo:* ${restInfo.sessionName} descansa ${restInfo.minutesRemaining} min`;
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

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function aggregateMetric(payload, keyRegexes) {
    let total = 0;
    let found = false;

    const walk = (node) => {
        if (node === null || node === undefined) return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node !== 'object') return;

        // Meta template_analytics reporta costos como [{ type: 'amount_spent', value: 0.49 }]
        // y no como claves directas amount_spent: 0.49.
        if (
            typeof node.type === 'string' &&
            (typeof node.value === 'number' || (typeof node.value === 'string' && node.value.trim() !== '' && !isNaN(Number(node.value))))
        ) {
            const metricType = node.type.toLowerCase();
            if (keyRegexes.some((re) => re.test(metricType))) {
                total += Number(node.value);
                found = true;
            }
        }

        for (const [k, v] of Object.entries(node)) {
            if (v && typeof v === 'object') {
                walk(v);
                continue;
            }
            if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))) {
                const key = String(k).toLowerCase();
                if (keyRegexes.some((re) => re.test(key))) {
                    total += Number(v);
                    found = true;
                }
            }
        }
    };

    walk(payload);
    return found ? total : null;
}

async function resolveWabaIdFromPhoneId({ token, graphVersion, phoneId }) {
    if (!phoneId) return { wabaId: null, warning: null };

    const baseUrl = `https://graph.facebook.com/${graphVersion}`;
    const headers = { Authorization: `Bearer ${token}` };

    try {
        const resp = await axios.get(`${baseUrl}/${phoneId}`, {
            headers,
            params: { fields: 'display_phone_number,verified_name' },
            timeout: 15000
        });
        return {
            wabaId: null,
            warning: `WHATSAPP_CLOUD_PHONE_ID válido (${resp.data?.display_phone_number || phoneId} - ${resp.data?.verified_name || 'sin nombre'}), pero Meta no expone WABA desde este endpoint. Configura META_WABA_ID o META_TEMPLATE_ID manualmente.`
        };
    } catch (error) {
        return {
            wabaId: null,
            warning: `No se pudo autodescubrir WABA con WHATSAPP_CLOUD_PHONE_ID: ${error.response?.data?.error?.message || error.message}`
        };
    }
}

async function fetchMetaTemplateStats({ token, graphVersion, wabaId, phoneId, templateId, templateName, templateLanguage, startDate, endDate }) {
    const baseUrl = `https://graph.facebook.com/${graphVersion}`;
    const headers = { Authorization: `Bearer ${token}` };

    let resolvedWabaId = wabaId || null;
    let resolvedTemplateId = templateId || null;
    let templateInfo = null;
    const warnings = [];

    if (!resolvedWabaId && !resolvedTemplateId) {
        const autoWaba = await resolveWabaIdFromPhoneId({ token, graphVersion, phoneId });
        resolvedWabaId = autoWaba.wabaId;
        if (autoWaba.warning) {
            warnings.push(autoWaba.warning);
        }
    }

    if (!resolvedWabaId && !resolvedTemplateId) {
        warnings.push('Configura META_WABA_ID o META_TEMPLATE_ID para consultar métricas de plantilla. También puedes configurar WHATSAPP_CLOUD_PHONE_ID para autodescubrir la WABA.');
    }
    if (!templateName && !resolvedTemplateId) {
        warnings.push('Configura META_TEMPLATE_NAME para resolver automáticamente la plantilla.');
    }

    if (!resolvedTemplateId && resolvedWabaId && templateName) {
        const listResp = await axios.get(`${baseUrl}/${resolvedWabaId}/message_templates`, {
            headers,
            params: {
                name: templateName,
                language: templateLanguage,
                fields: 'id,name,language,status,category,quality_score',
                limit: 50
            },
            timeout: 15000
        });

        const templates = listResp.data?.data || [];
        const selected = templates.find((t) => String(t.language || '').toLowerCase() === String(templateLanguage || '').toLowerCase()) || templates[0];
        if (selected) {
            resolvedTemplateId = selected.id;
            templateInfo = selected;
        } else {
            warnings.push(`No se encontró la plantilla '${templateName}' en la WABA configurada.`);
        }
    }

    if (resolvedTemplateId && !templateInfo) {
        try {
            const templateResp = await axios.get(`${baseUrl}/${resolvedTemplateId}`, {
                headers,
                params: { fields: 'id,name,language,status,category,quality_score' },
                timeout: 15000
            });
            templateInfo = templateResp.data;
        } catch (e) {
            warnings.push(`No se pudo leer detalle de plantilla: ${e.response?.data?.error?.message || e.message}`);
        }
    }

    const sinceRaw = Math.floor(new Date(`${startDate}T00:00:00`).getTime() / 1000);
    const untilRaw = Math.floor(new Date(`${endDate}T23:59:59`).getTime() / 1000);
    const nowEpoch = Math.floor(Date.now() / 1000);
    const until = Math.min(untilRaw, nowEpoch);
    const since = Math.min(sinceRaw, until - 60);

    const candidates = [];
    // Algunos objetos de plantilla no exponen template_analytics/insights directamente.
    // Usamos la ruta por WABA, que es la fuente estable para este dashboard.
    if (resolvedWabaId) {
        candidates.push({
            source: 'template_analytics_by_waba',
            url: `${baseUrl}/${resolvedWabaId}/template_analytics`,
            params: {
                start: since,
                end: until,
                granularity: 'DAILY',
                template_ids: resolvedTemplateId ? JSON.stringify([String(resolvedTemplateId)]) : undefined,
                name: resolvedTemplateId ? undefined : templateName,
                language: resolvedTemplateId ? undefined : templateLanguage
            }
        });
    }

    let analyticsPayload = null;
    let analyticsSource = null;

    for (const c of candidates) {
        try {
            const resp = await axios.get(c.url, {
                headers,
                params: c.params,
                timeout: 20000
            });
            analyticsPayload = resp.data;
            analyticsSource = c.source;
            break;
        } catch (e) {
            warnings.push(`${c.source}: ${e.response?.data?.error?.message || e.message}`);
        }
    }

    const sent = analyticsPayload ? aggregateMetric(analyticsPayload, [/^sent$/, /messages?_sent/, /sent_count/, /msg_?sent/]) : null;
    const delivered = analyticsPayload ? aggregateMetric(analyticsPayload, [/^delivered$/, /messages?_delivered/, /delivered_count/, /msg_?delivered/]) : null;
    const read = analyticsPayload ? aggregateMetric(analyticsPayload, [/^read$/, /messages?_read/, /read_count/, /msg_?read/]) : null;
    const uniqueReplies = analyticsPayload ? aggregateMetric(analyticsPayload, [/unique.*repl/, /replies?_unique/, /responses?_unique/, /^replies$/, /^responses$/, /^replied$/]) : null;
    const spendUSD = analyticsPayload ? aggregateMetric(analyticsPayload, [/spend/, /cost/, /amount_spent/, /usd/]) : null;

    return {
        template: {
            id: resolvedTemplateId || null,
            name: templateInfo?.name || templateName || null,
            language: templateInfo?.language || templateLanguage || null,
            status: templateInfo?.status || null,
            category: templateInfo?.category || null,
            quality: templateInfo?.quality_score?.score || templateInfo?.quality_score || null
        },
        period: { startDate, endDate },
        source: analyticsSource,
        available: !!analyticsPayload,
        wabaId: resolvedWabaId,
        stats: {
            sent: toNumberOrNull(sent),
            delivered: toNumberOrNull(delivered),
            read: toNumberOrNull(read),
            uniqueReplies: toNumberOrNull(uniqueReplies),
            spendUSD: toNumberOrNull(spendUSD),
            costPerDelivered: toNumberOrNull(spendUSD) !== null && toNumberOrNull(delivered) > 0
                ? Number((spendUSD / delivered).toFixed(4))
                : null
        },
        warnings
    };
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
                adapterType: session.adapterType || 'baileys-standard',
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
 * Query params: ?format=json para obtener JSON en lugar de HTML
 */
app.get('/api/sessions/:name/qr', async (req, res) => {
    try {
        const { name } = req.params;
        const { format } = req.query;
        const qrCode = await sessionManager.getQRCode(name);

        // Si se solicita formato JSON
        if (format === 'json') {
            if (!qrCode) {
                return res.status(404).json({
                    success: false,
                    error: 'QR no disponible'
                });
            }
            return res.json({
                success: true,
                qr: qrCode
            });
        }

        // Formato HTML (por defecto)
        if (!qrCode) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>QR Code - ${name}</title>
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            display: flex; 
                            justify-content: center; 
                            align-items: center; 
                            min-height: 100vh; 
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .container {
                            background: white;
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                            text-align: center;
                        }
                        h1 { color: #333; margin-bottom: 10px; }
                        p { color: #666; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>⚠️ QR No Disponible</h1>
                        <p>La sesión <strong>${name}</strong> no tiene código QR disponible</p>
                        <p>Intenta recargar la página en unos segundos</p>
                    </div>
                </body>
                </html>
            `);
        }

        // Renderizar HTML con la imagen QR
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>QR Code - ${name}</title>
                <style>
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        display: flex; 
                        justify-content: center; 
                        align-items: center; 
                        min-height: 100vh; 
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 20px;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                        text-align: center;
                        max-width: 500px;
                    }
                    h1 { 
                        color: #333; 
                        margin-bottom: 10px;
                        font-size: 28px;
                    }
                    .session-name {
                        color: #667eea;
                        font-weight: bold;
                        font-size: 20px;
                        margin-bottom: 20px;
                    }
                    img { 
                        max-width: 100%; 
                        height: auto;
                        border: 3px solid #667eea;
                        border-radius: 10px;
                        padding: 10px;
                        background: white;
                    }
                    .instructions {
                        margin-top: 20px;
                        padding: 20px;
                        background: #f8f9fa;
                        border-radius: 10px;
                        color: #555;
                        line-height: 1.6;
                    }
                    .instructions ol {
                        text-align: left;
                        margin: 10px 0;
                    }
                    .refresh-btn {
                        margin-top: 20px;
                        padding: 12px 30px;
                        background: #667eea;
                        color: white;
                        border: none;
                        border-radius: 25px;
                        cursor: pointer;
                        font-size: 16px;
                        transition: background 0.3s;
                    }
                    .refresh-btn:hover {
                        background: #764ba2;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>📱 Código QR WhatsApp</h1>
                    <div class="session-name">${name}</div>
                    <img src="${qrCode}" alt="QR Code WhatsApp" />
                    <div class="instructions">
                        <strong>📋 Instrucciones:</strong>
                        <ol>
                            <li>Abre WhatsApp en tu teléfono</li>
                            <li>Toca Menú o Configuración</li>
                            <li>Toca Dispositivos vinculados</li>
                            <li>Toca Vincular un dispositivo</li>
                            <li>Escanea este código QR</li>
                        </ol>
                    </div>
                    <button class="refresh-btn" onclick="location.reload()">🔄 Actualizar QR</button>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Error - QR Code</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        display: flex; 
                        justify-content: center; 
                        align-items: center; 
                        min-height: 100vh; 
                        margin: 0;
                        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 20px;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                        text-align: center;
                    }
                    h1 { color: #f5576c; margin-bottom: 10px; }
                    p { color: #666; }
                    code { 
                        background: #f8f9fa; 
                        padding: 2px 8px; 
                        border-radius: 4px;
                        color: #333;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Error</h1>
                    <p>No se pudo obtener el código QR</p>
                    <p><code>${error.message}</code></p>
                </div>
            </body>
            </html>
        `);
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
 * GET /api/adapters/info - Informacion de los adaptadores multi-libreria
 */
app.get('/api/adapters/info', (req, res) => {
    try {
        const adapterFactory = require('./lib/session/adapters');
        res.json({
            success: true,
            adapters: adapterFactory.getAdaptersInfo()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/sessions/rotation/info - Informacion de rotacion de sesiones
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
 * POST /api/sessions/:name/reconnect - Reconecta una sesión aplicando proxy
 */
app.post('/api/sessions/:name/reconnect', async (req, res) => {
    try {
        const { name } = req.params;
        
        console.log(`🔄 Solicitud de reconexión para sesión: ${name}`);
        
        const session = await sessionManager.reconnectSession(name);
        
        res.json({
            success: true,
            message: `Sesión ${name} reconectada exitosamente`,
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
 * POST /api/sessions/reconnect-all - Reconecta todas las sesiones con proxies
 */
app.post('/api/sessions/reconnect-all', async (req, res) => {
    try {
        const { excludeGpswox = true } = req.body;
        
        console.log(`🔄 Solicitud de reconexión masiva (excludeGpswox: ${excludeGpswox})`);
        
        const results = await sessionManager.reconnectAllSessions(excludeGpswox);
        
        res.json({
            success: true,
            message: 'Reconexión masiva completada',
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
        const { to, type, message, template, phoneNumber } = req.body;
        const destNumber = to || phoneNumber;

        if (!destNumber) {
            return res.status(400).json({ success: false, error: 'Número de destino requerido' });
        }

        const cloudApi = require('./lib/session/whatsapp-cloud-api');
        let result;

        if (type === 'template') {
            result = await cloudApi.sendTemplateMessage(destNumber, template || 'hello_world');
        } else if (message) {
            // Texto libre: NUNCA usar Cloud API (costo). Solo Baileys.
            const activeSessions = sessionManager.getActiveSessions();
            if (!activeSessions || activeSessions.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No hay sesiones Baileys activas. El texto libre no se envía por Cloud API para evitar costos. Activa una sesión Baileys primero.'
                });
            }
            result = await sessionManager.sendMessageWithRotation(destNumber, message);
        } else {
            return res.status(400).json({ success: false, error: 'message o template requerido' });
        }

        if (result.success) {
            // Guardar en BD como messages (para estadísticas consistentes)
            const db = require('./database-postgres');
            try {
                const { getColombiaTimestamp } = require('./lib/session/utils');
                const colombiaTs = getColombiaTimestamp();
                const formattedNumber = cloudApi.formatPhoneForApi(destNumber) + '@s.whatsapp.net';
                await db.query(`
                    INSERT INTO messages (session, phone_number, message_preview, char_count, status, is_consolidated, msg_count, created_at, timestamp)
                    VALUES ('cloud-api', $1, $2, $3, 'sent', false, 1, $4, $4)
                `, [formattedNumber, (message || `[Template: ${template}]`).substring(0, 200), (message || '').length, colombiaTs]);
            } catch (dbErr) {
                console.error('Error guardando mensaje Cloud API:', dbErr);
            }
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/cloud/stats - Estadísticas de WhatsApp Cloud API con costos
 * Pricing Colombia (utility templates): ~$0.0085 USD por mensaje
 * 1000 conversaciones gratis/mes (service conversations)
 */
app.get('/api/cloud/stats', async (req, res) => {
    try {
        const cloudApi = require('./lib/session/whatsapp-cloud-api');
        const stats = cloudApi.getStats();

        const COST_PER_CONVERSATION_USD = 0.0085; // Utility template Colombia - por conversación (ventana 24h)
        const FREE_CONVERSATIONS = 1000; // Gratis por mes (service conversations)
        const USD_TO_COP = 4200; // Tasa aproximada

        // Obtener conteo de mensajes y conversaciones desde la BD
        const db = require('./database-postgres');
        let dbStats = { total: 0, today: 0, thisHour: 0, thisMonth: 0, conversations: { month: 0, today: 0, uniqueNumbers: 0 } };

        try {
            // Total de mensajes enviados por Cloud API
            const totalResult = await db.query(`
                SELECT COUNT(*) as count FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent'
            `);
            dbStats.total = parseInt(totalResult.rows[0]?.count || 0);

            // Mensajes de hoy
            // Unificado con Analytics: usar timestamp y corte de día Colombia
            const todayResult = await db.query(`
                SELECT COUNT(*) as count FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND timestamp AT TIME ZONE 'America/Bogota' >= DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Bogota')
            `);
            dbStats.today = parseInt(todayResult.rows[0]?.count || 0);

            // Mensajes de la última hora
            const hourResult = await db.query(`
                SELECT COUNT(*) as count FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND timestamp >= NOW() - INTERVAL '1 hour'
            `);
            dbStats.thisHour = parseInt(hourResult.rows[0]?.count || 0);

            // Mensajes del mes actual en Colombia
            const monthResult = await db.query(`
                SELECT COUNT(*) as count FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND timestamp AT TIME ZONE 'America/Bogota' >= DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Bogota')
            `);
            dbStats.thisMonth = parseInt(monthResult.rows[0]?.count || 0);

            // CONVERSACIONES únicas del mes (número + día = 1 conversación)
            const convMonthResult = await db.query(`
                SELECT COUNT(DISTINCT phone_number || DATE((timestamp AT TIME ZONE 'America/Bogota'))::text) as conversations,
                       COUNT(DISTINCT phone_number) as unique_numbers
                FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND timestamp AT TIME ZONE 'America/Bogota' >= DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Bogota')
            `);
            dbStats.conversations.month = parseInt(convMonthResult.rows[0]?.conversations || 0);
            dbStats.conversations.uniqueNumbers = parseInt(convMonthResult.rows[0]?.unique_numbers || 0);

            // Conversaciones únicas de hoy en Colombia
            const convTodayResult = await db.query(`
                SELECT COUNT(DISTINCT phone_number) as conversations
                FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND timestamp AT TIME ZONE 'America/Bogota' >= DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Bogota')
            `);
            dbStats.conversations.today = parseInt(convTodayResult.rows[0]?.conversations || 0);

            // Mensajes por día (últimos 7 días)
            const dailyResult = await db.query(`
                SELECT DATE(timestamp) as date, COUNT(*) as count,
                       COUNT(DISTINCT phone_number) as conversations
                FROM messages 
                WHERE session = 'cloud-api' AND status = 'sent' 
                AND timestamp >= NOW() - INTERVAL '7 days'
                GROUP BY DATE(timestamp) 
                ORDER BY date DESC
            `);
            dbStats.daily = dailyResult.rows;

        } catch (dbErr) {
            console.error('Error obteniendo estadísticas de BD:', dbErr);
        }

        // Calcular costos basados en CONVERSACIONES, no mensajes
        const monthlyConversations = dbStats.conversations.month || 0;
        const billableConversations = Math.max(0, monthlyConversations - FREE_CONVERSATIONS);
        const costUSD = billableConversations * COST_PER_CONVERSATION_USD;
        const costCOP = costUSD * USD_TO_COP;

        res.json({
            success: true,
            cloudApi: stats,
            database: dbStats,
            phoneNumber: config.WHATSAPP_CLOUD_PHONE_ID,
            hybridMode: config.HYBRID_MODE_ENABLED,
            percentage: config.WHATSAPP_CLOUD_PERCENTAGE || 50,
            monthlyLimit: cloudApi.getMonthlyLimitInfo(),
            costs: {
                monthlyMessages: dbStats.thisMonth,
                monthlyConversations,
                freeConversations: FREE_CONVERSATIONS,
                freeRemaining: Math.max(0, FREE_CONVERSATIONS - monthlyConversations),
                billableConversations,
                costPerConversationUSD: COST_PER_CONVERSATION_USD,
                monthCostUSD: Math.round(costUSD * 100) / 100,
                monthCostCOP: Math.round(costCOP),
                todayConversations: dbStats.conversations.today,
                uniqueNumbers: dbStats.conversations.uniqueNumbers,
                usdToCop: USD_TO_COP
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/meta/template-stats
 * Consulta métricas de plantilla desde Meta Graph API.
 */
app.get('/api/meta/template-stats', async (req, res) => {
    try {
        const token = config.WHATSAPP_CLOUD_TOKEN;
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'WHATSAPP_CLOUD_TOKEN no configurado para consultar Meta Graph API'
            });
        }

        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
        const fmt = (d) => d.toISOString().split('T')[0];

        const startDate = req.query.start_date || fmt(sevenDaysAgo);
        const endDate = req.query.end_date || fmt(today);

        const data = await fetchMetaTemplateStats({
            token,
            graphVersion: config.META_GRAPH_VERSION,
            wabaId: config.META_WABA_ID,
            phoneId: config.WHATSAPP_CLOUD_PHONE_ID,
            templateId: config.META_TEMPLATE_ID,
            templateName: config.META_TEMPLATE_NAME,
            templateLanguage: config.META_TEMPLATE_LANGUAGE,
            startDate,
            endDate
        });

        res.json({ success: true, ...data });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || error.message
        });
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
 * POST /api/cloud/continue - Continuar enviando después de alcanzar el límite mensual
 */
app.post('/api/cloud/continue', (req, res) => {
    try {
        const cloudApi = require('./lib/session/whatsapp-cloud-api');
        cloudApi.setMonthlyLimitOverride(true);
        res.json({
            success: true,
            message: `Límite mensual ignorado. Cloud API continuará enviando más allá de ${cloudApi.MONTHLY_CONVERSATION_LIMIT} conversaciones.`,
            limitInfo: cloudApi.getMonthlyLimitInfo()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/cloud/pause - Re-activar el límite mensual (pausar envío Cloud API)
 */
app.post('/api/cloud/pause', (req, res) => {
    try {
        const cloudApi = require('./lib/session/whatsapp-cloud-api');
        cloudApi.setMonthlyLimitOverride(false);
        res.json({
            success: true,
            message: `Límite mensual re-activado. Cloud API se pausará al alcanzar ${cloudApi.MONTHLY_CONVERSATION_LIMIT} conversaciones.`,
            limitInfo: cloudApi.getMonthlyLimitInfo()
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

// ======================== RUTAS - GPSWOX ========================

// Importar módulo GPSwox
const gpswoxSession = require('./lib/session/gpswox-session');

/**
 * POST /api/gpswox/session/create - Crea una sesión dedicada GPSwox
 * Body opcional: { "sessionName": "gpswox-session-2" }
 */
app.post('/api/gpswox/session/create', async (req, res) => {
    try {
        const sessionName = req.body.sessionName || gpswoxSession.getGPSwoxSessionName();
        const allowedNames = gpswoxSession.getGPSwoxSessionNames();
        
        // Verificar que el nombre esté en la lista permitida
        if (!allowedNames.includes(sessionName)) {
            return res.status(400).json({
                success: false,
                error: `Nombre de sesión no permitido. Permitidos: ${allowedNames.join(', ')}`,
                allowedNames
            });
        }
        
        // Verificar si ya existe
        const existingSession = sessionManager.getSession(sessionName);
        if (existingSession) {
            return res.status(400).json({
                success: false,
                error: `La sesión GPSwox '${sessionName}' ya existe`,
                sessionName: sessionName,
                state: existingSession.state
            });
        }

        // Crear sesión
        await sessionManager.createSession(sessionName);
        
        res.json({
            success: true,
            message: `Sesión GPSwox '${sessionName}' creada exitosamente`,
            sessionName: sessionName,
            dedicatedMode: gpswoxSession.isGPSwoxDedicatedMode(),
            qrEndpoint: `/api/sessions/${sessionName}/qr`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/gpswox/sessions/create-all - Crea todas las sesiones GPSwox configuradas
 */
app.post('/api/gpswox/sessions/create-all', async (req, res) => {
    try {
        const sessionNames = gpswoxSession.getGPSwoxSessionNames();
        const results = [];
        
        for (const name of sessionNames) {
            const existing = sessionManager.getSession(name);
            if (existing) {
                results.push({ name, status: 'already_exists', state: existing.state });
            } else {
                await sessionManager.createSession(name);
                results.push({ name, status: 'created', qrEndpoint: `/api/sessions/${name}/qr` });
            }
        }
        
        res.json({
            success: true,
            message: `Procesadas ${sessionNames.length} sesiones GPSwox`,
            sessions: results
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/gpswox/session/status - Obtiene el estado de la sesión GPSwox
 */
app.get('/api/gpswox/session/status', (req, res) => {
    try {
        const sessionName = gpswoxSession.getGPSwoxSessionName();
        const session = sessionManager.getSession(sessionName);
        
        if (!session) {
            return res.json({
                success: true,
                exists: false,
                sessionName: sessionName,
                message: 'La sesión GPSwox no existe. Usa POST /api/gpswox/session/create para crearla.'
            });
        }

        res.json({
            success: true,
            exists: true,
            session: {
                name: sessionName,
                state: session.state,
                phoneNumber: session.phoneNumber || null,
                dedicatedMode: gpswoxSession.isGPSwoxDedicatedMode(),
                uptime: session.startTime ? Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60) : 0,
                messagesReceived: session.messagesReceivedCount || 0,
                messagesSent: session.messagesSentCount || 0
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
 * GET /api/gpswox/conversations - Obtiene estadísticas de conversaciones GPSwox activas
 */
app.get('/api/gpswox/conversations', (req, res) => {
    try {
        const stats = gpswoxSession.getConversationStats();
        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/gpswox/conversation/:phoneNumber - Obtiene el estado de una conversación específica
 */
app.get('/api/gpswox/conversation/:phoneNumber', (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const conversation = gpswoxSession.getConversationState(phoneNumber);
        
        if (!conversation) {
            return res.json({
                success: false,
                active: false,
                message: 'No hay conversación activa para este número'
            });
        }

        res.json({
            success: true,
            active: true,
            conversation: {
                state: conversation.state,
                email: conversation.data.email,
                plate: conversation.data.plate,
                startTime: conversation.startTime,
                lastActivity: conversation.lastActivity
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
 * GET /api/gpswox/messages - Obtiene los mensajes de GPSwox desde la base de datos
 */
app.get('/api/gpswox/messages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const phoneNumber = req.query.phone || null;
        
        const messages = await database.getGPSwoxMessages(limit, phoneNumber);
        
        res.json({
            success: true,
            messages: messages,
            count: messages.length
        });
    } catch (error) {
        console.error('Error obteniendo mensajes GPSwox:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/gpswox/stats - Obtiene estadísticas de mensajes GPSwox
 */
app.get('/api/gpswox/stats', async (req, res) => {
    try {
        const stats = await database.getGPSwoxStats();
        
        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas GPSwox:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/gpswox/conversation/:phoneNumber/start - Inicia una conversación de registro
 */
app.post('/api/gpswox/conversation/:phoneNumber/start', (req, res) => {
    try {
        const { phoneNumber } = req.params;
        
        if (gpswoxSession.hasActiveConversation(phoneNumber)) {
            return res.status(400).json({
                success: false,
                error: 'Ya existe una conversación activa para este número'
            });
        }

        gpswoxSession.startConversation(phoneNumber);
        
        res.json({
            success: true,
            message: 'Conversación iniciada exitosamente',
            phoneNumber: phoneNumber
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/gpswox/conversation/:phoneNumber - Finaliza una conversación
 */
app.delete('/api/gpswox/conversation/:phoneNumber', (req, res) => {
    try {
        const { phoneNumber } = req.params;
        
        if (!gpswoxSession.hasActiveConversation(phoneNumber)) {
            return res.status(404).json({
                success: false,
                error: 'No hay conversación activa para este número'
            });
        }

        gpswoxSession.endConversation(phoneNumber);
        
        res.json({
            success: true,
            message: 'Conversación finalizada exitosamente'
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

        // 🎯 DETECCIÓN FX: Si el mensaje contiene keywords MT5, enviar inmediatamente por FX
        if (mt5Detector.isMT5Alert(cleanedMessage)) {
            console.log(`📊 API detectó mensaje FX: "${cleanedMessage.substring(0, 50)}..."`);
            
            try {
                const fxResult = await sessionManager.sendViaFX(phoneNumber, cleanedMessage);
                if (fxResult.success) {
                    return res.json({
                        success: true,
                        consolidated: false,
                        fx: true,
                        message: `Mensaje enviado INMEDIATAMENTE por sesión FX: ${fxResult.fxSession}`,
                        details: fxResult
                    });
                } else {
                    console.log(`⚠️ No se pudo enviar por FX: ${fxResult.error}, enviando a consolidación`);
                }
            } catch (fxError) {
                console.log(`⚠️ Error al enviar por FX: ${fxError.message}, enviando a consolidación`);
            }
        }

        // Si no es FX o falló el envío FX, enviar a consolidación normal
        const result = await sessionManager.addToConsolidation(phoneNumber, cleanedMessage);
        if (result.success) {
            const sentNow = result.sentImmediately;
            res.json({
                success: true,
                consolidated: !sentNow,
                message: sentNow
                    ? `Mensaje enviado INMEDIATAMENTE por Cloud API`
                    : `Mensaje en cola (${result.pendingCount} pendientes, envio en ${result.sendInMinutes} min)`,
                details: result
            });
        } else if (result.discarded) {
            res.status(400).json({
                success: false,
                discarded: true,
                message: result.error,
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

        // 🎯 DETECCIÓN FX: Si el mensaje contiene keywords MT5, enviar inmediatamente por FX
        if (mt5Detector.isMT5Alert(cleanedMessage)) {
            console.log(`📊 API detectó mensaje FX: "${cleanedMessage.substring(0, 50)}..."`);
            
            try {
                const fxResult = await sessionManager.sendViaFX(phoneNumber, cleanedMessage);
                if (fxResult.success) {
                    return res.json({
                        success: true,
                        consolidated: false,
                        fx: true,
                        message: `Mensaje enviado INMEDIATAMENTE por sesión FX: ${fxResult.fxSession}`,
                        details: fxResult
                    });
                } else {
                    console.log(`⚠️ No se pudo enviar por FX: ${fxResult.error}, enviando a consolidación`);
                }
            } catch (fxError) {
                console.log(`⚠️ Error al enviar por FX: ${fxError.message}, enviando a consolidación`);
            }
        }

        // Si no es FX o falló el envío FX, enviar a consolidación normal
        const result = await sessionManager.addToConsolidation(phoneNumber, cleanedMessage);
        if (result.success) {
            const sentNow = result.sentImmediately;
            res.json({
                success: true,
                consolidated: !sentNow,
                message: sentNow
                    ? `Mensaje enviado INMEDIATAMENTE por Cloud API`
                    : `Mensaje en cola (${result.pendingCount} pendientes, envio en ${result.sendInMinutes} min)`,
                details: result
            });
        } else if (result.discarded) {
            res.status(400).json({
                success: false,
                discarded: true,
                message: result.error,
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
 * POST /api/send-direct - Envía un mensaje directo sin consolidación
 * Usa la primera sesión activa disponible o una sesión específica
 * Pensado para alertas/monitoreo que necesitan envío inmediato
 */
app.post('/api/send-direct', async (req, res) => {
    try {
        const { phoneNumber, message, sessionName } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y message son requeridos'
            });
        }

        // Buscar sesión activa
        let session = null;
        if (sessionName) {
            session = sessionManager.getSession(sessionName);
            if (!session || session.state !== config.SESSION_STATES.READY || !session.socket) {
                return res.status(400).json({ success: false, error: `Sesión ${sessionName} no disponible` });
            }
        } else {
            // Buscar la primera sesión READY
            const statuses = sessionManager.getSessionsStatus();
            for (const s of statuses) {
                if (s.state === config.SESSION_STATES.READY) {
                    session = sessionManager.getSession(s.name);
                    if (session && session.socket) break;
                    session = null;
                }
            }
            if (!session) {
                return res.status(503).json({ success: false, error: 'No hay sesiones activas disponibles' });
            }
        }

        const formattedNumber = formatPhoneNumber(phoneNumber);
        if (!formattedNumber) {
            return res.status(400).json({ success: false, error: 'Número de teléfono inválido' });
        }

        const jid = formattedNumber + '@s.whatsapp.net';
        await session.socket.sendMessage(jid, { text: message });

        console.log(`📤 Mensaje directo enviado a ${formattedNumber} vía sesión ${session.name}`);

        res.json({
            success: true,
            message: 'Mensaje enviado directamente',
            sessionUsed: session.name,
            to: formattedNumber
        });
    } catch (error) {
        console.error('❌ Error enviando mensaje directo:', error.message);
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
                discarded: !!result.discarded,
                consolidated: !!result.success,
                pendingCount: result.pendingCount || 0,
                error: result.discarded ? result.error : null
            });
        }

        const successCount = results.filter(r => r.success).length;
        const discardedCount = results.filter(r => r.discarded).length;
        res.json({
            success: discardedCount === 0,
            consolidated: successCount > 0,
            total: contacts.length,
            queued: successCount,
            discarded: discardedCount,
            failed: contacts.length - successCount,
            message: discardedCount > 0
                ? `${successCount} mensajes agregados a consolidacion, ${discardedCount} descartados por plantilla invalida`
                : `${successCount} mensajes agregados a consolidacion`,
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
 * GET /api/analytics/sessions-monthly - Envíos por sesión agrupados por mes
 */
app.get('/api/analytics/sessions-monthly', async (req, res) => {
    try {
        const analyticsController = require('./controllers/analyticsController');
        await analyticsController.getSessionsMonthly(req, res);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/analytics/export-sent - Mensajes enviados del período para Excel/tabla
 */
app.get('/api/analytics/export-sent', async (req, res) => {
    try {
        const { start_date, end_date, session, limit, offset, status_filter } = req.query;
        if (!start_date || !end_date) {
            return res.status(400).json({ success: false, error: 'Se requieren start_date y end_date' });
        }

        const pageLimit  = limit  ? Math.min(parseInt(limit),  50000) : 50000;
        const pageOffset = offset ? parseInt(offset) : 0;

        // Clave de caché única por filtros y página
        const sf = status_filter || 'sent';
        const cacheKey = `export_sent:${start_date}:${end_date}:${session || 'all'}:${sf}:${pageLimit}:${pageOffset}`;
        const cached = await redisGet(cacheKey);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(JSON.parse(cached));
        }

        // Condición de status según filtro
        let statusCondition;
        if (sf === 'received') {
            statusCondition = "status = 'received'";
        } else if (sf === 'all') {
            statusCondition = "(status IN ('sent','success','SENT','SUCCESS','received'))";
        } else {
            // 'sent' por defecto
            statusCondition = "(status IN ('sent','success','SENT','SUCCESS'))";
        }

        const conditions = [
            "timestamp >= $1",
            "timestamp <= $2",
            statusCondition
        ];
        const params = [`${start_date} 00:00:00`, `${end_date} 23:59:59`];

        if (session) {
            conditions.push(`session = $${params.length + 1}`);
            params.push(session);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;

        const [countResult, dataResult] = await Promise.all([
            database.query(`SELECT COUNT(*) as total FROM messages ${where}`, params),
            database.query(
                `SELECT timestamp, phone_number, message_preview, char_count, session, status
                 FROM messages ${where}
                 ORDER BY timestamp DESC
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, pageLimit, pageOffset]
            )
        ]);

        const total = parseInt(countResult.rows[0].total) || 0;
        const payload = { success: true, messages: dataResult.rows, total, limit: pageLimit, offset: pageOffset };

        // Cachear 5 min (datos del día), 30 min (días anteriores)
        const isToday = start_date === end_date && start_date === new Date().toISOString().split('T')[0];
        await redisSet(cacheKey, JSON.stringify(payload), isToday ? 300 : 1800);

        res.setHeader('X-Cache', 'MISS');
        res.json(payload);
    } catch (error) {
        console.error('Error en /api/analytics/export-sent:', error.message);
        if (error.message && error.message.includes('does not exist')) {
            return res.json({ success: true, messages: [], total: 0, limit: 50000, offset: 0 });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/analytics/messages - Historial de mensajes
 */
app.get('/api/analytics/messages', async (req, res) => {
    try {
        const { period = 'day', range = 'today', top = 10, start_date, end_date, session, limit } = req.query;
        const options = { period, range, top: parseInt(top), limit: parseInt(limit) || 50 };
        if (period === 'custom' && start_date && end_date) {
            options.startDate = start_date;
            options.endDate = end_date;
        }
        if (session) {
            options.session = session;
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
        const { period = 'day', range = 'today', top = 10, start_date, end_date, session, limit } = req.query;
        const options = { period, range, top: parseInt(top), limit: parseInt(limit) || 50 };
        if (period === 'custom' && start_date && end_date) {
            options.startDate = start_date;
            options.endDate = end_date;
        }
        if (session) {
            options.session = session;
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
        const { sessions: sessionNames, topic, messageCount = 5, delay = 15, style = 'casual', useCloudApi = false } = req.body;

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

        console.log(`\n🤖 Iniciando conversación IA entre ${sessionList.length} sesiones ${useCloudApi ? '(vía Cloud API)' : '(vía Baileys)'}`);
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
                // Enviar mensaje vía Cloud API o Baileys
                if (useCloudApi) {
                    const cloudApi = require('./lib/session/whatsapp-cloud-api');
                    const sendResult = await cloudApi.sendTextMessage(receiverPhone, currentMessage);
                    if (!sendResult.success) {
                        throw new Error(sendResult.error?.message || 'Error Cloud API');
                    }
                    console.log(`✅ ☁️ Cloud API → ${receiverName}: ${currentMessage.substring(0, 50)}...`);
                } else {
                    const formattedReceiver = receiverPhone + '@s.whatsapp.net';
                    await senderSession.socket.sendMessage(formattedReceiver, {
                        text: currentMessage
                    });
                    console.log(`✅ ${senderName} → ${receiverName}: ${currentMessage.substring(0, 50)}...`);
                }

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

// ======================== FX ROUTES ========================

// Montar rutas de FX (MetaTrader5)
const fxRouter = require('./routes/fx');
app.use('/api/fx', fxRouter);

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

// Favicon
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

/**
 * GET /api/message-logs - Alias de /api/monitor/messages para webhook-viewer
 */
app.get('/api/message-logs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 500;
        const offset = parseInt(req.query.offset) || 0;
        const result = await database.getMessagesByFilter({ limit, offset });
        const logs = (result.messages || []).map(m => ({
            id: m.id,
            session_name: m.session || '',
            phone_number: m.phone_number || m.destination || '',
            message_preview: m.message_preview || m.message || '',
            status: m.status || 'unknown',
            created_at: m.timestamp || m.created_at || ''
        }));
        res.json({ success: true, logs, total: result.total });
    } catch (error) {
        res.json({ success: true, logs: [], total: 0 });
    }
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

        // Auto-crear sesiones FX si no existen (para que siempre estén disponibles)
        const fxSession = require('./lib/session/fx-session');
        const fxNames = fxSession.getFXSessionNames();
        for (const fxName of fxNames) {
            if (!sessionManager.getSession(fxName)) {
                console.log(`📱 Auto-creando sesión FX: ${fxName}`);
                try {
                    await sessionManager.createSession(fxName);
                } catch (e) {
                    console.log(`⚠️ No se pudo auto-crear ${fxName}: ${e.message}`);
                }
            }
        }

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

