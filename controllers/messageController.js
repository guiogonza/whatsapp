/**
 * Controller de Mensajería de WhatsApp
 * Maneja el envío de mensajes, consolidación y procesamiento de colas
 */

const sessionManager = require('../lib/session');
const database = require('../database-postgres');

/**
 * POST /api/messages/send - Envía un mensaje
 */
async function sendMessage(req, res) {
    try {
        const { phoneNumber, message, sessionName } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y message son requeridos'
            });
        }

        let result;
        if (sessionName) {
            // Enviar con sesión específica
            const session = sessionManager.getSession(sessionName);
            if (!session) {
                return res.status(404).json({
                    success: false,
                    error: 'Sesión no encontrada'
                });
            }
            result = await sessionManager.sendMessageWithRetry(session, phoneNumber, message);
        } else {
            // Enviar con rotación
            result = await sessionManager.sendMessageWithRotation(phoneNumber, message);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/messages/bulk - Envía mensajes masivos
 */
async function sendBulkMessages(req, res) {
    try {
        const { contacts, message } = req.body;

        if (!Array.isArray(contacts) || contacts.length === 0 || !message) {
            return res.status(400).json({
                success: false,
                error: 'contacts (array) y message son requeridos'
            });
        }

        const results = [];
        for (const contact of contacts) {
            try {
                const result = await sessionManager.sendMessageWithRotation(contact, message);
                results.push({ contact, ...result });
            } catch (error) {
                results.push({ contact, success: false, error: error.message });
            }
        }

        res.json({
            success: true,
            results,
            total: contacts.length,
            sent: results.filter(r => r.success).length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/messages/consolidate - Añade mensaje a consolidación
 */
async function consolidateMessage(req, res) {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y message son requeridos'
            });
        }

        await sessionManager.addToConsolidation(phoneNumber, message);

        res.json({
            success: true,
            message: 'Mensaje añadido a consolidación'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/messages/consolidation/status - Estado de consolidación
 */
async function getConsolidationStatus(req, res) {
    try {
        const status = await sessionManager.getConsolidationStatus();
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/messages/history - Historial de mensajes
 */
function getMessageHistory(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const messages = sessionManager.getRecentMessages(limit);
        res.json({ success: true, messages });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/hybrid/status - Estado del modo híbrido
 */
function getHybridStatus(req, res) {
    try {
        const status = sessionManager.getHybridStatus();
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/cloud/send - Envía mensaje por Cloud API
 */
async function sendCloudMessage(req, res) {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y message son requeridos'
            });
        }

        const cloudApi = sessionManager.cloudApi;
        const result = await cloudApi.sendMessage(phoneNumber, message);

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/cloud/stats - Estadísticas de Cloud API
 */
async function getCloudStats(req, res) {
    try {
        const cloudApi = sessionManager.cloudApi;
        const stats = cloudApi.getStats();
        res.json({ success: true, ...stats });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/cloud/enable - Habilita Cloud API
 */
function enableCloud(req, res) {
    try {
        const cloudApi = sessionManager.cloudApi;
        cloudApi.enable();
        res.json({
            success: true,
            message: 'Cloud API habilitada'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/cloud/disable - Deshabilita Cloud API
 */
function disableCloud(req, res) {
    try {
        const cloudApi = sessionManager.cloudApi;
        cloudApi.disable();
        res.json({
            success: true,
            message: 'Cloud API deshabilitada'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/messages/logs - Obtiene logs de mensajes desde PostgreSQL
 */
async function getMessageLogs(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 100;
        
        const logs = await database.getMessageLogs(limit);
        
        res.json({
            success: true,
            logs: logs || [],
            count: logs ? logs.length : 0
        });
    } catch (error) {
        console.error('Error obteniendo logs:', error);
        res.json({
            success: true,
            logs: [],
            count: 0
        });
    }
}

module.exports = {
    sendMessage,
    sendBulkMessages,
    consolidateMessage,
    getConsolidationStatus,
    getMessageHistory,
    getMessageLogs,
    getHybridStatus,
    sendCloudMessage,
    getCloudStats,
    enableCloud,
    disableCloud
};
