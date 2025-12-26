// Utilidades compartidas

/**
 * Formatea un número de teléfono para WhatsApp
 * @param {string} phoneNumber - Número de teléfono
 * @returns {string|null} - Número formateado o null si es inválido
 */
function formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    const cleaned = phoneNumber.toString().replace(/[^\d]/g, '');
    if (cleaned.length < 10 || cleaned.length > 15) return null;
    return phoneNumber.endsWith('@c.us') ? phoneNumber : `${cleaned}@c.us`;
}

/**
 * Espera un tiempo determinado
 * @param {number} ms - Milisegundos a esperar
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determina el tipo de archivo según su MIME type
 * @param {string} mimetype - MIME type del archivo
 * @returns {string} - Tipo de archivo (imagen, video, audio, documento)
 */
function getFileType(mimetype) {
    if (mimetype.startsWith('image/')) return 'imagen';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'documento';
}

/**
 * Capitaliza la primera letra de una cadena
 * @param {string} str - Cadena a capitalizar
 * @returns {string} - Cadena capitalizada
 */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Obtiene la fecha actual formateada para Colombia
 * @returns {string} - Fecha formateada
 */
function getColombiaDate() {
    return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}

module.exports = {
    formatPhoneNumber,
    sleep,
    getFileType,
    capitalize,
    getColombiaDate
};
