/**
 * Controller de FX (MetaTrader5)
 * Maneja las operaciones relacionadas con notificaciones de trading
 */

const fxSession = require('../lib/session/fx-session');
const sessionManager = require('../lib/session');
const { formatNotification, NOTIFICATION_TYPES } = require('../lib/session/fx-api');

/**
 * POST /api/fx/session/create - Crea una sesión dedicada FX
 */
async function createFXSession(req, res) {
    try {
        const sessionName = req.body.sessionName || fxSession.getFXSessionName();
        const allowedNames = fxSession.getFXSessionNames();

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
                error: `La sesión FX '${sessionName}' ya existe`
                // QR disponible via /api/sessions/${sessionName}/qr
            });
        }

        // Crear la sesión
        await sessionManager.createSession(sessionName);

        res.json({
            success: true,
            message: `Sesión FX '${sessionName}' creada exitosamente`,
            sessionName,
            dedicatedMode: fxSession.isFXDedicatedMode()
            // QR se obtiene via /api/sessions/${sessionName}/qr después de unos segundos
        });
    } catch (error) {
        console.error('Error creando sesión FX:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/fx/sessions/create-all - Crea todas las sesiones FX configuradas
 */
async function createAllFXSessions(req, res) {
    try {
        const sessionNames = fxSession.getFXSessionNames();
        const results = [];

        for (const sessionName of sessionNames) {
            try {
                const existing = sessionManager.getSession(sessionName);
                if (existing) {
                    results.push({
                        sessionName,
                        success: true,
                        message: 'Ya existe',
                        qr: sessionManager.getQRCode(sessionName)
                    });
                    continue;
                }

                await sessionManager.createSession(sessionName);
                results.push({
                    sessionName,
                    success: true,
                    message: 'Creada exitosamente',
                    qr: sessionManager.getQRCode(sessionName)
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
            dedicatedMode: fxSession.isFXDedicatedMode(),
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
 * POST /api/fx/notify - Procesa una notificación FX (webhook desde MT5)
 */
async function sendNotification(req, res) {
    try {
        const { type, accountNumber, webhookSecret, data } = req.body;

        if (!type || !webhookSecret || !data) {
            return res.status(400).json({
                success: false,
                error: 'type, webhookSecret y data son requeridos'
            });
        }

        // Función para enviar mensajes
        const sendMessageFunction = async (phoneNumber, message) => {
            // Intentar usar sesión FX primero
            const fxSessions = sessionManager.getActiveSessions().filter(s => 
                fxSession.isFXSession(s.name)
            );

            if (fxSessions.length > 0) {
                const session = fxSessions[0];
                return await sessionManager.sendMessageWithRetry(session, phoneNumber, message);
            }

            // Fallback: usar rotación normal
            return await sessionManager.sendMessageWithRotation(phoneNumber, message);
        };

        // Procesar notificación
        const result = await fxSession.processNotification(
            { type, accountNumber, webhookSecret, data },
            sendMessageFunction
        );

        res.json(result);
    } catch (error) {
        console.error('Error procesando notificación FX:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/fx/subscribe - Suscribe un usuario a una cuenta
 */
function subscribe(req, res) {
    try {
        const { phoneNumber, accountNumber, notificationTypes } = req.body;

        if (!phoneNumber || !accountNumber) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y accountNumber son requeridos'
            });
        }

        const result = fxSession.subscribe(phoneNumber, accountNumber, notificationTypes);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/fx/unsubscribe - Desuscribe un usuario de una cuenta
 */
function unsubscribe(req, res) {
    try {
        const { phoneNumber, accountNumber } = req.body;

        if (!phoneNumber || !accountNumber) {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber y accountNumber son requeridos'
            });
        }

        const result = fxSession.unsubscribe(phoneNumber, accountNumber);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/fx/subscribers - Lista todos los suscriptores
 */
function getSubscribers(req, res) {
    try {
        const subscribers = fxSession.listAllSubscribers();
        res.json({
            success: true,
            count: subscribers.length,
            subscribers
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/fx/subscribers/:accountNumber - Obtiene suscriptores de una cuenta
 */
function getAccountSubscribers(req, res) {
    try {
        const { accountNumber } = req.params;
        const subscribers = fxSession.getSubscribers(accountNumber);
        
        res.json({
            success: true,
            accountNumber,
            count: subscribers.length,
            subscribers
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/fx/stats - Estadísticas de FX
 */
function getStats(req, res) {
    try {
        const stats = fxSession.getStats();
        res.json({ success: true, ...stats });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/fx/history - Historial de notificaciones
 */
function getHistory(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const history = fxSession.getHistory(limit);
        
        res.json({
            success: true,
            count: history.length,
            history
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/fx/types - Lista tipos de notificaciones disponibles
 */
function getNotificationTypes(req, res) {
    try {
        res.json({
            success: true,
            types: Object.values(NOTIFICATION_TYPES),
            descriptions: {
                [NOTIFICATION_TYPES.SIGNAL]: 'Señales de trading (BUY/SELL)',
                [NOTIFICATION_TYPES.ALERT]: 'Alertas de precio (Stop Loss, Take Profit)',
                [NOTIFICATION_TYPES.POSITION]: 'Apertura/cierre de posiciones',
                [NOTIFICATION_TYPES.ACCOUNT]: 'Reportes de cuenta (Balance, Equity, Margin)',
                [NOTIFICATION_TYPES.NEWS]: 'Noticias del mercado Forex',
                [NOTIFICATION_TYPES.CUSTOM]: 'Mensajes personalizados'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    createFXSession,
    createAllFXSessions,
    sendNotification,
    subscribe,
    unsubscribe,
    getSubscribers,
    getAccountSubscribers,
    getStats,
    getHistory,
    getNotificationTypes
};
