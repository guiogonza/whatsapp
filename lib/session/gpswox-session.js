/**
 * Módulo de Sesión Especial plataformagps
 * Maneja el flujo conversacional para registro de usuarios y asignación de placas
 *
 * Flujo:
 * 1. Usuario envía correo electrónico
 * 2. Sistema valida formato de correo
 * 3. Sistema verifica si el correo existe en plataformagps
 * 4. Sistema solicita placa del vehículo
 * 5. Sistema formatea placa (agrega guion después de 3 caracteres)
 * 6. Sistema valida si la placa existe en plataformagps
 * 7. Sistema asigna la placa al usuario
 *
 * NOTA: Este módulo ya no recibe el socket real de Baileys. El webhook
 * (routes/webhook.js) le pasa un socket "shim" (lib/whatsappSender.js) que
 * reenvía cada sendMessage() como un POST HTTP hacia el proyecto
 * whatsapp-docker, que es quien mantiene la conexión real de WhatsApp.
 */
// NOTA (nov. 2026): copia del flujo de produccion de hesego-operatividad/lib/gpswox-session.js adaptada a este repo (rutas de require, puentes
// locales en gpswox-puente-local.js y las dos funciones extra de abajo). Si cambia el original, repetir la adaptacion.


const config = require('../../config');
const database = require('../../database-postgres');
const { getCountryFromIP, getSocketIP } = require('./utils');
const {
    isValidEmail,
    formatPlate,
    isValidPlateFormat,
    findUserByEmail,
    findDeviceByPlate,
    assignDeviceToUser,
    removeDeviceFromUser,
    getDeviceUserIdsEstricto,
    invalidateClientsCache
} = require('./gpswox-api');
const operational = require('./gpswox-operational');
const { startInspection, startPreopRastrear, startJornadaCointra } = require('./gpswox-puente-local');

// Estados del flujo conversacional
const CONVERSATION_STATES = {
    MENU: 'menu',
    OPTION_1_EMAIL: 'option_1_email',
    OPTION_1_PLATE: 'option_1_plate',
    OPTION_1_ASSIGNING: 'option_1_assigning',
    // Opcion 9: quitar usuario de vehiculo (el contrario de la 1)
    OPTION_9_EMAIL: 'option_9_email',
    OPTION_9_PLATE: 'option_9_plate',
    OPTION_9_CONFIRM: 'option_9_confirm',
    OPTION_2_PLATE: 'option_2_plate',
    OPTION_3_EMAIL: 'option_3_email',
    COMPLETED: 'completed',
    ERROR: 'error',
    // Menú propio de Rastrear (independiente del de Hesego de arriba) -- misma
    // sesión de WhatsApp, pero otro set de opciones (ver showRastrearMenu).
    RASTREAR_MENU: 'rastrear_menu',
    RASTREAR_OPTION_2_PLATE: 'rastrear_option_2_plate',
    // Menú de Cointra: 1 inicio de jornada, 2 fin de jornada (ver showCointraMenu).
    COINTRA_MENU: 'cointra_menu'
};

// Estados que pertenecen al menú de Rastrear (vs. los de Hesego arriba) -- usado
// para que "MENU" reabra el menú correcto según en cuál estabas, y para que
// "HESEGO"/"RASTREAR" sepan si hace falta resetear algo al entrar desde el otro.
const ESTADOS_RASTREAR = new Set([CONVERSATION_STATES.RASTREAR_MENU, CONVERSATION_STATES.RASTREAR_OPTION_2_PLATE]);

// Teléfonos que usaron el menú de Cointra (teléfono -> última vez). Terminado el flujo (enlace de fotos o
// fin de jornada), cualquier mensaje suyo reabre el menú de Cointra en vez del aviso de "bot de notificaciones".
// "SALIR" los olvida. En memoria: se pierde al reiniciar el servicio.
const COINTRA_RECUERDO_MS = 24 * 60 * 60 * 1000;
const cointraRecordados = new Map();
function recordarCointra(phone) { cointraRecordados.set(phone, Date.now()); }
function esCointraReciente(phone) {
    const t = cointraRecordados.get(phone);
    if (!t) return false;
    if (Date.now() - t > COINTRA_RECUERDO_MS) { cointraRecordados.delete(phone); return false; }
    return true;
}

// Almacén de conversaciones activas: { phoneNumber: { state, data } }
const activeConversations = new Map();

// Contador de mensajes por número: { phoneNumber: { count, firstMessageTime } }
const messageCounter = new Map();
// Tope de mensajes por numero cada 24 h (antes 40: con tantas opciones en los menus la gente lo gastaba)
const MAX_MESSAGES_PER_NUMBER = parseInt(process.env.BOT_MAX_MENSAJES_DIA || '100', 10);
const MESSAGE_COUNTER_RESET = 24 * 60 * 60 * 1000; // Reset cada 24 horas

// Bloqueo temporal por escribir 5 palabras que no corresponden a las opciones del bot (palabras sueltas sin
// conversacion, u opciones invalidas dentro de un menu): { phoneNumber: { intentos, bloqueos, bloqueadoHasta,
// ultimo, avisadoAt } }. El primer bloqueo dura 10 min; si despues de eso vuelve a escribir otras 5, el
// siguiente es de 30 min (y los que sigan, tambien de 30). El escalon se olvida tras 24 h sin intentos fallidos.
// Evita que alguien siga mandando mensajes a un bot que no los lee (y corta el gasto de responder una y otra vez).
const intentosFallidos = new Map();
const MAX_INTENTOS_PALABRA = parseInt(process.env.BOT_INTENTOS_PALABRA || '5', 10);
const BLOQUEOS_PALABRA_MS = [
    parseInt(process.env.BOT_BLOQUEO_1_MIN || '10', 10) * 60 * 1000,
    parseInt(process.env.BOT_BLOQUEO_2_MIN || '30', 10) * 60 * 1000
];
const AVISO_BLOQUEO_CADA_MS = 60 * 1000; // mientras esta bloqueado solo se le recuerda cuanto falta 1 vez por minuto

// Timeout para limpiar conversaciones inactivas (30 minutos)
// 5 minutos sin que la persona conteste: la conversacion se reinicia por completo (se revisa al LEER, no solo en la limpieza periodica)
const CONVERSATION_TIMEOUT = parseInt(process.env.BOT_INACTIVIDAD_MIN || '5', 10) * 60 * 1000;

// Cache de información de conexión por número (IP y país)
const connectionInfoCache = new Map();

async function getConnectionInfo(socket, senderPhone) {
    const cached = connectionInfoCache.get(senderPhone);
    if (cached && (Date.now() - cached.timestamp < 3600000)) {
        return { ip: cached.ip, country: cached.country };
    }

    let ip = getSocketIP(socket);
    let country = 'Desconocido';

    if (ip) {
        country = await getCountryFromIP(ip);
    } else {
        ip = 'Desconocido';
    }

    connectionInfoCache.set(senderPhone, {
        ip,
        country,
        timestamp: Date.now()
    });

    return { ip, country };
}

function cleanPhoneNumber(senderPhone) {
    return senderPhone.replace('@s.whatsapp.net', '').replace('@c.us', '').split(':')[0];
}

function cleanInactiveConversations() {
    const now = Date.now();
    for (const [phone, conversation] of activeConversations.entries()) {
        if (now - conversation.lastActivity > CONVERSATION_TIMEOUT) {
            console.log(`🧹 Limpiando conversación inactiva: ${phone}`);
            activeConversations.delete(phone);
        }
    }
    for (const [phone, counter] of messageCounter.entries()) {
        if (now - counter.firstMessageTime > MESSAGE_COUNTER_RESET) {
            messageCounter.delete(phone);
        }
    }
    for (const [phone, estado] of intentosFallidos.entries()) {
        const bloqueadoAun = !!estado.bloqueadoHasta && now < estado.bloqueadoHasta;
        if (!bloqueadoAun && (now - (estado.ultimo || 0)) > MESSAGE_COUNTER_RESET) intentosFallidos.delete(phone);
    }
}

setInterval(cleanInactiveConversations, 60 * 1000);

function checkMessageLimit(phoneNumber) {
    const now = Date.now();
    let counter = messageCounter.get(phoneNumber);

    if (!counter || (now - counter.firstMessageTime) > MESSAGE_COUNTER_RESET) {
        counter = { count: 0, firstMessageTime: now };
        messageCounter.set(phoneNumber, counter);
    }

    counter.count++;

    if (counter.count > MAX_MESSAGES_PER_NUMBER) {
        console.log(`🚫 Límite de mensajes alcanzado para ${phoneNumber}: ${counter.count}/${MAX_MESSAGES_PER_NUMBER}`);
        return false;
    }

    return true;
}

/** Texto del aviso de bloqueo. */
function textoBloqueo(minutos) {
    return `🚫 Escribiste mal varias veces. Por seguridad, espera *${minutos} minuto${minutos === 1 ? '' : 's'}* antes de volver a intentar.`;
}

/**
 * Registra un mensaje que no corresponde a las opciones del bot (palabra suelta sin conversacion u opcion
 * invalida de un menu). Al llegar a MAX_INTENTOS_PALABRA (5) bloquea: la primera vez 10 min, y si despues
 * vuelve a pasar, 30 min. Si ya esta bloqueado no suma: solo informa cuanto falta.
 * @returns {{bloqueado: boolean, minutosRestantes?: number}}
 */
function registrarIntentoFallido(phoneNumber) {
    const now = Date.now();
    const estado = intentosFallidos.get(phoneNumber) || { intentos: 0, bloqueos: 0, bloqueadoHasta: null, ultimo: 0, avisadoAt: 0 };

    if (estado.bloqueadoHasta && now < estado.bloqueadoHasta) {
        return { bloqueado: true, minutosRestantes: Math.ceil((estado.bloqueadoHasta - now) / 60000) };
    }

    // Sin bloqueo vigente (o ya vencido): el conteo de intentos sigue desde donde iba.
    estado.bloqueadoHasta = null;
    estado.intentos += 1;
    estado.ultimo = now;

    if (estado.intentos >= MAX_INTENTOS_PALABRA) {
        const duracion = BLOQUEOS_PALABRA_MS[Math.min(estado.bloqueos, BLOQUEOS_PALABRA_MS.length - 1)];
        estado.bloqueos += 1;
        estado.intentos = 0;
        estado.bloqueadoHasta = now + duracion;
        estado.avisadoAt = now;
        intentosFallidos.set(phoneNumber, estado);
        console.log(`🚫 ${phoneNumber} bloqueado ${Math.round(duracion / 60000)} min (bloqueo n.º ${estado.bloqueos}) por ${MAX_INTENTOS_PALABRA} mensajes que no corresponden a las opciones del bot`);
        return { bloqueado: true, minutosRestantes: Math.ceil(duracion / 60000) };
    }

    intentosFallidos.set(phoneNumber, estado);
    return { bloqueado: false };
}

/**
 * ¿Este numero esta bloqueado ahora? `avisar` = true cuando toca recordarle cuanto falta (como mucho 1 vez por minuto,
 * para no contestarle a cada mensaje mientras insiste).
 * @returns {{bloqueado: boolean, minutosRestantes?: number, avisar?: boolean}}
 */
function estadoBloqueo(phoneNumber) {
    const now = Date.now();
    const estado = intentosFallidos.get(phoneNumber);
    if (!estado || !estado.bloqueadoHasta || now >= estado.bloqueadoHasta) return { bloqueado: false };
    const avisar = now - (estado.avisadoAt || 0) >= AVISO_BLOQUEO_CADA_MS;
    if (avisar) estado.avisadoAt = now;
    return { bloqueado: true, minutosRestantes: Math.ceil((estado.bloqueadoHasta - now) / 60000), avisar };
}

/**
 * Se escribio una palabra de acceso valida: se borran los intentos fallidos seguidos. NO se borra el historial de
 * bloqueos (el escalon de 10 -> 30 min se olvida solo tras 24 h sin intentos fallidos).
 */
function limpiarIntentosFallidos(phoneNumber) {
    const estado = intentosFallidos.get(phoneNumber);
    if (estado) estado.intentos = 0;
}

/**
 * Respuesta a una opcion invalida dentro de un menu: cuenta como intento fallido; si con ese llega al limite, el
 * bloqueo corta la conversacion en curso y se le avisa cuanto debe esperar en vez del "opcion no valida".
 */
async function responderOpcionInvalida(socket, senderPhone, texto, tipoLog) {
    const intento = registrarIntentoFallido(senderPhone);
    let salida = texto, tipo = tipoLog;
    if (intento.bloqueado) {
        endConversation(senderPhone);
        salida = textoBloqueo(intento.minutosRestantes);
        tipo = 'BLOQUEO_INTENTOS';
    }
    await database.logGPSwoxMessage(cleanPhoneNumber(senderPhone), 'OUT', salida, tipo);
    await socket.sendMessage(senderPhone, { text: salida });
}

function startConversation(phoneNumber) {
    console.log(`🆕 Iniciando conversación con ${phoneNumber}`);

    activeConversations.set(phoneNumber, {
        state: CONVERSATION_STATES.MENU,
        data: {
            selectedOption: null,
            user: null,
            device: null,
            email: null,
            plate: null
        },
        startTime: Date.now(),
        lastActivity: Date.now()
    });
}

function getConversationState(phoneNumber) {
    const conversation = activeConversations.get(phoneNumber);
    if (conversation && Date.now() - conversation.lastActivity > CONVERSATION_TIMEOUT) {
        console.log(`⏱️ Conversación vencida por inactividad: ${phoneNumber}`);
        activeConversations.delete(phoneNumber);
        return undefined;
    }
    return conversation;
}

function updateConversation(phoneNumber, updates) {
    const conversation = activeConversations.get(phoneNumber);
    if (conversation) {
        Object.assign(conversation, updates);
        conversation.lastActivity = Date.now();
    }
}

function endConversation(phoneNumber) {
    console.log(`✅ Finalizando conversación con ${phoneNumber}`);
    activeConversations.delete(phoneNumber);
}

function hasActiveConversation(phoneNumber) {
    return !!getConversationState(phoneNumber); // respeta la caducidad por inactividad
}

/**
 * Procesa un mensaje entrante en el flujo de registro plataformagps
 */
async function processGPSwoxMessage(session, sessionName, socket, senderPhone, messageText, canStartNewConversation = false) {
    try {
        const operationalProcessed = await operational.processOperationalMessage(session, sessionName, socket, senderPhone, messageText);
        if (operationalProcessed) {
            return true;
        }

        const { ip, country } = await getConnectionInfo(socket, senderPhone);

        const cleanPhone = cleanPhoneNumber(senderPhone);
        await database.logGPSwoxMessage(cleanPhone, 'IN', messageText, null, null, ip, country);

        if (!checkMessageLimit(senderPhone)) {
            const counter = messageCounter.get(senderPhone);
            if (counter && counter.count === MAX_MESSAGES_PER_NUMBER + 1) {
                await socket.sendMessage(senderPhone, {
                    text: `⚠️ Has alcanzado el límite de *${MAX_MESSAGES_PER_NUMBER} mensajes*. Por favor, intenta nuevamente en 24 horas.`
                });
            }
            return true;
        }

        // Bloqueado por escribir mal varias veces: no se atiende nada (ni siquiera las palabras de acceso) hasta que
        // pase el tiempo. Solo se le recuerda cuanto falta, como mucho una vez por minuto.
        const bloqueo = estadoBloqueo(senderPhone);
        if (bloqueo.bloqueado) {
            if (bloqueo.avisar) {
                const avisoBloqueo = textoBloqueo(bloqueo.minutosRestantes);
                await database.logGPSwoxMessage(cleanPhone, 'OUT', avisoBloqueo, 'BLOQUEO_INTENTOS');
                await socket.sendMessage(senderPhone, { text: avisoBloqueo });
            }
            return true;
        }

        let conversation = getConversationState(senderPhone);
        if (conversation) conversation.lastActivity = Date.now(); // cada mensaje reinicia los minutos de inactividad
        const input = messageText.trim();

        // Ignorar mensajes que son solo un link (ej. el auditor comparte de vuelta
        // el reporte de inspeccion/preoperacional usando el boton "compartir" de
        // la pagina web) - no es una seleccion real de menu, responder "opcion no
        // valida" solo confunde.
        if (/^https?:\/\/\S+$/i.test(input)) {
            console.log(`🔗 Mensaje de solo link ignorado (no es una respuesta de menu): ${input}`);
            return true;
        }

        // "SALIR": vuelve al punto neutral (ni menú de Hesego ni ningún flujo),
        // útil sobre todo desde Preoperacional/Inspección de Rastrear, que no
        // tienen un menú propio al que volver. Se revisa ANTES que cualquier
        // otra cosa (incluso con conversación o flujo en curso) para que
        // siempre funcione, sea cual sea el estado en que esté el teléfono.
        if (['salir', 'cancelar', 'terminar'].includes(input.toLowerCase())) {
            cointraRecordados.delete(senderPhone);
            limpiarIntentosFallidos(senderPhone);
            endConversation(senderPhone);
            const salirText = 'Listo 👋 Escribe el nombre de tu empresa o la palabra de acceso cuando quieras continuar.';
            await database.logGPSwoxMessage(cleanPhoneNumber(senderPhone), 'OUT', salirText, 'SALIR');
            await socket.sendMessage(senderPhone, { text: salirText });
            return true;
        }

        // "HESEGO"/"RASTREAR" siempre abren/reinician su propio menú, sea cual sea
        // el estado actual -- son las palabras de entrada "desde afuera". "MENU"/
        // "MENÚ" en cambio es solo un atajo para volver al tope del menú MIENTRAS
        // ya estás adentro de ESE MISMO menú (hay una conversación activa de ese
        // tipo); si no hay conversación, o la que hay es la del otro menú, "menu"
        // no debe abrir nada -- se trata como cualquier otra palabra sin reconocer,
        // para no reabrir un menú desde "afuera" por accidente ni cruzar Hesego
        // con Rastrear.
        const palabraLower = input.toLowerCase();
        const esHesego = palabraLower === 'hesego';
        const esRastrear = palabraLower === 'rastrear';
        const esCointra = palabraLower === 'cointra';
        const enMenuRastrear = !!conversation && ESTADOS_RASTREAR.has(conversation.state);
        const enMenuCointra = !!conversation && conversation.state === CONVERSATION_STATES.COINTRA_MENU;
        const esMenuHesego = (palabraLower === 'menu' || palabraLower === 'menú') && !!conversation && !enMenuRastrear && !enMenuCointra;
        const esMenuCointra = (palabraLower === 'menu' || palabraLower === 'menú') && enMenuCointra;
        const esMenuRastrear = (palabraLower === 'menu' || palabraLower === 'menú') && enMenuRastrear;

        if (esHesego || esMenuHesego) {
            limpiarIntentosFallidos(senderPhone);
            endConversation(senderPhone);
            startConversation(senderPhone);
            conversation = getConversationState(senderPhone);
            await showMenu(socket, senderPhone);
            return true;
        }

        if (esCointra || esMenuCointra) {
            recordarCointra(senderPhone);
            limpiarIntentosFallidos(senderPhone);
            endConversation(senderPhone);
            startConversation(senderPhone);
            updateConversation(senderPhone, { state: CONVERSATION_STATES.COINTRA_MENU });
            conversation = getConversationState(senderPhone);
            await showCointraMenu(socket, senderPhone);
            return true;
        }

        if (esRastrear || esMenuRastrear) {
            limpiarIntentosFallidos(senderPhone);
            endConversation(senderPhone);
            startConversation(senderPhone);
            updateConversation(senderPhone, { state: CONVERSATION_STATES.RASTREAR_MENU });
            conversation = getConversationState(senderPhone);
            await showRastrearMenu(socket, senderPhone);
            return true;
        }

        // Respuestas del dueño al agente de monitoreo ("MON <id> ..."): las lee el agente desde la base; el bot no contesta.
        if (/^mon(\s|$)/i.test(input)) return true;

        if (!conversation && canStartNewConversation && esCointraReciente(senderPhone)) {
            limpiarIntentosFallidos(senderPhone);
            startConversation(senderPhone);
            updateConversation(senderPhone, { state: CONVERSATION_STATES.COINTRA_MENU });
            conversation = getConversationState(senderPhone);
            await showCointraMenu(socket, senderPhone);
            return true;
        }

        if (!conversation) {
            if (canStartNewConversation) {
                // Este número también recibe notificaciones automáticas (recibos,
                // alertas, etc.) a las que la gente a veces responde "Ok", "Gracias",
                // etc. Sin este filtro, cualquier respuesta casual abría el menú
                // completo de administración a quien sea. Ahora el menú solo se
                // abre con la palabra de activación ("HESEGO", "MENU" o, para los
                // otros bots del mismo número, "RASTREAR"/"TURNOS" -- esos se
                // interceptan antes, en whatsapp-docker); cualquier otro mensaje
                // recibe una aclaración de que esto es un bot de notificaciones,
                // sin iniciar conversación ni exponer el menú.
                //
                // Tercer intento seguido sin acertar la palabra = bloqueo de 10 min
                // (registrarIntentoFallido): evita que alguien siga mandando mensajes
                // sueltos a un bot que no los lee, y corta el gasto de responder una
                // y otra vez. Mientras está bloqueado, el mensaje avisa cuánto falta
                // en vez del aviso genérico.
                const intento = registrarIntentoFallido(senderPhone);
                const avisoText = intento.bloqueado
                    ? textoBloqueo(intento.minutosRestantes)
                    : 'Hola 👋 Este es un bot de notificaciones automáticas, no leemos ni respondemos mensajes aquí.\n\nSi necesitas usar el menú de opciones, escribe el nombre de la empresa o la palabra de acceso.';
                console.log(`📭 Mensaje sin palabra de activación en sesión dedicada, respondiendo ${intento.bloqueado ? 'bloqueo' : 'aviso'}: ${senderPhone}`);
                await database.logGPSwoxMessage(cleanPhoneNumber(senderPhone), 'OUT', avisoText, intento.bloqueado ? 'BLOQUEO_INTENTOS' : 'AVISO_NOTIFICACIONES');
                await socket.sendMessage(senderPhone, { text: avisoText });
                return true;
            } else {
                console.log(`📭 No hay conversación plataformagps activa para ${senderPhone} - no procesando en sesión no dedicada`);
                return false;
            }
        }

        switch (conversation.state) {
            case CONVERSATION_STATES.MENU:
                await handleMenuSelection(session, sessionName, socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_1_EMAIL:
                await handleOption1Email(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_1_PLATE:
                await handleOption1Plate(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_9_EMAIL:
                await handleOption9Email(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_9_PLATE:
                await handleOption9Plate(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_9_CONFIRM:
                await handleOption9Confirm(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_2_PLATE:
                await handleOption2Plate(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_3_EMAIL:
                await handleOption3Email(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.COINTRA_MENU:
                await handleCointraMenuSelection(senderPhone, socket, input);
                break;

            case CONVERSATION_STATES.RASTREAR_MENU:
                await handleRastrearMenuSelection(senderPhone, socket, input);
                break;

            case CONVERSATION_STATES.RASTREAR_OPTION_2_PLATE:
                await handleOption2Plate(socket, senderPhone, input, conversation, {
                    returnState: CONVERSATION_STATES.RASTREAR_MENU,
                    showReturnMenu: showRastrearMenu
                });
                break;

            default:
                console.log(`⚠️ Estado desconocido: ${conversation.state}`);
                endConversation(senderPhone);
                await showMenu(socket, senderPhone);
                startConversation(senderPhone);
                return true;
        }

        return true;

    } catch (error) {
        console.error(`❌ Error procesando mensaje plataformagps: ${error.message}`);

        const cleanPhone = cleanPhoneNumber(senderPhone);
        const errorText = `❌ Ocurrió un error procesando tu solicitud: ${error.message}\n\nEnvía cualquier mensaje para volver al menú.`;

        try {
            await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR');
            await socket.sendMessage(senderPhone, { text: errorText });
        } catch (sendError) {
            console.error(`Error enviando mensaje de error: ${sendError.message}`);
        }

        endConversation(senderPhone);
        return true;
    }
}

// Menú completo de administración (antes de nov. 2026). Archivado: se reactiva con la variable de
// entorno HESEGO_MENU_COMPLETO=1 (los manejadores de las opciones 1-8 siguen intactos más abajo,
// en handleMenuSelection). Por defecto se muestra el menú corto de abajo.
const MENU_COMPLETO_ARCHIVADO = `👋 *Bienvenido a plataformagps*\n\n` +
                     `Selecciona una opción enviando el número correspondiente:\n\n` +
                     `*1* - Asignar usuario a vehículo 🚗\n` +
                     `*2* - Consultar placa y última ubicación 📍\n` +
                     `*3* - Consultar usuario 👤\n` +
                     `*4* - Registrar vehículo no operativo 🔧\n` +
                     `*5* - Consultar vehículos no operativos 📋\n` +
                     `*6* - Mover vehículo a otra sede 🔁\n` +
                     `*7* - Vencimientos de documentos 📅\n` +
                     `*8* - Inspección Hesego 🔧\n` +
                     `*9* - Quitar usuario de vehículo 🔓\n\n` +
                     `Envía el número de la opción que deseas.`;

const MENU_HESEGO = `👋 *Bienvenido a bot hesego*\n\n` +
                     `Selecciona una opción enviando el número correspondiente:\n\n` +
                     `*1* - 📍 Consultar placa y última ubicación\n` +
                     `*2* - 🔧 Inspección Hesego\n` +
                     `*3* - 🚗 Asignar usuario a vehículo\n` +
                     `*4* - 🔓 Quitar usuario de vehículo\n\n` +
                     `Envía el número de la opción que deseas.`;

const MENU_HESEGO_COMPLETO = process.env.HESEGO_MENU_COMPLETO === '1';

async function showMenu(socket, senderPhone) {
    const menuText = MENU_HESEGO_COMPLETO ? MENU_COMPLETO_ARCHIVADO : MENU_HESEGO;

    const cleanPhone = cleanPhoneNumber(senderPhone);
    await database.logGPSwoxMessage(cleanPhone, 'OUT', menuText, 'MENU');

    await socket.sendMessage(senderPhone, { text: menuText });
}

async function handleMenuSelection(session, sessionName, socket, senderPhone, input, conversation) {
    let option = input.trim();
    if (!MENU_HESEGO_COMPLETO) {
        // Menú corto: se traduce al número que tiene la opción en el menú completo (abajo).
        const delMenuCorto = { '1': '2', '2': '8', '3': '1', '4': '9' };
        if (!delMenuCorto[option]) {
            await responderOpcionInvalida(socket, senderPhone, `❌ Opción no válida. Por favor, envía *1*, *2*, *3* o *4*.`, 'MENU');
            return;
        }
        option = delMenuCorto[option];
    }
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (option === '1') {
        conversation.data.selectedOption = 1;
        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_1_EMAIL });
        const responseText = `🚗 *Asignar usuario a vehículo*\n\n` +
                  `Por favor, envía el *correo electrónico* del usuario.\n\n` +
                  `Ejemplo: usuario@ejemplo.com\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'OPTION_1_EMAIL');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else if (option === '2') {
        conversation.data.selectedOption = 2;
        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_2_PLATE });
        const responseText = `📍 *Consultar placa y ubicación*\n\n` +
                  `Por favor, envía la *placa* del vehículo.\n\n` +
                  `Ejemplo: ABC123 o ABC-123\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'OPTION_2_PLATE');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else if (option === '3') {
        conversation.data.selectedOption = 3;
        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_3_EMAIL });
        const responseText = `👤 *Consultar usuario*\n\n` +
                  `Por favor, envía el *correo electrónico* del usuario.\n\n` +
                  `Ejemplo: usuario@ejemplo.com\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'OPTION_3_EMAIL');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else if (option === '4') {
        endConversation(senderPhone);
        const responseText = `🔧 *Registrar vehículo no operativo*\n\n` +
                  `Envía la sede usando uno de estos formatos:\n\n` +
                  `*operatividad jamundi*\n` +
                  `*operatividad buga*\n` +
                  `*operatividad tulua*\n` +
                  `*operatividad zarzal*\n\n` +
                  `Luego te pediré la placa, la validaré en plataformagps y solicitaré el estado y la observación.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'MENU');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else if (option === '5') {
        endConversation(senderPhone);
        await database.logGPSwoxMessage(cleanPhone, 'OUT', 'Consultar vehiculos no operativos', 'MENU');
        await operational.startConsultFlow(socket, senderPhone);
    } else if (option === '6') {
        endConversation(senderPhone);
        await database.logGPSwoxMessage(cleanPhone, 'OUT', 'Mover vehiculo a otra sede', 'MENU');
        await operational.startMoveSiteFlow(socket, senderPhone);
    } else if (option === '7') {
        endConversation(senderPhone);
        await database.logGPSwoxMessage(cleanPhone, 'OUT', 'Vencimientos de documentos', 'MENU');
        await operational.startDocumentExpirationFlow(socket, senderPhone);
    } else if (option === '8') {
        endConversation(senderPhone);
        await database.logGPSwoxMessage(cleanPhone, 'OUT', 'Inspección Hesego', 'MENU');
        const result = await startInspection(senderPhone);
        if (!result.success) {
            const errorText = `❌ No se pudo iniciar Inspección Hesego en este momento. Intenta de nuevo o escribe *menu*.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR');
            await socket.sendMessage(senderPhone, { text: errorText });
        }
    } else if (option === '9') {
        conversation.data.selectedOption = 9;
        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_9_EMAIL });
        const responseText = `🔓 *Quitar usuario de vehículo*\n\n` +
                  `Por favor, envía el *correo electrónico* del usuario.\n\n` +
                  `Ejemplo: usuario@ejemplo.com\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'OPTION_9_EMAIL');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else {
        await responderOpcionInvalida(socket, senderPhone, `❌ Opción no válida. Por favor, envía *1*, *2*, *3*, *4*, *5*, *6*, *7*, *8* o *9*.`, 'MENU');
    }
}

/**
 * Menú de Rastrear -- independiente del de Hesego arriba (otro set de
 * opciones), misma sesión de WhatsApp. La opción 2 (consultar placa y
 * ubicación) reutiliza exactamente la misma lógica que la opción 2 de
 * Hesego (findDeviceByPlate es de plataformagps, no es específico de
 * ninguna empresa). La opción 1 (Preoperacional) vive en whatsapp-docker,
 * así que se le pide a ese servicio que la arranque (mismo patrón que
 * startInspection para la opción 8 de Hesego).
 */
async function showRastrearMenu(socket, senderPhone) {
    const menuText = `👋 *Bienvenido a Rastrear*\n\n` +
                     `Selecciona una opción enviando el número correspondiente:\n\n` +
                     `*1* - Preoperacional 📋\n` +
                     `*2* - Consultar placa y última ubicación 📍\n` +
                     `*3* - Consultar documentos 📄\n` +
                     `*4* - Registrar gastos 💰\n\n` +
                     `Envía el número de la opción que deseas.`;

    const cleanPhone = cleanPhoneNumber(senderPhone);
    await database.logGPSwoxMessage(cleanPhone, 'OUT', menuText, 'RASTREAR_MENU');
    await socket.sendMessage(senderPhone, { text: menuText });
}

/** Menú de Cointra: solo inicio y fin de jornada (el flujo vive en whatsapp-docker, preop-flow.js). */
async function showCointraMenu(socket, senderPhone) {
    const menuText = `👋 *Bienvenido a Cointra*\n\n` +
                     `Selecciona una opción enviando el número correspondiente:\n\n` +
                     `*1* - Inicio de jornada 🟢\n` +
                     `*2* - Fin de jornada 🔴\n\n` +
                     `Envía el número de la opción que deseas.`;
    await database.logGPSwoxMessage(cleanPhoneNumber(senderPhone), 'OUT', menuText, 'COINTRA_MENU');
    await socket.sendMessage(senderPhone, { text: menuText });
}

async function handleCointraMenuSelection(senderPhone, socket, input) {
    const option = input.trim();
    const cleanPhone = cleanPhoneNumber(senderPhone);
    if (option === '1' || option === '2') {
        endConversation(senderPhone);
        await database.logGPSwoxMessage(cleanPhone, 'OUT', option === '1' ? 'Inicio de jornada Cointra' : 'Fin de jornada Cointra', 'COINTRA_MENU');
        const result = await startJornadaCointra(senderPhone, option === '1' ? 'inicio' : 'fin');
        if (!result.success) {
            const errorText = `❌ No se pudo iniciar en este momento. Intenta de nuevo o escribe *cointra*.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR');
            await socket.sendMessage(senderPhone, { text: errorText });
        }
    } else {
        await responderOpcionInvalida(socket, senderPhone, `❌ Opción no válida. Por favor, envía *1* (inicio de jornada) o *2* (fin de jornada).`, 'COINTRA_MENU');
    }
}

async function handleRastrearMenuSelection(senderPhone, socket, input) {
    const option = input.trim();
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (option === '1') {
        endConversation(senderPhone);
        await database.logGPSwoxMessage(cleanPhone, 'OUT', 'Preoperacional Rastrear', 'RASTREAR_MENU');
        const result = await startPreopRastrear(senderPhone);
        if (!result.success) {
            const errorText = `❌ No se pudo iniciar el Preoperacional en este momento. Intenta de nuevo o escribe *rastrear*.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR');
            await socket.sendMessage(senderPhone, { text: errorText });
        }
    } else if (option === '2') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.RASTREAR_OPTION_2_PLATE });
        const responseText = `📍 *Consultar placa y ubicación*\n\n` +
                  `Por favor, envía la *placa* del vehículo.\n\n` +
                  `Ejemplo: ABC123 o ABC-123\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'RASTREAR_OPTION_2_PLATE');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else if (option === '3' || option === '4') {
        const nombre = option === '3' ? 'Consultar documentos' : 'Registrar gastos';
        const responseText = `🚧 *${nombre}*\n\nPróximamente, estamos en desarrollo de esta opción.\n\nEnvía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'RASTREAR_MENU');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else if (option === '0') {
        await showRastrearMenu(socket, senderPhone);
    } else {
        await responderOpcionInvalida(socket, senderPhone, `❌ Opción no válida. Por favor, envía *1*, *2*, *3* o *4*.`, 'RASTREAR_MENU');
    }
}

async function handleOption1Email(socket, senderPhone, input, conversation) {
    const email = input.trim();
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (email === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }

    if (!isValidEmail(email)) {
        const errorText = `❌ El correo electrónico no es válido.\n\nPor favor, envía un correo electrónico válido.\n\nEjemplo: usuario@ejemplo.com\n\nEnvía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_1_EMAIL');
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const validatingText = `🔍 Validando correo: *${email}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', validatingText, 'OPTION_1_EMAIL');
    await socket.sendMessage(senderPhone, { text: validatingText });

    try {
        const user = await findUserByEmail(email);

        if (!user) {
            const notFoundText = `❌ No se encontró un usuario con el correo: *${email}*\n\nVerifica que esté registrado en el sistema.\n\nEnvía otro correo o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_1_EMAIL');
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        conversation.data.email = email;
        conversation.data.user = user;

        const successText = `✅ ¡Usuario verificado!\n\n` +
                  `📧 Correo: *${email}*\n` +
                  `👤 Nombre: ${user.email || 'N/A'}\n` +
                  `🚗 Vehículos: *${user.devices_count || 0}*\n\n` +
                  `Ahora envía la *placa del vehículo*.\n\n` +
                  `Ejemplo: IMU148 o IMU-148\n\n` +
                  `Envía *0* para regresar al menú principal.`;

        await database.logGPSwoxMessage(cleanPhone, 'OUT', successText, 'OPTION_1_EMAIL', conversation.data);
        await socket.sendMessage(senderPhone, { text: successText });

        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_1_PLATE });

    } catch (error) {
        console.error(`Error validando correo: ${error.message}`);
        const errorText = `❌ Error al validar el correo: ${error.message}\n\nIntenta de nuevo o escribe *menu*.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_1_EMAIL');
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

async function handleOption1Plate(socket, senderPhone, input, conversation) {
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (input.trim() === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }

    const plate = input.trim().toUpperCase();
    const formattedPlate = formatPlate(plate);

    if (!isValidPlateFormat(formattedPlate)) {
        const errorText = `❌ Formato de placa inválido: *${plate}*\n\nEjemplo: IMU148 o IMU-148\n\nEnvía la placa nuevamente o envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_1_PLATE', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const validatingText = `🔍 Validando placa: *${formattedPlate}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', validatingText, 'OPTION_1_PLATE', conversation.data);
    await socket.sendMessage(senderPhone, { text: validatingText });

    try {
        const device = await findDeviceByPlate(formattedPlate);

        if (!device) {
            const notFoundText = `❌ No se encontró vehículo con placa: *${formattedPlate}*\n\nVerifica que esté registrado.\n\nEnvía otra placa o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_1_PLATE', conversation.data);
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        conversation.data.plate = formattedPlate;
        conversation.data.device = device;

        const foundText = `✅ ¡Vehículo encontrado!\n\n` +
                  `🚗 Placa: *${formattedPlate}*\n` +
                  `📡 Protocolo: ${device.protocol || 'N/A'}\n\n` +
                  `🔗 Asignando a *${conversation.data.email}*...`;

        await database.logGPSwoxMessage(cleanPhone, 'OUT', foundText, 'OPTION_1_PLATE', conversation.data);
        await socket.sendMessage(senderPhone, { text: foundText });

        const result = await assignDeviceToUser(conversation.data.user.id, device.id);

        if (result.success) {
            invalidateClientsCache();

            const msg = result.alreadyAssigned
                ? `ℹ️ El usuario *${conversation.data.email}* ya tenía asignado *${formattedPlate}*.\n\n✅ Proceso finalizado.\n\nSi deseas asignar otra placa a este usuario, envíala. O escribe *menu* para volver.`
                : `✅ ¡Asignación exitosa!\n\n👤 Usuario: *${conversation.data.email}*\n🚗 Vehículo: *${formattedPlate}*\n\n🎉 Proceso completado.\n\nSi deseas asignar otra placa a este usuario, envíala. O escribe *menu* para volver.`;

            await database.logGPSwoxMessage(cleanPhone, 'OUT', msg, 'COMPLETED', conversation.data);
            await socket.sendMessage(senderPhone, { text: msg });

            // Mantener la conversación en el mismo estado (mismo usuario/email) para
            // permitir asignar otra placa sin volver a pedir el correo. "menu" ya
            // funciona en cualquier momento gracias al manejo global de esa palabra.
            conversation.data.plate = null;
            conversation.data.device = null;
            updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_1_PLATE });
        } else {
            const errorText = `❌ Error al asignar: ${result.error}\n\nContacta al administrador o escribe *menu*.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
            await socket.sendMessage(senderPhone, { text: errorText });
            endConversation(senderPhone);
        }

    } catch (error) {
        console.error(`Error procesando placa: ${error.message}`);
        const errorText = `❌ Error: ${error.message}\n\nEscribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

// ── Opcion 9: quitar usuario de vehiculo (el contrario de la 1: correo -> placa -> confirmar) ──────────────────

/** Texto de "no tiene asignado": el usuario existe y el vehiculo tambien, pero no estan asignados entre si. */
function textoNoAsignado(email, placa) {
    return `ℹ️ El usuario *${email}* no tiene asignado el vehículo *${placa}*.\n\nNo se cambió nada.\n\n` +
           `Envía otra placa para quitarla de este usuario, o escribe *menu* para volver.`;
}

async function handleOption9Email(socket, senderPhone, input, conversation) {
    const email = input.trim();
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (email === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }

    if (!isValidEmail(email)) {
        const errorText = `❌ El correo electrónico no es válido.\n\nPor favor, envía un correo electrónico válido.\n\nEjemplo: usuario@ejemplo.com\n\nEnvía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_9_EMAIL');
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const validatingText = `🔍 Validando correo: *${email}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', validatingText, 'OPTION_9_EMAIL');
    await socket.sendMessage(senderPhone, { text: validatingText });

    try {
        const user = await findUserByEmail(email);

        if (!user) {
            const notFoundText = `❌ No se encontró un usuario con el correo: *${email}*\n\nVerifica que esté registrado en el sistema.\n\nEnvía otro correo o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_9_EMAIL');
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        conversation.data.email = email;
        conversation.data.user = user;

        const successText = `✅ ¡Usuario verificado!\n\n` +
                  `📧 Correo: *${email}*\n` +
                  `🚗 Vehículos: *${user.devices_count || 0}*\n\n` +
                  `Ahora envía la *placa del vehículo* que quieres quitarle.\n\n` +
                  `Ejemplo: IMU148 o IMU-148\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', successText, 'OPTION_9_EMAIL', conversation.data);
        await socket.sendMessage(senderPhone, { text: successText });

        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_9_PLATE });
    } catch (error) {
        console.error(`Error validando correo (quitar): ${error.message}`);
        const errorText = `❌ Error al validar el correo: ${error.message}\n\nIntenta de nuevo o escribe *menu*.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_9_EMAIL');
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

async function handleOption9Plate(socket, senderPhone, input, conversation) {
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (input.trim() === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }

    const plate = input.trim().toUpperCase();
    const formattedPlate = formatPlate(plate);

    if (!isValidPlateFormat(formattedPlate)) {
        const errorText = `❌ Formato de placa inválido: *${plate}*\n\nEjemplo: IMU148 o IMU-148\n\nEnvía la placa nuevamente o envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_9_PLATE', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const validatingText = `🔍 Validando placa: *${formattedPlate}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', validatingText, 'OPTION_9_PLATE', conversation.data);
    await socket.sendMessage(senderPhone, { text: validatingText });

    try {
        const device = await findDeviceByPlate(formattedPlate);

        if (!device) {
            const notFoundText = `❌ No se encontró vehículo con placa: *${formattedPlate}*\n\nVerifica que esté registrado.\n\nEnvía otra placa o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_9_PLATE', conversation.data);
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        // Lectura ESTRICTA de quienes lo tienen asignado ahora: si falla, no se asume nada (ni "lo tiene" ni "no lo tiene")
        const asignados = await getDeviceUserIdsEstricto(device.id);

        if (!asignados.includes(Number(conversation.data.user.id))) {
            const noTieneText = textoNoAsignado(conversation.data.email, formattedPlate);
            await database.logGPSwoxMessage(cleanPhone, 'OUT', noTieneText, 'OPTION_9_PLATE', conversation.data);
            await socket.sendMessage(senderPhone, { text: noTieneText });
            return;
        }

        // Si lo tiene: se pide confirmacion antes de quitarlo (cambia la plataforma GPS)
        conversation.data.plate = formattedPlate;
        conversation.data.device = device;

        const confirmText = `⚠️ *Confirma*\n\n` +
                  `Vas a quitar a *${conversation.data.email}* del vehículo *${formattedPlate}*.\n\n` +
                  `Responde *SI* para quitarlo o *NO* para cancelar.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', confirmText, 'OPTION_9_PLATE', conversation.data);
        await socket.sendMessage(senderPhone, { text: confirmText });

        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_9_CONFIRM });
    } catch (error) {
        console.error(`Error procesando placa (quitar): ${error.message}`);
        const errorText = `❌ No se pudo consultar los usuarios del vehículo: ${error.message}\n\nNo se cambió nada. Escribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

async function handleOption9Confirm(socket, senderPhone, input, conversation) {
    const cleanPhone = cleanPhoneNumber(senderPhone);
    const respuesta = input.trim().toUpperCase();

    if (respuesta === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }

    const { email, user, device, plate } = conversation.data;
    const volverAPlaca = () => {
        conversation.data.plate = null;
        conversation.data.device = null;
        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_9_PLATE });
    };

    if (respuesta === 'NO') {
        const cancelText = `👍 Cancelado. No se quitó nada.\n\nEnvía otra placa para quitarla de *${email}*, o escribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', cancelText, 'OPTION_9_CONFIRM', conversation.data);
        await socket.sendMessage(senderPhone, { text: cancelText });
        volverAPlaca();
        return;
    }

    if (respuesta !== 'SI' && respuesta !== 'SÍ') {
        const repiteText = `Responde *SI* para quitar a *${email}* del vehículo *${plate}*, *NO* para cancelar, o *0* para volver al menú.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', repiteText, 'OPTION_9_CONFIRM', conversation.data);
        await socket.sendMessage(senderPhone, { text: repiteText });
        return;
    }

    try {
        const resultado = await removeDeviceFromUser(user.id, device.id);

        let msg;
        if (resultado.success && resultado.notAssigned) {
            msg = textoNoAsignado(email, plate);
        } else if (resultado.success) {
            invalidateClientsCache();
            console.log(`🔓 [AUDITORIA] ${cleanPhone} quitó a ${email} (id ${user.id}) del vehículo ${plate} (id ${device.id})`);
            msg = `✅ ¡Listo!\n\n👤 Usuario: *${email}*\n🚗 Vehículo: *${plate}*\n\nEl usuario ya no tiene asignado este vehículo.\n\n` +
                  `Si deseas quitar otro vehículo a este usuario, envía la placa. O escribe *menu* para volver.`;
        } else if (resultado.onlyUser) {
            msg = `❌ No se quitó: *${email}* es el único usuario asignado a *${plate}* y por seguridad no se deja un vehículo sin usuarios.\n\n` +
                  `Envía otra placa o escribe *menu* para volver.`;
        } else {
            msg = `❌ No se pudo quitar: ${resultado.error}\n\nNo se confirmó ningún cambio. Contacta al administrador o escribe *menu*.`;
        }

        await database.logGPSwoxMessage(cleanPhone, 'OUT', msg, resultado.removed ? 'COMPLETED' : (resultado.success || resultado.onlyUser ? 'OPTION_9_CONFIRM' : 'ERROR'), conversation.data);
        await socket.sendMessage(senderPhone, { text: msg });

        if (resultado.success || resultado.onlyUser) {
            volverAPlaca();   // mismo usuario: puede seguir con otra placa
        } else {
            endConversation(senderPhone);
        }
    } catch (error) {
        console.error(`Error quitando usuario del vehículo: ${error.message}`);
        const errorText = `❌ Error: ${error.message}\n\nNo se confirmó ningún cambio. Escribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

async function handleOption2Plate(socket, senderPhone, input, conversation, opts = {}) {
    const returnState = opts.returnState || CONVERSATION_STATES.MENU;
    const showReturnMenu = opts.showReturnMenu || showMenu;
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (input.trim() === '0') {
        updateConversation(senderPhone, { state: returnState });
        await showReturnMenu(socket, senderPhone);
        return;
    }

    const plate = input.trim().toUpperCase();
    const formattedPlate = formatPlate(plate);

    if (!isValidPlateFormat(formattedPlate)) {
        const errorText = `❌ Formato de placa inválido: *${plate}*\n\nEjemplo: IMU148\n\nEnvía la placa nuevamente o envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_2_PLATE', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const consultingText = `🔍 Consultando placa: *${formattedPlate}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', consultingText, 'OPTION_2_PLATE', conversation.data);
    await socket.sendMessage(senderPhone, { text: consultingText });

    try {
        const device = await findDeviceByPlate(formattedPlate);

        if (!device) {
            const notFoundText = `❌ No se encontró vehículo con placa: *${formattedPlate}*\n\nVerifica que esté registrado.\n\nEnvía otra placa o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_2_PLATE', conversation.data);
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        const onlineStatus = device.online ? '🟢 En Línea' : '🔴 Desconectado';
        const speed = device.speed ? `${device.speed} km/h` : 'N/A';
        const lat = device.lat || 'N/A';
        const lng = device.lng || 'N/A';
        const lastReport = device.time || 'N/A';
        const googleMapsLink = (lat !== 'N/A' && lng !== 'N/A')
            ? `https://www.google.com/maps?q=${lat},${lng}`
            : null;

        let msg = `📍 *Información de vehículo*\n\n` +
                  `🚗 Placa: *${formattedPlate}*\n` +
                  `${onlineStatus}\n` +
                  `📡 Protocolo: ${device.protocol || 'N/A'}\n` +
                  `🗂️ Grupo: ${device.group_title || 'N/A'}\n` +
                  `⚡ Velocidad: ${speed}\n` +
                  `🕐 Último reporte: ${lastReport}\n\n` +
                  `📌 *Última ubicación:*\n` +
                  `Lat: ${lat}\n` +
                  `Lng: ${lng}`;

        if (googleMapsLink) {
            msg += `\n\n🗺️ Ver en mapa: ${googleMapsLink}`;
        }

        msg += `\n\nEnvía otra placa o envía *0* para regresar al menú principal.`;

        await database.logGPSwoxMessage(cleanPhone, 'OUT', msg, 'OPTION_2_PLATE', { ...conversation.data, device });
        await socket.sendMessage(senderPhone, { text: msg });

    } catch (error) {
        console.error(`Error consultando placa: ${error.message}`);
        const errorText = `❌ Error al consultar: ${error.message}\n\nEscribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

async function handleOption3Email(socket, senderPhone, input, conversation) {
    const email = input.trim();
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (email === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }

    if (!isValidEmail(email)) {
        const errorText = `❌ Correo inválido.\n\nEjemplo: usuario@ejemplo.com\n\nEnvía el correo nuevamente o envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_3_EMAIL', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const consultingText = `🔍 Consultando usuario: *${email}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', consultingText, 'OPTION_3_EMAIL', conversation.data);
    await socket.sendMessage(senderPhone, { text: consultingText });

    try {
        const user = await findUserByEmail(email);

        if (!user) {
            const notFoundText = `❌ No se encontró usuario con correo: *${email}*\n\nVerifica que esté registrado.\n\nEnvía otro correo o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_3_EMAIL', conversation.data);
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        const msg = `✅ *Usuario encontrado*\n\n` +
                    `📧 Correo: *${email}*\n` +
                    `🚗 Vehículos asignados: ${user.devices_count || 0}\n\n` +
                    `Envía otro correo o envía *0* para regresar al menú principal.`;

        await database.logGPSwoxMessage(cleanPhone, 'OUT', msg, 'OPTION_3_EMAIL', { ...conversation.data, user });
        await socket.sendMessage(senderPhone, { text: msg });

    } catch (error) {
        console.error(`Error consultando usuario: ${error.message}`);
        const errorText = `❌ Error al consultar: ${error.message}\n\nEscribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

function getConversationStats() {
    const stats = {
        total: activeConversations.size,
        byState: {}
    };

    for (const conversation of activeConversations.values()) {
        const state = conversation.state;
        stats.byState[state] = (stats.byState[state] || 0) + 1;
    }

    return stats;
}

function isGPSwoxSession(sessionName) {
    return sessionName === config.GPSWOX_SESSION_NAME;
}

function getGPSwoxSessionName() {
    return config.GPSWOX_SESSION_NAME;
}

function getActiveConversations() {
    const conversations = [];
    for (const [phoneNumber, data] of activeConversations.entries()) {
        conversations.push({
            phoneNumber,
            state: data.state,
            data: data.data,
            lastActivity: data.lastActivity,
            timeout: data.timeout
        });
    }
    return conversations;
}

function getStats() {
    return {
        activeConversations: activeConversations.size,
        messagesTracked: messageCounter.size,
        states: getStateDistribution()
    };
}

function getStateDistribution() {
    const distribution = {};
    for (const [, data] of activeConversations.entries()) {
        const state = data.state;
        distribution[state] = (distribution[state] || 0) + 1;
    }
    return distribution;
}

/**
 * Verifica si el modo dedicado plataformagps está habilitado
 * @returns {boolean}
 */
function isGPSwoxDedicatedMode() {
    return config.GPSWOX_DEDICATED_MODE;
}

/**
 * Obtiene todos los nombres de sesiones plataformagps
 * @returns {string[]}
 */
function getGPSwoxSessionNames() {
    return config.GPSWOX_SESSION_NAMES;
}

module.exports = {
    isGPSwoxDedicatedMode,
    getGPSwoxSessionNames,
    CONVERSATION_STATES,
    registrarIntentoFallido,
    estadoBloqueo,
    processGPSwoxMessage,
    startConversation,
    endConversation,
    showMenu,
    hasActiveConversation,
    getConversationState,
    getConversationStats,
    isGPSwoxSession,
    getGPSwoxSessionName,
    getActiveConversations,
    getStats
};
