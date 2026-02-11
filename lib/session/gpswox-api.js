/**
 * Módulo para interactuar con la API de GPSwox
 * Documentación: https://gpswox.stoplight.io/
 * Servidor: https://plataforma.sistemagps.online/
 */

const axios = require('axios');

const GPSWOX_CONFIG = {
    BASE_URL: 'https://plataforma.sistemagps.online/api',
    API_HASH: '$2y$10$q8oTWg/6WPee2w8oE3ebCOVEFK60Zlsb6d0nyqU1Vxx3GgMhm/xzG'
};

/**
 * Cliente HTTP configurado para GPSwox
 */
const gpswoxClient = axios.create({
    baseURL: GPSWOX_CONFIG.BASE_URL,
    headers: {
        'Authorization': `Bearer ${GPSWOX_CONFIG.API_HASH}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    },
    timeout: 15000
});

/**
 * Valida si un correo electrónico tiene formato válido
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Busca un usuario por correo electrónico en GPSwox
 * @param {string} email - Correo electrónico del usuario
 * @returns {Promise<Object>} Usuario encontrado o null
 */
async function findUserByEmail(email) {
    try {
        console.log(`🔍 Buscando usuario con email: ${email}`);
        
        // Endpoint común en APIs GPS: /users?email=xxx o /users/search
        const response = await gpswoxClient.get('/users', {
            params: { email: email }
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
            const user = response.data.data[0];
            console.log(`✅ Usuario encontrado: ${user.email} (ID: ${user.id})`);
            return user;
        }

        // Intento alternativo si el primer endpoint no funciona
        try {
            const altResponse = await gpswoxClient.get(`/users/search`, {
                params: { email: email }
            });
            
            if (altResponse.data && altResponse.data.user) {
                console.log(`✅ Usuario encontrado (endpoint alternativo)`);
                return altResponse.data.user;
            }
        } catch (altError) {
            // Ignorar error del endpoint alternativo
        }

        console.log(`❌ Usuario no encontrado con email: ${email}`);
        return null;

    } catch (error) {
        console.error(`❌ Error buscando usuario: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}, Data:`, error.response.data);
        }
        throw new Error(`Error al buscar usuario: ${error.message}`);
    }
}

/**
 * Formatea una placa agregando guion después de 3 caracteres
 * Ejemplos: ABC123 -> ABC-123, ABC-123 -> ABC-123
 */
function formatPlate(plate) {
    // Eliminar espacios y convertir a mayúsculas
    let cleanPlate = plate.trim().toUpperCase().replace(/\s+/g, '');
    
    // Si ya tiene guion, verificar formato correcto
    if (cleanPlate.includes('-')) {
        const parts = cleanPlate.split('-');
        if (parts.length === 2 && parts[0].length === 3) {
            return cleanPlate; // Ya tiene formato correcto
        }
        // Si tiene guion pero mal colocado, quitarlo y reformatear
        cleanPlate = cleanPlate.replace('-', '');
    }
    
    // Agregar guion después de los primeros 3 caracteres
    if (cleanPlate.length > 3) {
        return `${cleanPlate.substring(0, 3)}-${cleanPlate.substring(3)}`;
    }
    
    return cleanPlate;
}

/**
 * Valida si una placa tiene el formato correcto (XXX-XXX)
 */
function isValidPlateFormat(plate) {
    // Formato esperado: 3 caracteres, guion, resto de caracteres
    const plateRegex = /^[A-Z0-9]{3}-[A-Z0-9]+$/;
    return plateRegex.test(plate);
}

/**
 * Busca un dispositivo (vehículo) por placa en GPSwox
 * @param {string} plate - Placa del vehículo (formato: ABC-123)
 * @returns {Promise<Object>} Dispositivo encontrado o null
 */
async function findDeviceByPlate(plate) {
    try {
        console.log(`🔍 Buscando dispositivo con placa: ${plate}`);
        
        // Endpoint común: /devices o /objects
        const response = await gpswoxClient.get('/devices', {
            params: { 
                plate: plate,
                // Algunos sistemas usan 'name' o 'imei' también
            }
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
            // Buscar el dispositivo que coincida con la placa
            const device = response.data.data.find(d => 
                d.plate === plate || 
                d.name === plate ||
                (d.plate && d.plate.toUpperCase() === plate.toUpperCase())
            );
            
            if (device) {
                console.log(`✅ Dispositivo encontrado: ${device.plate || device.name} (ID: ${device.id})`);
                return device;
            }
        }

        // Intento alternativo - obtener todos y filtrar
        try {
            const allDevicesResponse = await gpswoxClient.get('/devices');
            if (allDevicesResponse.data && allDevicesResponse.data.data) {
                const device = allDevicesResponse.data.data.find(d => 
                    (d.plate && d.plate.toUpperCase() === plate.toUpperCase()) ||
                    (d.name && d.name.toUpperCase() === plate.toUpperCase())
                );
                
                if (device) {
                    console.log(`✅ Dispositivo encontrado (búsqueda completa)`);
                    return device;
                }
            }
        } catch (altError) {
            // Ignorar error del endpoint alternativo
        }

        console.log(`❌ Dispositivo no encontrado con placa: ${plate}`);
        return null;

    } catch (error) {
        console.error(`❌ Error buscando dispositivo: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}, Data:`, error.response.data);
        }
        throw new Error(`Error al buscar dispositivo: ${error.message}`);
    }
}

/**
 * Asigna un dispositivo a un usuario en GPSwox
 * @param {number} userId - ID del usuario
 * @param {number} deviceId - ID del dispositivo
 * @returns {Promise<Object>} Resultado de la asignación
 */
async function assignDeviceToUser(userId, deviceId) {
    try {
        console.log(`🔗 Asignando dispositivo ${deviceId} al usuario ${userId}`);
        
        // Endpoints comunes para asignación:
        // POST /users/{userId}/devices
        // POST /devices/{deviceId}/assign
        // PUT /devices/{deviceId}
        
        const response = await gpswoxClient.post(`/users/${userId}/devices`, {
            device_id: deviceId
        });

        if (response.data && response.data.success) {
            console.log(`✅ Dispositivo asignado exitosamente`);
            return {
                success: true,
                data: response.data
            };
        }

        // Intento alternativo
        try {
            const altResponse = await gpswoxClient.put(`/devices/${deviceId}`, {
                user_id: userId
            });
            
            if (altResponse.data) {
                console.log(`✅ Dispositivo asignado (endpoint alternativo)`);
                return {
                    success: true,
                    data: altResponse.data
                };
            }
        } catch (altError) {
            // Ignorar
        }

        return {
            success: false,
            error: 'No se pudo asignar el dispositivo'
        };

    } catch (error) {
        console.error(`❌ Error asignando dispositivo: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}, Data:`, error.response.data);
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Obtiene los dispositivos asignados a un usuario
 * @param {number} userId - ID del usuario
 * @returns {Promise<Array>} Lista de dispositivos del usuario
 */
async function getUserDevices(userId) {
    try {
        console.log(`📋 Obteniendo dispositivos del usuario ${userId}`);
        
        const response = await gpswoxClient.get(`/users/${userId}/devices`);

        if (response.data && response.data.data) {
            console.log(`✅ Encontrados ${response.data.data.length} dispositivos`);
            return response.data.data;
        }

        return [];

    } catch (error) {
        console.error(`❌ Error obteniendo dispositivos del usuario: ${error.message}`);
        return [];
    }
}

module.exports = {
    isValidEmail,
    formatPlate,
    isValidPlateFormat,
    findUserByEmail,
    findDeviceByPlate,
    assignDeviceToUser,
    getUserDevices,
    GPSWOX_CONFIG
};
