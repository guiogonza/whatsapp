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
    // Quien tiene nombre de usuario de WhatsApp puede llegar SIN telefono: Meta omite message.from / wa_id y manda un
    // identificador propio (BSUID, ej. "CO.1349...") en from_user_id y contacts[].user_id. Ese identificador sirve para
    // responder (campo `recipient`, ver whatsapp-cloud-api.destinatario) y para reconocer a la persona.
    const remitenteId = message.from || message.from_user_id || message.user_id || null;
    const contact = contacts?.find(c => (c.wa_id && c.wa_id === message.from) || (c.user_id && c.user_id === remitenteId))
        || (contacts && contacts.length === 1 ? contacts[0] : null) || {};
    const remitente = remitenteId || contact.user_id || contact.wa_id || null;
    if (!message.from) {
        // Solo nombres de campos (nunca valores): sirve para confirmar el formato real que manda Meta
        console.log(`[WEBHOOK] ℹ️ Mensaje sin teléfono (usuario con nombre de usuario). Campos del mensaje: ${Object.keys(message).join(',')} | del contacto: ${Object.keys(contact).join(',')} | identificador resuelto: ${remitente ? 'sí' : 'NO'}`);
    }
    if (!remitente) {
        console.error('[WEBHOOK] ❌ Mensaje sin teléfono ni identificador de usuario: no hay a quién responder');
        return;
    }
    
    const messageData = {
        id: message.id,
        from: remitente,
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
        // Respuesta a botón/lista interactiva
        interactive: message.interactive || null,
        // Mensaje original para debug
        raw: message
    };

    console.log(`[WEBHOOK] 📩 Mensaje de ${messageData.fromName} (${messageData.from}): ${messageData.text || `[${messageData.type}]`}`);

    // COINTRA: la respuesta del conductor (4 ultimos del manifiesto) a la plantilla
    // "conductor_confirma_salida" llega a ESTE numero (Cloud API) y se reenvia a monitoreo
    // (torre.apptu.net). Mismo contrato que forwardToCointra (core.js, sesiones Baileys):
    // textos de <=200 caracteres con >=4 digitos y X-Internal-Secret. Si monitoreo reconoce
    // al remitente (resultado != 'ignorado') el mensaje se da por atendido; si no, sigue su
    // camino normal (TURNO, etc.). Un fallo aqui nunca debe frenar el resto.
    try {
        const urlCointra = process.env.COINTRA_WEBHOOK_URL;
        const secretoCointra = process.env.COINTRA_WEBHOOK_SECRET;
        const texto = messageData.text || '';
        if (urlCointra && secretoCointra && messageData.type === 'text'
            && texto.length <= 200 && /\d{4}/.test(texto)) {
            const axios = require('axios');
            const r = await axios.post(
                urlCointra,
                { phoneNumber: messageData.from, message: texto, sessionName: 'cloud-api' },
                { timeout: 8000, headers: { 'X-Internal-Secret': secretoCointra } }
            );
            if (r.data && r.data.resultado && r.data.resultado !== 'ignorado') return;
        }
    } catch (e) {
        console.error(`[WEBHOOK] ❌ reenvio a COINTRA: ${e.message}`);
    }

    // COINTRA: fotos y audios del conductor. COINTRA los cuenta (tope de 5 por dia y por
    // conductor), lee la foto con DeepSeek y contesta con plantilla. Aqui se baja la FOTO de
    // Meta (COINTRA no guarda credenciales de Meta) y se le manda en base64; del audio solo
    // se avisa que llego (no se procesa, no hace falta bajarlo). Mismo secreto y mismo
    // criterio que el texto: si COINTRA conoce al remitente se da por atendido.
    try {
        const urlCointra = process.env.COINTRA_WEBHOOK_URL;
        const secretoCointra = process.env.COINTRA_WEBHOOK_SECRET;
        if (urlCointra && secretoCointra && (messageData.type === 'image' || messageData.type === 'audio')
            && messageData.mediaId) {
            const axios = require('axios');
            const cuerpo = {
                phoneNumber: messageData.from,
                type: messageData.type,
                mimeType: messageData.mimeType,
                sessionName: 'cloud-api'
            };
            if (messageData.type === 'image') {
                const cabeceras = { Authorization: `Bearer ${config.WHATSAPP_CLOUD_TOKEN}` };
                const version = config.WHATSAPP_CLOUD_API_VERSION || 'v18.0';
                const meta = await axios.get(`https://graph.facebook.com/${version}/${messageData.mediaId}`,
                    { headers: cabeceras, timeout: 15000 });
                const archivo = await axios.get(meta.data.url,
                    { headers: cabeceras, responseType: 'arraybuffer', timeout: 30000, maxContentLength: 8 * 1024 * 1024 });
                cuerpo.mimeType = meta.data.mime_type || cuerpo.mimeType || 'image/jpeg';
                cuerpo.contentBase64 = Buffer.from(archivo.data).toString('base64');
            }
            const r = await axios.post(urlCointra.replace(/\/incoming$/, '/incoming-media'), cuerpo, {
                timeout: 20000, maxBodyLength: Infinity,
                headers: { 'X-Internal-Secret': secretoCointra }
            });
            if (r.data && r.data.resultado && r.data.resultado !== 'ignorado') return;
        }
    } catch (e) {
        console.error(`[WEBHOOK] ❌ reenvio de medio a COINTRA: ${e.message}`);
    }

    // 🚚 "TURNO"/"TURNOS": responde con el botón (cta_url) de la app de turnos de
    // descargue. Va AQUÍ (no en core.js/Baileys) porque los conductores le escriben
    // a este número de la Cloud API -- el mismo que turnos_co usa para mandar la
    // plantilla aprobada "turno_descargue" -- no al número de la sesión Baileys de
    // GPSwox/HESEGO/RASTREAR, que es otra sesión completamente aparte.
    try {
        const textoUpper = (messageData.text || '').trim().toUpperCase();
        if (config.TURNOS_TRIGGER_KEYWORDS.includes(textoUpper)) {
            console.log(`[WEBHOOK] 🚚 "${textoUpper}" detectado de ${messageData.from}`);
            const cloudApi = require('./whatsapp-cloud-api');
            const resultado = await cloudApi.sendInteractiveMessage(messageData.from, {
                type: 'cta_url',
                body: { text: '🚚 *Turnos de descargue*\n\nToca el botón para registrar tu turno.' },
                action: {
                    name: 'cta_url',
                    parameters: { display_text: 'Registrar turno', url: config.TURNOS_URL }
                }
            });
            if (!resultado.success) {
                console.error(`[WEBHOOK] ❌ No se pudo enviar el botón de TURNOS, usando texto plano: ${resultado.error?.message}`);
                await cloudApi.sendTextMessage(messageData.from,
                    `🚚 *Turnos de descargue*\n\nIngresa a este enlace para registrar tu turno:\n${config.TURNOS_URL}`);
            }
        }
    } catch (error) {
        console.error('[WEBHOOK] Error respondiendo TURNOS:', error.message);
    }

    // 📦 "PUERTO": lista las transportadoras de Turnos, el usuario responde con el número y
    // recibe el enlace único para fotografiar el manifiesto y los 4 precintos (puerto-flow.js).
    // Si el mensaje era de este flujo no se le pasa al bot de encuesta (un "1" no es una respuesta suya).
    let puertoManejado = false;
    try {
        if (config.PUERTO_BOT_SECRET && messageData.type === 'text') {
            puertoManejado = await require('./puerto-flow').manejar(messageData.from, messageData.text);
        }
    } catch (error) {
        console.error('[WEBHOOK] Error en el flujo PUERTO:', error.message);
    }

    if (!puertoManejado) {
        try {
            const encuestaBot = require('./encuesta-bot/flow');
            const manejado = await encuestaBot.procesarMensajeEntrante(messageData.from, message);
            if (manejado) {
                console.log(`[WEBHOOK] 🩺 Mensaje de ${messageData.from} atendido por el bot de encuesta psicosocial`);
            }
        } catch (error) {
            console.error('[WEBHOOK] Error en bot de encuesta psicosocial:', error.message);
        }
    }

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

    if (statusData.status === 'failed' && statusData.errorCode) {
        console.error(`[WEBHOOK] ❌ Error código: ${statusData.errorCode} - ${statusData.errorMessage}`);
    }

    // Los estados delivered/read no se persisten (tabla messages solo acepta sent/error/queued/received)
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
        // Normalizar campos para que el frontend los encuentre
        return (result.rows || []).map(row => ({
            ...row,
            message_body: row.text_content || row.message_body || null,
            body: row.text_content || row.body || null,
            from: row.from_number,
            fromName: row.from_name,
            type: row.message_type,
        }));
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
    getReceivedMessagesFromDB,
    getVerifyToken,
    WEBHOOK_VERIFY_TOKEN
};
