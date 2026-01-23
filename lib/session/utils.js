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

module.exports = {
    sleep,
    formatPhoneNumber,
    randomDelay,
    getColombiaTimestamp
};
