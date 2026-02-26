/**
 * Controller de GPSwox
 * Maneja las operaciones relacionadas con el módulo GPSwox
 */

const gpswoxSession = require('../lib/session/gpswox-session');
const sessionManager = require('../lib/session');

/**
 * POST /api/gpswox/session/create - Crea una sesión dedicada GPSwox
 */
async function createGPSwoxSession(req, res) {
    try {
        const sessionName = req.body.sessionName || gpswoxSession.getGPSwoxSessionName();
        const allowedNames = gpswoxSession.getGPSwoxSessionNames();

        // Validar que el nombre sea uno de los permitidos
        if (!allowedNames.includes(sessionName)) {
            return res.status(400).json({
                success: false,
                error: `Nombre de sesión inválido. Use uno de: ${allowedNames.join(', ')}`
            });
        }

        // Verificar si ya existe
        const existing = sessionManager.getSession(sessionName);
        if (existing) {
            return res.status(409).json({
                success: false,
                error: `La sesión GPSwox '${sessionName}' ya existe`
                // QR disponible via /api/sessions/${sessionName}/qr
            });
        }

        // Crear la sesión
        await sessionManager.createSession(sessionName);

        res.json({
            success: true,
            message: `Sesión GPSwox '${sessionName}' creada exitosamente`,
            sessionName,
            dedicatedMode: gpswoxSession.isGPSwoxDedicatedMode()
            // QR se obtiene via /api/sessions/${sessionName}/qr después de unos segundos
        });
    } catch (error) {
        console.error('Error creando sesión GPSwox:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/gpswox/sessions/create-all - Crea todas las sesiones GPSwox configuradas
 */
async function createAllGPSwoxSessions(req, res) {
    try {
        const sessionNames = gpswoxSession.getGPSwoxSessionNames();
        const results = [];

        for (const sessionName of sessionNames) {
            try {
                const existing = sessionManager.getSession(sessionName);
                if (existing) {
                    results.push({
                        sessionName,
                        success: true,
                        message: 'Ya existe'
                        // QR disponible via /api/sessions/${sessionName}/qr
                    });
                    continue;
                }

                await sessionManager.createSession(sessionName);
                results.push({
                    sessionName,
                    success: true,
                    message: 'Creada exitosamente'
                    // QR se obtiene via polling
                });
            } catch (error) {
                results.push({
                    sessionName,
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `Proceso completado para ${sessionNames.length} sesiones`,
            dedicatedMode: gpswoxSession.isGPSwoxDedicatedMode(),
            results
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/gpswox/conversations - Obtiene todas las conversaciones activas
 */
function getConversations(req, res) {
    try {
        const conversations = gpswoxSession.getActiveConversations();
        res.json({
            success: true,
            count: conversations.length,
            conversations
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/gpswox/conversation/:phoneNumber - Obtiene una conversación específica
 */
function getConversation(req, res) {
    try {
        const { phoneNumber } = req.params;
        const conversation = gpswoxSession.getConversation(phoneNumber);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'Conversación no encontrada'
            });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/gpswox/conversation/:phoneNumber/start - Inicia una conversación
 */
function startConversation(req, res) {
    try {
        const { phoneNumber } = req.params;
        gpswoxSession.startConversation(phoneNumber);
        
        res.json({
            success: true,
            message: 'Conversación iniciada'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * DELETE /api/gpswox/conversation/:phoneNumber - Elimina una conversación
 */
function deleteConversation(req, res) {
    try {
        const { phoneNumber } = req.params;
        gpswoxSession.endConversation(phoneNumber);
        
        res.json({
            success: true,
            message: 'Conversación eliminada'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/gpswox/stats - Estadísticas de GPSwox
 */
function getStats(req, res) {
    try {
        const stats = gpswoxSession.getStats();
        res.json({ success: true, ...stats });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    createGPSwoxSession,
    createAllGPSwoxSessions,
    getConversations,
    getConversation,
    startConversation,
    deleteConversation,
    getStats
};
