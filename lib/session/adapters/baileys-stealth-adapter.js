/**
 * Baileys Stealth Adapter
 * Usa @whiskeysockets/baileys con fingerprints aleatorios y parámetros
 * de conexión randomizados para reducir la detección por parte de WhatsApp.
 * 
 * Diferencias vs Standard:
 * - Browser fingerprint aleatorio (Chrome/Safari/Edge/Firefox/Opera)
 * - keepAlive con intervalo variable (25-45s en lugar de 30s fijo)
 * - retryRequestDelay variable (1.5-3.5s)
 * - markOnlineOnConnect deshabilitado
 * - generateHighQualityLinkPreview deshabilitado
 * - emitOwnEvents deshabilitado
 */
const BaseAdapter = require('./base-adapter');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');

// Pool de fingerprints realistas para simular distintos dispositivos/navegadores
const BROWSER_FINGERPRINTS = [
    ['Windows Desktop', 'Chrome', '131.0.6778.85'],
    ['macOS Desktop', 'Safari', '17.2.1'],
    ['Windows Desktop', 'Microsoft Edge', '131.0.2903.70'],
    ['Linux Desktop', 'Firefox', '131.0.3'],
    ['Windows Desktop', 'Opera', '114.0.5282.115'],
    ['macOS Desktop', 'Chrome', '130.0.6723.117'],
    ['Windows Desktop', 'Chrome', '129.0.6668.100'],
    ['Linux Desktop', 'Chrome', '131.0.6778.69'],
];

class BaileysStealthAdapter extends BaseAdapter {
    constructor() {
        super('baileys-stealth');
    }

    _getRandomFingerprint() {
        return BROWSER_FINGERPRINTS[Math.floor(Math.random() * BROWSER_FINGERPRINTS.length)];
    }

    async connect(authPath, options = {}) {
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const { version, isLatest } = await fetchLatestBaileysVersion();

        const logger = options.logger || pino({ level: 'silent' });
        const fingerprint = this._getRandomFingerprint();

        // Randomizar parámetros de conexión para reducir fingerprint
        const keepAlive = 25000 + Math.floor(Math.random() * 20000);   // 25-45s
        const retryDelay = 1500 + Math.floor(Math.random() * 2000);    // 1.5-3.5s
        const qrTimeout = 35000 + Math.floor(Math.random() * 15000);   // 35-50s

        const socketConfig = {
            version,
            logger,
            printQRInTerminal: false,
            browser: fingerprint,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            keepAliveIntervalMs: keepAlive,
            retryRequestDelayMs: retryDelay,
            qrTimeout,
            emitOwnEvents: false,
            getMessage: async () => undefined
        };

        if (options.agent) {
            socketConfig.agent = options.agent;
        }

        const socket = makeWASocket(socketConfig);
        console.log(`🕵️ [baileys-stealth] fingerprint: ${fingerprint[0]} ${fingerprint[1]} v${fingerprint[2]} | keepAlive: ${keepAlive}ms | retry: ${retryDelay}ms`);

        return { socket, saveCreds, adapterType: this.adapterName };
    }
}

module.exports = BaileysStealthAdapter;
