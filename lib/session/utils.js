/**
 * Utilidades comunes para el módulo de sesiones
 * Centraliza funciones auxiliares usadas en múltiples módulos
 */

/**
 * Promesa de espera
 * @param {number} ms - Milisegundos a esperar
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Formatea un número de teléfono al formato de WhatsApp
 * @param {string} phone - Número de teléfono
 * @returns {string} Número formateado (ej: 573001234567@s.whatsapp.net)
 */
const formatPhoneNumber = (phone) => {
    if (!phone) return null;
    let cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '57' + cleaned.substring(1);
    }
    if (!cleaned.includes('@')) {
        cleaned = cleaned + '@s.whatsapp.net';
    }
    return cleaned;
};

/**
 * Genera un delay aleatorio entre min y max
 * @param {number} min - Mínimo en milisegundos
 * @param {number} max - Máximo en milisegundos
 * @returns {number}
 */
const randomDelay = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Obtiene timestamp en zona horaria de Colombia
 * @returns {string}
 */
const getColombiaTimestamp = () => {
    return new Date().toLocaleString('sv-SE', { 
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).replace(' ', 'T');
};

/**
 * Obtiene el país desde una dirección IP usando API gratuita
 * @param {string} ip - Dirección IP
 * @returns {Promise<string>} País o 'Desconocido'
 */
const getCountryFromIP = async (ip) => {
    if (!ip || ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('192.168.')) {
        return 'Local';
    }
    
    try {
        const axios = require('axios');
        const response = await axios.get(`http://ip-api.com/json/${ip}?fields=country,countryCode`, {
            timeout: 3000
        });
        
        if (response.data && response.data.country) {
            return `${response.data.country} (${response.data.countryCode})`;
        }
        
        return 'Desconocido';
    } catch (error) {
        console.log(`⚠️ Error obteniendo país para IP ${ip}:`, error.message);
        return 'Desconocido';
    }
};

/**
 * Extrae la IP de conexión desde el socket de WhatsApp
 * @param {Object} socket - Socket de WhatsApp (Baileys)
 * @returns {string} IP o null
 */
const getSocketIP = (socket) => {
    try {
        if (socket && socket.ws) {
            // Intentar obtener IP del WebSocket
            const ws = socket.ws;
            if (ws._socket) {
                return ws._socket.remoteAddress;
            }
            // Alternativa: desde el objeto de conexión
            if (ws.socket && ws.socket.remoteAddress) {
                return ws.socket.remoteAddress;
            }
        }
        return null;
    } catch (error) {
        return null;
    }
};

module.exports = {
    sleep,
    formatPhoneNumber,
    randomDelay,
    getColombiaTimestamp,
    getCountryFromIP,
    getSocketIP
};
