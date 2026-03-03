/**
 * WPPConnect Adapter
 * Usa @wppconnect-team/wppconnect (basado en Puppeteer/Chromium) con interfaz Baileys-compatible.
 * 
 * Diferencias clave vs Baileys y whatsapp-web.js:
 * - Usa Puppeteer con inyección WPP4NodeJS (fingerprint de navegador real)
 * - QR automático con callback directo (base64 ya listo)
 * - Auth persistente via tokenStore de archivos
 * - StatusFind callback para monitorear estado de sesión
 * - Mayor consumo de memoria (~100-200MB por sesión) pero fingerprint completamente diferente
 * 
 * REQUIERE: npm install @wppconnect-team/wppconnect
 * El Dockerfile ya incluye Chromium (/usr/bin/chromium)
 */
const BaseAdapter = require('./base-adapter');
const EventEmitter = require('events');
const path = require('path');

class WPPConnectAdapter extends BaseAdapter {
    constructor() {
        super('wppconnect');
    }

    /**
     * Verifica si @wppconnect-team/wppconnect está instalado
     */
    static isAvailable() {
        try {
            require('@wppconnect-team/wppconnect');
            return true;
        } catch (e) {
            return false;
        }
    }

    async connect(authPath, options = {}) {
        let wppconnect;
        try {
            wppconnect = require('@wppconnect-team/wppconnect');
        } catch (e) {
            throw new Error('@wppconnect-team/wppconnect no instalado. Ejecuta: npm install @wppconnect-team/wppconnect');
        }

        const sessionName = path.basename(authPath);

        // Crear EventEmitter Baileys-compatible
        const ev = new EventEmitter();

        // Crear wrapper del socket (se completa cuando el cliente está listo)
        const socket = this._createSocketWrapper(null, ev);

        // Configurar Puppeteer args
        const puppeteerArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--single-process',
            '--no-zygote',
            '--disable-accelerated-2d-canvas',
            '--no-first-run'
        ];

        // Si hay proxy agent en options, extraer la URL del proxy para Chromium
        // WPPConnect no usa SocksProxyAgent sino que pasa el proxy directo a Chromium
        if (options.agent && options.agent.proxy) {
            const proxyUrl = options.agent.proxy;
            const proxyHost = `${proxyUrl.host}:${proxyUrl.port}`;
            puppeteerArgs.push(`--proxy-server=socks5://${proxyHost}`);
            console.log(`🌐 [wppconnect] Proxy configurado para Chromium: socks5://${proxyHost}`);
        }

        // Crear sesión WPPConnect
        console.log(`🔗 [wppconnect] Iniciando sesión ${sessionName} con Chromium...`);

        const createOptions = {
            session: sessionName,
            headless: true,
            devtools: false,
            useChrome: false, // Usar Chromium del sistema
            debug: false,
            logQR: false, // No mostrar QR en terminal, lo manejamos nosotros
            disableWelcome: true,
            updatesLog: false,
            autoClose: 0, // No cerrar automáticamente (nosotros controlamos el ciclo de vida)
            folderNameToken: authPath, // Guardar tokens en la carpeta de la sesión
            tokenStore: 'file',

            // Puppeteer options
            puppeteerOptions: {
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
                headless: true,
                args: puppeteerArgs
            },

            // Callback QR: WPPConnect entrega base64 directamente
            catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
                console.log(`📱 [wppconnect] QR generado para ${sessionName} (intento ${attempts})`);
                // WPPConnect entrega base64 con data URI, pero core.js espera el string raw del QR
                // urlCode es el data-ref del QR (string puro que Baileys también usa)
                ev.emit('connection.update', { qr: urlCode || base64Qr });
            },

            // StatusFind callback: monitorear estado de la sesión
            statusFind: (statusSession, session) => {
                console.log(`📶 [wppconnect] ${sessionName} statusFind: ${statusSession}`);

                switch (statusSession) {
                    case 'isLogged':
                        // Ya autenticado, esperando 'ready'
                        break;

                    case 'notLogged':
                        // Necesita escanear QR (ya se emite via catchQR)
                        break;

                    case 'qrReadSuccess':
                        console.log(`✅ [wppconnect] ${sessionName} QR leído exitosamente`);
                        break;

                    case 'qrReadFail':
                        console.log(`❌ [wppconnect] ${sessionName} QR lectura fallida`);
                        ev.emit('connection.update', {
                            connection: 'close',
                            lastDisconnect: {
                                error: { output: { statusCode: 428 }, message: 'QR read failed' }
                            }
                        });
                        break;

                    case 'browserClose':
                    case 'autocloseCalled':
                        console.log(`📴 [wppconnect] ${sessionName} browser cerrado: ${statusSession}`);
                        ev.emit('connection.update', {
                            connection: 'close',
                            lastDisconnect: {
                                error: { output: { statusCode: 428 }, message: statusSession }
                            }
                        });
                        break;

                    case 'desconnectedMobile':
                        console.log(`📴 [wppconnect] ${sessionName} desconectado del móvil`);
                        ev.emit('connection.update', {
                            connection: 'close',
                            lastDisconnect: {
                                error: { output: { statusCode: 401 }, message: 'Disconnected from mobile' }
                            }
                        });
                        break;

                    case 'serverClose':
                        console.log(`📴 [wppconnect] ${sessionName} WebSocket cerrado`);
                        ev.emit('connection.update', {
                            connection: 'close',
                            lastDisconnect: {
                                error: { output: { statusCode: 515 }, message: 'Server close - restart required' }
                            }
                        });
                        break;

                    case 'deleteToken':
                        console.log(`🗑️ [wppconnect] ${sessionName} token eliminado`);
                        ev.emit('connection.update', {
                            connection: 'close',
                            lastDisconnect: {
                                error: { output: { statusCode: 401 }, message: 'Token deleted - logged out' }
                            }
                        });
                        break;
                }
            }
        };

        // Inicializar WPPConnect (asíncrono, no bloqueante)
        // wppconnect.create() retorna una Promise que resuelve cuando el cliente está listo
        wppconnect.create(createOptions)
            .then((client) => {
                console.log(`✅ [wppconnect] ${sessionName} cliente creado exitosamente`);

                // Actualizar el wrapper del socket con el cliente real
                socket._wppClient = client;

                // Obtener info del usuario conectado
                this._setupClientInfo(client, socket, sessionName, ev);

                // Configurar recepción de mensajes
                this._setupMessageHandling(client, ev, sessionName);
            })
            .catch((error) => {
                console.error(`❌ [wppconnect] Error creando sesión ${sessionName}:`, error.message);
                ev.emit('connection.update', {
                    connection: 'close',
                    lastDisconnect: {
                        error: { output: { statusCode: 500 }, message: error.message }
                    }
                });
            });

        // saveCreds no-op (WPPConnect maneja la persistencia via tokenStore)
        const saveCreds = async () => {};

        return { socket, saveCreds, adapterType: this.adapterName };
    }

    /**
     * Configura info del usuario y emite conexión abierta
     */
    async _setupClientInfo(client, socket, sessionName, ev) {
        try {
            const hostDevice = await client.getHostDevice();
            const phoneNumber = hostDevice?.wid?.user || hostDevice?.id?.user || '';

            // Establecer user en el socket ANTES de emitir 'open'
            socket.user = {
                id: `${phoneNumber}:0@s.whatsapp.net`,
                name: hostDevice?.pushname || 'Usuario'
            };
            socket.authState = {
                creds: {
                    me: {
                        id: `${phoneNumber}:0@s.whatsapp.net`,
                        lid: null
                    }
                }
            };

            console.log(`✅ [wppconnect] ${sessionName} conectado: ${phoneNumber}`);
            ev.emit('connection.update', { connection: 'open', isNewLogin: false });
        } catch (error) {
            console.error(`⚠️ [wppconnect] Error obteniendo info de ${sessionName}:`, error.message);
            // Intentar emitir 'open' de todas formas 
            ev.emit('connection.update', { connection: 'open', isNewLogin: false });
        }
    }

    /**
     * Configura la recepción de mensajes y los traduce al formato Baileys
     */
    _setupMessageHandling(client, ev, sessionName) {
        // Mensajes entrantes
        client.onMessage((message) => {
            try {
                const remoteJid = (message.from || '').replace('@c.us', '@s.whatsapp.net');
                
                ev.emit('messages.upsert', {
                    messages: [{
                        key: {
                            fromMe: false,
                            remoteJid,
                            id: message.id || String(Date.now()),
                            participant: message.author
                                ? message.author.replace('@c.us', '@s.whatsapp.net')
                                : undefined
                        },
                        message: {
                            conversation: message.body || ''
                        },
                        messageTimestamp: Math.floor((message.timestamp || Date.now() / 1000))
                    }],
                    type: 'notify'
                });
            } catch (e) {
                console.error(`❌ [wppconnect] Error procesando mensaje entrante en ${sessionName}:`, e.message);
            }
        });

        // Mensajes enviados por nosotros (ACK)
        client.onAnyMessage((message) => {
            try {
                if (message.fromMe) {
                    const remoteJid = (message.to || '').replace('@c.us', '@s.whatsapp.net');

                    ev.emit('messages.upsert', {
                        messages: [{
                            key: {
                                fromMe: true,
                                remoteJid,
                                id: message.id || String(Date.now())
                            },
                            message: {
                                conversation: message.body || ''
                            },
                            messageTimestamp: Math.floor((message.timestamp || Date.now() / 1000))
                        }],
                        type: 'notify'
                    });
                }
            } catch (e) {
                // Silenciar errores de mensajes propios
            }
        });

        // Detectar desconexión
        client.onStateChange((state) => {
            console.log(`📶 [wppconnect] ${sessionName} state change: ${state}`);
            
            const disconnectedStates = ['CONFLICT', 'UNPAIRED', 'UNLAUNCHED'];
            if (disconnectedStates.includes(state)) {
                ev.emit('connection.update', {
                    connection: 'close',
                    lastDisconnect: {
                        error: { output: { statusCode: 428 }, message: `State: ${state}` }
                    }
                });
            }
        });
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
            _wppClient: client, // Se actualiza cuando el cliente está listo

            async sendMessage(jid, content) {
                const wppClient = socket._wppClient;
                if (!wppClient) {
                    throw new Error('WPPConnect client no inicializado aún');
                }

                const chatId = jid.replace('@s.whatsapp.net', '@c.us');

                if (content.text) {
                    return await wppClient.sendText(chatId, content.text);
                }

                // Mensajes multimedia
                let buffer, mimetype, filename, caption;

                if (content.image) {
                    buffer = content.image;
                    mimetype = content.mimetype || 'image/jpeg';
                    filename = 'image.jpg';
                    caption = content.caption || '';
                } else if (content.video) {
                    buffer = content.video;
                    mimetype = content.mimetype || 'video/mp4';
                    filename = 'video.mp4';
                    caption = content.caption || '';
                } else if (content.audio) {
                    buffer = content.audio;
                    mimetype = content.mimetype || 'audio/mpeg';
                    filename = 'audio.mp3';
                } else if (content.document) {
                    buffer = content.document;
                    mimetype = content.mimetype || 'application/octet-stream';
                    filename = content.fileName || 'document';
                    caption = content.caption || '';
                }

                if (buffer) {
                    const base64Data = Buffer.isBuffer(buffer) ? buffer.toString('base64') : buffer;
                    const dataUri = `data:${mimetype};base64,${base64Data}`;

                    // WPPConnect usa sendFile con base64 data URI
                    return await wppClient.sendFile(chatId, dataUri, filename, caption || '');
                }

                throw new Error('Tipo de mensaje no soportado por WPPConnect adapter');
            },

            async logout() {
                try {
                    if (socket._wppClient) {
                        await socket._wppClient.logout();
                    }
                } catch (e) {}
            },

            end() {
                try {
                    if (socket._wppClient) {
                        socket._wppClient.close();
                    }
                } catch (e) {}
            },

            ws: {
                close() {
                    try {
                        if (socket._wppClient) {
                            socket._wppClient.close();
                        }
                    } catch (e) {}
                }
            }
        };

        return socket;
    }
}

module.exports = WPPConnectAdapter;
