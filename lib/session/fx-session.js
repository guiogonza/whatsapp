/**
 * Módulo de Sesión Especial FX (MetaTrader5)
 * Gestiona sesiones dedicadas exclusivas para notificaciones de trading
 * 
 * Características:
 * - Sesiones dedicadas solo para notificaciones MT5
 * - No participan en rotación de mensajes normales
 * - Alta prioridad y baja latencia
 * - Soporta múltiples cuentas de trading
 */

const config = require('../../config');
const database = require('../../database-postgres');
const { formatNotification, validateWebhookSecret, NOTIFICATION_TYPES } = require('./fx-api');

// Nombres de sesiones FX dedicadas (configurables via .env)
const FX_SESSION_NAMES = (process.env.FX_SESSION_NAMES || 'fx-session-1,fx-session-2')
    .split(',')
    .map(s => s.trim())
    .filter(s => s);

// Modo dedicado: Si es true, las sesiones FX SOLO envían notificaciones FX
const FX_DEDICATED_MODE = process.env.FX_DEDICATED_MODE !== 'false'; // true por defecto

// Almacén de suscriptores: { accountNumber: [phoneNumber1, phoneNumber2] }
const subscribers = new Map();

// Almacén de preferencias de usuario: { phoneNumber: { accounts: [], types: [] } }
const userPreferences = new Map();

// Historial de notificaciones enviadas (últimas 100)
const notificationHistory = [];
const MAX_HISTORY = 100;

// Estadísticas de envío
const stats = {
    totalSent: 0,
    byType: {},
    byAccount: {},
    errors: 0,
    lastNotification: null
};

/**
 * Inicializa estadísticas para tipos de notificación
 */
Object.values(NOTIFICATION_TYPES).forEach(type => {
    stats.byType[type] = 0;
});

/**
 * Verifica si una sesión es una sesión FX
 * @param {string} sessionName - Nombre de la sesión
 * @returns {boolean}
 */
function isFXSession(sessionName) {
    return FX_SESSION_NAMES.includes(sessionName);
}

/**
 * Obtiene el nombre de la sesión FX por defecto
 * @returns {string}
 */
function getFXSessionName() {
    return FX_SESSION_NAMES[0] || 'fx-session-1';
}

/**
 * Obtiene todos los nombres de sesiones FX
 * @returns {Array<string>}
 */
function getFXSessionNames() {
    return [...FX_SESSION_NAMES];
}

/**
 * Verifica si el modo dedicado está activo
 * @returns {boolean}
 */
function isFXDedicatedMode() {
    return FX_DEDICATED_MODE;
}

/**
 * Suscribe un número de teléfono a una cuenta de trading
 * @param {string} phoneNumber - Número de WhatsApp
 * @param {string|number} accountNumber - Número de cuenta MT5
 * @param {Array<string>} notificationTypes - Tipos de notificaciones (opcional)
 */
function subscribe(phoneNumber, accountNumber, notificationTypes = null) {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const accountStr = String(accountNumber);

    // Agregar a suscriptores por cuenta
    if (!subscribers.has(accountStr)) {
        subscribers.set(accountStr, []);
    }
    
    const accountSubscribers = subscribers.get(accountStr);
    if (!accountSubscribers.includes(cleanPhone)) {
        accountSubscribers.push(cleanPhone);
        console.log(`📊 Usuario ${cleanPhone} suscrito a cuenta FX ${accountStr}`);
    }

    // Actualizar preferencias del usuario
    if (!userPreferences.has(cleanPhone)) {
        userPreferences.set(cleanPhone, {
            accounts: [],
            types: notificationTypes || Object.values(NOTIFICATION_TYPES)
        });
    }

    const prefs = userPreferences.get(cleanPhone);
    if (!prefs.accounts.includes(accountStr)) {
        prefs.accounts.push(accountStr);
    }

    // Si se especifican tipos, actualizar
    if (notificationTypes) {
        prefs.types = notificationTypes;
    }

    return { success: true, message: 'Suscripción exitosa' };
}

/**
 * Desuscribe un número de teléfono de una cuenta
 * @param {string} phoneNumber - Número de WhatsApp
 * @param {string|number} accountNumber - Número de cuenta MT5
 */
function unsubscribe(phoneNumber, accountNumber) {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const accountStr = String(accountNumber);

    // Remover de suscriptores por cuenta
    if (subscribers.has(accountStr)) {
        const accountSubscribers = subscribers.get(accountStr);
        const index = accountSubscribers.indexOf(cleanPhone);
        if (index > -1) {
            accountSubscribers.splice(index, 1);
            console.log(`📊 Usuario ${cleanPhone} desuscrito de cuenta FX ${accountStr}`);
        }
    }

    // Actualizar preferencias del usuario
    if (userPreferences.has(cleanPhone)) {
        const prefs = userPreferences.get(cleanPhone);
        const accountIndex = prefs.accounts.indexOf(accountStr);
        if (accountIndex > -1) {
            prefs.accounts.splice(accountIndex, 1);
        }
        
        // Si no tiene más cuentas, eliminar preferencias
        if (prefs.accounts.length === 0) {
            userPreferences.delete(cleanPhone);
        }
    }

    return { success: true, message: 'Desuscripción exitosa' };
}

/**
 * Obtiene suscriptores de una cuenta
 * @param {string|number} accountNumber - Número de cuenta MT5
 * @returns {Array<string>}
 */
function getSubscribers(accountNumber) {
    const accountStr = String(accountNumber);
    return subscribers.get(accountStr) || [];
}

/**
 * Obtiene las preferencias de un usuario
 * @param {string} phoneNumber - Número de WhatsApp
 * @returns {Object|null}
 */
function getUserPreferences(phoneNumber) {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    return userPreferences.get(cleanPhone) || null;
}

/**
 * Verifica si un usuario debe recibir un tipo de notificación
 * @param {string} phoneNumber - Número de WhatsApp
 * @param {string} notificationType - Tipo de notificación
 * @returns {boolean}
 */
function shouldReceiveNotification(phoneNumber, notificationType) {
    const prefs = getUserPreferences(phoneNumber);
    if (!prefs) return false;
    return prefs.types.includes(notificationType);
}

/**
 * Procesa una notificación FX y la envía a los suscriptores
 * @param {Object} notification - Datos de la notificación
 * @param {Function} sendMessageFunction - Función para enviar mensajes
 * @returns {Promise<Object>}
 */
async function processNotification(notification, sendMessageFunction) {
    try {
        const {
            type = NOTIFICATION_TYPES.CUSTOM,
            accountNumber = null,
            webhookSecret = '',
            data = {}
        } = notification;

        // Validar webhook secret
        if (!validateWebhookSecret(webhookSecret)) {
            console.error('❌ FX: Webhook secret inválido');
            stats.errors++;
            return { success: false, error: 'Webhook secret inválido' };
        }

        // Formatear el mensaje
        const message = formatNotification(type, data);

        // Obtener destinatarios
        let recipients = [];
        
        if (accountNumber) {
            // Enviar solo a suscriptores de la cuenta específica
            recipients = getSubscribers(accountNumber).filter(phone => 
                shouldReceiveNotification(phone, type)
            );
        } else {
            // Enviar a todos los usuarios suscritos a cualquier cuenta
            const allPhones = new Set();
            userPreferences.forEach((prefs, phone) => {
                if (prefs.types.includes(type)) {
                    allPhones.add(phone);
                }
            });
            recipients = Array.from(allPhones);
        }

        if (recipients.length === 0) {
            console.log(`⚠️ FX: No hay destinatarios para notificación tipo ${type}`);
            return { success: true, message: 'Sin destinatarios', sent: 0 };
        }

        // Enviar a todos los destinatarios
        const results = [];
        for (const phone of recipients) {
            try {
                const result = await sendMessageFunction(phone, message);
                results.push({ phone, success: result.success });
                
                if (result.success) {
                    console.log(`✅ FX: Notificación enviada a ${phone}`);
                }
            } catch (error) {
                console.error(`❌ FX: Error enviando a ${phone}:`, error.message);
                results.push({ phone, success: false, error: error.message });
                stats.errors++;
            }
        }

        // Actualizar estadísticas
        const successCount = results.filter(r => r.success).length;
        stats.totalSent += successCount;
        stats.byType[type] = (stats.byType[type] || 0) + successCount;
        
        if (accountNumber) {
            const accountStr = String(accountNumber);
            stats.byAccount[accountStr] = (stats.byAccount[accountStr] || 0) + successCount;
        }
        
        stats.lastNotification = new Date();

        // Agregar al historial
        notificationHistory.unshift({
            type,
            accountNumber,
            message,
            recipients: recipients.length,
            sent: successCount,
            timestamp: new Date()
        });

        // Limitar historial
        if (notificationHistory.length > MAX_HISTORY) {
            notificationHistory.pop();
        }

        // Guardar en base de datos
        try {
            await database.logFXNotification({
                type,
                accountNumber,
                message,
                recipients: recipients.length,
                sent: successCount,
                timestamp: new Date()
            });
        } catch (dbError) {
            console.error('Error guardando en BD:', dbError.message);
        }

        return {
            success: true,
            message: 'Notificación procesada',
            sent: successCount,
            failed: results.length - successCount,
            results
        };

    } catch (error) {
        console.error('❌ FX: Error procesando notificación:', error.message);
        stats.errors++;
        return { success: false, error: error.message };
    }
}

/**
 * Obtiene estadísticas de notificaciones FX
 * @returns {Object}
 */
function getStats() {
    return {
        ...stats,
        totalSubscribers: userPreferences.size,
        totalAccounts: subscribers.size,
        accountDetails: Array.from(subscribers.entries()).map(([account, subs]) => ({
            account,
            subscribers: subs.length
        }))
    };
}

/**
 * Obtiene el historial de notificaciones
 * @param {number} limit - Límite de resultados
 * @returns {Array}
 */
function getHistory(limit = 50) {
    return notificationHistory.slice(0, Math.min(limit, notificationHistory.length));
}

/**
 * Lista todos los suscriptores con sus preferencias
 * @returns {Array}
 */
function listAllSubscribers() {
    const result = [];
    
    userPreferences.forEach((prefs, phone) => {
        result.push({
            phoneNumber: phone,
            accounts: prefs.accounts,
            notificationTypes: prefs.types
        });
    });
    
    return result;
}

/**
 * Limpia todos los suscriptores (solo para testing/mantenimiento)
 */
function clearAllSubscribers() {
    subscribers.clear();
    userPreferences.clear();
    console.log('🧹 Todos los suscriptores FX han sido eliminados');
}

module.exports = {
    // Identificación de sesiones
    isFXSession,
    getFXSessionName,
    getFXSessionNames,
    isFXDedicatedMode,
    
    // Gestión de suscripciones
    subscribe,
    unsubscribe,
    getSubscribers,
    getUserPreferences,
    shouldReceiveNotification,
    listAllSubscribers,
    clearAllSubscribers,
    
    // Procesamiento de notificaciones
    processNotification,
    
    // Estadísticas e historial
    getStats,
    getHistory,
    
    // Constantes
    FX_SESSION_NAMES,
    FX_DEDICATED_MODE,
    NOTIFICATION_TYPES
};
