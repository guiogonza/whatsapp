/**
 * Módulo de Webhook para WhatsApp Cloud API
 * Recibe mensajes entrantes, estados de entrega y notificaciones
 */

const config = require('../../config');
const database = require('../../database-postgres');

// Token de verificación para el webhook (configurable en .env)
const WEBHOOK_VERIFY_TOKEN = config.WEBHOOK_VERIFY_TOKEN || 'rastrear_webhook_2026';

// Almacén temporal de mensajes recibidos (también se guardan en BD)
const receivedMessages = [];
const MAX_MESSAGES_BUFFER = 100;

// Callbacks para eventos
let onMessageReceived = null;
let onStatusUpdate = null;

/**
 * Configura callback para mensajes recibidos
 */
function setOnMessageReceived(callback) {
    onMessageReceived = callback;
}

/**
 * Configura callback para actualizaciones de estado
 */
function setOnStatusUpdate(callback) {
    onStatusUpdate = callback;
}

/**
 * Verificación del webhook (GET request de Meta)
 * Meta envía esto para verificar que el webhook es válido
 */
function verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[WEBHOOK] Verificación recibida:', { mode, token: token?.substring(0, 10) + '...' });

    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        console.log('[WEBHOOK] ✅ Verificación exitosa');
        res.status(200).send(challenge);
    } else {
        console.log('[WEBHOOK] ❌ Verificación fallida');
        res.status(403).send('Forbidden');
    }
}

/**
 * Procesa notificaciones del webhook (POST request de Meta)
 */
async function handleWebhook(req, res) {
    try {
        const body = req.body;

        // Verificar que es un mensaje de WhatsApp
        if (body.object !== 'whatsapp_business_account') {
            console.log('[WEBHOOK] Objeto no reconocido:', body.object);
            return res.sendStatus(404);
        }

        // Responder inmediatamente a Meta (requerido en < 20 segundos)
        res.sendStatus(200);

        // Procesar cada entrada
        for (const entry of body.entry || []) {
            for (const change of entry.changes || []) {
                if (change.field === 'messages') {
                    await processMessagesChange(change.value, entry.id);
                }
            }
        }

    } catch (error) {
        console.error('[WEBHOOK] Error procesando webhook:', error.message);
        res.sendStatus(500);
    }
}

/**
 * Procesa cambios de mensajes
 */
async function processMessagesChange(value, businessAccountId) {
    const metadata = value.metadata || {};
    const phoneNumberId = metadata.phone_number_id;
    const displayPhone = metadata.display_phone_number;

    // Procesar mensajes entrantes
    if (value.messages) {
        for (const message of value.messages) {
            await processIncomingMessage(message, value.contacts, phoneNumberId, displayPhone);
        }
    }

    // Procesar estados de mensajes (enviado, entregado, leído)
    if (value.statuses) {
        for (const status of value.statuses) {
            await processStatusUpdate(status, phoneNumberId);
        }
    }
}

/**
 * Procesa un mensaje entrante
 */
async function processIncomingMessage(message, contacts, phoneNumberId, displayPhone) {
    const contact = contacts?.find(c => c.wa_id === message.from) || {};
    
    const messageData = {
        id: message.id,
        from: message.from,
        fromName: contact.profile?.name || 'Desconocido',
        timestamp: new Date(parseInt(message.timestamp) * 1000),
        type: message.type,
        phoneNumberId,
        displayPhone,
        // Contenido según el tipo
        text: message.text?.body || null,
        caption: message.image?.caption || message.video?.caption || message.document?.caption || null,
        mediaId: message.image?.id || message.video?.id || message.audio?.id || message.document?.id || null,
        mimeType: message.image?.mime_type || message.video?.mime_type || message.audio?.mime_type || message.document?.mime_type || null,
        // Para ubicación
        latitude: message.location?.latitude || null,
        longitude: message.location?.longitude || null,
        // Para contactos
        contacts: message.contacts || null,
        // Mensaje original para debug
        raw: message
    };

    console.log(`[WEBHOOK] 📩 Mensaje de ${messageData.fromName} (${messageData.from}): ${messageData.text || `[${messageData.type}]`}`);

    // Guardar en buffer temporal
    receivedMessages.unshift(messageData);
    if (receivedMessages.length > MAX_MESSAGES_BUFFER) {
        receivedMessages.pop();
    }

    // Guardar en base de datos
    try {
        await database.query(`
            INSERT INTO webhook_messages (
                message_id, from_number, from_name, message_type, 
                text_content, media_id, timestamp, phone_number_id, raw_data
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            messageData.id,
            messageData.from,
            messageData.fromName,
            messageData.type,
            messageData.text || messageData.caption,
            messageData.mediaId,
            messageData.timestamp,
            phoneNumberId,
            JSON.stringify(message)
        ]);
    } catch (error) {
        // La tabla puede no existir aún
        console.log('[WEBHOOK] Error guardando mensaje (tabla puede no existir):', error.message);
    }

    // Ejecutar callback si está configurado
    if (onMessageReceived) {
        try {
            await onMessageReceived(messageData);
        } catch (error) {
            console.error('[WEBHOOK] Error en callback de mensaje:', error.message);
        }
    }
}

/**
 * Procesa actualización de estado de mensaje
 */
async function processStatusUpdate(status, phoneNumberId) {
    const statusData = {
        messageId: status.id,
        recipientId: status.recipient_id,
        status: status.status, // sent, delivered, read, failed
        timestamp: new Date(parseInt(status.timestamp) * 1000),
        phoneNumberId,
        // Error info si falló
        errorCode: status.errors?.[0]?.code || null,
        errorMessage: status.errors?.[0]?.message || null
    };

    const emoji = {
        'sent': '📤',
        'delivered': '✅',
        'read': '👁️',
        'failed': '❌'
    }[statusData.status] || '📋';

    console.log(`[WEBHOOK] ${emoji} Estado: ${statusData.status} para ${statusData.recipientId}`);

    // Actualizar en base de datos
    try {
        await database.query(`
            UPDATE message_logs 
            SET delivery_status = $1, 
                delivery_timestamp = $2,
                error_message = $3
            WHERE message_id = $4 OR (phone_number LIKE $5 AND created_at > NOW() - INTERVAL '1 day')
        `, [
            statusData.status,
            statusData.timestamp,
            statusData.errorMessage,
            statusData.messageId,
            '%' + statusData.recipientId + '%'
        ]);
    } catch (error) {
        console.log('[WEBHOOK] Error actualizando estado:', error.message);
    }

    // Ejecutar callback si está configurado
    if (onStatusUpdate) {
        try {
            await onStatusUpdate(statusData);
        } catch (error) {
            console.error('[WEBHOOK] Error en callback de estado:', error.message);
        }
    }
}

/**
 * Obtiene los mensajes recibidos recientes
 */
function getReceivedMessages(limit = 50) {
    return receivedMessages.slice(0, limit);
}

/**
 * Obtiene mensajes recibidos de la base de datos
 */
async function getReceivedMessagesFromDB(limit = 50) {
    try {
        const result = await database.query(`
            SELECT * FROM webhook_messages 
            ORDER BY timestamp DESC 
            LIMIT $1
        `, [limit]);
        return result.rows || [];
    } catch (error) {
        console.log('[WEBHOOK] Error obteniendo mensajes de BD:', error.message);
        return receivedMessages.slice(0, limit);
    }
}

/**
 * Obtiene el token de verificación actual
 */
function getVerifyToken() {
    return WEBHOOK_VERIFY_TOKEN;
}

module.exports = {
    verifyWebhook,
    handleWebhook,
    getReceivedMessages,
    getReceivedMessagesFromDB,
    getVerifyToken,
    setOnMessageReceived,
    setOnStatusUpdate,
    WEBHOOK_VERIFY_TOKEN
};
