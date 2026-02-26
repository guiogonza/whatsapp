/**
 * Módulo para interactuar con MetaTrader5
 * Gestiona el envío de notificaciones de Trading a través de WhatsApp
 * 
 * Tipos de notificaciones soportadas:
 * - Señales de trading (BUY/SELL)
 * - Alertas de precio (Stop Loss, Take Profit)
 * - Reportes de cuenta (Balance, Equity, Margin)
 * - Noticias del mercado Forex
 */

const axios = require('axios');
const config = require('../../config');

// Configuración de MetaTrader5 API (configurar en .env)
const FX_CONFIG = {
    // URL base de la API de MT5 (si existe)
    BASE_URL: process.env.MT5_API_BASE_URL || '',
    API_KEY: process.env.MT5_API_KEY || '',
    // Webhook entrante desde MT5
    WEBHOOK_SECRET: process.env.MT5_WEBHOOK_SECRET || 'mt5_secret_2026',
};

// Tipos de notificaciones
const NOTIFICATION_TYPES = {
    SIGNAL: 'signal',           // Señal de trading
    ALERT: 'alert',             // Alerta de precio
    POSITION: 'position',       // Apertura/cierre de posición
    ACCOUNT: 'account',         // Estado de cuenta
    NEWS: 'news',               // Noticias del mercado
    CUSTOM: 'custom'            // Mensaje personalizado
};

// Formato de señales
const SIGNAL_TYPES = {
    BUY: 'BUY',
    SELL: 'SELL',
    BUY_LIMIT: 'BUY_LIMIT',
    SELL_LIMIT: 'SELL_LIMIT',
    BUY_STOP: 'BUY_STOP',
    SELL_STOP: 'SELL_STOP'
};

/**
 * Valida un número de cuenta MT5
 * @param {string|number} accountNumber - Número de cuenta
 * @returns {boolean}
 */
function isValidAccountNumber(accountNumber) {
    // MT5 account numbers son típicamente de 6-10 dígitos
    const accountStr = String(accountNumber);
    return /^\d{6,10}$/.test(accountStr);
}

/**
 * Valida el formato de un par de divisas
 * @param {string} symbol - Par de divisas (ej: EURUSD, GBPJPY)
 * @returns {boolean}
 */
function isValidSymbol(symbol) {
    // Formato típico: 6 caracteres (EURUSD) o con sufijo (EURUSDm)
    return /^[A-Z]{6}[a-z]?$/.test(symbol);
}

/**
 * Formatea una señal de trading para WhatsApp
 * @param {Object} signal - Datos de la señal
 * @returns {string} - Mensaje formateado
 */
function formatTradingSignal(signal) {
    const {
        type = 'BUY',
        symbol = 'EURUSD',
        entry = 0,
        stopLoss = 0,
        takeProfit = 0,
        lotSize = 0.01,
        timeframe = 'H1',
        reason = '',
        timestamp = new Date()
    } = signal;

    const emoji = type.includes('BUY') ? '📈' : '📉';
    const date = new Date(timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    let message = `${emoji} *SEÑAL DE TRADING*\n\n`;
    message += `*Tipo:* ${type}\n`;
    message += `*Par:* ${symbol}\n`;
    message += `*Entrada:* ${entry}\n`;
    message += `*Stop Loss:* ${stopLoss}\n`;
    message += `*Take Profit:* ${takeProfit}\n`;
    message += `*Lotes:* ${lotSize}\n`;
    message += `*Timeframe:* ${timeframe}\n\n`;
    
    if (reason) {
        message += `*Razón:* ${reason}\n\n`;
    }
    
    message += `⏰ ${date}`;
    
    return message;
}

/**
 * Formatea una alerta de precio
 * @param {Object} alert - Datos de la alerta
 * @returns {string} - Mensaje formateado
 */
function formatPriceAlert(alert) {
    const {
        symbol = 'EURUSD',
        currentPrice = 0,
        alertType = 'STOP_LOSS',
        alertPrice = 0,
        position = 'BUY',
        timestamp = new Date()
    } = alert;

    const emoji = alertType === 'TAKE_PROFIT' ? '✅' : '⚠️';
    const date = new Date(timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    let message = `${emoji} *ALERTA DE PRECIO*\n\n`;
    message += `*Par:* ${symbol}\n`;
    message += `*Tipo:* ${alertType.replace('_', ' ')}\n`;
    message += `*Posición:* ${position}\n`;
    message += `*Precio Alerta:* ${alertPrice}\n`;
    message += `*Precio Actual:* ${currentPrice}\n\n`;
    message += `⏰ ${date}`;
    
    return message;
}

/**
 * Formatea información de posición abierta/cerrada
 * @param {Object} position - Datos de la posición
 * @returns {string} - Mensaje formateado
 */
function formatPosition(position) {
    const {
        action = 'OPENED', // OPENED, CLOSED, MODIFIED
        ticket = 0,
        type = 'BUY',
        symbol = 'EURUSD',
        volume = 0.01,
        openPrice = 0,
        closePrice = 0,
        profit = 0,
        stopLoss = 0,
        takeProfit = 0,
        timestamp = new Date()
    } = position;

    const emoji = action === 'OPENED' ? '🔓' : (profit >= 0 ? '💰' : '📛');
    const date = new Date(timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    let message = `${emoji} *POSICIÓN ${action === 'OPENED' ? 'ABIERTA' : action === 'CLOSED' ? 'CERRADA' : 'MODIFICADA'}*\n\n`;
    message += `*Ticket:* #${ticket}\n`;
    message += `*Tipo:* ${type}\n`;
    message += `*Par:* ${symbol}\n`;
    message += `*Volumen:* ${volume} lotes\n`;
    message += `*Precio Apertura:* ${openPrice}\n`;
    
    if (action === 'CLOSED' && closePrice) {
        message += `*Precio Cierre:* ${closePrice}\n`;
        message += `*Resultado:* ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USD ${profit >= 0 ? '✅' : '❌'}\n`;
    } else {
        if (stopLoss > 0) message += `*Stop Loss:* ${stopLoss}\n`;
        if (takeProfit > 0) message += `*Take Profit:* ${takeProfit}\n`;
    }
    
    message += `\n⏰ ${date}`;
    
    return message;
}

/**
 * Formatea reporte de cuenta
 * @param {Object} account - Datos de la cuenta
 * @returns {string} - Mensaje formateado
 */
function formatAccountReport(account) {
    const {
        accountNumber = '12345678',
        balance = 0,
        equity = 0,
        margin = 0,
        freeMargin = 0,
        marginLevel = 0,
        profit = 0,
        openPositions = 0,
        timestamp = new Date()
    } = account;

    const emoji = profit >= 0 ? '💹' : '📊';
    const date = new Date(timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    let message = `${emoji} *REPORTE DE CUENTA*\n\n`;
    message += `*Cuenta:* ${accountNumber}\n`;
    message += `*Balance:* $${balance.toFixed(2)}\n`;
    message += `*Equity:* $${equity.toFixed(2)}\n`;
    message += `*Margen Usado:* $${margin.toFixed(2)}\n`;
    message += `*Margen Libre:* $${freeMargin.toFixed(2)}\n`;
    message += `*Nivel de Margen:* ${marginLevel.toFixed(2)}%\n`;
    message += `*Ganancia/Pérdida:* ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} ${profit >= 0 ? '✅' : '❌'}\n`;
    message += `*Posiciones Abiertas:* ${openPositions}\n\n`;
    message += `⏰ ${date}`;
    
    return message;
}

/**
 * Formatea noticia del mercado
 * @param {Object} news - Datos de la noticia
 * @returns {string} - Mensaje formateado
 */
function formatMarketNews(news) {
    const {
        title = '',
        impact = 'MEDIUM', // LOW, MEDIUM, HIGH
        currency = 'USD',
        forecast = '',
        previous = '',
        actual = '',
        timestamp = new Date()
    } = news;

    const impactEmoji = {
        'LOW': '🟢',
        'MEDIUM': '🟡',
        'HIGH': '🔴'
    };

    const emoji = impactEmoji[impact] || '📰';
    const date = new Date(timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    let message = `${emoji} *NOTICIA DEL MERCADO*\n\n`;
    message += `*${title}*\n\n`;
    message += `*Impacto:* ${impact}\n`;
    message += `*Divisa:* ${currency}\n`;
    
    if (forecast) message += `*Pronóstico:* ${forecast}\n`;
    if (previous) message += `*Anterior:* ${previous}\n`;
    if (actual) message += `*Actual:* ${actual}\n`;
    
    message += `\n⏰ ${date}`;
    
    return message;
}

/**
 * Formatea un mensaje personalizado
 * @param {Object} custom - Datos del mensaje
 * @returns {string} - Mensaje formateado
 */
function formatCustomMessage(custom) {
    const {
        title = 'NOTIFICACIÓN',
        message = '',
        timestamp = new Date()
    } = custom;

    const date = new Date(timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    let formattedMsg = `📢 *${title}*\n\n`;
    formattedMsg += `${message}\n\n`;
    formattedMsg += `⏰ ${date}`;
    
    return formattedMsg;
}

/**
 * Procesa y formatea una notificación según su tipo
 * @param {string} type - Tipo de notificación
 * @param {Object} data - Datos de la notificación
 * @returns {string} - Mensaje formateado
 */
function formatNotification(type, data) {
    switch (type) {
        case NOTIFICATION_TYPES.SIGNAL:
            return formatTradingSignal(data);
        case NOTIFICATION_TYPES.ALERT:
            return formatPriceAlert(data);
        case NOTIFICATION_TYPES.POSITION:
            return formatPosition(data);
        case NOTIFICATION_TYPES.ACCOUNT:
            return formatAccountReport(data);
        case NOTIFICATION_TYPES.NEWS:
            return formatMarketNews(data);
        case NOTIFICATION_TYPES.CUSTOM:
            return formatCustomMessage(data);
        default:
            return formatCustomMessage({ title: 'NOTIFICACIÓN', message: JSON.stringify(data) });
    }
}

/**
 * Valida el webhook secret para seguridad
 * @param {string} secret - Secret recibido
 * @returns {boolean}
 */
function validateWebhookSecret(secret) {
    return secret === FX_CONFIG.WEBHOOK_SECRET;
}

module.exports = {
    FX_CONFIG,
    NOTIFICATION_TYPES,
    SIGNAL_TYPES,
    isValidAccountNumber,
    isValidSymbol,
    formatTradingSignal,
    formatPriceAlert,
    formatPosition,
    formatAccountReport,
    formatMarketNews,
    formatCustomMessage,
    formatNotification,
    validateWebhookSecret
};
