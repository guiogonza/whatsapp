/**
 * Controller de Sesiones de WhatsApp
 * Maneja la creación, gestión y eliminación de sesiones
 */

const sessionManager = require('../lib/session');
const { checkProxyAvailable } = require('../lib/session/proxy');

/**
 * GET /api/sessions - Lista todas las sesiones
 */
async function getSessions(req, res) {
    try {
        const database = require('../database-postgres');
        const sessions = sessionManager.getSessionsStatus();
        const allSessions = sessionManager.getAllSessions();
        const { getAllSessionProxyIPs } = require('../lib/session/proxy');

        // Obtener IPs de proxies para cada sesión
        const proxyIPs = await getAllSessionProxyIPs();

        // Obtener estadísticas de la BD para cada sesión
        const dbSessionStats = await database.getSessionStats();

        // Agregar información adicional a cada sesión
        const sessionsWithInfo = sessions.map(session => {
            const fullSession = allSessions[session.name];
            const dbStats = dbSessionStats[session.name] || {
                sentCount: 0,
                receivedCount: 0,
                consolidatedCount: 0
            };

            return {
                ...session,
                messagesSentCount: dbStats.sentCount,
                messagesReceivedCount: dbStats.receivedCount,
                consolidatedCount: dbStats.consolidatedCount,
                adapterType: session.adapterType || 'baileys-standard',
                proxyInfo: proxyIPs[session.name] || {
                    ip: null,
                    proxyUrl: null,
                    location: 'VPS Directo',
                    country: 'VPS',
                    city: 'Directo',
                    countryCode: ''
                }
            };
        });

        // Obtener IP pública del servidor
        const net = require('net');
        const https = require('https');
        const PROXY_URL = process.env.ALL_PROXY || process.env.SOCKS_PROXY || null;
        let publicIP = 'No disponible';
        let usingProxy = false;

        try {
            if (PROXY_URL && await checkProxyAvailable(PROXY_URL)) {
                const { SocksProxyAgent } = require('socks-proxy-agent');
                const agent = new SocksProxyAgent(PROXY_URL);
                usingProxy = true;
                
                publicIP = await new Promise((resolve, reject) => {
                    https.get('https://api.ipify.org', { agent }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(data.trim()));
                    }).on('error', reject);
                });
            } else {
                publicIP = await new Promise((resolve, reject) => {
                    https.get('https://api.ipify.org', (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(data.trim()));
                    }).on('error', reject);
                });
            }
        } catch (error) {
            console.error('Error obteniendo IP pública:', error.message);
        }

        res.json({
            success: true,
            sessions: sessionsWithInfo,
            networkInfo: {
                publicIP,
                usingProxy,
                proxyUrl: PROXY_URL || null
            }
        });
    } catch (error) {
        console.error('Error obteniendo sesiones:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/sessions/create - Crea una nueva sesión
 */
async function createSession(req, res) {
    try {
        const { name } = req.body;
        
        if (!name || typeof name !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'El campo "name" es requerido'
            });
        }

        // Verificar si ya existe
        const existing = sessionManager.getSession(name);
        if (existing) {
            return res.status(409).json({
                success: false,
                error: `La sesión '${name}' ya existe`
            });
        }

        // Crear sesión
        await sessionManager.createSession(name);

        res.json({
            success: true,
            message: `Sesión '${name}' creada exitosamente`,
            session: { name, state: 'connecting' }
        });
    } catch (error) {
        console.error('Error creando sesión:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/sessions/:name/qr - Obtiene el código QR de una sesión
 */
async function getQR(req, res) {
    try {
        const { name } = req.params;
        const qr = sessionManager.getQRCode(name);

        if (!qr) {
            return res.status(404).json({
                success: false,
                error: 'QR no disponible'
            });
        }

        res.json({ success: true, qr });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/sessions/:name/status - Obtiene el estado de una sesión
 */
function getStatus(req, res) {
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
                phoneNumber: session.phoneNumber || null,
                startTime: session.startTime,
                messages: session.messages?.length || 0
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * DELETE /api/sessions/:name - Elimina una sesión
 */
async function deleteSession(req, res) {
    try {
        const { name } = req.params;
        const session = sessionManager.getSession(name);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Sesión no encontrada'
            });
        }

        await sessionManager.closeSession(name);
        await sessionManager.deleteSessionData(name);

        res.json({
            success: true,
            message: `Sesión '${name}' eliminada exitosamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/sessions/cleanup - Limpia sesiones estancadas
 */
async function cleanupSessions(req, res) {
    try {
        const result = await sessionManager.runStaleSessionCleaner();
        res.json({
            success: true,
            message: 'Limpieza completada',
            result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/adapters/info - Información de adaptadores
 */
function getAdaptersInfo(req, res) {
    try {
        const adapterFactory = require('../lib/session/adapters');
        res.json({
            success: true,
            adapters: adapterFactory.getAdaptersInfo()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/sessions/rotation/info - Información de rotación
 */
function getRotationInfo(req, res) {
    try {
        const info = sessionManager.getRotationInfo();
        res.json({ success: true, ...info });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/proxy/status - Estado del proxy
 */
function getProxyStatus(req, res) {
    try {
        const status = sessionManager.getProxyStatus();
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    getSessions,
    createSession,
    getQR,
    getStatus,
    deleteSession,
    cleanupSessions,
    getAdaptersInfo,
    getRotationInfo,
    getProxyStatus
};
