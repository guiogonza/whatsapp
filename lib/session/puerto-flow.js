/**
 * Flujo "PUERTO" (Cloud API, mismo número que TURNO): el conductor/despachador del puerto escribe
 * PUERTO, el bot le lista las transportadoras de la app de turnos (numeradas), responde con el
 * número de la suya, luego el CLIENTE de Turnos (también numerado), la placa, y recibe un ENLACE ÚNICO para fotografiar
 * el manifiesto y los 4 precintos (en UNA sola foto)
 * (con OCR y confirmación del número por quien toma la foto). Los datos y las fotos se guardan
 * en Turnos (turnos_co) para compararlos después, cuando el vehículo se enturna.
 *
 * Todo lo que no es conversación vive en Turnos: aquí solo se pide la lista, se abre la sesión
 * (POST /api/puerto/sesion) y se manda el enlace. Autenticación: X-Bot-Secret = PUERTO_BOT_SECRET
 * (mismo valor que en el .env de turnos_co).
 *
 * El estado de la conversación (esperando el número de transportadora) vive en memoria, como el
 * menú de Cointra: se pierde si se reinicia el bot y el usuario solo vuelve a escribir PUERTO.
 */
const axios = require('axios');
const config = require('../../config');
const cloudApi = require('./whatsapp-cloud-api');

const MINUTOS_ESPERA = config.BOT_INACTIVIDAD_MIN;
const MAX_CARACTERES_MENSAJE = 3500; // WhatsApp admite 4096; margen para el encabezado
// Placa de carro colombiana: 3 letras + 3 números, sin espacios ni guiones (igual que Turnos)
const PLACA_RE = /^[A-Za-z]{3}[0-9]{3}$/;
// Transportadoras (nombre en mayúsculas, separadas por coma en el .env) que eligen cliente de Turnos antes de la placa
const TRANSPORTADORAS_CON_CLIENTE = (process.env.PUERTO_CLIENTE_TRANSPORTADORAS || 'COINTRA')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const sesiones = new Map(); // teléfono -> { transportadoras: [{id, nombre}], expira }

function api() {
    return axios.create({
        baseURL: config.TURNOS_API_URL,
        timeout: 15000,
        headers: { 'X-Bot-Secret': config.PUERTO_BOT_SECRET }
    });
}

function limpiarVencidas() {
    const ahora = Date.now();
    for (const [telefono, s] of sesiones) {
        if (s.expira < ahora) sesiones.delete(telefono);
    }
}

function esPalabraClave(texto) {
    return config.PUERTO_TRIGGER_KEYWORDS.includes((texto || '').trim().toUpperCase());
}

/** ¿Este teléfono está en medio del flujo (eligiendo transportadora)? */
function tieneSesion(telefono) {
    limpiarVencidas();
    return sesiones.has(telefono);
}

/** Parte la lista numerada en mensajes que quepan en WhatsApp. */
function partirEnMensajes(encabezado, lineas, pie) {
    const mensajes = [];
    let actual = encabezado;
    for (const linea of lineas) {
        if ((actual + linea + '\n').length > MAX_CARACTERES_MENSAJE) {
            mensajes.push(actual.trimEnd());
            actual = '';
        }
        actual += linea + '\n';
    }
    mensajes.push((actual + pie).trimEnd());
    return mensajes;
}

async function responder(telefono, texto) {
    await cloudApi.sendTextMessage(telefono, texto);
}

async function iniciar(telefono) {
    // Quien escribe con nombre de usuario de WhatsApp llega sin telefono: este flujo lo necesita (queda en el registro y
    // recibe la confirmacion), asi que se le explica en vez de fallar mas adelante.
    if (!/^\d{8,15}$/.test(String(telefono))) {
        await responder(telefono, '⚠️ Para registrar en puerto necesitamos tu número de teléfono y WhatsApp no lo está compartiendo desde tu cuenta (usas nombre de usuario). Pide a un compañero que haga el registro o comparte tu número en los ajustes de privacidad de WhatsApp, y vuelve a escribir *PUERTO*.');
        return;
    }
    let transportadoras;
    try {
        const r = await api().get('/api/puerto/transportadoras');
        transportadoras = r.data.transportadoras || [];
    } catch (error) {
        console.error(`[PUERTO] ❌ No se pudo leer las transportadoras: ${error.message}`);
        await responder(telefono, '⚠️ No pudimos consultar las transportadoras en este momento. Intenta de nuevo en unos minutos escribiendo *PUERTO*.');
        return;
    }
    if (transportadoras.length === 0) {
        await responder(telefono, '⚠️ No hay transportadoras registradas. Comunícate con el administrador.');
        return;
    }
    sesiones.set(telefono, { paso: 'TRANSPORTADORA', transportadoras, expira: Date.now() + MINUTOS_ESPERA * 60 * 1000 });
    const lineas = transportadoras.map((t, i) => `*${i + 1}* - ${t.nombre}`);
    const mensajes = partirEnMensajes(
        '📦 *Registro en puerto*\n\nSelecciona tu empresa transportadora enviando el número correspondiente:\n\n',
        lineas,
        '\nEnvía *SALIR* para cancelar.'
    );
    for (const m of mensajes) await responder(telefono, m);
}

async function elegir(telefono, texto) {
    const sesion = sesiones.get(telefono);
    const numero = parseInt(texto, 10);
    if (!/^\d{1,3}$/.test(texto) || numero < 1 || numero > sesion.transportadoras.length) {
        await responder(telefono, `❌ Opción no válida. Envía un número del *1* al *${sesion.transportadoras.length}*, o *SALIR* para cancelar.`);
        return;
    }
    sesion.transportadora = sesion.transportadoras[numero - 1];
    sesion.expira = Date.now() + MINUTOS_ESPERA * 60 * 1000;

    // Solo las transportadoras listadas (por defecto COINTRA) preguntan el CLIENTE de la carga; las demás van directo a la placa
    if (!TRANSPORTADORAS_CON_CLIENTE.includes(sesion.transportadora.nombre.trim().toUpperCase())) {
        await pedirPlaca(telefono, sesion);
        return;
    }
    // Se consultan los clientes activos de Turnos
    let clientes;
    try {
        const r = await api().get('/api/puerto/clientes');
        clientes = r.data.clientes || [];
    } catch (error) {
        console.error(`[PUERTO] ❌ No se pudo leer los clientes: ${error.message}`);
        sesiones.delete(telefono);
        await responder(telefono, '⚠️ No pudimos consultar los clientes en este momento. Intenta de nuevo en unos minutos escribiendo *PUERTO*.');
        return;
    }
    if (clientes.length === 0) { // Turnos todavia no tiene clientes: se sigue sin ese paso
        await pedirPlaca(telefono, sesion);
        return;
    }
    sesion.clientes = clientes;
    sesion.paso = 'CLIENTE';
    const lineas = clientes.map((c, i) => `*${i + 1}* - ${c.nombre}`);
    const mensajes = partirEnMensajes(
        `🚛 *${sesion.transportadora.nombre}*\n\nSelecciona el *cliente* al que pertenece la carga enviando el número correspondiente:\n\n`,
        lineas,
        '\nEnvía *SALIR* para cancelar.'
    );
    for (const m of mensajes) await responder(telefono, m);
}

async function elegirCliente(telefono, texto) {
    const sesion = sesiones.get(telefono);
    const numero = parseInt(texto, 10);
    if (!/^\d{1,3}$/.test(texto) || numero < 1 || numero > sesion.clientes.length) {
        await responder(telefono, `❌ Opción no válida. Envía un número del *1* al *${sesion.clientes.length}*, o *SALIR* para cancelar.`);
        return;
    }
    sesion.cliente = sesion.clientes[numero - 1];
    await pedirPlaca(telefono, sesion);
}

async function pedirPlaca(telefono, sesion) {
    sesion.paso = 'PLACA';
    sesion.expira = Date.now() + MINUTOS_ESPERA * 60 * 1000;
    const encabezado = sesion.cliente ? `🚛 *${sesion.transportadora.nombre}* · 🏢 *${sesion.cliente.nombre}*` : `🚛 *${sesion.transportadora.nombre}*`;
    await responder(telefono, `${encabezado}

Escribe la *placa* del vehículo: 3 letras y 3 números, sin espacios ni guiones (ejemplo: *ABC123*).

Envía *SALIR* para cancelar.`);
}

async function recibirPlaca(telefono, texto) {
    const sesion = sesiones.get(telefono);
    if (!PLACA_RE.test(texto)) {
        await responder(telefono, '❌ Placa no válida. Debe tener *3 letras y 3 números*, sin espacios ni caracteres especiales (ejemplo: *ABC123*). Escríbela de nuevo, o envía *SALIR* para cancelar.');
        return;
    }
    const placa = texto.toUpperCase();
    const elegida = sesion.transportadora;
    let datos;
    try {
        const r = await api().post('/api/puerto/sesion', {
            telefono, transportadora_id: elegida.id, placa, ...(sesion.cliente ? { cliente_id: sesion.cliente.id } : {})
        });
        datos = r.data;
    } catch (error) {
        console.error(`[PUERTO] ❌ No se pudo crear la sesión: ${error.message}`);
        sesiones.delete(telefono);
        await responder(telefono, '⚠️ No pudimos generar el enlace en este momento. Intenta de nuevo escribiendo *PUERTO*.');
        return;
    }
    sesiones.delete(telefono);

    const resultado = await cloudApi.sendInteractiveMessage(telefono, {
        type: 'cta_url',
        body: {
            text: `📦 *${elegida.nombre}*${sesion.cliente ? ` · *${sesion.cliente.nombre}*` : ''} · *${placa}*\n\nToca el botón para tomar *2 fotos*: el *manifiesto* y los *4 precintos juntos* en una sola. ` +
                  'Después de cada foto confirma los números que lee el sistema.\n\nEl enlace es personal y vence en 30 minutos.'
        },
        action: { name: 'cta_url', parameters: { display_text: 'Cargar fotos', url: datos.url } }
    });
    if (!resultado.success) {
        console.error(`[PUERTO] ❌ No se pudo enviar el botón, usando texto plano: ${resultado.error?.message}`);
        await responder(telefono, `📦 *${elegida.nombre}*${sesion.cliente ? ` · *${sesion.cliente.nombre}*` : ''} · *${placa}*\n\nIngresa a este enlace y toma 2 fotos: el manifiesto y los 4 precintos juntos en una sola:\n${datos.url}`);
    }
}

/**
 * Devuelve true si el mensaje era del flujo PUERTO (el webhook no debe pasarlo a otros bots).
 * `texto` = cuerpo del mensaje de texto (puede ser null si llegó otro tipo de mensaje).
 */
async function manejar(telefono, texto) {
    const limpio = (texto || '').trim();
    if (esPalabraClave(limpio)) {
        await iniciar(telefono);
        return true;
    }
    if (!tieneSesion(telefono)) return false;
    sesiones.get(telefono).expira = Date.now() + MINUTOS_ESPERA * 60 * 1000; // cada mensaje reinicia la cuenta

    if (['SALIR', 'CANCELAR'].includes(limpio.toUpperCase())) {
        sesiones.delete(telefono);
        await responder(telefono, '👍 Listo, cancelé el registro en puerto. Escribe *PUERTO* cuando quieras empezar de nuevo.');
        return true;
    }
    if (sesiones.get(telefono).paso === 'PLACA') {
        await recibirPlaca(telefono, limpio);
        return true;
    }
    // Solo un número (o algo que lo intente ser) pertenece a este flujo; cualquier otra cosa
    // (otra palabra clave, una foto...) cierra la espera y sigue su camino normal.
    if (!/^\d+$/.test(limpio)) {
        sesiones.delete(telefono);
        return false;
    }
    if (sesiones.get(telefono).paso === 'CLIENTE') await elegirCliente(telefono, limpio);
    else await elegir(telefono, limpio);
    return true;
}

module.exports = { manejar, tieneSesion, esPalabraClave };
