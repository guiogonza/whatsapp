/**
 * Módulo para interactuar con la API de GPSwox
 * Servidor PRD: https://plataforma.sistemagps.online/
 * Servidor DEV: http://213.199.45.139/
 * 
 * Endpoints reales utilizados:
 *   GET  /api/admin/clients   → Listar/buscar usuarios (paginado, 25/página)
 *   GET  /api/get_devices     → Listar dispositivos por grupos (name = placa)
 *   POST /api/edit_device     → Editar dispositivo (asignación de usuario)
 *   GET  /api/get_user_data   → Datos del usuario autenticado
 */

const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('../../config');

// Configuración dinámica: usa PRD por defecto, ENV para cambiar
const GPSWOX_CONFIG = {
    BASE_URL: process.env.GPSWOX_ENV === 'dev'
        ? config.GPSWOX_API_BASE_DEV
        : config.GPSWOX_API_BASE_PRD,
    API_HASH: process.env.GPSWOX_ENV === 'dev'
        ? config.GPSWOX_API_HASH_DEV
        : config.GPSWOX_API_HASH_PRD,
};

// Instancia compartida con keep-alive para reducir "socket hang up" por churn de conexiones
const gpswoxHttp = axios.create({
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 10 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 10 }),
});

/**
 * Ejecuta una llamada axios con reintentos ante errores transitorios de red
 * (socket hang up, ECONNRESET, ETIMEDOUT, 5xx del servidor GPSwox).
 * No reintenta errores 4xx (son errores de solicitud, no de red).
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
            console.warn(`⚠️ ${label} falló (intento ${attempt + 1}/${retries + 1}): ${error.message}. Reintentando en ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Cache de clientes para evitar llamadas excesivas (TTL 5 minutos)
let clientsCache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Valida si un correo electrónico tiene formato válido
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Obtiene todos los clientes paginados de /api/admin/clients
 * Cachea el resultado por 5 minutos
 * @returns {Promise<Array>} Array de usuarios
 */
async function getAllClients() {
    // Verificar cache
    if (clientsCache.data && (Date.now() - clientsCache.timestamp) < CACHE_TTL) {
        console.log(`📦 Usando cache de clientes (${clientsCache.data.length} usuarios)`);
        return clientsCache.data;
    }

    console.log(`🔄 Obteniendo lista de clientes desde API...`);
    const allClients = [];
    let page = 1;
    let lastPage = 1;

    try {
        do {
            const url = `${GPSWOX_CONFIG.BASE_URL}/admin/clients`;
            const response = await requestWithRetry(() => gpswoxHttp.get(url, {
                params: {
                    lang: 'es',
                    user_api_hash: GPSWOX_CONFIG.API_HASH,
                    page: page
                },
                timeout: 20000
            }), { label: `GET /admin/clients (página ${page})` });

            const body = response.data;

            if (body && body.data && Array.isArray(body.data)) {
                allClients.push(...body.data);
                if (body.pagination) {
                    lastPage = body.pagination.last_page || 1;
                }
            } else {
                // Respuesta no paginada (array directo)
                if (Array.isArray(body)) {
                    allClients.push(...body);
                }
                break;
            }

            page++;
        } while (page <= lastPage);

        console.log(`✅ Obtenidos ${allClients.length} clientes (${lastPage} páginas)`);

        // Guardar en cache
        clientsCache = { data: allClients, timestamp: Date.now() };
        return allClients;

    } catch (error) {
        console.error(`❌ Error obteniendo clientes: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}, Data:`, JSON.stringify(error.response.data).substring(0, 200));
        }
        throw new Error(`Error al obtener clientes: ${error.message}`);
    }
}

/**
 * Busca un usuario por correo electrónico en GPSwox
 * Usa GET /api/admin/clients y filtra por email
 * @param {string} email - Correo electrónico del usuario
 * @returns {Promise<Object>} Usuario encontrado o null
 */
async function findUserByEmail(email) {
    try {
        console.log(`🔍 Buscando usuario con email: ${email}`);
        const normalizedEmail = email.trim().toLowerCase();

        const clients = await getAllClients();

        const user = clients.find(c =>
            c.email && c.email.trim().toLowerCase() === normalizedEmail
        );

        if (user) {
            console.log(`✅ Usuario encontrado: ${user.email} (ID: ${user.id}, devices: ${user.devices_count || 0})`);
            return {
                id: user.id,
                email: user.email,
                active: user.active,
                name: user.email.split('@')[0],
                devices_count: user.devices_count || 0,
                client_id: user.client_id,
                group_id: user.group_id,
                role_id: user.role_id,
                manager_id: user.manager_id
            };
        }

        console.log(`❌ Usuario no encontrado con email: ${email}`);
        return null;

    } catch (error) {
        console.error(`❌ Error buscando usuario: ${error.message}`);
        throw new Error(`Error al buscar usuario: ${error.message}`);
    }
}

/**
 * Formatea una placa agregando guion después de 3 caracteres
 * Ejemplos: ABC123 -> ABC-123, ABC-123 -> ABC-123
 */
/**
 * Normaliza una placa eliminando guiones, espacios y convirtiendo a mayúsculas
 * Se usa para comparar placas independientemente del formato
 */
function normalizePlateForComparison(plate) {
    return plate.trim().toUpperCase().replace(/[-\s]/g, '');
}

function formatPlate(plate) {
    let cleanPlate = plate.trim().toUpperCase().replace(/\s+/g, '');

    if (cleanPlate.includes('-')) {
        const parts = cleanPlate.split('-');
        if (parts.length === 2 && parts[0].length === 3) {
            return cleanPlate;
        }
        cleanPlate = cleanPlate.replace(/-/g, '');
    }

    if (cleanPlate.length > 3) {
        return `${cleanPlate.substring(0, 3)}-${cleanPlate.substring(3)}`;
    }

    return cleanPlate;
}

/**
 * Valida si una placa tiene el formato correcto (XXX-XXX)
 */
function isValidPlateFormat(plate) {
    const plateRegex = /^[A-Z0-9]{3}-[A-Z0-9]+$/;
    return plateRegex.test(plate);
}

/**
 * Busca un dispositivo (vehículo) por placa en GPSwox
 * Usa GET /api/get_devices — el campo "name" del dispositivo ES la placa
 * @param {string} plate - Placa del vehículo (formato: ABC-123)
 * @returns {Promise<Object>} Dispositivo encontrado o null
 */
async function findDeviceByPlate(plate) {
    try {
        console.log(`🔍 Buscando dispositivo con placa: ${plate}`);
        const normalizedSearchPlate = normalizePlateForComparison(plate);

        const url = `${GPSWOX_CONFIG.BASE_URL}/get_devices`;
        const response = await requestWithRetry(() => gpswoxHttp.get(url, {
            params: {
                lang: 'en',
                user_api_hash: GPSWOX_CONFIG.API_HASH
            },
            timeout: 30000
        }), { label: 'GET /get_devices (findDeviceByPlate)' });

        const groups = response.data;
        if (!Array.isArray(groups)) {
            console.log(`❌ Respuesta de get_devices no es un array`);
            return null;
        }

        // Buscar el dispositivo comparando placas normalizadas (sin guiones/espacios)
        for (const group of groups) {
            const items = group.items || [];
            for (const device of items) {
                const devicePlateNormalized = normalizePlateForComparison(device.name || '');
                if (devicePlateNormalized === normalizedSearchPlate) {
                    console.log(`✅ Dispositivo encontrado: ${device.name} (ID: ${device.id}, grupo: ${group.title || group.id})`);
                    return {
                        id: device.id,
                        name: device.name,
                        plate: device.name,
                        online: device.online,
                        protocol: device.protocol,
                        lat: device.lat,
                        lng: device.lng,
                        speed: device.speed,
                        time: device.time,
                        timestamp: device.timestamp,
                        group_id: group.id,
                        group_title: group.title
                    };
                }
            }
        }

        console.log(`❌ Dispositivo no encontrado con placa: ${plate}`);
        return null;

    } catch (error) {
        console.error(`❌ Error buscando dispositivo: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
        }
        throw new Error(`Error al buscar dispositivo: ${error.message}`);
    }
}

/**
 * Obtiene los usuarios actualmente asignados a un dispositivo
 * Usa GET /api/edit_device_data para obtener el campo "users"
 * @param {number} deviceId - ID del dispositivo
 * @returns {Promise<number[]>} Array de user IDs asignados
 */
async function getDeviceUserIds(deviceId) {
    try {
        console.log(`📋 Obteniendo usuarios actuales del dispositivo ${deviceId}`);

        const url = `${GPSWOX_CONFIG.BASE_URL}/edit_device_data`;
        const response = await requestWithRetry(() => gpswoxHttp.get(url, {
            params: {
                device_id: deviceId,
                lang: 'es',
                user_api_hash: GPSWOX_CONFIG.API_HASH
            },
            timeout: 20000
        }), { label: `GET /edit_device_data (device ${deviceId})` });

        const data = response.data;
        
        // CORRECCIÓN: usar sel_users (usuarios realmente asignados) en vez de users (todos los disponibles)
        if (data && data.sel_users && typeof data.sel_users === 'object') {
            const userIds = Object.values(data.sel_users).map(id => Number(id));
            console.log(`✅ Dispositivo ${deviceId} tiene ${userIds.length} usuarios asignados (sel_users)`);
            return userIds;
        }

        // Fallback: si no hay sel_users, retornar vacío
        console.log(`⚠️ No se encontró campo sel_users en edit_device_data`);
        return [];

    } catch (error) {
        console.error(`❌ Error obteniendo usuarios del dispositivo: ${error.message}`);
        return [];
    }
}

/**
 * Asigna un dispositivo a un usuario en GPSwox SIN eliminar los existentes
 * 1. GET /api/edit_device_data → obtiene users actuales
 * 2. Agrega el nuevo userId si no está
 * 3. POST /api/edit_device con el array completo de user_id
 * @param {number} userId - ID del usuario
 * @param {number} deviceId - ID del dispositivo
 * @returns {Promise<Object>} Resultado de la asignación
 */
async function assignDeviceToUser(userId, deviceId) {
    try {
        console.log(`🔗 Asignando dispositivo ${deviceId} al usuario ${userId}`);

        // 1. Obtener usuarios actuales del dispositivo
        const currentUserIds = await getDeviceUserIds(deviceId);

        // 2. Verificar si ya está asignado
        if (currentUserIds.includes(userId)) {
            console.log(`ℹ️ Usuario ${userId} ya está asignado al dispositivo ${deviceId} (sel_users: ${JSON.stringify(currentUserIds)})`);
            return { success: true, alreadyAssigned: true, data: { status: 1 } };
        }

        // 3. Agregar el nuevo usuario al array existente
        const updatedUserIds = [...currentUserIds, userId];
        console.log(`📝 Enviando ${updatedUserIds.length} usuarios: ${JSON.stringify(updatedUserIds)} (${currentUserIds.length} existentes + 1 nuevo)`);

        const url = `${GPSWOX_CONFIG.BASE_URL}/edit_device`;
        const response = await requestWithRetry(() => gpswoxHttp.post(url,
            { user_id: updatedUserIds },
            {
                params: {
                    device_id: deviceId,
                    lang: 'es',
                    user_api_hash: GPSWOX_CONFIG.API_HASH
                },
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        ), { label: `POST /edit_device (device ${deviceId})` });

        const body = response.data;

        if (body && body.status === 1) {
            console.log(`✅ Dispositivo ${deviceId} asignado al usuario ${userId} (total: ${updatedUserIds.length} usuarios)`);
            return { success: true, data: body };
        }

        console.log(`⚠️ Respuesta edit_device:`, JSON.stringify(body).substring(0, 300));
        return {
            success: false,
            error: body.message || 'Respuesta inesperada del servidor'
        };

    } catch (error) {
        console.error(`❌ Error asignando dispositivo: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}, Data:`, JSON.stringify(error.response.data).substring(0, 200));
        }
        return {
            success: false,
            error: error.response?.data?.message || error.message
        };
    }
}

/**
 * Obtiene los dispositivos visibles para el usuario admin
 * Filtra por grupo o nombre si se provee
 * @param {number} userId - ID del usuario (no se usa directamente, se busca por contexto)
 * @returns {Promise<Array>} Lista de dispositivos
 */
async function getUserDevices(userId) {
    try {
        console.log(`📋 Obteniendo dispositivos (contexto usuario ${userId})`);

        const url = `${GPSWOX_CONFIG.BASE_URL}/get_devices`;
        const response = await requestWithRetry(() => gpswoxHttp.get(url, {
            params: {
                lang: 'en',
                user_api_hash: GPSWOX_CONFIG.API_HASH
            },
            timeout: 30000
        }), { label: 'GET /get_devices (getUserDevices)' });

        const groups = response.data;
        if (!Array.isArray(groups)) return [];

        // Aplanar todos los dispositivos
        const allDevices = [];
        for (const group of groups) {
            for (const device of (group.items || [])) {
                allDevices.push({
                    id: device.id,
                    name: device.name,
                    plate: device.name,
                    online: device.online,
                    group_title: group.title
                });
            }
        }

        console.log(`✅ Total dispositivos: ${allDevices.length}`);
        return allDevices;

    } catch (error) {
        console.error(`❌ Error obteniendo dispositivos: ${error.message}`);
        return [];
    }
}

/**
 * Invalida el caché de clientes (útil después de cambios)
 */
function invalidateClientsCache() {
    clientsCache = { data: null, timestamp: 0 };
    console.log(`🗑️ Cache de clientes invalidado`);
}

module.exports = {
    isValidEmail,
    formatPlate,
    isValidPlateFormat,
    findUserByEmail,
    findDeviceByPlate,
    assignDeviceToUser,
    getDeviceUserIds,
    getUserDevices,
    getAllClients,
    invalidateClientsCache,
    GPSWOX_CONFIG
};
