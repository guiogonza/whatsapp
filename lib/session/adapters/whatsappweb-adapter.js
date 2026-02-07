/**
 * WhatsApp Web.js Adapter
 * Usa whatsapp-web.js (basado en Puppeteer/Chromium) con interfaz Baileys-compatible.
 * 
 * Diferencias clave vs Baileys:
 * - Usa un navegador real (Chromium) en vez de WebSocket directo
 * - Fingerprint completamente distinto (navegador real vs protocolo directo)
 * - Mayor consumo de memoria (~100-200MB por sesión) pero más difícil de detectar
 * - Auth manejado por LocalAuth (persistencia automática)
 * 
 * REQUIERE: npm install whatsapp-web.js
 * El Dockerfile ya incluye Chromium (/usr/bin/chromium)
 */
const BaseAdapter = require('./base-adapter');
const EventEmitter = require('events');
const path = require('path');

class WhatsAppWebAdapter extends BaseAdapter {
    constructor() {
        super('whatsapp-web-js');
    }

    /**
     * Verifica si whatsapp-web.js está instalado
     */
    static isAvailable() {
        try {
            require('whatsapp-web.js');
            return true;
        } catch (e) {
            return false;
        }
    }

    async connect(authPath, options = {}) {
        let Client, LocalAuth;
        try {
            const wwjs = require('whatsapp-web.js');
            Client = wwjs.Client;
            LocalAuth = wwjs.LocalAuth;
        } catch (e) {
            throw new Error('whatsapp-web.js no instalado. Ejecuta: npm install whatsapp-web.js');
        }

        const sessionName = path.basename(authPath);

        const client = new Client({
            authStrategy: new LocalAuth({
                dataPath: authPath,
                clientId: 'wwebjs'
            }),
            puppeteer: {
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--single-process',
                    '--no-zygote',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run'
                ]
            }
        });

        // Crear EventEmitter Baileys-compatible
        const ev = new EventEmitter();

        // Crear wrapper del socket con interfaz Baileys-compatible
        const socket = this._createSocketWrapper(client, ev);

        // Configurar traducción de eventos
        this._setupEventTranslation(client, ev, socket, sessionName);

        // Inicializar cliente (asíncrono, no bloqueante)
        client.initialize().catch(err => {
            console.error(`❌ [whatsapp-web-js] Error inicializando ${sessionName}:`, err.message);
            ev.emit('connection.update', {
                connection: 'close',
                lastDisconnect: {
                    error: { output: { statusCode: 500 }, message: err.message }
                }
            });
        });

        console.log(`🌐 [whatsapp-web-js] Iniciando con Chromium para ${sessionName}...`);

        // saveCreds no-op (LocalAuth maneja la persistencia automáticamente)
        const saveCreds = async () => {};

        return { socket, saveCreds, adapterType: this.adapterName, _client: client };
    }

    /**
     * Crea un objeto socket con la misma interfaz que Baileys
     * para que core.js funcione sin cambios
     */
    _createSocketWrapper(client, ev) {
        const socket = {
            ev,
            user: null,
            authState: { creds: { me: null } },

            async sendMessage(jid, content) {
                const chatId = jid.replace('@s.whatsapp.net', '@c.us');

                if (content.text) {
                    return await client.sendMessage(chatId, content.text);
                }

                // Mensajes multimedia
                let buffer, mimetype, filename;

                if (content.image) {
                    buffer = content.image;
                    mimetype = content.mimetype || 'image/jpeg';
                    filename = 'image.jpg';
                } else if (content.video) {
                    buffer = content.video;
                    mimetype = content.mimetype || 'video/mp4';
                    filename = 'video.mp4';
                } else if (content.audio) {
                    buffer = content.audio;
                    mimetype = content.mimetype || 'audio/mpeg';
                    filename = 'audio.mp3';
                } else if (content.document) {
                    buffer = content.document;
                    mimetype = content.mimetype || 'application/octet-stream';
                    filename = content.fileName || 'document';
                }

                if (buffer) {
                    const wwjs = require('whatsapp-web.js');
                    const base64Data = Buffer.isBuffer(buffer) ? buffer.toString('base64') : buffer;
                    const media = new wwjs.MessageMedia(mimetype, base64Data, filename);
                    return await client.sendMessage(chatId, media, {
                        caption: content.caption || ''
                    });
                }

                throw new Error('Tipo de mensaje no soportado');
            },

            async logout() {
                try { await client.logout(); } catch (e) {}
            },

            end() {
                try { client.destroy(); } catch (e) {}
            },

            ws: {
                close() {
                    try { client.destroy(); } catch (e) {}
                }
            }
        };

        return socket;
    }

    /**
     * Traduce eventos de whatsapp-web.js al formato de Baileys
     * para que core.js no necesite cambios
     */
    _setupEventTranslation(client, ev, socket, sessionName) {
        // QR Code
        client.on('qr', (qr) => {
            console.log(`📱 [whatsapp-web-js] QR generado para ${sessionName}`);
            ev.emit('connection.update', { qr });
        });

        // Autenticado (intermedio, antes de ready)
        client.on('authenticated', () => {
            console.log(`🔐 [whatsapp-web-js] ${sessionName} autenticado`);
        });

        // Pantalla de carga
        client.on('loading_screen', (percent, message) => {
            if (percent % 20 === 0) { // Log solo cada 20%
                console.log(`⏳ [whatsapp-web-js] ${sessionName}: ${percent}% - ${message}`);
            }
        });

        // Listo (conectado)
        client.on('ready', () => {
            const info = client.info;
            const phoneNumber = info?.wid?.user || '';

            // IMPORTANTE: Establecer user ANTES de emitir el evento
            // para que core.js pueda leerlo en el handler de 'connection.update'
            socket.user = {
                id: `${phoneNumber}:0@s.whatsapp.net`,
                name: info?.pushname || 'Usuario'
            };
            socket.authState.creds.me = {
                id: `${phoneNumber}:0@s.whatsapp.net`,
                lid: null
            };

            console.log(`✅ [whatsapp-web-js] ${sessionName} conectado: ${phoneNumber}`);
            ev.emit('connection.update', { connection: 'open', isNewLogin: false });
        });

        // Desconexión
        client.on('disconnected', (reason) => {
            console.log(`📴 [whatsapp-web-js] ${sessionName} desconectado: ${reason}`);
            const statusCode = reason === 'LOGOUT' ? 401 : 428;
            ev.emit('connection.update', {
                connection: 'close',
                lastDisconnect: {
                    error: { output: { statusCode }, message: String(reason) }
                }
            });
        });

        // Fallo de autenticación
        client.on('auth_failure', (msg) => {
            console.log(`🚫 [whatsapp-web-js] ${sessionName} auth_failure: ${msg}`);
            ev.emit('connection.update', {
                connection: 'close',
                lastDisconnect: {
                    error: { output: { statusCode: 401 }, message: msg || 'Auth failure' }
                }
            });
        });

        // Mensajes (entrantes y salientes)
        client.on('message_create', (msg) => {
            try {
                const remoteJid = (msg.fromMe ? msg.to : msg.from)
                    .replace('@c.us', '@s.whatsapp.net');

                ev.emit('messages.upsert', {
                    messages: [{
                        key: {
                            fromMe: msg.fromMe,
                            remoteJid,
                            id: msg.id?._serialized || String(Date.now()),
                            participant: msg.author
                                ? msg.author.replace('@c.us', '@s.whatsapp.net')
                                : undefined
                        },
                        message: {
                            conversation: msg.body || ''
                        },
                        messageTimestamp: Math.floor((msg.timestamp || Date.now() / 1000))
                    }],
                    type: 'notify'
                });
            } catch (e) {
                console.error(`❌ [whatsapp-web-js] Error procesando mensaje:`, e.message);
            }
        });

        // Cambio de estado de conexión
        client.on('change_state', (state) => {
            console.log(`📶 [whatsapp-web-js] ${sessionName} state: ${state}`);
        });
    }
}

module.exports = WhatsAppWebAdapter;
