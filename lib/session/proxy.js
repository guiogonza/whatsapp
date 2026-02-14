/**
 * Módulo de manejo de Proxy SOCKS5
 * Gestiona la conexión a través de proxy para sesiones de WhatsApp
 * Soporta múltiples proxies para asignar IPs diferentes a cada sesión
 */

const { SocksProxyAgent } = require('socks-proxy-agent');
const net = require('net');

// ==========================================
// CONFIGURACIÓN DE PROXIES
// ==========================================
// Opción 1: Un solo proxy (legacy)
const SINGLE_PROXY_URL = process.env.ALL_PROXY || process.env.SOCKS_PROXY || null;

// Opción 2: Lista de proxies separados por coma
// Ejemplo: PROXY_LIST=socks5://user:pass@ip1:port,socks5://user:pass@ip2:port,socks5://ip3:port
const PROXY_LIST = process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',').map(p => p.trim()).filter(p => p) : [];

// Opción 3: Proxy con rotación por puerto (algunos proveedores ofrecen diferentes IPs por puerto)
// Ejemplo: ROTATING_PROXY_BASE=socks5://user:pass@proxy.example.com
//          ROTATING_PROXY_PORT_START=10000
//          ROTATING_PROXY_PORT_COUNT=100
const ROTATING_PROXY_BASE = process.env.ROTATING_PROXY_BASE || null;
const ROTATING_PROXY_PORT_START = parseInt(process.env.ROTATING_PROXY_PORT_START) || 10000;
const ROTATING_PROXY_PORT_COUNT = parseInt(process.env.ROTATING_PROXY_PORT_COUNT) || 100;

// Tracking de proxies por sesión
const sessionProxyMap = new Map(); // sessionName -> proxyUrl
const proxyAvailability = new Map(); // proxyUrl -> boolean
const usedProxies = new Set(); // Para evitar asignar el mismo proxy a múltiples sesiones

let lastProxyCheck = 0;
const PROXY_CHECK_INTERVAL = 60 * 1000; // Verificar cada 60 segundos

/**
 * Genera la lista completa de proxies disponibles
 * @returns {string[]}
 */
function getAllProxies() {
    const proxies = [];
    
    // Agregar proxy único si existe
    if (SINGLE_PROXY_URL) {
        proxies.push(SINGLE_PROXY_URL);
    }
    
    // Agregar lista de proxies
    if (PROXY_LIST.length > 0) {
        proxies.push(...PROXY_LIST);
    }
    
    // Generar proxies con rotación por puerto
    if (ROTATING_PROXY_BASE) {
        const baseMatch = ROTATING_PROXY_BASE.match(/(socks5?:\/\/(?:[^@]+@)?[^:]+)/);
        if (baseMatch) {
            const baseUrl = baseMatch[1];
            for (let i = 0; i < ROTATING_PROXY_PORT_COUNT; i++) {
                const port = ROTATING_PROXY_PORT_START + i;
                proxies.push(`${baseUrl}:${port}`);
            }
        }
    }
    
    return [...new Set(proxies)]; // Eliminar duplicados
}

/**
 * Verifica si un proxy específico está disponible
 * @param {string} proxyUrl 
 * @returns {Promise<boolean>}
 */
async function checkSingleProxyAvailability(proxyUrl) {
    if (!proxyUrl) return false;
    
    try {
        const proxyMatch = proxyUrl.match(/socks5?:\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)/);
        if (!proxyMatch) {
            console.log('⚠️ URL de proxy inválida:', proxyUrl);
            return false;
        }
        
        const [, , , host, port] = proxyMatch;
        
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(5000);
            
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
 * Obtiene un proxy disponible para una sesión específica
 * Si la sesión ya tiene un proxy asignado, lo devuelve
 * Si no, asigna uno nuevo de la lista disponible
 * IMPORTANTE: Las sesiones GPSwox NO usan proxy (conexión directa)
 * @param {string} sessionName 
 * @returns {Promise<SocksProxyAgent|null>}
 */
async function getProxyAgentForSession(sessionName) {
    // Configuración: nombres de sesiones GPSwox que NO deben usar proxy
    const config = require('../../config');
    const gpswoxSessionNames = config.GPSWOX_SESSION_NAMES || [];
    
    // Si es una sesión GPSwox, NO usar proxy (conexión directa)
    if (gpswoxSessionNames.includes(sessionName)) {
        console.log(`🔒 Sesión GPSwox ${sessionName}: usando conexión directa (sin proxy)`);
        return null;
    }
    
    const allProxies = getAllProxies();
    
    if (allProxies.length === 0) {
        return null;
    }
    
    // Si ya tiene un proxy asignado, verificar que sigue disponible
    if (sessionProxyMap.has(sessionName)) {
        const assignedProxy = sessionProxyMap.get(sessionName);
        const isAvailable = await checkSingleProxyAvailability(assignedProxy);
        
        if (isAvailable) {
            return new SocksProxyAgent(assignedProxy);
        } else {
            // Proxy no disponible, liberar y reasignar
            console.log(`⚠️ Proxy asignado a ${sessionName} no disponible, reasignando...`);
            usedProxies.delete(assignedProxy);
            sessionProxyMap.delete(sessionName);
        }
    }
    
    // Buscar un proxy disponible que no esté en uso
    for (const proxy of allProxies) {
        // Si ya está usado por otra sesión, saltar
        if (usedProxies.has(proxy)) continue;
        
        // Verificar disponibilidad
        const isAvailable = await checkSingleProxyAvailability(proxy);
        if (isAvailable) {
            // Asignar este proxy a la sesión
            sessionProxyMap.set(sessionName, proxy);
            usedProxies.add(proxy);
            console.log(`✅ Proxy asignado a ${sessionName}: ${maskProxy(proxy)}`);
            return new SocksProxyAgent(proxy);
        }
    }
    
    // Si no hay proxies disponibles únicos, reusar uno aleatorio
    if (allProxies.length > 0) {
        console.log(`⚠️ No hay proxies únicos disponibles para ${sessionName}, reusando...`);
        const randomProxy = allProxies[Math.floor(Math.random() * allProxies.length)];
        const isAvailable = await checkSingleProxyAvailability(randomProxy);
        if (isAvailable) {
            sessionProxyMap.set(sessionName, randomProxy);
            return new SocksProxyAgent(randomProxy);
        }
    }
    
    console.log(`⚠️ Ningún proxy disponible para ${sessionName}, usando conexión directa`);
    return null;
}

/**
 * Oculta credenciales del proxy para logs
 * @param {string} proxyUrl 
 * @returns {string}
 */
function maskProxy(proxyUrl) {
    if (!proxyUrl) return 'N/A';
    return proxyUrl.replace(/\/\/([^:]+):([^@]+)@/, '//****:****@');
}

/**
 * Libera el proxy de una sesión cuando se elimina
 * @param {string} sessionName 
 */
function releaseProxyForSession(sessionName) {
    if (sessionProxyMap.has(sessionName)) {
        const proxy = sessionProxyMap.get(sessionName);
        usedProxies.delete(proxy);
        sessionProxyMap.delete(sessionName);
        console.log(`🔓 Proxy liberado para sesión: ${sessionName}`);
    }
}

/**
 * Obtiene el agente de proxy si está disponible (legacy - para compatibilidad)
 * @returns {Promise<SocksProxyAgent|null>}
 */
async function getProxyAgent() {
    const allProxies = getAllProxies();
    if (allProxies.length === 0) return null;
    
    // Devuelve el primer proxy disponible (para compatibilidad)
    for (const proxy of allProxies) {
        const isAvailable = await checkSingleProxyAvailability(proxy);
        if (isAvailable) {
            return new SocksProxyAgent(proxy);
        }
    }
    return null;
}

/**
 * Inicializa y verifica todos los proxies disponibles
 */
async function initProxy() {
    const allProxies = getAllProxies();
    
    if (allProxies.length === 0) {
        console.log('ℹ️ Sin proxies configurados, usando IP del VPS directamente');
        console.log('💡 Tip: Configura PROXY_LIST en .env para usar múltiples IPs');
        return;
    }
    
    console.log(`🔍 Verificando ${allProxies.length} proxy(s) disponibles...`);
    
    let availableCount = 0;
    for (const proxy of allProxies) {
        const isAvailable = await checkSingleProxyAvailability(proxy);
        proxyAvailability.set(proxy, isAvailable);
        if (isAvailable) {
            availableCount++;
            console.log(`  ✅ ${maskProxy(proxy)} - Disponible`);
        } else {
            console.log(`  ❌ ${maskProxy(proxy)} - No disponible`);
        }
    }
    
    console.log(`\n📊 Proxies disponibles: ${availableCount}/${allProxies.length}`);
    if (availableCount > 0) {
        console.log(`🎯 Cada sesión usará un proxy diferente (hasta ${availableCount} sesiones con IP única)`);
    }
}

/**
 * Obtiene el estado actual del proxy
 */
function getProxyStatus() {
    const allProxies = getAllProxies();
    let availableCount = 0;
    
    for (const [, isAvail] of proxyAvailability) {
        if (isAvail) availableCount++;
    }
    
    return {
        configured: allProxies.length > 0,
        totalProxies: allProxies.length,
        availableProxies: availableCount,
        sessionsWithProxy: sessionProxyMap.size,
        assignments: Object.fromEntries(
            [...sessionProxyMap.entries()].map(([session, proxy]) => [session, maskProxy(proxy)])
        )
    };
}

/**
 * Obtiene información de qué proxy usa cada sesión
 * @returns {Map<string, string>}
 */
function getSessionProxyAssignments() {
    return new Map([...sessionProxyMap.entries()].map(([s, p]) => [s, maskProxy(p)]));
}

/**
 * Obtiene la IP pública a través de un proxy específico
 * @param {string} proxyUrl 
 * @returns {Promise<string|null>}
 */
async function getProxyPublicIP(proxyUrl) {
    if (!proxyUrl) return null;
    
    try {
        const https = require('https');
        const agent = new SocksProxyAgent(proxyUrl);
        
        return new Promise((resolve) => {
            const req = https.get('https://api.ipify.org', { agent, timeout: 10000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data.trim()));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });
        });
    } catch (error) {
        return null;
    }
}

/**
 * Obtiene información de geolocalización de una IP
 * @param {string} ip
 * @returns {Promise<{country: string, city: string, countryCode: string}>}
 */
async function getIPGeoLocation(ip) {
    if (!ip) return { country: 'Desconocido', city: 'Desconocido', countryCode: '' };
    
    // Cache de geolocalización
    if (!global.geoCache) global.geoCache = new Map();
    
    if (global.geoCache.has(ip)) {
        const cached = global.geoCache.get(ip);
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) { // Cache 24 horas
            return cached.geo;
        }
    }
    
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city`);
        const data = await response.json();
        
        if (data.status === 'success') {
            const geo = {
                country: data.country || 'Desconocido',
                city: data.city || 'Desconocido',
                countryCode: data.countryCode || ''
            };
            global.geoCache.set(ip, { geo, timestamp: Date.now() });
            return geo;
        }
    } catch (error) {
        console.log(`⚠️ Error obteniendo geolocalización para ${ip}:`, error.message);
    }
    
    return { country: 'Desconocido', city: 'Desconocido', countryCode: '' };
}

/**
 * Obtiene la IP del proxy asignado a una sesión con geolocalización
 * @param {string} sessionName 
 * @returns {Promise<{ip: string|null, proxyUrl: string|null, location: string, country: string, city: string, countryCode: string}>}
 */
async function getSessionProxyIP(sessionName) {
    const proxyUrl = sessionProxyMap.get(sessionName);
    if (!proxyUrl) {
        return { ip: null, proxyUrl: null, location: 'VPS Directo', country: 'VPS', city: 'Directo', countryCode: '' };
    }
    
    // Cache de IPs para no consultar cada vez
    if (!global.proxyIPCache) global.proxyIPCache = new Map();
    
    if (global.proxyIPCache.has(proxyUrl)) {
        const cached = global.proxyIPCache.get(proxyUrl);
        if (Date.now() - cached.timestamp < 5 * 60 * 1000) { // Cache 5 minutos
            return { 
                ip: cached.ip, 
                proxyUrl: maskProxy(proxyUrl), 
                location: 'Proxy',
                country: cached.country || 'Desconocido',
                city: cached.city || 'Desconocido',
                countryCode: cached.countryCode || ''
            };
        }
    }
    
    const ip = await getProxyPublicIP(proxyUrl);
    let geoInfo = { country: 'Desconocido', city: 'Desconocido', countryCode: '' };
    
    if (ip) {
        geoInfo = await getIPGeoLocation(ip);
        global.proxyIPCache.set(proxyUrl, { 
            ip, 
            timestamp: Date.now(),
            country: geoInfo.country,
            city: geoInfo.city,
            countryCode: geoInfo.countryCode
        });
    }
    
    return { 
        ip, 
        proxyUrl: maskProxy(proxyUrl), 
        location: 'Proxy',
        country: geoInfo.country,
        city: geoInfo.city,
        countryCode: geoInfo.countryCode
    };
}

/**
 * Obtiene las IPs de todas las sesiones con proxy
 * @returns {Promise<Object>}
 */
async function getAllSessionProxyIPs() {
    const result = {};
    const promises = [];
    
    for (const [sessionName] of sessionProxyMap) {
        promises.push(
            getSessionProxyIP(sessionName).then(info => {
                result[sessionName] = info;
            })
        );
    }
    
    await Promise.all(promises);
    return result;
}

module.exports = {
    checkProxyAvailability: checkSingleProxyAvailability,
    getProxyAgent,
    getProxyAgentForSession,
    releaseProxyForSession,
    initProxy,
    getProxyStatus,
    getSessionProxyAssignments,
    getAllProxies,
    maskProxy,
    getSessionProxyIP,
    getAllSessionProxyIPs,
    PROXY_URL: SINGLE_PROXY_URL // Para compatibilidad
};
