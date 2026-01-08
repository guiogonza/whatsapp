/**
 * Session Manager - Proxy de compatibilidad
 * 
 * Este archivo mantiene compatibilidad con el código existente.
 * Toda la lógica ha sido modularizada en lib/session/
 * 
 * Estructura:
 * lib/session/
 * ├── index.js      - Exportaciones principales
 * ├── proxy.js      - Manejo de SOCKS5 proxy
 * ├── logging.js    - Registro de mensajes
 * ├── queue.js      - Consolidación y cola batch
 * ├── rotation.js   - Rotación de sesiones
 * ├── messaging.js  - Envío de mensajes
 * └── core.js       - Lógica principal de sesiones Baileys
 */

module.exports = require('./lib/session');


