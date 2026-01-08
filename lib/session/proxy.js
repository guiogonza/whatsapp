/**
 * Módulo de manejo de Proxy SOCKS5
 * Gestiona la conexión a través de proxy para sesiones de WhatsApp
 */

const { SocksProxyAgent } = require('socks-proxy-agent');
const net = require('net');

// Configurar proxy si está disponible
const PROXY_URL = process.env.ALL_PROXY || process.env.SOCKS_PROXY || null;
let proxyAgent = null;
let proxyAvailable = false;
let lastProxyCheck = 0;
const PROXY_CHECK_INTERVAL = 30 * 1000; // Verificar cada 30 segundos

/**
 * Verifica si el servidor proxy SOCKS5 está disponible
 * @returns {Promise<boolean>}
 */
async function checkProxyAvailability() {
    if (!PROXY_URL) return false;
    
    try {
        const proxyMatch = PROXY_URL.match(/socks5?:\/\/([^:]+):(\d+)/);
        if (!proxyMatch) {
            console.log('⚠️ URL de proxy inválida:', PROXY_URL);
            return false;
        }
        
        const [, host, port] = proxyMatch;
        
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(3000);
            
            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });
            
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.connect(parseInt(port), host);
        });
    } catch (error) {
        return false;
    }
}

/**
 * Obtiene el agente de proxy si está disponible, null si no
 * @returns {Promise<SocksProxyAgent|null>}
 */
async function getProxyAgent() {
    if (!PROXY_URL) return null;
    
    const now = Date.now();
    
    if (now - lastProxyCheck > PROXY_CHECK_INTERVAL) {
        lastProxyCheck = now;
        const wasAvailable = proxyAvailable;
        proxyAvailable = await checkProxyAvailability();
        
        if (proxyAvailable && !wasAvailable) {
            console.log('✅ Proxy SOCKS5 conectado:', PROXY_URL, '(IP Colombia)');
            proxyAgent = new SocksProxyAgent(PROXY_URL);
        } else if (!proxyAvailable && wasAvailable) {
            console.log('⚠️ Proxy SOCKS5 desconectado, usando IP del VPS');
            proxyAgent = null;
        }
    }
    
    return proxyAvailable ? proxyAgent : null;
}

/**
 * Inicializa el proxy al cargar el módulo
 */
async function initProxy() {
    if (PROXY_URL) {
        console.log('🔍 Verificando disponibilidad del proxy:', PROXY_URL);
        proxyAvailable = await checkProxyAvailability();
        if (proxyAvailable) {
            proxyAgent = new SocksProxyAgent(PROXY_URL);
            console.log('✅ Proxy SOCKS5 disponible:', PROXY_URL, '(IP Colombia)');
        } else {
            console.log('⚠️ Proxy SOCKS5 no disponible, usando IP del VPS directamente');
        }
    } else {
        console.log('ℹ️ Sin proxy configurado, usando IP del VPS directamente');
    }
}

/**
 * Obtiene el estado actual del proxy
 */
function getProxyStatus() {
    return {
        configured: !!PROXY_URL,
        available: proxyAvailable,
        url: PROXY_URL
    };
}

module.exports = {
    checkProxyAvailability,
    getProxyAgent,
    initProxy,
    getProxyStatus,
    PROXY_URL
};
