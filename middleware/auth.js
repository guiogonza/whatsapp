/**
 * Middleware de autenticación API
 * Valida API keys para proteger endpoints sensibles
 */

const config = require('../config');

const API_KEY = process.env.API_KEY || '';

/**
 * Rutas públicas que no requieren autenticación
 */
const PUBLIC_ROUTES = [
    '/health',
    '/webhook',
    '/privacy.html',
    '/index.html'
];

/**
 * Middleware de autenticación API
 * @param {Object} req - Request
 * @param {Object} res - Response
 * @param {Function} next - Next middleware
 */
function authenticateAPI(req, res, next) {
    // Verificar si es ruta pública
    const isPublicRoute = PUBLIC_ROUTES.some(route => req.path.startsWith(route));
    
    // Si es ruta pública o no hay API_KEY configurada, permitir acceso
    if (isPublicRoute || !API_KEY || !req.path.startsWith('/api/')) {
        return next();
    }
    
    // Verificar API key en headers o query params
    const providedKey = req.headers['x-api-key'] || req.query.apiKey;
    
    if (providedKey !== API_KEY) {
        return res.status(401).json({
            success: false,
            error: 'API key requerida o inválida'
        });
    }
    
    next();
}

module.exports = { authenticateAPI };
