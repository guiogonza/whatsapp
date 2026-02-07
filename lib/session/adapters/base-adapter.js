/**
 * Base Adapter - Interfaz abstracta para librerías de WhatsApp
 * Todos los adaptadores deben implementar el método connect()
 * que retorna un socket compatible con la interfaz de Baileys.
 */
const EventEmitter = require('events');

class BaseAdapter extends EventEmitter {
    constructor(name) {
        super();
        this.adapterName = name;
    }

    /**
     * Inicializa la conexión y retorna un socket Baileys-compatible
     * @param {string} authPath - Ruta para almacenar datos de autenticación
     * @param {object} options - Opciones de conexión { logger, agent (proxy) }
     * @returns {object} - { socket, saveCreds, adapterType }
     *   socket debe tener: .ev (EventEmitter), .user, .sendMessage(), .logout(), .end(), .ws.close()
     *   socket.ev debe emitir: 'connection.update', 'messages.upsert', 'creds.update'
     */
    async connect(authPath, options = {}) {
        throw new Error(`connect() must be implemented by adapter: ${this.adapterName}`);
    }

    /**
     * Retorna el nombre del tipo de adaptador
     */
    getType() {
        return this.adapterName;
    }
}

module.exports = BaseAdapter;
