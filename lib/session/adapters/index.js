/**
 * Adapter Factory - Gestión de adaptadores multi-librería
 * 
 * Rota automáticamente entre librerías al crear nuevas sesiones
 * para diversificar el fingerprint de conexión y reducir baneos.
 * 
 * Adaptadores disponibles:
 * - baileys-standard: Baileys con configuración estándar (Chrome Linux)
 * - baileys-stealth: Baileys con fingerprint aleatorio y parámetros randomizados
 * - whatsapp-web-js: whatsapp-web.js con Chromium real (requiere instalación)
 * 
 * Configuración via .env:
 *   ENABLED_ADAPTERS=baileys-standard,baileys-stealth,whatsapp-web-js
 */

const config = require('../../../config');
const BaileysAdapter = require('./baileys-adapter');
const BaileysStealthAdapter = require('./baileys-stealth-adapter');
const WhatsAppWebAdapter = require('./whatsappweb-adapter');
const WPPConnectAdapter = require('./wppconnect-adapter');

// Registro de todos los adaptadores posibles
const ALL_ADAPTERS = {
    'baileys-standard': BaileysAdapter,
    'baileys-stealth': BaileysStealthAdapter,
    'whatsapp-web-js': WhatsAppWebAdapter,
    'wppconnect': WPPConnectAdapter
};

// Adaptadores activos (instancias)
let activeAdapters = [];

// Índice para round-robin
let adapterIndex = 0;

// Mapeo sessionName → adapterType (para reconexiones)
const sessionAdapterMap = new Map();

/**
 * Inicializa los adaptadores habilitados según configuración
 */
function initAdapters() {
    const enabledNames = config.ENABLED_ADAPTERS || ['baileys-standard', 'baileys-stealth'];
    activeAdapters = [];

    for (const name of enabledNames) {
        const AdapterClass = ALL_ADAPTERS[name];
        if (!AdapterClass) {
            console.log(`⚠️ Adaptador desconocido: ${name}, ignorando`);
            continue;
        }

        // Para whatsapp-web.js, verificar que esté instalado
        if (name === 'whatsapp-web-js') {
            if (!WhatsAppWebAdapter.isAvailable()) {
                console.log(`ℹ️ whatsapp-web.js no instalado, omitiendo adaptador. Instala con: npm install whatsapp-web.js`);
                continue;
            }
        }

        // Para wppconnect, verificar que esté instalado
        if (name === 'wppconnect') {
            if (!WPPConnectAdapter.isAvailable()) {
                console.log(`ℹ️ @wppconnect-team/wppconnect no instalado, omitiendo adaptador. Instala con: npm install @wppconnect-team/wppconnect`);
                continue;
            }
        }

        activeAdapters.push(new AdapterClass());
        console.log(`✅ Adaptador habilitado: ${name}`);
    }

    // Fallback: si ningún adaptador está habilitado, usar Baileys estándar
    if (activeAdapters.length === 0) {
        console.log(`⚠️ Ningún adaptador habilitado, usando baileys-standard por defecto`);
        activeAdapters.push(new BaileysAdapter());
    }

    console.log(`🔧 ${activeAdapters.length} adaptadores activos: ${activeAdapters.map(a => a.getType()).join(', ')}`);
}

/**
 * Obtiene el siguiente adaptador en round-robin
 */
function getNextAdapter() {
    const adapter = activeAdapters[adapterIndex % activeAdapters.length];
    adapterIndex++;
    return adapter;
}

/**
 * Obtiene el adaptador para una sesión específica
 * - Si la sesión ya tiene un adaptador asignado (reconexión), lo reutiliza
 * - Si es nueva, usa round-robin para seleccionar uno
 * 
 * @param {string} sessionName - Nombre de la sesión
 * @returns {BaseAdapter} - Instancia del adaptador
 */
function getAdapterForSession(sessionName) {
    // Si la sesión ya tiene un adaptador asignado, reutilizarlo
    const existingType = sessionAdapterMap.get(sessionName);
    if (existingType) {
        const adapter = activeAdapters.find(a => a.getType() === existingType);
        if (adapter) {
            console.log(`🔄 Reutilizando adaptador ${existingType} para sesión ${sessionName}`);
            return adapter;
        }
        // Si el adaptador ya no está activo, seleccionar uno nuevo
        console.log(`⚠️ Adaptador ${existingType} ya no disponible para ${sessionName}, seleccionando nuevo`);
        sessionAdapterMap.delete(sessionName);
    }

    // Seleccionar nuevo adaptador por round-robin
    const adapter = getNextAdapter();
    sessionAdapterMap.set(sessionName, adapter.getType());
    console.log(`🆕 Asignado adaptador ${adapter.getType()} a sesión ${sessionName}`);
    return adapter;
}

/**
 * Establece el tipo de adaptador para una sesión (usado al cargar del disco)
 */
function setAdapterForSession(sessionName, adapterType) {
    if (adapterType && ALL_ADAPTERS[adapterType]) {
        sessionAdapterMap.set(sessionName, adapterType);
    }
}

/**
 * Limpia el adaptador asignado a una sesión
 */
function clearAdapterForSession(sessionName) {
    sessionAdapterMap.delete(sessionName);
}

/**
 * Obtiene info de los adaptadores para diagnóstico
 */
function getAdaptersInfo() {
    return {
        active: activeAdapters.map(a => a.getType()),
        enabled: config.ENABLED_ADAPTERS || ['baileys-standard', 'baileys-stealth'],
        sessionAssignments: Object.fromEntries(sessionAdapterMap),
        roundRobinIndex: adapterIndex
    };
}

// Inicializar al cargar el módulo
initAdapters();

module.exports = {
    getAdapterForSession,
    setAdapterForSession,
    clearAdapterForSession,
    getAdaptersInfo,
    initAdapters,
    // Acceso directo a clases de adaptadores
    BaileysAdapter,
    BaileysStealthAdapter,
    WhatsAppWebAdapter,
    WPPConnectAdapter
};
