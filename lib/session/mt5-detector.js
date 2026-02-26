/**
 * Detector y procesador de mensajes MT5
 * Detecta alertas de MetaTrader5 y las reenvía por sesiones FX
 */

const fxSession = require('./fx-session');

/**
 * Detecta si un mensaje es una alerta de MT5
 * @param {string} text - Texto del mensaje
 * @returns {boolean}
 */
function isMT5Alert(text) {
    if (!text || typeof text !== 'string') return false;
    
    const keywords = [
        'ticket',
        'alerta mt5',
        'simbolo:',
        'apertura:',
        'profit:',
        'balance:',
        'stop loss',
        'take profit'
    ];
    
    const lowerText = text.toLowerCase();
    return keywords.some(keyword => lowerText.includes(keyword));
}

/**
 * Extrae información de una alerta MT5
 * @param {string} text - Texto del mensaje
 * @returns {Object|null}
 */
function parseMT5Alert(text) {
    try {
        const data = {};
        
        // Extraer tipo de alerta
        if (text.includes('CRITICO')) {
            data.alertLevel = 'CRITICAL';
        } else if (text.includes('ADVERTENCIA')) {
            data.alertLevel = 'WARNING';
        } else {
            data.alertLevel = 'INFO';
        }
        
        // Extraer Ticket
        const ticketMatch = text.match(/Ticket:\s*#?(\d+)/i);
        if (ticketMatch) {
            data.ticket = ticketMatch[1];
        }
        
        // Extraer Símbolo y tipo de operación
        const symbolMatch = text.match(/Simbolo:\s*([A-Z]+)\s*\|\s*(BUY|SELL)\s*([\d.]+)\s*lot/i);
        if (symbolMatch) {
            data.symbol = symbolMatch[1];
            data.type = symbolMatch[2];
            data.lots = parseFloat(symbolMatch[3]);
        }
        
        // Extraer Apertura
        const openMatch = text.match(/Apertura:\s*([\d.]+)/i);
        if (openMatch) {
            data.openPrice = parseFloat(openMatch[1]);
        }
        
        // Extraer Precio Actual
        const currentMatch = text.match(/Actual:\s*([\d.]+)/i);
        if (currentMatch) {
            data.currentPrice = parseFloat(currentMatch[1]);
        }
        
        // Extraer Stop Loss
        if (text.includes('SL: NO CONFIGURADO')) {
            data.stopLoss = null;
        } else {
            const slMatch = text.match(/SL:\s*([\d.]+)/i);
            if (slMatch) {
                data.stopLoss = parseFloat(slMatch[1]);
            }
        }
        
        // Extraer Take Profit
        if (text.includes('TP: NO CONFIGURADO')) {
            data.takeProfit = null;
        } else {
            const tpMatch = text.match(/TP:\s*([\d.]+)/i);
            if (tpMatch) {
                data.takeProfit = parseFloat(tpMatch[1]);
            }
        }
        
        // Extraer Profit
        const profitMatch = text.match(/Profit:\s*\$?([-\d.]+)\s*\(([-\d.]+)%\)/i);
        if (profitMatch) {
            data.profit = parseFloat(profitMatch[1]);
            data.profitPercent = parseFloat(profitMatch[2]);
        }
        
        // Extraer Balance
        const balanceMatch = text.match(/Balance:\s*\$?([\d.]+)/i);
        if (balanceMatch) {
            data.balance = parseFloat(balanceMatch[1]);
        }
        
        // Extraer Recomendación
        const recomMatch = text.match(/Recomendacion:\s*(.+?)(?:\n|$)/i);
        if (recomMatch) {
            data.recommendation = recomMatch[1].trim();
        }
        
        // Extraer Fecha
        const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/);
        if (dateMatch) {
            data.timestamp = dateMatch[1];
        }
        
        return data;
    } catch (error) {
        console.error('Error parseando alerta MT5:', error.message);
        return null;
    }
}

/**
 * Extrae el número destino de un mensaje FX
 * Formatos soportados:
 * - "Para: +5549999999999"
 * - "Enviar a: 5549999999999"
 * - "To: +55 49 99999-9999"
 * - Primer número de teléfono encontrado
 * @param {string} text - Texto del mensaje
 * @returns {Object|null} {targetPhone, content} o null si no se encuentra
 */
function extractTargetPhone(text) {
    if (!text || typeof text !== 'string') return null;
    
    // Buscar patrones comunes de "Para:", "Enviar a:", "To:", etc.
    const patterns = [
        /(?:para|enviar\s*a|to|destino)\s*:?\s*([+]?[0-9\s-]+)/i,
        /(?:^|\n)([+]?[0-9]{10,15})/m // Número al inicio de línea
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            // Limpiar el número (quitar espacios, guiones, etc.)
            const rawNumber = match[1].replace(/[\s-]/g, '');
            
            // Validar que tenga al menos 10 dígitos
            if (rawNumber.length >= 10) {
                // Formatear para WhatsApp
                const cleanNumber = rawNumber.replace(/^[+]/, '');
                const targetPhone = `${cleanNumber}@s.whatsapp.net`;
                
                // Remover la línea del número del contenido
                const content = text.replace(match[0], '').trim();
                
                return { targetPhone, content, rawNumber: cleanNumber };
            }
        }
    }
    
    return null;
}

/**
 * Formatea una alerta MT5 para envío por WhatsApp
 * @param {Object} data - Datos extraídos de la alerta
 * @param {string} originalText - Texto original del mensaje
 * @returns {string}
 */
function formatMT5Alert(data, originalText) {
    // Si no se pudo parsear, devolver el texto original
    if (!data || !data.ticket) {
        return originalText;
    }
    
    const emoji = data.alertLevel === 'CRITICAL' ? '🚨' : 
                  data.alertLevel === 'WARNING' ? '⚠️' : 'ℹ️';
    
    const typeEmoji = data.type === 'BUY' ? '📈' : '📉';
    
    let message = `${emoji} *ALERTA MT5 - ${data.alertLevel}*\n\n`;
    message += `*Ticket:* #${data.ticket}\n`;
    
    if (data.symbol) {
        message += `${typeEmoji} *${data.symbol}* | ${data.type} ${data.lots} lot\n`;
    }
    
    if (data.openPrice !== undefined && data.currentPrice !== undefined) {
        message += `*Apertura:* ${data.openPrice} | *Actual:* ${data.currentPrice}\n`;
    }
    
    const slText = data.stopLoss ? data.stopLoss.toString() : 'NO CONFIGURADO';
    const tpText = data.takeProfit ? data.takeProfit.toString() : 'NO CONFIGURADO';
    message += `*SL:* ${slText} | *TP:* ${tpText}\n`;
    
    if (data.profit !== undefined && data.profitPercent !== undefined) {
        const profitSign = data.profit >= 0 ? '+' : '';
        const profitEmoji = data.profit >= 0 ? '💰' : '📛';
        message += `${profitEmoji} *Profit:* ${profitSign}$${data.profit.toFixed(2)} (${profitSign}${data.profitPercent.toFixed(2)}%)\n`;
    }
    
    if (data.balance !== undefined) {
        message += `💵 *Balance:* $${data.balance.toFixed(2)}\n`;
    }
    
    if (data.recommendation) {
        message += `\n💡 *Recomendación:* ${data.recommendation}\n`;
    }
    
    if (data.timestamp) {
        message += `\n⏰ ${data.timestamp}`;
    }
    
    return message;
}

/**
 * Procesa y reenvía una alerta MT5/FX al número destino especificado
 * El mensaje debe contener el número destino en formato:
 * "Para: +5549999999999" o "Enviar a: 5549999999999"
 * @param {string} senderPhone - Número del remitente
 * @param {string} messageText - Texto del mensaje
 * @param {Function} sendMessageFunction - Función para enviar mensajes
 * @param {string} fxSessionName - Nombre de la sesión FX (para BD)
 * @returns {Promise<boolean>}
 */
async function processMT5Alert(senderPhone, messageText, sendMessageFunction, fxSessionName = 'fx-session-unknown') {
    try {
        console.log('📊 Detectada alerta MT5/FX, procesando...');
        const database = require('../database-postgres');
        
        // 1. EXTRAER NÚMERO DESTINO del mensaje
        const targetInfo = extractTargetPhone(messageText);
        
        if (!targetInfo) {
            console.log('⚠️ No se encontró número destino en el mensaje');
            console.log('💡 Formato esperado: "Para: +5549999999999" o "Enviar a: 5549999999999"');
            return false;
        }
        
        console.log(`🎯 Número destino extraído: ${targetInfo.rawNumber}`);
        
        // 2. DETERMINAR CONTENIDO A ENVIAR
        let contentToSend = targetInfo.content;
        
        // Si el contenido tiene información de ticket, formatearlo
        const alertData = parseMT5Alert(contentToSend);
        if (alertData && alertData.ticket) {
            contentToSend = formatMT5Alert(alertData, contentToSend);
            console.log('✨ Mensaje formateado con emojis y estructura MT5');
        } else {
            // Enviar contenido tal cual (sin formateo)
            console.log('📄 Enviando mensaje sin formateo especial');
        }
        
        // Extraer solo número del senderPhone (remover @s.whatsapp.net)
        const sourceNumber = senderPhone ? senderPhone.replace('@s.whatsapp.net', '').replace('@c.us', '').split(':')[0] : null;
        
        // 3. ENVIAR AL NÚMERO DESTINO
        let sendSuccess = false;
        let sendError = null;
        
        try {
            await sendMessageFunction(targetInfo.targetPhone, contentToSend);
            console.log(`✅ Mensaje FX enviado exitosamente a ${targetInfo.rawNumber}`);
            sendSuccess = true;
        } catch (error) {
            console.error(`❌ Error enviando a ${targetInfo.rawNumber}:`, error.message);
            sendError = error.message;
            sendSuccess = false;
        }
        
        // 4. GUARDAR EN BASE DE DATOS
        try {
            await database.query(`
                INSERT INTO fx_messages (fx_session, source_phone, target_phone, message, status, timestamp)
                VALUES ($1, $2, $3, $4, $5, NOW())
            `, [
                fxSessionName,
                sourceNumber,
                targetInfo.rawNumber,
                contentToSend,
                sendSuccess ? 'FORWARDED' : 'ERROR'
            ]);
            console.log(`💾 Mensaje FX guardado en BD (sesión: ${fxSessionName})`);
        } catch (dbError) {
            console.error('❌ Error guardando mensaje FX en BD:', dbError.message);
            // No fallar si hay error de BD, el mensaje ya se envió
        }
        
        return sendSuccess;
        
    } catch (error) {
        console.error('❌ Error procesando mensaje FX:', error.message);
        return false;
    }
}

module.exports = {
    isMT5Alert,
    parseMT5Alert,
    formatMT5Alert,
    processMT5Alert,
    extractTargetPhone
};
