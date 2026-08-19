/**
 * Cliente HTTP hacia la API de Inspección Hesego (INSP_API_URL).
 * Backend independiente (mismo patrón que preop-api.js) — este módulo solo lo
 * consume, no lo modifica.
 *
 * Endpoints usados:
 *   GET  /rest/v1/sedes/public          → lista de sedes activas
 *   POST /auth/login-inspeccion          → autentica un vehículo (placa + sedeId + auditorNombre)
 *   GET  /rest/v1/inspecciones/hoy        → indica si ya existe inspección de hoy para la placa
 *   POST /rest/v1/inspecciones            → crea la inspección directo (caso "sin novedades"), requiere Bearer
 *   POST /internal/upload-token           → genera el link único de fotos (caso "con daños"), requiere secreto interno
 */

const axios = require('axios');
const config = require('../../config');

const inspHttp = axios.create({
    baseURL: config.INSP_API_URL,
    timeout: 30000
});

async function requestWithRetry(requestFn, { retries = 2, baseDelayMs = 500, label = 'request' } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await requestFn();
        } catch (error) {
            lastError = error;
            const status = error.response?.status;
            const isRetryable = !status || status >= 500;
            if (!isRetryable || attempt === retries) {
                throw error;
            }
            const delay = baseDelayMs * Math.pow(2, attempt);
            console.warn(`⚠️ [inspeccion-api] ${label} falló (intento ${attempt + 1}/${retries + 1}): ${error.message}. Reintentando en ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

function extractErrorMessage(error, fallback) {
    return error.response?.data?.error || error.response?.data?.message || fallback;
}

async function getSedes() {
    const response = await requestWithRetry(
        () => inspHttp.get('/rest/v1/sedes/public'),
        { label: 'GET /rest/v1/sedes/public' }
    );
    return response.data;
}

async function loginInspeccion(placa, sedeId, auditorNombre) {
    const response = await requestWithRetry(
        () => inspHttp.post('/auth/login-inspeccion', { placa, sedeId, auditorNombre }),
        { label: 'POST /auth/login-inspeccion', retries: 1 }
    );
    return response.data;
}

async function getInspeccionHoy(token, placa) {
    const response = await requestWithRetry(
        () => inspHttp.get('/rest/v1/inspecciones/hoy', {
            params: { placa },
            headers: { Authorization: `Bearer ${token}` }
        }),
        { label: 'GET /rest/v1/inspecciones/hoy' }
    );
    return response.data;
}

/**
 * Crea la inspección directamente (solo para el caso "sin novedades", que no
 * requiere fotos). No se reintenta: es una escritura final.
 */
async function crearInspeccion(token, body) {
    const response = await inspHttp.post('/rest/v1/inspecciones', body, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
}

/**
 * Genera un link único de subida de fotos (endpoint interno, requiere
 * INSP_INTERNAL_SECRET). La página que abre ese link fuerza cámara en vivo
 * (capture=environment, sin galería) — una foto por cada daño reportado — y
 * crea la inspección al enviarlas; el bot NO llama a crearInspeccion en este
 * caso, la creación ocurre del lado del backend.
 * @param {object} data - { placa, sedeId, sedeNombre, auditorNombre, danos: [{item_nombre, comentario}] }
 * @returns {Promise<{token: string, uploadUrl: string, expiresAt: number}>}
 */
async function getUploadToken(data) {
    const response = await requestWithRetry(
        () => inspHttp.post('/internal/upload-token', data, {
            headers: { 'x-internal-secret': config.INSP_INTERNAL_SECRET }
        }),
        { label: 'POST /internal/upload-token', retries: 1 }
    );
    return response.data;
}

module.exports = {
    getSedes,
    loginInspeccion,
    getInspeccionHoy,
    crearInspeccion,
    getUploadToken,
    extractErrorMessage
};
