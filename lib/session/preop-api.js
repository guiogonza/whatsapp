/**
 * Cliente HTTP hacia la API de Preoperacional Hesego (PREOP_API_URL).
 * Backend ya desplegado en producción — este módulo solo lo consume, no lo modifica.
 *
 * Endpoints usados:
 *   GET  /rest/v1/empresas/public                 → lista de empresas activas
 *   POST /auth/login-vehiculo                      → autentica un vehículo (empresaId + placa)
 *   GET  /rest/v1/preoperacional/hoy?placa=...      → indica si ya existe inspección de hoy
 *   POST /rest/v1/upload                            → sube una foto (multipart), requiere Bearer
 *   POST /rest/v1/preoperacional                    → crea la inspección, requiere Bearer
 */

const axios = require('axios');
const FormData = require('form-data');
const config = require('../../config');

const preopHttp = axios.create({
    baseURL: config.PREOP_API_URL,
    timeout: 30000
});

/**
 * Ejecuta una llamada axios con reintentos ante errores transitorios de red
 * (timeouts, ECONNRESET, 5xx del backend). No reintenta errores 4xx.
 */
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
            console.warn(`⚠️ [preop-api] ${label} falló (intento ${attempt + 1}/${retries + 1}): ${error.message}. Reintentando en ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

/**
 * Extrae un mensaje de error legible para el usuario final desde una respuesta axios.
 */
function extractErrorMessage(error, fallback) {
    return error.response?.data?.error || error.response?.data?.message || fallback;
}

/**
 * Lista de empresas activas, sin autenticación previa.
 * @returns {Promise<Array<{id: number, nombre: string}>>}
 */
async function getEmpresas() {
    const response = await requestWithRetry(
        () => preopHttp.get('/rest/v1/empresas/public'),
        { label: 'GET /rest/v1/empresas/public' }
    );
    return response.data;
}

/**
 * Autentica un vehículo por empresa + placa. No se reintenta agresivamente
 * porque un 404/403 es una respuesta válida (placa no registrada / no coincide).
 * @returns {Promise<{token: string, vehiculo: object, empresa: object}>}
 */
async function loginVehiculo(empresaId, placa) {
    const response = await requestWithRetry(
        () => preopHttp.post('/auth/login-vehiculo', { empresaId, placa }),
        { label: 'POST /auth/login-vehiculo', retries: 1 }
    );
    return response.data;
}

/**
 * Verifica si ya existe una inspección preoperacional registrada hoy para la placa.
 * @returns {Promise<{exists: boolean, inspecciones: Array}>}
 */
async function getPreoperacionalHoy(token, placa) {
    const response = await requestWithRetry(
        () => preopHttp.get('/rest/v1/preoperacional/hoy', {
            params: { placa },
            headers: { Authorization: `Bearer ${token}` }
        }),
        { label: 'GET /rest/v1/preoperacional/hoy' }
    );
    return response.data;
}

/**
 * Sube una foto (multipart/form-data) y retorna la URL relativa devuelta por el backend.
 * @returns {Promise<{url: string}>}
 */
async function subirFoto(token, buffer, filename, mimetype) {
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mimetype });

    const response = await requestWithRetry(
        () => preopHttp.post('/rest/v1/upload', form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${token}`
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        }),
        { label: 'POST /rest/v1/upload', retries: 1 }
    );
    return response.data;
}

/**
 * Crea la inspección preoperacional. No se reintenta: es una escritura final,
 * y un fallo de red debe reportarse tal cual al conductor para que decida reintentar.
 * @returns {Promise<object>} La inspección creada (incluye estado calculado por el backend)
 */
async function crearPreoperacional(token, body) {
    const response = await preopHttp.post('/rest/v1/preoperacional', body, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
}

/**
 * Clasifica una novedad en texto libre ("pito malo, frenos rechinan") contra
 * el checklist del vehículo usando IA (endpoint interno, requiere
 * PREOP_INTERNAL_SECRET). Si no hay OPENAI_API_KEY configurada del lado del
 * backend, devuelve items: [] (sin clasificar) sin fallar.
 * @returns {Promise<{items: Array<{item_nombre: string, comentario: string}>, resumen_texto: string, total_checklist: number}>}
 */
async function mapearItems({ novedad, placa, tipo }) {
    const response = await requestWithRetry(
        () => preopHttp.post('/internal/preop/mapear-items', { novedad, placa, tipo }, {
            headers: { 'x-internal-secret': config.PREOP_INTERNAL_SECRET }
        }),
        { label: 'POST /internal/preop/mapear-items', retries: 1 }
    );
    return response.data;
}

/**
 * Genera un link único de subida de fotos (endpoint interno, requiere
 * PREOP_INTERNAL_SECRET). La página que abre ese link fuerza cámara en vivo
 * (capture=environment, sin galería) y crea la inspección al enviar las fotos
 * — el bot NO llama a crearPreoperacional en este flujo, la creación ocurre
 * del lado del backend cuando el conductor completa las fotos.
 * @param {object} data - { phone, placa, tipo, conductor_nombre, odometro, novedad, items, tiene_novedad }
 *   `items` son SOLO los ítems con novedad (Malo), como { item_nombre, comentario }.
 * @returns {Promise<{token: string, uploadUrl: string, expiresAt: number}>}
 */
async function getUploadToken(data) {
    const response = await requestWithRetry(
        () => preopHttp.post('/internal/whatsapp-upload-token', data, {
            headers: { 'x-internal-secret': config.PREOP_INTERNAL_SECRET }
        }),
        { label: 'POST /internal/whatsapp-upload-token', retries: 1 }
    );
    return response.data;
}

module.exports = {
    getEmpresas,
    loginVehiculo,
    getPreoperacionalHoy,
    subirFoto,
    crearPreoperacional,
    getUploadToken,
    mapearItems,
    extractErrorMessage
};
