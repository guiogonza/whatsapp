/**
 * Comandos interactivos FX/MT5
 * Responde a comandos como "fx", "posiciones", "balance" enviados por WhatsApp
 */

const database = require('../../database-postgres');

// Palabras clave que disparan el comando FX
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
 * Obtiene el resumen de posiciones y actividad reciente
 * @param {string} phoneNumber - Número que consulta (para filtrar sus datos)
 * @returns {Promise<string>} Mensaje formateado con el resumen
 */
async function getPositionsSummary(phoneNumber) {
    try {
        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        
        // 1. Consultar POSICIONES ABIERTAS (tabla fx_positions - datos desde MT5)
        const openPositions = await database.query(
            `SELECT * FROM fx_positions 
             WHERE is_open = TRUE 
             ORDER BY open_time DESC`
        );

        // 2. Consultar últimos mensajes FX reenviados a este número
        const fxMessages = await database.query(
            `SELECT message, timestamp, status FROM fx_messages 
             WHERE target_phone LIKE $1 
             ORDER BY timestamp DESC LIMIT 5`,
            [`%${cleanPhone}%`]
        );

        // 3. Consultar últimas notificaciones webhook
        const fxNotifications = await database.query(
            `SELECT type, message, timestamp FROM fx_notifications 
             ORDER BY timestamp DESC LIMIT 3`
        );

        // Construir respuesta
        const now = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
        let response = `📊 *RESUMEN DE TRADING*\n⏰ ${now}\n\n`;

        // --- POSICIONES EN VIVO (desde MT5) ---
        if (openPositions.rows.length > 0) {
            const posData = openPositions.rows;
            
            // Totales
            const totalProfit = posData.reduce((s, p) => s + parseFloat(p.profit || 0), 0);
            const profitSign = totalProfit >= 0 ? '+' : '';
            const profitEmoji = totalProfit >= 0 ? '🟢' : '🔴';
            
            response += `${profitEmoji} *P/L Total: ${profitSign}$${totalProfit.toFixed(2)}*\n`;
            response += `📈 ${posData.length} posiciones abiertas\n\n`;

            for (const pos of posData) {
                const emoji = pos.type === 'BUY' ? '📈' : '📉';
                const pEmoji = parseFloat(pos.profit) >= 0 ? '🟢' : '🔴';
                const pSign = parseFloat(pos.profit) >= 0 ? '+' : '';
                
                response += `${emoji} *#${pos.ticket}* ${pos.symbol} ${pos.type} ${pos.lots} lot\n`;
                response += `   Apertura: ${pos.open_price}`;
                if (pos.current_price) response += ` | Actual: ${pos.current_price}`;
                response += `\n`;
                if (pos.stop_loss) response += `   SL: ${pos.stop_loss}`;
                if (pos.take_profit) response += ` | TP: ${pos.take_profit}`;
                response += `\n`;
                response += `   ${pEmoji} P/L: ${pSign}$${parseFloat(pos.profit).toFixed(2)} (${pSign}${parseFloat(pos.profit_pct).toFixed(2)}%)\n\n`;
            }
        } else {
            // --- SIN POSICIONES EN VIVO: mostrar historial reciente ---
            
            // Extraer balance
            let balance = null;
            for (const row of fxMessages.rows) {
                const bMatch = (row.message || '').match(/Balance:\s*\$?([\d,.]+)/i);
                if (bMatch) { balance = bMatch[1]; break; }
            }
            if (balance) {
                response += `💵 *Balance:* $${balance}\n\n`;
            }

            // Posiciones desde historial de mensajes
            const positions = [];
            const seenTickets = new Set();
            
            for (const row of fxMessages.rows) {
                const msg = row.message || '';
                const ticketMatch = msg.match(/Ticket:\s*#?(\d+)/i);
                const symbolMatch = msg.match(/\*([A-Z]+)\*\s*\|\s*(BUY|SELL)\s*([\d.]+)\s*lot/i);
                const profitMatch = msg.match(/Profit:\s*\$?([-\d.]+)\s*\(([-\d.]+)%\)/i);
                const openMatch = msg.match(/Apertura:\s*([\d.]+)/i);
                const currentMatch = msg.match(/Actual:\s*([\d.]+)/i);
                
                if (ticketMatch && symbolMatch && !seenTickets.has(ticketMatch[1])) {
                    seenTickets.add(ticketMatch[1]);
                    const openP = openMatch ? parseFloat(openMatch[1]) : null;
                    const curP = currentMatch ? parseFloat(currentMatch[1]) : null;
                    positions.push({
                        ticket: ticketMatch[1],
                        symbol: symbolMatch[1],
                        type: symbolMatch[2],
                        lots: symbolMatch[3],
                        profit: profitMatch ? profitMatch[1] : '?',
                        profitPct: profitMatch ? profitMatch[2] : '?',
                        openPrice: openP,
                        currentPrice: curP
                    });
                }
            }

            if (positions.length > 0) {
                response += `📈 *Últimas posiciones (${positions.length}):*\n\n`;
                for (const pos of positions) {
                    const emoji = pos.type === 'BUY' ? '📈' : '📉';
                    const pEmoji = parseFloat(pos.profit) >= 0 ? '🟢' : '🔴';
                    const pSign = parseFloat(pos.profit) >= 0 ? '+' : '';
                    response += `${emoji} *#${pos.ticket}* ${pos.symbol} ${pos.type} ${pos.lots} lot\n`;
                    if (pos.openPrice) response += `   Apertura: ${pos.openPrice}`;
                    if (pos.currentPrice) response += ` | Actual: ${pos.currentPrice}`;
                    response += `\n   ${pEmoji} P/L: ${pSign}$${pos.profit} (${pSign}${pos.profitPct}%)\n\n`;
                }
            } else {
                response += `📭 *Sin posiciones registradas*\n\n`;
                response += `💡 Configura el EA en MT5 para enviar posiciones a:\n`;
                response += `\`POST /api/fx/positions\`\n\n`;
            }

            // Últimas señales webhook
            if (fxNotifications.rows.length > 0) {
                response += `🔔 *Últimas señales:*\n`;
                for (const notif of fxNotifications.rows) {
                    const symMatch = notif.message.match(/\*Par:\*\s*([A-Z]+)/);
                    const typeMatch = notif.message.match(/\*Tipo:\*\s*(\w+)/);
                    if (symMatch) {
                        response += `📶 ${symMatch[1]} ${typeMatch ? typeMatch[1] : ''}\n`;
                    }
                }
            }
        }

        response += `\n---\n💡 *fx* = ver posiciones | *webhook* = info API`;

        return response;

    } catch (error) {
        console.error('❌ Error generando resumen FX:', error.message);
        return `❌ Error al consultar posiciones.\n\n💡 Para reenviar alertas: "*Para: +57XXX*" + datos MT5`;
    }
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
        const summary = await getPositionsSummary(senderPhone);
        await sendFn(remoteJid, { text: summary });
        console.log(`✅ Resumen FX enviado a ${senderPhone}`);
        return true;
    } catch (error) {
        console.error(`❌ Error enviando resumen FX:`, error.message);
        return false;
    }
}

module.exports = {
    isFXCommand,
    handleFXCommand,
    getPositionsSummary
};
