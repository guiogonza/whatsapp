/**
 * Controlador de configuración
 */

// Almacenamiento en memoria para configuraciones
// TODO: Migrar a PostgreSQL si se requiere persistencia
const settings = {
    sessionTimeout: 10 // minutos por defecto
};

/**
 * Obtener timeout de sesión
 */
async function getSessionTimeout(req, res) {
    try {
        res.json({
            success: true,
            timeout: settings.sessionTimeout
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * Guardar timeout de sesión
 */
async function saveSessionTimeout(req, res) {
    try {
        const { timeout } = req.body;
        
        if (!timeout || timeout < 1 || timeout > 120) {
            return res.status(400).json({
                success: false,
                error: 'Timeout debe estar entre 1 y 120 minutos'
            });
        }
        
        settings.sessionTimeout = timeout;
        
        res.json({
            success: true,
            timeout: settings.sessionTimeout,
            message: `Timeout configurado a ${timeout} minutos`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/settings/batch - Obtener configuración de batch
 */
async function getBatchSettings(req, res) {
    try {
        res.json({
            success: true,
            batchSize: settings.batchSize || 10,
            batchDelay: settings.batchDelay || 60
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/settings/batch - Guardar configuración de batch
 */
async function saveBatchSettings(req, res) {
    try {
        const { batchSize, batchDelay } = req.body;
        
        if (batchSize) settings.batchSize = parseInt(batchSize);
        if (batchDelay) settings.batchDelay = parseInt(batchDelay);
        
        res.json({
            success: true,
            batchSize: settings.batchSize,
            batchDelay: settings.batchDelay
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/settings/notification-interval - Obtener intervalo de notificaciones
 */
async function getNotificationInterval(req, res) {
    try {
        res.json({
            success: true,
            interval: settings.notificationInterval || 30
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/settings/notification-interval - Guardar intervalo de notificaciones
 */
async function saveNotificationInterval(req, res) {
    try {
        const { interval } = req.body;
        
        if (interval) {
            settings.notificationInterval = parseInt(interval);
        }
        
        res.json({
            success: true,
            interval: settings.notificationInterval
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    getSessionTimeout,
    saveSessionTimeout,
    getBatchSettings,
    saveBatchSettings,
    getNotificationInterval,
    saveNotificationInterval
};
