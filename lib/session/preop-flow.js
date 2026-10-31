/**
 * Flujo conversacional del bot de Preoperacional (Hesego y Rastrear: dos instancias, un solo bot).
 * Máquina de estados por teléfono (paso guardado en preop_bot_sesiones.datos.step),
 * reutilizando la misma sesión de WhatsApp dedicada a GPSwox.
 *
 * Este módulo NO decide cuándo interceptar un mensaje — eso lo hace el gancho en
 * lib/session/core.js (trigger explícito PREOP/PREOPERACIONAL o conversación en curso).
 */

const config = require('../../config');
const preopApi = require('./preop-api');
const preopSession = require('./preop-session');
const empresaPref = require('./empresa-pref');
const { sendMessageWithRetry } = require('./messaging');

/**
 * ¿El teléfono tiene una conversación de preoperacional activa?
 * Usado por el gancho en core.js para decidir si intercepta el mensaje.
 */
async function hasActiveSession(telefono) {
    const sesion = await preopSession.obtenerSesionActiva(telefono);
    return !!sesion;
}

// Instancias del Preoperacional que atiende este bot. La palabra clave con la que el conductor
// inicia decide cuál: PREOP/PREOPERACIONAL → Hesego; RPREOP / PREOP RASTREAR → Rastrear.
const TENANT_NOMBRES = { hesego: 'Hesego', rastrear: 'Rastrear' };

// Palabras que valen para cualquier empresa: abren el preoperacional de la empresa que el teléfono
// eligió (HESEGO / RASTREAR); sin elección previa, el de Hesego (como siempre).
const PALABRAS_GENERICAS = ['PREOP', 'PREOPERACIONAL'];
const HESEGO_EXPLICITAS = ['PREOP HESEGO', 'PREOPERACIONAL HESEGO']; // por si el .env del servidor define su propia lista

/** @returns {'hesego'|'rastrear'|'auto'|null} instancia de la palabra clave ('auto' = la empresa elegida; null = no es trigger) */
function tenantFromTrigger(textoUpper) {
    if (PALABRAS_GENERICAS.includes(textoUpper)) return 'auto';
    if (config.PREOP_RASTREAR_TRIGGER_KEYWORDS.includes(textoUpper)) return 'rastrear';
    if (HESEGO_EXPLICITAS.includes(textoUpper) || config.PREOP_TRIGGER_KEYWORDS.includes(textoUpper)) return 'hesego';
    return null;
}

async function enviar(session, telefono, texto) {
    await sendMessageWithRetry(session, telefono, texto, 3);
}

/**
 * Reenvía una palabra clave (menu/salir) a hesego-operatividad, dueño real del
 * menú/estado de conversación de GPSwox -- mismo patrón que inspeccion-flow.js.
 * Si el webhook no está configurado o falla, usa el fallback local inerte.
 */
async function reenviarAGPSwox(session, sessionName, senderPhone, socket, palabra) {
    if (config.GPSWOX_WEBHOOK_URL) {
        try {
            const axios = require('axios');
            await axios.post(`${config.GPSWOX_WEBHOOK_URL}/webhook/incoming`, {
                phoneNumber: senderPhone,
                message: palabra,
                sessionName
            }, {
                timeout: 10000,
                headers: config.GPSWOX_WEBHOOK_SHARED_SECRET
                    ? { 'X-Internal-Secret': config.GPSWOX_WEBHOOK_SHARED_SECRET }
                    : {}
            });
        } catch (webhookError) {
            console.error(`❌ Error reenviando "${palabra}" a hesego-operatividad: ${webhookError.message}`);
            await enviar(session, senderPhone, 'El sistema no está disponible en este momento, intenta más tarde.');
        }
        return;
    }

    // Fallback: sin GPSWOX_WEBHOOK_URL configurado, comportamiento anterior
    const { showMenu, startConversation, endConversation } = require('./gpswox-session');
    endConversation(senderPhone);
    if (palabra === 'salir') {
        await enviar(session, senderPhone, 'Listo 👋 Escribe el nombre de tu empresa o la palabra de acceso cuando quieras continuar.');
        return;
    }
    startConversation(senderPhone);
    await showMenu(socket, senderPhone);
}

/**
 * Punto de entrada del flujo. Llamado desde core.js/handleIncomingMessage.
 * @param {object} session - sesión WhatsApp (objeto interno del repo)
 * @param {string} sessionName
 * @param {string} senderPhone - teléfono del remitente (formato usado por sendMessageWithRetry)
 * @param {string} textoRaw - texto plano del mensaje entrante
 * @param {object} mediaMessage - mensaje crudo de Baileys (m.messages[0]), para bajar fotos
 * @param {object} socket - socket de Baileys de la sesión (no se usa directamente aquí)
 */
async function handleMessage(session, sessionName, senderPhone, textoRaw, mediaMessage, socket) {
    const texto = (textoRaw || '').trim();
    const textoUpper = texto.toUpperCase();

    // CANCELAR aborta el flujo en cualquier paso
    if (textoUpper === 'CANCELAR') {
        const sesionActiva = await preopSession.obtenerSesionActiva(senderPhone);
        if (sesionActiva) {
            await preopSession.cerrarSesion(senderPhone);
            await enviar(session, senderPhone, '❌ Proceso de preoperacional cancelado. Escribe *PREOP* cuando quieras iniciar de nuevo.');
        }
        return;
    }

    // SALIR en cualquier paso: sale del preoperacional sin abrir ningún menú --
    // útil sobre todo viniendo de Rastrear, que no tiene un menú propio al que
    // volver (a diferencia de Hesego). Mismo patrón de reenvío que MENU abajo.
    if (textoUpper === 'SALIR') {
        const sesionActiva = await preopSession.obtenerSesionActiva(senderPhone);
        if (sesionActiva) await preopSession.cerrarSesion(senderPhone);
        await reenviarAGPSwox(session, sessionName, senderPhone, socket, 'salir');
        return;
    }

    // MENU/MENÚ en cualquier paso: sale del preoperacional y vuelve al menú de Hesego.
    // Reenvía "menu" a hesego-operatividad (dueño real del menú) en vez de llamar al
    // fallback local inerte de aquí -- si no, hesego-operatividad nunca se entera de
    // que la conversación arrancó y el siguiente mensaje del usuario vuelve a mostrar
    // el menú en vez de avanzar (mismo bug ya corregido en inspeccion-flow.js).
    if (textoUpper === 'MENU' || textoUpper === 'MENÚ') {
        const sesionActiva = await preopSession.obtenerSesionActiva(senderPhone);
        if (sesionActiva) await preopSession.cerrarSesion(senderPhone);
        await reenviarAGPSwox(session, sessionName, senderPhone, socket, 'menu');
        return;
    }

    let triggerTenant = tenantFromTrigger(textoUpper);
    if (triggerTenant === 'auto') triggerTenant = await empresaPref.obtenerOPorDefecto(senderPhone);
    const esCointra = triggerTenant === 'cointra'; // PREOP siendo de Cointra = inicio de jornada
    if (esCointra) triggerTenant = 'rastrear';
    const sesion = await preopSession.obtenerSesionActiva(senderPhone);

    if (triggerTenant) {
        // Nueva conversación (o reinicio si ya había una en curso)
        await iniciarConversacion(session, senderPhone, triggerTenant, esCointra ? OPTS_COINTRA : {});
        return;
    }

    if (!sesion) {
        // No debería ocurrir: el gancho en core.js solo llega aquí con trigger o sesión activa
        return;
    }

    const datos = sesion.datos || {};
    const step = datos.step;

    try {
        switch (step) {
            case 'ELEGIR_EMPRESA':
                await pasoElegirEmpresa(session, senderPhone, datos, texto);
                break;
            case 'FIN_PLACA':
                await pasoFinPlaca(session, senderPhone, datos, texto);
                break;
            case 'FIN_ODOMETRO':
                await pasoFinOdometro(session, senderPhone, datos, texto);
                break;
            case 'ESPERANDO_PLACA':
                await pasoPlaca(session, senderPhone, datos, texto);
                break;
            case 'CONFIRMAR_CONDUCTOR':
                await pasoConfirmarConductor(session, senderPhone, datos, textoUpper);
                break;
            case 'CEDULA':
                await pasoCedula(session, senderPhone, datos, texto);
                break;
            case 'CONFIRMAR_CEDULA':
                await pasoConfirmarCedula(session, senderPhone, datos, textoUpper);
                break;
            case 'ESPERANDO_NOMBRE':
                await pasoNombre(session, senderPhone, datos, texto);
                break;
            case 'ESPERANDO_ODOMETRO':
                await pasoOdometro(session, senderPhone, datos, texto);
                break;
            case 'ESPERANDO_TODO_BIEN':
                await pasoTodoBien(session, senderPhone, datos, textoUpper);
                break;
            case 'ESPERANDO_NOVEDAD_TEXTO':
                await pasoNovedadTexto(session, senderPhone, datos, texto);
                break;
            default:
                console.warn(`⚠️ [preop-flow] Paso desconocido "${step}" para ${senderPhone}, reiniciando sesión`);
                await preopSession.cerrarSesion(senderPhone);
                await enviar(session, senderPhone, 'Hubo un problema con tu proceso anterior. Escribe *PREOP* para iniciar de nuevo.');
        }
    } catch (error) {
        console.error(`❌ [preop-flow] Error procesando paso "${step}" para ${senderPhone}:`, error.message);
        await enviar(session, senderPhone, '⚠️ Ocurrió un error inesperado procesando tu solicitud. Intenta de nuevo, escribe *CANCELAR* para reiniciar, o *MENU* para volver al menú principal.');
    }
}

// Cointra usa el preoperacional de Rastrear: la empresa se elige sola por nombre y el título es "Inicio de jornada".
const OPTS_COINTRA = { jornada: true, empresaMatch: /cointra/i, marca: 'Cointra' };

/** Menú Cointra opción 1: arranca el preoperacional de Rastrear como inicio de jornada. */
async function iniciarJornada(session, telefono) {
    await preopSession.cerrarSesion(telefono);
    await iniciarConversacion(session, telefono, 'rastrear', OPTS_COINTRA);
}

/** Menú Cointra opción 2: fin de jornada (placa + odómetro final). */
async function iniciarFinJornada(session, telefono) {
    await preopSession.abrirSesion(telefono, { step: 'FIN_PLACA', tenant: 'rastrear', jornada: true });
    await enviar(session, telefono, '🔴 *Fin de jornada*\n\nEscribe la *placa* del vehículo (sin espacios ni guiones). En cualquier momento escribe *CANCELAR* para salir.');
}

async function pasoFinPlaca(session, telefono, datos, texto) {
    const placa = texto.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{5,6}$/.test(placa)) {
        await enviar(session, telefono, 'La placa no parece válida. Escríbela sin espacios ni guiones, por ejemplo *ABC123*.');
        return;
    }
    datos.step = 'FIN_ODOMETRO';
    datos.placaFin = placa;
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, 'Escribe el *kilometraje final del odómetro* (solo el número).');
}

async function pasoFinOdometro(session, telefono, datos, texto) {
    const numero = parseFloat(texto.replace(',', '.').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(numero)) {
        await enviar(session, telefono, 'No entendí el kilometraje. Escribe solo el número (ej: 15234.5).');
        return;
    }
    try {
        const j = await preopApi.finalizarJornada({ phone: telefono, placa: datos.placaFin, odometro_fin: numero }, 'rastrear');
        await preopSession.cerrarSesion(telefono);
        const recorrido = (j.odometro_inicio != null && numero >= Number(j.odometro_inicio))
            ? `\nRecorrido: *${(numero - Number(j.odometro_inicio)).toLocaleString('es-CO')} km*` : '';
        await enviar(session, telefono, `✅ *Jornada finalizada*\n\nVehículo: *${j.placa}*\nOdómetro final: *${numero}*${recorrido}\n\n¡Gracias! Escribe *COINTRA* para volver al menú.`);
    } catch (error) {
        const mensaje = preopApi.extractErrorMessage(error, 'No pudimos registrar el fin de jornada. Intenta de nuevo.');
        if (error.response && error.response.status === 409) { // placa distinta a la de la jornada: vuelve a pedirla
            datos.step = 'FIN_PLACA';
            await preopSession.actualizarDatos(telefono, datos);
            await enviar(session, telefono, `⚠️ ${mensaje}\n\nEscribe la placa correcta, o *CANCELAR*.`);
        } else {
            await preopSession.cerrarSesion(telefono);
            await enviar(session, telefono, `⚠️ ${mensaje}\n\nEscribe *COINTRA* para volver al menú.`);
        }
    }
}

async function iniciarConversacion(session, telefono, tenant = 'hesego', opts = {}) {
    const marca = opts.marca || TENANT_NOMBRES[tenant] || 'Hesego';
    let empresas;
    try {
        empresas = await preopApi.getEmpresas(tenant);
    } catch (error) {
        console.error('❌ [preop-flow] Error obteniendo empresas:', error.message);
        await enviar(session, telefono, '⚠️ No pudimos conectar con el sistema de preoperacional en este momento. Intenta nuevamente en unos minutos escribiendo *PREOP*.');
        return;
    }

    if (!Array.isArray(empresas) || empresas.length === 0) {
        await enviar(session, telefono, '⚠️ No hay empresas configuradas en el sistema de preoperacional. Por favor contacta al administrador.');
        return;
    }

    const saludo = opts.jornada
        ? `🟢 *Inicio de jornada ${marca}*.

Primero llenamos el preoperacional de tu vehículo. En cualquier momento puedes escribir *CANCELAR* para salir.`
        : `👋 Bienvenido al *Preoperacional ${marca}*.\n\nVamos a registrar la inspección preoperacional de tu vehículo. En cualquier momento puedes escribir *CANCELAR* para salir, o *MENU* para volver al menú principal.`;

    // Cointra: la empresa se elige sola por nombre (si no existe en el panel, cae a la lista normal).
    const coincidentes = opts.empresaMatch ? empresas.filter(e => opts.empresaMatch.test(e.nombre)) : [];
    if (coincidentes.length >= 1 || empresas.length === 1) {
        const empresa = coincidentes.length >= 1 ? coincidentes[0] : empresas[0];
        let placaSugerida = null;
        if (opts.jornada) { // vehículo que tiene asignado actualmente este celular
            try {
                const asignados = await preopApi.vehiculosPorTelefono(telefono, tenant);
                if (asignados.length === 1) placaSugerida = asignados[0].placa;
            } catch (error) {
                console.error('⚠️ [preop-flow] No se pudo consultar el vehículo asignado:', error.message);
            }
        }
        await preopSession.abrirSesion(telefono, {
            step: 'ESPERANDO_PLACA',
            tenant,
            jornada: !!opts.jornada,
            placaSugerida,
            empresaId: empresa.id,
            empresaNombre: empresa.nombre
        });
        const pedirPlaca = placaSugerida
            ? `Tu vehículo asignado es *${placaSugerida}*. Responde *SI* para usarlo, o escribe otra *placa* (debe existir en ${empresa.nombre}).`
            : 'Por favor escribe la *placa* del vehículo (sin espacios ni guiones).';
        await enviar(session, telefono, `${saludo}\n\nEmpresa: *${empresa.nombre}*\n\n${pedirPlaca}\n\nEscribe *SALIR* en cualquier momento para terminar.`);
        return;
    }

    const lista = empresas.map((e, i) => `${i + 1}. ${e.nombre}`).join('\n');
    await preopSession.abrirSesion(telefono, {
        step: 'ELEGIR_EMPRESA',
        tenant,
        empresasDisponibles: empresas
    });
    await enviar(session, telefono, `${saludo}\n\n¿Para qué empresa vas a registrar el preoperacional?\n\n${lista}\n\nResponde con el número de la opción.`);
}

async function pasoElegirEmpresa(session, telefono, datos, texto) {
    const opciones = datos.empresasDisponibles || [];
    const numero = parseInt(texto, 10);
    if (!Number.isInteger(numero) || numero < 1 || numero > opciones.length) {
        const lista = opciones.map((e, i) => `${i + 1}. ${e.nombre}`).join('\n');
        await enviar(session, telefono, `No entendí tu respuesta. Por favor responde solo con el número de la empresa:\n\n${lista}`);
        return;
    }

    const empresa = opciones[numero - 1];
    datos.step = 'ESPERANDO_PLACA';
    datos.empresaId = empresa.id;
    datos.empresaNombre = empresa.nombre;
    delete datos.empresasDisponibles;
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, `Empresa seleccionada: *${empresa.nombre}*\n\nPor favor escribe la *placa* del vehículo (sin espacios ni guiones).`);
}

async function pasoPlaca(session, telefono, datos, texto) {
    const textoPlaca = (datos.placaSugerida && /^s[ií]$/i.test(texto.trim())) ? datos.placaSugerida : texto;
    const placa = textoPlaca.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{5,6}$/.test(placa)) {
        await enviar(session, telefono, 'La placa no parece válida. Escríbela sin espacios ni guiones, por ejemplo *ABC123* (5 a 6 caracteres).\n\nIntenta nuevamente con otra placa, o escribe *SALIR* para terminar.');
        return;
    }

    let loginData;
    try {
        loginData = await preopApi.loginVehiculo(datos.empresaId, placa, datos.tenant);
    } catch (error) {
        // No cerramos la sesión: el usuario se queda en este mismo paso y puede
        // escribir otra placa directamente, sin tener que volver a escribir PREOP.
        const mensaje = preopApi.extractErrorMessage(error, 'No pudimos validar la placa. Verifica que sea correcta o contacta al administrador.');
        await enviar(session, telefono, `⚠️ ${mensaje}\n\nIntenta nuevamente con otra placa, o escribe *SALIR* para terminar.`);
        return;
    }

    const { token, vehiculo, empresa } = loginData;

    let hoy;
    try {
        hoy = await preopApi.getPreoperacionalHoy(token, vehiculo.placa, datos.tenant);
    } catch (error) {
        console.error('❌ [preop-flow] Error consultando preoperacional/hoy:', error.message);
        await preopSession.cerrarSesion(telefono);
        await enviar(session, telefono, '⚠️ No pudimos verificar el historial de hoy para este vehículo. Intenta más tarde escribiendo *PREOP*, o escribe *MENU* para volver al menú principal.');
        return;
    }

    if (hoy && hoy.exists) {
        await preopSession.cerrarSesion(telefono);
        const previo = hoy.inspecciones && hoy.inspecciones[0];
        const enlacePrevio = previo ? `\n\n📄 Aquí está: ${config.PREOP_RASTREAR_API_URL}/ver/${previo.id}` : '';
        await enviar(session, telefono, `✅ El vehículo *${vehiculo.placa}* ya tiene registrada la inspección preoperacional de hoy.${datos.tenant === 'rastrear' ? enlacePrevio : ''} ¡Buen viaje!\n\nEscribe *MENU* para volver al menú principal.`);
        return;
    }

    datos.token = token;
    datos.vehiculo = vehiculo;
    datos.empresaNombre = (empresa && empresa.nombre) || datos.empresaNombre;

    // Rastrear/Cointra: cada vehículo trae su conductor por defecto; si no es él, se valida por cédula.
    if (datos.tenant === 'rastrear') {
        try {
            const defecto = await preopApi.conductorPorPlaca(vehiculo.placa, datos.tenant);
            const encabezado = `Vehículo encontrado: *${vehiculo.placa}* (${vehiculo.marca || ''} ${vehiculo.modelo || ''})`;
            if (defecto && defecto.nombre) {
                datos.step = 'CONFIRMAR_CONDUCTOR';
                datos.conductorProp = defecto;
                await preopSession.actualizarDatos(telefono, datos);
                await enviar(session, telefono, `${encabezado}\n\nEl conductor asignado es *${defecto.nombre}*.\n\n¿Eres tú? Responde *SI* o *NO*.`);
            } else {
                datos.step = 'CEDULA';
                await preopSession.actualizarDatos(telefono, datos);
                await enviar(session, telefono, `${encabezado}\n\nEste vehículo no tiene conductor asignado. Escribe tu *número de cédula* (solo números).`);
            }
            return;
        } catch (error) {
            console.error('⚠️ [preop-flow] No se pudo consultar el conductor por defecto, se pide el nombre:', error.message);
        }
    }

    datos.step = 'ESPERANDO_NOMBRE';
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, `Vehículo encontrado: *${vehiculo.placa}* (${vehiculo.marca || ''} ${vehiculo.modelo || ''})\n\nPor favor escribe el *nombre completo* del conductor.`);
}

/** Conductor confirmado: guarda el nombre y sigue con el odómetro. */
async function seguirConConductor(session, telefono, datos, nombre) {
    datos.conductorNombre = nombre;
    delete datos.conductorProp;
    datos.step = 'ESPERANDO_ODOMETRO';
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, `Conductor: *${nombre}* ✅\n\nEscribe el *kilometraje del odómetro* (solo el número). Es *obligatorio*.`);
}

async function pasoConfirmarConductor(session, telefono, datos, textoUpper) {
    if (textoUpper === 'SI' || textoUpper === 'SÍ') {
        await seguirConConductor(session, telefono, datos, datos.conductorProp.nombre);
    } else if (textoUpper === 'NO') {
        datos.step = 'CEDULA';
        delete datos.conductorProp;
        await preopSession.actualizarDatos(telefono, datos);
        await enviar(session, telefono, 'Escribe tu *número de cédula* (solo números) para identificarte.');
    } else {
        await enviar(session, telefono, `Por favor responde *SI* o *NO*: ¿eres *${datos.conductorProp.nombre}*?`);
    }
}

async function pasoCedula(session, telefono, datos, texto) {
    const cedula = texto.replace(/\D/g, '');
    if (cedula.length < 5) {
        await enviar(session, telefono, 'La cédula no parece válida. Escribe solo los números, sin puntos ni espacios.');
        return;
    }
    let conductor;
    try {
        conductor = await preopApi.conductorPorCedula(cedula, datos.tenant);
    } catch (error) {
        console.error('❌ [preop-flow] Error consultando cédula:', error.message);
        await enviar(session, telefono, '⚠️ No pudimos consultar la cédula en este momento. Intenta de nuevo en unos minutos.');
        return;
    }
    if (!conductor) {
        await enviar(session, telefono, `⚠️ La cédula *${cedula}* no está registrada. Verifica el número e inténtalo de nuevo, o contacta al administrador para que te registre. (*CANCELAR* para salir)`);
        return;
    }
    datos.step = 'CONFIRMAR_CEDULA';
    datos.conductorProp = conductor;
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, `La cédula *${cedula}* corresponde a *${conductor.nombre}*.\n\n¿Eres tú? Responde *SI* o *NO*.`);
}

async function pasoConfirmarCedula(session, telefono, datos, textoUpper) {
    if (textoUpper === 'SI' || textoUpper === 'SÍ') {
        await seguirConConductor(session, telefono, datos, datos.conductorProp.nombre);
    } else if (textoUpper === 'NO') {
        datos.step = 'CEDULA';
        delete datos.conductorProp;
        await preopSession.actualizarDatos(telefono, datos);
        await enviar(session, telefono, 'Escribe de nuevo tu *número de cédula* (solo números).');
    } else {
        await enviar(session, telefono, 'Por favor responde *SI* o *NO*.');
    }
}

async function pasoNombre(session, telefono, datos, texto) {
    if (!texto || texto.length < 3) {
        await enviar(session, telefono, 'Por favor escribe el nombre completo del conductor.');
        return;
    }
    datos.step = 'ESPERANDO_ODOMETRO';
    datos.conductorNombre = texto;
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, 'Escribe el *kilometraje del odómetro* (solo el número). Es *obligatorio*.');
}

async function pasoOdometro(session, telefono, datos, texto) {
    const normalizado = texto.replace(',', '.').replace(/[^\d.]/g, '');
    const numero = parseFloat(normalizado);
    if (!Number.isFinite(numero) || numero <= 0) {
        await enviar(session, telefono, 'El kilometraje es *obligatorio*. Escribe solo el número del odómetro (ej: 15234.5).');
        return;
    }
    datos.odometro = numero;
    datos.step = 'ESPERANDO_TODO_BIEN';
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, '¿El vehículo está en *buen estado general* (sin novedades)?\n\nResponde *SI* o *NO*.');
}

async function pasoTodoBien(session, telefono, datos, textoUpper) {
    if (textoUpper === 'SI') {
        datos.afectados = [];
        await preopSession.actualizarDatos(telefono, datos);
        await enviarLinkFotos(session, telefono, datos);
        return;
    }

    if (textoUpper === 'NO') {
        datos.step = 'ESPERANDO_NOVEDAD_TEXTO';
        await preopSession.actualizarDatos(telefono, datos);
        await enviar(session, telefono, 'Cuéntanos qué está mal, en tus palabras (ej: *"pito malo, frenos rechinan"*). Puedes mencionar varias cosas en el mismo mensaje.');
        return;
    }

    await enviar(session, telefono, 'Por favor responde *SI* o *NO*: ¿el vehículo está en buen estado general?');
}

/**
 * Clasifica la novedad en texto libre contra el checklist usando IA
 * (/internal/preop/mapear-items, mismo motor que usaba el formulario original).
 * Si la IA no logra identificar ningún ítem puntual, no se pierde la novedad:
 * se registra igual como un hallazgo general para que quede visible en el panel.
 */
async function pasoNovedadTexto(session, telefono, datos, texto) {
    if (!texto || texto.trim().length < 3) {
        await enviar(session, telefono, 'Por favor describe brevemente qué está mal con el vehículo.');
        return;
    }

    let resultado;
    try {
        resultado = await preopApi.mapearItems({
            novedad: texto,
            placa: datos.vehiculo.placa,
            tipo: datos.vehiculo.tipo,
        }, datos.tenant);
    } catch (error) {
        console.error('❌ [preop-flow] Error clasificando novedad:', error.message);
        resultado = { items: [] };
    }

    // Si la IA no logra mapear ítems puntuales del checklist, `afectados` queda
    // vacío — el backend (POST /preop-fotos/submit) igual registra la novedad
    // como hallazgo general usando el texto libre (`novedadTexto`/`tieneNovedad`),
    // no se pierde.
    datos.afectados = Array.isArray(resultado.items) ? resultado.items : [];
    datos.novedadTexto = texto;
    datos.tieneNovedad = true;
    await preopSession.actualizarDatos(telefono, datos);

    if (resultado.resumen_texto) {
        await enviar(session, telefono, resultado.resumen_texto);
    }
    await enviarLinkFotos(session, telefono, datos);
}

/**
 * Último paso del checklist: genera el link único de fotos (obligatorio) y lo
 * envía por WhatsApp. Las fotos se toman SOLO con la cámara en vivo (la página
 * fuerza capture=environment, sin opción de galería) — evita fotos viejas o de
 * otro vehículo. El backend crea la inspección cuando el conductor termina de
 * subir las fotos ahí, así que el bot NO llama a crearPreoperacional: su parte
 * termina al entregar el link.
 */
async function enviarLinkFotos(session, telefono, datos) {
    const afectados = (datos.afectados || []).map(i => ({ item_nombre: i.item_nombre, comentario: i.comentario || null }));

    let linkData;
    try {
        linkData = await preopApi.getUploadToken({
            phone: telefono,
            placa: datos.vehiculo.placa,
            tipo: datos.vehiculo.tipo,
            conductor_nombre: datos.conductorNombre,
            odometro: datos.odometro,
            novedad: datos.novedadTexto || null,
            items: afectados,
            tiene_novedad: !!datos.tieneNovedad,
        }, datos.tenant);
    } catch (error) {
        console.error('❌ [preop-flow] Error generando link de fotos:', error.message);
        const mensaje = preopApi.extractErrorMessage(error, 'No pudimos generar el link para las fotos.');
        await enviar(session, telefono, `⚠️ ${mensaje}\n\nIntenta de nuevo escribiendo *PREOP*, o escribe *MENU* para volver al menú principal.`);
        await preopSession.cerrarSesion(telefono);
        return;
    }

    const esMoto = (datos.vehiculo.tipo || '').toLowerCase().includes('moto');
    const totalFotos = esMoto ? 3 : 5;
    // Cada daño reportado exige además su propia foto; una novedad sin ítem identificado cuenta como un daño.
    const totalDanios = afectados.length > 0 ? afectados.length : (datos.tieneNovedad ? 1 : 0);
    const viñetas = [`• *${totalFotos} fotos* del vehículo`];
    if (totalDanios > 0) viñetas.push(`• *${totalDanios} foto${totalDanios > 1 ? 's' : ''}* de los daños reportados (1 por cada daño)`);

    await enviar(session, telefono,
        `📸 *Último paso: fotos (obligatorias)*\n\n` +
        `Abre este link y toma con la *cámara* de tu celular (no puedes elegir fotos de la galería):\n\n` +
        `${viñetas.join('\n')}\n\n` +
        `${linkData.uploadUrl}\n\n` +
        `⏱️ El link vence en 30 minutos. Tu preoperacional queda registrado automáticamente al enviar las fotos ahí.`
    );
    await preopSession.cerrarSesion(telefono);
}

module.exports = { handleMessage, hasActiveSession, tenantFromTrigger, iniciarJornada, iniciarFinJornada };
