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

module.exports = {
    getSessionTimeout,
    saveSessionTimeout
};
