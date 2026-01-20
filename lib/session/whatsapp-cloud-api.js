/**
 * Módulo de WhatsApp Cloud API (Business)
 * Integración con Meta WhatsApp Business Platform
 * 
 * Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const axios = require('axios');
const config = require('../../config');

// Estadísticas de uso
let apiStats = {
    messagesSent: 0,
    messagesFailed: 0,
    lastUsed: null,
    hourlyCount: 0,
    hourlyReset: Date.now(),
    accountReady: true,  // Se pone en false si la cuenta no está lista
    accountError: null,  // Mensaje de error de la cuenta
    lastAccountCheck: null
};

// Errores que indican que la cuenta no está lista (no enviar más)
const ACCOUNT_NOT_READY_ERRORS = [
    133010,  // Account not registered
    131031,  // Account has been locked
    131042,  // Business account is not verified
    131045,  // Phone number not verified
    190,     // Token inválido
    100      // Parámetros inválidos (puede ser config incorrecta)
];

/**
 * Verifica si la API está configurada
 */
function isConfigured() {
    return !!(config.WHATSAPP_CLOUD_TOKEN && config.WHATSAPP_CLOUD_PHONE_ID);
}

/**
 * Verifica si la API está disponible para usar
 */
function isAvailable() {
    if (!isConfigured()) return false;
    
    // Si la cuenta no está lista (error de registro), no está disponible
    if (!apiStats.accountReady) {
        return false;
    }
    
    // Verificar límite por hora (1000 msgs/min es el límite de Meta, pero usamos menos)
    const now = Date.now();
    if (now - apiStats.hourlyReset > 3600000) {
        apiStats.hourlyCount = 0;
        apiStats.hourlyReset = now;
    }
    
    const maxPerHour = config.WHATSAPP_CLOUD_MAX_PER_HOUR || 500;
    return apiStats.hourlyCount < maxPerHour;
}

/**
 * Verifica si la cuenta está lista (registrada y verificada)
 */
function isAccountReady() {
    return apiStats.accountReady;
}

/**
 * Marca la cuenta como lista (para cuando se apruebe)
 */
function setAccountReady(ready, error = null) {
    apiStats.accountReady = ready;
    apiStats.accountError = error;
    apiStats.lastAccountCheck = new Date();
    
    if (ready) {
        console.log('[CLOUD API] ✅ Cuenta marcada como LISTA para enviar mensajes');
    } else {
        console.log(`[CLOUD API] ⚠️ Cuenta marcada como NO LISTA: ${error || 'Sin especificar'}`);
    }
}

/**
 * Formatea número de teléfono para la API (sin @s.whatsapp.net, solo números)
 */
function formatPhoneForApi(phone) {
    if (!phone) return null;
    // Remover cualquier formato de WhatsApp
    let cleaned = phone.replace(/@s\.whatsapp\.net/g, '').replace(/\D/g, '');
    // Asegurar código de país
    if (!cleaned.startsWith('57')) cleaned = '57' + cleaned;
    return cleaned;
}

/**
 * Envía mensaje de texto usando WhatsApp Cloud API
 */
async function sendTextMessage(phoneNumber, message) {
    if (!isConfigured()) {
        return { 
            success: false, 
            error: new Error('WhatsApp Cloud API no configurada. Configura WHATSAPP_CLOUD_TOKEN y WHATSAPP_CLOUD_PHONE_ID') 
        };
    }

    const formattedPhone = formatPhoneForApi(phoneNumber);
    if (!formattedPhone) {
        return { success: false, error: new Error('Número de teléfono inválido') };
    }

    const url = `https://graph.facebook.com/${config.WHATSAPP_CLOUD_API_VERSION || 'v18.0'}/${config.WHATSAPP_CLOUD_PHONE_ID}/messages`;

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'text',
        text: {
            preview_url: false,
            body: message
        }
    };

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${config.WHATSAPP_CLOUD_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (response.data && response.data.messages && response.data.messages[0]) {
            apiStats.messagesSent++;
            apiStats.hourlyCount++;
            apiStats.lastUsed = new Date();
            
            console.log(`✅ [CLOUD API] Mensaje enviado a ${formattedPhone} (ID: ${response.data.messages[0].id})`);
            
            return { 
                success: true, 
                messageId: response.data.messages[0].id,
                via: 'cloud-api'
            };
        }

        return { success: false, error: new Error('Respuesta inesperada de la API') };

    } catch (error) {
        apiStats.messagesFailed++;
        
        let errorMessage = error.message;
        let errorCode = null;
        
        if (error.response?.data?.error) {
            const apiError = error.response.data.error;
            errorCode = apiError.code;
            errorMessage = `${apiError.code}: ${apiError.message}`;
            
            // Verificar si es un error de cuenta no lista
            if (ACCOUNT_NOT_READY_ERRORS.includes(apiError.code)) {
                apiStats.accountReady = false;
                apiStats.accountError = errorMessage;
                apiStats.lastAccountCheck = new Date();
                console.error(`⚠️ [CLOUD API] Cuenta NO LISTA - Error ${apiError.code}: ${apiError.message}`);
                console.error(`⚠️ [CLOUD API] Se desactivará Cloud API hasta que la cuenta esté registrada`);
            }
            
            // Errores comunes (mensajes descriptivos)
            if (apiError.code === 131030) {
                errorMessage = 'Número no registrado en WhatsApp';
            } else if (apiError.code === 133010) {
                errorMessage = 'Cuenta Cloud API no registrada en WhatsApp';
            } else if (apiError.code === 131047) {
                errorMessage = 'Re-engagement requerido (24h sin respuesta)';
            } else if (apiError.code === 131026) {
                errorMessage = 'Mensaje no entregado (usuario bloqueó o no disponible)';
            } else if (apiError.code === 190) {
                errorMessage = 'Token de acceso inválido o expirado';
            }
        }

        console.error(`❌ [CLOUD API] Error enviando a ${formattedPhone}: ${errorMessage}`);
        
        return { 
            success: false, 
            error: new Error(errorMessage),
            via: 'cloud-api'
        };
    }
}

/**
 * Envía mensaje con plantilla (template) - útil para iniciar conversaciones
 * Las plantillas deben estar aprobadas por Meta
 */
async function sendTemplateMessage(phoneNumber, templateName, languageCode = 'es', components = []) {
    if (!isConfigured()) {
        return { success: false, error: new Error('WhatsApp Cloud API no configurada') };
    }

    const formattedPhone = formatPhoneForApi(phoneNumber);
    if (!formattedPhone) {
        return { success: false, error: new Error('Número de teléfono inválido') };
    }

    const url = `https://graph.facebook.com/${config.WHATSAPP_CLOUD_API_VERSION || 'v18.0'}/${config.WHATSAPP_CLOUD_PHONE_ID}/messages`;

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
            name: templateName,
            language: {
                code: languageCode
            },
            components: components
        }
    };

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${config.WHATSAPP_CLOUD_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (response.data?.messages?.[0]) {
            apiStats.messagesSent++;
            apiStats.hourlyCount++;
            apiStats.lastUsed = new Date();
            
            console.log(`✅ [CLOUD API] Template '${templateName}' enviado a ${formattedPhone}`);
            
            return { 
                success: true, 
                messageId: response.data.messages[0].id,
                via: 'cloud-api-template'
            };
        }

        return { success: false, error: new Error('Respuesta inesperada de la API') };

    } catch (error) {
        apiStats.messagesFailed++;
        console.error(`❌ [CLOUD API] Error enviando template a ${formattedPhone}: ${error.message}`);
        return { success: false, error, via: 'cloud-api-template' };
    }
}

/**
 * Obtiene estadísticas de uso de la API
 */
function getStats() {
    const now = Date.now();
    if (now - apiStats.hourlyReset > 3600000) {
        apiStats.hourlyCount = 0;
        apiStats.hourlyReset = now;
    }

    return {
        configured: isConfigured(),
        available: isAvailable(),
        accountReady: apiStats.accountReady,
        accountError: apiStats.accountError,
        lastAccountCheck: apiStats.lastAccountCheck,
        messagesSent: apiStats.messagesSent,
        messagesFailed: apiStats.messagesFailed,
        lastUsed: apiStats.lastUsed,
        hourlyCount: apiStats.hourlyCount,
        hourlyLimit: config.WHATSAPP_CLOUD_MAX_PER_HOUR || 500,
        hourlyRemaining: (config.WHATSAPP_CLOUD_MAX_PER_HOUR || 500) - apiStats.hourlyCount
    };
}

/**
 * Resetea las estadísticas
 */
function resetStats() {
    apiStats = {
        messagesSent: 0,
        messagesFailed: 0,
        lastUsed: null,
        hourlyCount: 0,
        hourlyReset: Date.now(),
        accountReady: true,
        accountError: null,
        lastAccountCheck: null
    };
}

module.exports = {
    isConfigured,
    isAvailable,
    isAccountReady,
    setAccountReady,
    sendTextMessage,
    sendTemplateMessage,
    getStats,
    resetStats,
    formatPhoneForApi
};
