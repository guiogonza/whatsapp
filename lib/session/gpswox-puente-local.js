/**
 * Puente LOCAL para el módulo de chat de GPSwox (gpswox-session.js).
 *
 * El flujo de HESEGO / RASTREAR / COINTRA nació en `hesego-operatividad`, que no tiene sesión de WhatsApp y le pedía a este bot
 * (por HTTP, con `whatsappSender.js`) que arrancara la Inspección o el Preoperacional. Ahora que el flujo puede correr dentro de
 * este mismo bot, esas tres acciones se hacen directo, con la sesión real, sin dar la vuelta por la red. Misma lógica y mismas
 * respuestas ({ success, error }) que los endpoints `/api/gpswox/session/start-inspection` y `/start-preop` de server-baileys.js.
 */
const config = require('../../config');

/** Sesión GPSwox lista para escribir, o null si no está conectada. */
function sesionLista() {
    const sessionManager = require('./index');   // se pide aquí (no arriba) para evitar la dependencia circular al arrancar
    const nombre = config.GPSWOX_SESSION_NAME;
    const session = sessionManager.getSession(nombre);
    if (!session || !session.socket || session.state !== config.SESSION_STATES.READY) return null;
    return { session, nombre };
}

const aJid = (telefono) => (String(telefono).includes('@') ? String(telefono) : `${telefono}@s.whatsapp.net`);

async function ejecutar(telefono, etiqueta, accion) {
    try {
        const s = sesionLista();
        if (!s) return { success: false, error: 'Sesion GPSwox no disponible' };
        await accion(s.session, s.nombre, aJid(telefono));
        return { success: true };
    } catch (error) {
        console.error(`❌ Error iniciando ${etiqueta} para ${telefono}:`, error.message);
        return { success: false, error: error.message };
    }
}

/** Opción «Inspección Hesego» del menú. */
function startInspection(telefono) {
    return ejecutar(telefono, 'inspección', (session, nombre, jid) =>
        require('./inspeccion-flow').handleMessage(session, nombre, jid, 'INSPECCION', null, session.socket));
}

/** Opción «Preoperacional» del menú de Rastrear (la empresa queda fija en RASTREAR). */
function startPreopRastrear(telefono) {
    return ejecutar(telefono, 'preoperacional Rastrear', async (session, nombre, jid) => {
        require('./empresa-pref').guardar(jid, 'rastrear').catch(() => {});   // el «PREOP» siguiente entra por la misma empresa
        await require('./preop-flow').handleMessage(session, nombre, jid, 'PREOPR', null, session.socket);
    });
}

/** Menú de Cointra: accion = 'inicio' (preoperacional como inicio de jornada) | 'fin' (placa + odómetro final). */
function startJornadaCointra(telefono, accion) {
    return ejecutar(telefono, 'jornada Cointra', async (session, nombre, jid) => {
        require('./empresa-pref').guardar(jid, 'cointra').catch(() => {});
        const preopFlow = require('./preop-flow');
        if (accion === 'fin') await preopFlow.iniciarFinJornada(session, jid);
        else await preopFlow.iniciarJornada(session, jid);
    });
}

module.exports = { startInspection, startPreopRastrear, startJornadaCointra };
