/**
 * Comandos interactivos FX/MT5
 * Responde a comandos como "fx", "posiciones", "balance", o cualquier pregunta
 * libre ("fx oro", "fx cuanto gane hoy", "fx cual fue mi peor operacion") enviados
 * por WhatsApp.
 *
 * Todo el trabajo real lo hace el proyecto hermano del dashboard de trading
 * (C:\Documentos\Fx\app.py, contenedor mt5-dashboard-fxpro) via su endpoint
 * POST /webhook/incoming -- mismo patron que el webhook de hesego-operatividad.
 * Ahi un LLM (DeepSeek, tool-calling sobre trading_tools.py) redacta la
 * respuesta leyendo SIEMPRE datos reales (posiciones, operaciones cerradas,
 * precios de mercado en vivo); nunca inventa cifras porque solo puede llamar
 * funciones de solo lectura, no generar SQL ni calcular a ciegas.
 */

const axios = require('axios');
const config = require('../../config');

// Palabras clave que disparan el comando FX (el unico requisito: empezar con
// una de estas; todo lo que sigue es libre, lo interpreta el asistente).
const FX_COMMAND_TRIGGERS = [
    'fx', '/fx', '!fx',
    'posiciones', 'mis posiciones',
    'balance', 'mi balance',
    'estado', 'mi estado',
    'trading', 'mt5'
];

/**
 * Detecta si un mensaje es un comando FX
 * @param {string} text - Texto del mensaje
 * @returns {boolean}
 */
function isFXCommand(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();
    return FX_COMMAND_TRIGGERS.some(trigger => lower === trigger || lower.startsWith(trigger + ' '));
}

/**
 * Reenvia la pregunta al asistente de trading (Fx/DeepSeek) en modo sincrono:
 * el gateway espera la respuesta ya redactada y la manda por la misma
 * conversacion. Si el asistente no responde a tiempo, devuelve un mensaje
 * claro en vez de dejar al usuario sin nada.
 * @param {string} senderPhone - Numero del remitente (con o sin @s.whatsapp.net)
 * @param {string} messageText - Pregunta completa tal como la escribio el usuario
 * @returns {Promise<string>} Texto de respuesta, listo para enviar por WhatsApp
 */
async function preguntarAsistenteFX(senderPhone, messageText) {
    const baseUrl = config.FX_ASSISTANT_URL || 'http://mt5-dashboard-fxpro:8080';
    const response = await axios.post(`${baseUrl}/webhook/incoming`, {
        phoneNumber: senderPhone,
        message: messageText,
        sessionName: 'fx-assistant',
        sincrono: true
    }, {
        timeout: 28000,
        headers: config.FX_ASSISTANT_SHARED_SECRET
            ? { 'X-Internal-Secret': config.FX_ASSISTANT_SHARED_SECRET }
            : {}
    });

    if (response.data?.ignorado) {
        // El numero que pregunta no es el dueño autorizado de la cuenta de
        // trading (ver whatsapp_autorizados.txt en el dashboard) -- no hay
        // nada que responder aqui, pero tampoco es un error.
        return null;
    }
    return response.data?.respuesta || 'No pude obtener una respuesta del asistente de trading. Intenta de nuevo en un momento.';
}

/**
 * Procesa un comando FX y responde al usuario
 * @param {string} senderPhone - Teléfono del remitente (con @s.whatsapp.net)
 * @param {string} messageText - Texto del comando
 * @param {Function} sendFn - Función para enviar respuesta (socket.sendMessage o similar)
 * @param {string} remoteJid - JID del chat donde responder
 * @returns {Promise<boolean>} true si se procesó el comando
 */
async function handleFXCommand(senderPhone, messageText, sendFn, remoteJid) {
    if (!isFXCommand(messageText)) return false;

    console.log(`💬 Comando FX detectado de ${senderPhone}: "${messageText}"`);

    try {
        const respuesta = await preguntarAsistenteFX(senderPhone, messageText);
        if (respuesta === null) {
            console.log(`📭 ${senderPhone} no es el numero autorizado para el asistente FX, ignorado`);
            return true;
        }
        await sendFn(remoteJid, { text: respuesta });
        console.log(`✅ Respuesta del asistente FX enviada a ${senderPhone}`);
        return true;
    } catch (error) {
        console.error(`❌ Error consultando al asistente FX:`, error.message);
        await sendFn(remoteJid, { text: '❌ No pude consultar el asistente de trading ahora mismo. Intenta de nuevo en un momento.' });
        return true;
    }
}

module.exports = {
    isFXCommand,
    handleFXCommand
};
