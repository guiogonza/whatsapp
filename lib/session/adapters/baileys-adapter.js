/**
 * Baileys Standard Adapter
 * Usa @whiskeysockets/baileys con configuración estándar.
 * Fingerprint: Chrome en Linux (configuración por defecto).
 */
const BaseAdapter = require('./base-adapter');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');

class BaileysAdapter extends BaseAdapter {
    constructor() {
        super('baileys-standard');
        this.browserFingerprint = ['Chrome (Linux)', 'Chrome', '130.0.6723.91'];
    }

    async connect(authPath, options = {}) {
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📋 [baileys-standard] WA v${version.join('.')}, isLatest: ${isLatest}`);

        const logger = options.logger || pino({ level: 'silent' });

        const socketConfig = {
            version,
            logger,
            printQRInTerminal: false,
            browser: this.browserFingerprint,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 2000,
            qrTimeout: 40000,
            getMessage: async () => undefined
        };

        if (options.agent) {
            socketConfig.agent = options.agent;
        }

        const socket = makeWASocket(socketConfig);
        return { socket, saveCreds, adapterType: this.adapterName };
    }
}

module.exports = BaileysAdapter;
