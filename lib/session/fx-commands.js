/**
 * Comandos interactivos FX/MT5
 * Responde a comandos como "fx", "posiciones", "balance" enviados por WhatsApp
 */

const axios = require('axios');
const config = require('../../config');
const database = require('../../database-postgres');

// Palabras clave que disparan el comando FX
const FX_COMMAND_TRIGGERS = [
    'fx', '/fx', '!fx',
    'posiciones', 'mis posiciones',
    'balance', 'mi balance',
    'estado', 'mi estado',
    'trading', 'mt5'
];

// Alias en español -> símbolo real que expone fx.apptu.net (GET /api/precios).
// Confirmado en vivo: {EURUSD, GBPUSD, GER40CASH, GOLD, NGASCASH, OILCASH,
// US500CASH, USDJPY}. Varios nombres por símbolo para que "fx oro",
// "fx gold" o "fx dólar" funcionen igual.
const SYMBOL_ALIASES = {
    'oro': 'GOLD', 'gold': 'GOLD', 'xau': 'GOLD', 'xauusd': 'GOLD',
    'euro': 'EURUSD', 'eur': 'EURUSD', 'eurusd': 'EURUSD',
    'libra': 'GBPUSD', 'gbp': 'GBPUSD', 'gbpusd': 'GBPUSD',
    'yen': 'USDJPY', 'dolaryen': 'USDJPY', 'usdjpy': 'USDJPY',
    'petroleo': 'OILCASH', 'petróleo': 'OILCASH', 'oil': 'OILCASH', 'crudo': 'OILCASH',
    'gas': 'NGASCASH', 'gasnatural': 'NGASCASH',
    'sp500': 'US500CASH', 's&p500': 'US500CASH', 'spx': 'US500CASH',
    'dax': 'GER40CASH', 'alemania': 'GER40CASH', 'ger40': 'GER40CASH',
};

/**
 * Si el comando es "fx <algo>" y <algo> coincide con un símbolo conocido,
 * devuelve ese símbolo real (ej. "GOLD"); si no, null (cae al resumen
 * genérico de posiciones de siempre).
 */
function parseSymbolQuery(text) {
    const match = (text || '').trim().match(/^(?:fx|\/fx|!fx)\s+(.+)$/i);
    if (!match) return null;
    const key = match[1].trim().toLowerCase().replace(/\s+/g, '');
    return SYMBOL_ALIASES[key] || null;
}

/**
 * Consulta el precio en vivo de un símbolo contra fx.apptu.net (feed en
 * tiempo real desde XM vía websocket, ver C:\Documentos\Fx\app.py).
 * @param {string} symbol - Símbolo real (ej. "GOLD")
 * @returns {Promise<{ask:number, bid:number, spread:number, time:number}|null>}
 */
async function getLivePrice(symbol) {
    const baseUrl = config.FX_PRICES_API_URL || 'https://fx.apptu.net';
    const response = await axios.get(`${baseUrl}/api/precios`, { timeout: 8000 });
    return response.data?.precios?.[symbol] || null;
}

const SYMBOL_DISPLAY_NAMES = {
    GOLD: 'Oro', EURUSD: 'Euro/Dólar', GBPUSD: 'Libra/Dólar', USDJPY: 'Dólar/Yen',
    OILCASH: 'Petróleo', NGASCASH: 'Gas Natural', US500CASH: 'S&P 500', GER40CASH: 'DAX (Alemania)',
};

/**
 * Da formato a la respuesta de precio para un símbolo.
 */
function formatPriceReply(nombreAmigable, symbol, data) {
    const hora = new Date(data.time * 1000).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    return `💰 *${nombreAmigable}* (${symbol})\n\n` +
        `📈 Compra (ask): *${data.ask}*\n` +
        `📉 Venta (bid): *${data.bid}*\n` +
        `↔️ Spread: ${data.spread}\n\n` +
        `🕐 ${hora}\n\n` +
        `---\n💡 *fx* = ver posiciones | *fx oro* = precio del oro`;
}

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

    // "fx oro", "fx gold", "fx euro", etc. -> precio en vivo, en vez del
    // resumen generico de posiciones.
    const symbol = parseSymbolQuery(messageText);
    if (symbol) {
        try {
            const data = await getLivePrice(symbol);
            if (!data) {
                await sendFn(remoteJid, { text: `⚠️ No tengo precio en vivo de *${symbol}* en este momento. Intenta de nuevo en un momento.` });
                return true;
            }
            const nombre = SYMBOL_DISPLAY_NAMES[symbol] || symbol;
            await sendFn(remoteJid, { text: formatPriceReply(nombre, symbol, data) });
            console.log(`✅ Precio de ${symbol} enviado a ${senderPhone}`);
            return true;
        } catch (error) {
            console.error(`❌ Error consultando precio de ${symbol}:`, error.message);
            await sendFn(remoteJid, { text: `❌ No pude consultar el precio de *${symbol}* ahora mismo. Intenta de nuevo en un momento.` });
            return true;
        }
    }

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
