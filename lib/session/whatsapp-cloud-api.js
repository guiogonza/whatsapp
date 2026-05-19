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

// Límite mensual de conversaciones Cloud API
const MONTHLY_CONVERSATION_LIMIT = 2000;
let monthlyLimitOverride = false; // true = ignorar el límite y seguir enviando
let monthlyConversationsCache = { count: 0, lastCheck: 0 };

// Errores que indican que la cuenta no está lista (no enviar más)
const ACCOUNT_NOT_READY_ERRORS = [
    133010,  // Account not registered
    131031,  // Account has been locked
    131042,  // Business account is not verified
    131045,  // Phone number not verified
    190      // Token inválido
    // OJO: el código 100 suele indicar número o payload inválido y NO debe bloquear toda la Cloud API
];

const ALERT_TEMPLATE_REGEX = /^\s*🚨\s*Alerta de\s+([^\r\n]+?)\s*-\s*GPS\s*(?:\r?\n\s*){2,}🚗\s*Veh[ií]culo:\s*([^\r\n]+?)\s*(?:\r?\n\s*)+⚠️?\s*Evento:\s*([^\r\n]+?)\s*(?:\r?\n\s*)+📍\s*Ubicaci[oó]n:\s*([^\r\n]+?)\s*(?:\r?\n\s*)+🕐\s*Hora:\s*([^\r\n]+?)\s*hrs\s*$/u;
const FLAT_ALERT_REGEX = /^\s*(.+?)\s+Veh[ií]culo:\s*(.+?)\s+Evento:\s*(.+?)\s+Ubicaci[oó]n:\s*(.+?)\s+(?:Hora|Time):\s*(.+?)(?:\s*hrs)?\s*$/iu;
// Formato nativo GPSwox con asteriscos: "hola EMPRESA te informa una alerta en su vehiculo *PLACA* ha presentado *EVENTO*"
const GPSWOX_STARS_REGEX = /^hola\s+(.+?)\s+te\s+informa\s+una\s+alerta\s+en\s+su\s+veh[ií]culo\s+\*([^*\n]+)\*\s+ha\s+presentado\s+\*([^*\n]+)\*/iu;
// Formato nativo GPSwox sin asteriscos: "hola EMPRESA te informa una alerta en su vehiculo PLACA ha presentado EVENTO [Fecha: ...]"
const GPSWOX_PLAIN_REGEX = /^hola\s+(.+?)\s+te\s+informa\s+una\s+alerta\s+en\s+su\s+veh[ií]culo\s+([A-Za-z0-9][A-Za-z0-9\s-]{0,14}?)\s+ha\s+presentado\s+(.+?)(?:\s+(?:Fecha|Hora|Time|Ubicaci[oó]n|Link)[:\s]|\s*$)/iu;

function normalizeAlertValue(value, fallback = 'N/A') {
    const normalized = (value || '').toString().trim().replace(/\s+/g, ' ');
    return normalized || fallback;
}

function extractCompanyName(prefix) {
    const rawPrefix = (prefix || '').toString().trim().replace(/\s+/g, ' ');
    if (!rawPrefix) return 'Rastreamos';

    const decoratedMatch = rawPrefix.match(/^(?:🚨\s*)?Alerta\s+de\s+(.+?)\s*-\s*GPS$/iu);
    if (decoratedMatch) {
        return normalizeAlertValue(decoratedMatch[1], 'Rastreamos');
    }

    const cleaned = rawPrefix
        .replace(/\s*-\s*GPS$/iu, '')
        .replace(/^(?:🚨\s*)?Alerta\s+de\s+/iu, '');

    return normalizeAlertValue(cleaned, 'Rastreamos');
}

function formatAlertMessage(alertData) {
    if (!alertData) return '';

    const empresa = normalizeAlertValue(alertData.empresa, 'Rastreamos');
    const vehiculo = normalizeAlertValue(alertData.vehiculo, 'N/A');
    const evento = normalizeAlertValue(alertData.evento, 'Alerta');
    const ubicacion = normalizeAlertValue(alertData.ubicacion, 'N/A');
    const hora = normalizeAlertValue(alertData.hora, 'N/A');

    return [
        `🚨 Alerta de ${empresa} - GPS`,
        '',
        `🚗 Vehículo: ${vehiculo}`,
        `⚠️ Evento: ${evento}`,
        `📍 Ubicación: ${ubicacion}`,
        `🕐 Hora: ${hora} hrs`
    ].join('\n');
}

/**
 * Verifica si la API está configurada
 */
function isConfigured() {
    return !!(config.WHATSAPP_CLOUD_TOKEN && config.WHATSAPP_CLOUD_PHONE_ID);
}

/**
 * Actualiza el cache de conversaciones mensuales desde la BD
 */
async function updateMonthlyConversationsCache() {
    try {
        const db = require('../../database-postgres');
        const result = await db.query(`
            SELECT COUNT(DISTINCT phone_number || DATE(timestamp)::text) as conversations
            FROM messages 
            WHERE session = 'cloud-api' AND status = 'sent' 
            AND timestamp >= DATE_TRUNC('month', CURRENT_DATE)
        `);
        monthlyConversationsCache.count = parseInt(result.rows[0]?.conversations || 0);
        monthlyConversationsCache.lastCheck = Date.now();
    } catch (err) {
        console.error('[CLOUD API] Error consultando conversaciones mensuales:', err.message);
    }
}

/**
 * Verifica si se alcanzó el límite mensual de conversaciones
 */
function isMonthlyLimitReached() {
    if (monthlyLimitOverride) return false;
    return monthlyConversationsCache.count >= MONTHLY_CONVERSATION_LIMIT;
}

/**
 * Establece si se ignora el límite mensual (botón "Continuar enviando")
 */
function setMonthlyLimitOverride(override) {
    monthlyLimitOverride = !!override;
    if (override) {
        console.log(`[CLOUD API] ✅ Límite mensual de ${MONTHLY_CONVERSATION_LIMIT} conversaciones IGNORADO por el usuario`);
    } else {
        console.log(`[CLOUD API] 🛑 Límite mensual de ${MONTHLY_CONVERSATION_LIMIT} conversaciones RE-ACTIVADO`);
    }
}

/**
 * Obtiene info del límite mensual
 */
function getMonthlyLimitInfo() {
    return {
        limit: MONTHLY_CONVERSATION_LIMIT,
        current: monthlyConversationsCache.count,
        limitReached: isMonthlyLimitReached(),
        override: monthlyLimitOverride,
        lastCheck: monthlyConversationsCache.lastCheck ? new Date(monthlyConversationsCache.lastCheck) : null
    };
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

    let cleaned = phone
        .toString()
        .trim()
        .replace(/@(s\.whatsapp\.net|c\.us)$/i, '')
        .replace(/\D/g, '');

    if (!cleaned) return null;

    if (cleaned.startsWith('0') && cleaned.length === 11) {
        cleaned = `57${cleaned.substring(1)}`;
    } else if (cleaned.length === 10) {
        cleaned = `57${cleaned}`;
    }

    if (cleaned.length < 10 || cleaned.length > 15) {
        return null;
    }

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
            } else if (apiError.code === 100) {
                errorMessage = 'Número de destino o payload inválido';
                console.warn(`⚠️ [CLOUD API] Parámetro inválido para ${formattedPhone}. Se descarta solo este envío.`);
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
        console.log(`📤 [CLOUD API] Enviando template '${templateName}' (${languageCode}) a ${formattedPhone}`);
        console.log(`📤 [CLOUD API] Payload: ${JSON.stringify(payload.template)}`);
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
        const metaError = error.response?.data?.error;
        if (metaError) {
            console.error(`❌ [CLOUD API] Error enviando template a ${formattedPhone}: ${metaError.message} (code: ${metaError.code}, subcode: ${metaError.error_subcode})`);
            console.error(`   Detalle: ${JSON.stringify(metaError)}`);
        } else {
            console.error(`❌ [CLOUD API] Error enviando template a ${formattedPhone}: ${error.message}`);
        }
        return { success: false, error, via: 'cloud-api-template' };
    }
}

/**
 * Parsea un mensaje de alerta GPS y extrae las variables.
 * Solo acepta la estructura exacta de la plantilla alerta_vehiculo.
 *
 * 🚨 Alerta de {empresa} - GPS
 * 🚗 Vehículo: {vehiculo}
 * ⚠️ Evento: {evento}
 * 📍 Ubicación: {ubicacion}
 * 🕐 Hora: {hora} hrs
 */
function parseAlertMessage(message) {
    if (!message) return null;

    const rawMessage = message.toString().trim();

    const decoratedMatch = rawMessage.match(ALERT_TEMPLATE_REGEX);
    if (decoratedMatch) {
        return {
            empresa: normalizeAlertValue(decoratedMatch[1], 'Rastreamos'),
            vehiculo: normalizeAlertValue(decoratedMatch[2]),
            evento: normalizeAlertValue(decoratedMatch[3], 'Alerta'),
            ubicacion: normalizeAlertValue(decoratedMatch[4]),
            hora: normalizeAlertValue(decoratedMatch[5])
        };
    }

    const flattenedMessage = rawMessage
        .replace(/\r/g, '\n')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const flatMatch = flattenedMessage.match(FLAT_ALERT_REGEX);
    if (flatMatch) {
        return {
            empresa: extractCompanyName(flatMatch[1]),
            vehiculo: normalizeAlertValue(flatMatch[2]),
            evento: normalizeAlertValue(flatMatch[3], 'Alerta'),
            ubicacion: normalizeAlertValue(flatMatch[4]),
            hora: normalizeAlertValue(flatMatch[5])
        };
    }

    // Formato nativo GPSwox con asteriscos: "hola EMPRESA te informa ... *PLACA* ha presentado *EVENTO*"
    const gpswoxStarsMatch = flattenedMessage.match(GPSWOX_STARS_REGEX);
    if (gpswoxStarsMatch) {
        const horaMatch = flattenedMessage.match(/(?:[Ff]echa|[Hh]ora|[Tt]ime)[:\s]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s+\d{2}:\d{2}(?::\d{2})?)/);
        const ubicMatch = flattenedMessage.match(/(?:Ubicaci[oó]n|[Ll]ocation|[Dd]irecci[oó]n)[:\s]+([^\s]+)/i)
            || flattenedMessage.match(/(https?:\/\/(?:maps\.google|goo\.gl|waze)\S+)/i);
        return {
            empresa: normalizeAlertValue(gpswoxStarsMatch[1], 'Rastreamos'),
            vehiculo: normalizeAlertValue(gpswoxStarsMatch[2]),
            evento: normalizeAlertValue(gpswoxStarsMatch[3], 'Alerta'),
            ubicacion: normalizeAlertValue(ubicMatch ? ubicMatch[1] : null, 'Ver GPS'),
            hora: normalizeAlertValue(horaMatch ? horaMatch[1] : null, 'Ver app')
        };
    }

    // Formato nativo GPSwox sin asteriscos: "hola EMPRESA te informa ... PLACA ha presentado EVENTO [Fecha: ...]"
    const gpswoxPlainMatch = flattenedMessage.match(GPSWOX_PLAIN_REGEX);
    if (gpswoxPlainMatch) {
        const horaMatch = flattenedMessage.match(/(?:[Ff]echa|[Hh]ora|[Tt]ime)[:\s]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s+\d{2}:\d{2}(?::\d{2})?)/);
        const ubicMatch = flattenedMessage.match(/(?:Ubicaci[oó]n|[Ll]ocation|[Dd]irecci[oó]n)[:\s]+([^\s]+)/i)
            || flattenedMessage.match(/(https?:\/\/(?:maps\.google|goo\.gl|waze)\S+)/i);
        return {
            empresa: normalizeAlertValue(gpswoxPlainMatch[1], 'Rastreamos'),
            vehiculo: normalizeAlertValue(gpswoxPlainMatch[2]),
            evento: normalizeAlertValue(gpswoxPlainMatch[3], 'Alerta'),
            ubicacion: normalizeAlertValue(ubicMatch ? ubicMatch[1] : null, 'Ver GPS'),
            hora: normalizeAlertValue(horaMatch ? horaMatch[1] : null, 'Ver app')
        };
    }

    return null;
}

/**
 * Envía alerta usando la plantilla alerta_vehiculo
 * Template: alerta_vehiculo (es_CO)
 * Variables: empresa, vehiculo, evento, ubicacion, hora
 */
async function sendAlertTemplate(phoneNumber, alertData) {
    if (!alertData) {
        return { success: false, error: new Error('Datos de alerta inválidos') };
    }
    
    // Construir componentes para la plantilla
    // Template usa parámetros con NOMBRE ({{empresa}}, {{vehiculo}}, etc.)
    // Requiere parameter_name en cada parámetro
    const safeText = (val, fallback) => (val || '').trim() || fallback;
    const components = [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: safeText(alertData.empresa, 'Rastreamos'), parameter_name: 'empresa' },
                { type: 'text', text: safeText(alertData.vehiculo, 'N/A'), parameter_name: 'vehiculo' },
                { type: 'text', text: safeText(alertData.evento, 'Alerta'), parameter_name: 'evento' },
                { type: 'text', text: safeText(alertData.ubicacion, 'N/A'), parameter_name: 'ubicacion' },
                { type: 'text', text: safeText(alertData.hora, 'N/A'), parameter_name: 'hora' }
            ]
        }
    ];
    
    console.log(`📋 [CLOUD API] Template params: empresa=${components[0].parameters[0].text}, vehiculo=${components[0].parameters[1].text}, evento=${components[0].parameters[2].text}`);
    
    return sendTemplateMessage(phoneNumber, 'alerta_vehiculo', 'es_CO', components);
}

/**
 * Envía mensaje inteligente: si es alerta GPS usa template, sino texto libre
 * NOTA: Para cuentas de utilidad solo se pueden enviar templates
 */
async function sendMessage(phoneNumber, message) {
    // Intentar parsear como alerta GPS
    const alertData = parseAlertMessage(message);
    
    if (alertData) {
        console.log(`📋 [CLOUD API] Mensaje es alerta GPS, usando template alerta_vehiculo`);
        console.log(`   Empresa: ${alertData.empresa}, Vehículo: ${alertData.vehiculo}`);
        return sendAlertTemplate(phoneNumber, alertData);
    }
    
    // Si no es alerta, enviar como texto (para respuestas, etc)
    // NOTA: Esto puede fallar si la cuenta es solo de utilidad y no hay ventana 24h
    console.log(`💬 [CLOUD API] Mensaje no es alerta, enviando como texto libre`);
    return sendTextMessage(phoneNumber, message);
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
    sendAlertTemplate,
    sendMessage,        // Función inteligente que decide template vs texto
    parseAlertMessage,  // Para testing/debugging
    formatAlertMessage,
    getStats,
    resetStats,
    formatPhoneForApi,
    updateMonthlyConversationsCache,
    isMonthlyLimitReached,
    setMonthlyLimitOverride,
    getMonthlyLimitInfo,
    MONTHLY_CONVERSATION_LIMIT
};
