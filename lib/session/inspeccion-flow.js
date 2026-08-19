/**
 * Flujo conversacional del bot de Inspección (Hesego).
 * Máquina de estados por teléfono (paso guardado en inspeccion_bot_sesiones.datos.step),
 * reutilizando la misma sesión de WhatsApp dedicada a GPSwox.
 *
 * Este módulo NO decide cuándo interceptar un mensaje — eso lo hace el gancho en
 * lib/session/core.js (trigger explícito INSPECCION/INSPECCIONAR o conversación en curso).
 */

const config = require('../../config');
const inspApi = require('./inspeccion-api');
const inspSession = require('./inspeccion-session');
const { sendMessageWithRetry } = require('./messaging');

// Checklist fijo — copiado literal del frontend web, no cambiar los nombres
const ITEMS_INSPECCION = [
    'Parrilla delantera',
    'Faros delanteros',
    'Rines de las llantas',
    'Defensas (parachoques)',
    'Cofre (capó)',
    'Estribos laterales (escalones)',
    'Luces de atrás',
    'Espejos laterales',
    'Barras del techo',
    'Alerón trasero, baúl',
    'Manijas de las puertas',
    'Molduras de las salpicaderas',
    'Tablero principal',
    'Asientos',
    'Volante',
    'Pantalla central',
    'Consola del medio (donde va la palanca)',
    'Luces ambientales interiores',
    'Paneles de las puertas',
    'Aire acondicionado',
];

function listaItems() {
    return ITEMS_INSPECCION.map((n, i) => `${i + 1}. ${n}`).join('\n');
}

async function hasActiveSession(telefono) {
    const sesion = await inspSession.obtenerSesionActiva(telefono);
    return !!sesion;
}

async function enviar(session, telefono, texto) {
    await sendMessageWithRetry(session, telefono, texto, 3);
}

/**
 * Punto de entrada del flujo. Llamado desde core.js/handleIncomingMessage.
 */
async function handleMessage(session, sessionName, senderPhone, textoRaw, mediaMessage, socket) {
    const texto = (textoRaw || '').trim();
    const textoUpper = texto.toUpperCase();

    if (textoUpper === 'CANCELAR') {
        const sesionActiva = await inspSession.obtenerSesionActiva(senderPhone);
        if (sesionActiva) {
            await inspSession.cerrarSesion(senderPhone);
            await enviar(session, senderPhone, '❌ Proceso de inspección cancelado. Escribe *INSPECCION* cuando quieras iniciar de nuevo.');
        }
        return;
    }

    if (textoUpper === 'MENU' || textoUpper === 'MENÚ') {
        const sesionActiva = await inspSession.obtenerSesionActiva(senderPhone);
        if (sesionActiva) await inspSession.cerrarSesion(senderPhone);

        // El menu principal de plataformagps ahora vive en hesego-operatividad
        // (proyecto extraido de este monolito). Si esta desplegado, reenviarle
        // "menu" para que sea EL quien cree el estado de conversacion y responda
        // - de lo contrario, dos copias de gpswox-session (esta local, inerte, y
        // la del proyecto nuevo) quedan desincronizadas: esta enviaria el menu
        // pero hesego-operatividad nunca se enteraria de que la conversacion
        // arranco, y el siguiente mensaje del usuario volveria a mostrar el
        // menu en vez de avanzar.
        if (config.GPSWOX_WEBHOOK_URL) {
            try {
                const axios = require('axios');
                await axios.post(`${config.GPSWOX_WEBHOOK_URL}/webhook/incoming`, {
                    phoneNumber: senderPhone,
                    message: 'menu',
                    sessionName
                }, {
                    timeout: 10000,
                    headers: config.GPSWOX_WEBHOOK_SHARED_SECRET
                        ? { 'X-Internal-Secret': config.GPSWOX_WEBHOOK_SHARED_SECRET }
                        : {}
                });
            } catch (webhookError) {
                console.error(`❌ Error reenviando "menu" a hesego-operatividad: ${webhookError.message}`);
            }
            return;
        }

        // Fallback: sin GPSWOX_WEBHOOK_URL configurado, comportamiento anterior
        const { showMenu, startConversation, endConversation } = require('./gpswox-session');
        endConversation(senderPhone);
        startConversation(senderPhone);
        await showMenu(socket, senderPhone);
        return;
    }

    const esTrigger = config.INSP_TRIGGER_KEYWORDS.includes(textoUpper);
    const sesion = await inspSession.obtenerSesionActiva(senderPhone);

    if (esTrigger) {
        await iniciarConversacion(session, senderPhone);
        return;
    }

    if (!sesion) return;

    const datos = sesion.datos || {};
    const step = datos.step;

    try {
        switch (step) {
            case 'ELEGIR_SEDE':
                await pasoElegirSede(session, senderPhone, datos, texto);
                break;
            case 'ESPERANDO_PLACA':
                await pasoPlaca(session, senderPhone, datos, texto);
                break;
            case 'ESPERANDO_AUDITOR':
                await pasoAuditor(session, senderPhone, datos, texto);
                break;
            case 'ESPERANDO_ITEM_DANADO':
                await pasoItemDanado(session, senderPhone, datos, texto);
                break;
            case 'ESPERANDO_DESCRIPCION_ITEM':
                await pasoDescripcionItem(session, senderPhone, datos, texto);
                break;
            default:
                console.warn(`⚠️ [inspeccion-flow] Paso desconocido "${step}" para ${senderPhone}, reiniciando sesión`);
                await inspSession.cerrarSesion(senderPhone);
                await enviar(session, senderPhone, 'Hubo un problema con tu proceso anterior. Escribe *INSPECCION* para iniciar de nuevo.');
        }
    } catch (error) {
        console.error(`❌ [inspeccion-flow] Error procesando paso "${step}" para ${senderPhone}:`, error.message);
        await enviar(session, senderPhone, '⚠️ Ocurrió un error inesperado procesando tu solicitud. Intenta de nuevo, escribe *CANCELAR* para reiniciar, o *MENU* para volver al menú principal.');
    }
}

async function iniciarConversacion(session, telefono) {
    let sedes;
    try {
        sedes = await inspApi.getSedes();
    } catch (error) {
        console.error('❌ [inspeccion-flow] Error obteniendo sedes:', error.message);
        await enviar(session, telefono, '⚠️ No pudimos conectar con el sistema de inspección en este momento. Intenta nuevamente en unos minutos escribiendo *INSPECCION*.');
        return;
    }

    if (!Array.isArray(sedes) || sedes.length === 0) {
        await enviar(session, telefono, '⚠️ No hay sedes configuradas en el sistema de inspección. Por favor contacta al administrador.');
        return;
    }

    const saludo = '👋 Bienvenido a *Inspección Hesego*.\n\nVamos a registrar la inspección de tu vehículo. En cualquier momento puedes escribir *CANCELAR* para salir, o *MENU* para volver al menú principal.';

    if (sedes.length === 1) {
        const sede = sedes[0];
        await inspSession.abrirSesion(telefono, { step: 'ESPERANDO_PLACA', sedeId: sede.id, sedeNombre: sede.nombre });
        await enviar(session, telefono, `${saludo}\n\nSede: *${sede.nombre}*\n\nPor favor escribe la *placa* del vehículo (sin espacios ni guiones).`);
        return;
    }

    const lista = sedes.map((s, i) => `${i + 1}. ${s.nombre}`).join('\n');
    await inspSession.abrirSesion(telefono, { step: 'ELEGIR_SEDE', sedesDisponibles: sedes });
    await enviar(session, telefono, `${saludo}\n\n¿En qué sede estás?\n\n${lista}\n\nResponde con el número de la opción.`);
}

async function pasoElegirSede(session, telefono, datos, texto) {
    const opciones = datos.sedesDisponibles || [];
    const numero = parseInt(texto, 10);
    if (!Number.isInteger(numero) || numero < 1 || numero > opciones.length) {
        const lista = opciones.map((s, i) => `${i + 1}. ${s.nombre}`).join('\n');
        await enviar(session, telefono, `No entendí tu respuesta. Por favor responde solo con el número de la sede:\n\n${lista}`);
        return;
    }

    const sede = opciones[numero - 1];
    datos.step = 'ESPERANDO_PLACA';
    datos.sedeId = sede.id;
    datos.sedeNombre = sede.nombre;
    delete datos.sedesDisponibles;
    await inspSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, `Sede seleccionada: *${sede.nombre}*\n\nPor favor escribe la *placa* del vehículo (sin espacios ni guiones).`);
}

/**
 * Valida la placa (GPSWOX/local) y si ya tiene inspección de hoy ANTES de
 * pedir el nombre del auditor — no tiene sentido preguntarlo si de todos
 * modos ya no hay nada que registrar hoy para ese vehículo.
 */
async function pasoPlaca(session, telefono, datos, texto) {
    const placa = texto.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{5,6}$/.test(placa)) {
        await enviar(session, telefono, 'La placa no parece válida. Escríbela sin espacios ni guiones, por ejemplo *ABC123* (5 a 6 caracteres).\n\nIntenta con otra placa, o escribe *MENU* para volver al menú principal.');
        return;
    }

    let loginData;
    try {
        // Nombre de auditor aún no lo tenemos — se usa un valor temporal solo
        // para validar la placa; el nombre real se pide después y se envía
        // en el paso final (no queda guardado en ningún lado con este valor).
        loginData = await inspApi.loginInspeccion(placa, datos.sedeId, 'Pendiente');
    } catch (error) {
        const mensaje = inspApi.extractErrorMessage(error, 'No pudimos validar la placa. Verifica que sea correcta o contacta al administrador.');
        await enviar(session, telefono, `⚠️ ${mensaje}\n\nIntenta con otra placa, o escribe *MENU* para volver al menú principal.`);
        return;
    }

    const { token, vehiculo } = loginData;

    let hoy;
    try {
        hoy = await inspApi.getInspeccionHoy(token, vehiculo.placa);
    } catch (error) {
        console.error('❌ [inspeccion-flow] Error consultando inspecciones/hoy:', error.message);
        await enviar(session, telefono, '⚠️ No pudimos verificar el historial de hoy para este vehículo.\n\nIntenta con otra placa, o escribe *MENU* para volver al menú principal.');
        return;
    }

    if (hoy && hoy.exists) {
        await enviar(session, telefono, `✅ El vehículo *${vehiculo.placa}* ya tiene registrada la inspección de hoy. ¡Buen viaje!\n\nEscribe otra *placa* para inspeccionar otro vehículo, o escribe *MENU* para volver al menú principal.`);
        return;
    }

    datos.token = token;
    datos.vehiculo = vehiculo;
    datos.step = 'ESPERANDO_AUDITOR';
    await inspSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, `Vehículo encontrado: *${vehiculo.placa}*\n\nPor favor escribe el *nombre completo* del auditor.`);
}

async function pasoAuditor(session, telefono, datos, texto) {
    if (!texto || texto.length < 3) {
        await enviar(session, telefono, 'Por favor escribe el nombre completo del auditor.');
        return;
    }
    datos.auditorNombre = texto;
    datos.danos = []; // { item_nombre, foto_url, comentario }
    datos.step = 'ESPERANDO_ITEM_DANADO';
    await inspSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono,
        `Estos son los ${ITEMS_INSPECCION.length} puntos a revisar:\n\n${listaItems()}\n\n` +
        `Escribe el/los *número(s)* de los ítems dañados, separados por coma si hay varios (ej: *2, 5, 7*), o escribe *NINGUNO* si el vehículo está en buen estado.`
    );
}

/**
 * Acepta NINGUNO, o uno o varios números separados por coma (ej: "2, 5, 7")
 * en un solo mensaje — no se pregunta "¿hay otro daño?" iterativamente.
 */
async function pasoItemDanado(session, telefono, datos, texto) {
    const textoUpper = texto.trim().toUpperCase();

    if (textoUpper === 'NINGUNO') {
        datos.danos = [];
        await inspSession.actualizarDatos(telefono, datos);
        await finalizarSinDanos(session, telefono, datos);
        return;
    }

    const numeros = [...new Set(
        texto.split(',')
            .map(s => parseInt(s.trim(), 10))
            .filter(n => Number.isInteger(n) && n >= 1 && n <= ITEMS_INSPECCION.length)
    )];

    if (numeros.length === 0) {
        await enviar(session, telefono, `No entendí tu respuesta. Escribe el/los número(s) del ítem dañado, separados por coma si hay varios (ej: *2, 5, 7*), o *NINGUNO* si no hay daños:\n\n${listaItems()}`);
        return;
    }

    datos.itemsDanados = numeros.map(n => ITEMS_INSPECCION[n - 1]);
    datos.descripciones = {};
    datos.descIndex = 0;
    datos.step = 'ESPERANDO_DESCRIPCION_ITEM';
    await inspSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, `Cuéntanos qué está mal en *${datos.itemsDanados[0]}*:`);
}

async function pasoDescripcionItem(session, telefono, datos, texto) {
    const itemActual = datos.itemsDanados[datos.descIndex];

    if (!texto || !texto.trim()) {
        await enviar(session, telefono, `Por favor escribe una breve descripción del daño en *${itemActual}*.`);
        return;
    }

    datos.descripciones[itemActual] = texto.trim();
    datos.descIndex += 1;

    if (datos.descIndex < datos.itemsDanados.length) {
        const siguiente = datos.itemsDanados[datos.descIndex];
        await inspSession.actualizarDatos(telefono, datos);
        await enviar(session, telefono, `Cuéntanos qué está mal en *${siguiente}*:`);
        return;
    }

    datos.danos = datos.itemsDanados.map(nombre => ({ item_nombre: nombre, comentario: datos.descripciones[nombre] }));
    await inspSession.actualizarDatos(telefono, datos);
    await enviarLinkFotos(session, telefono, datos);
}

/**
 * Caso "sin novedades": no requiere fotos, se crea la inspección directo.
 */
async function finalizarSinDanos(session, telefono, datos) {
    const items = ITEMS_INSPECCION.map(nombre => ({ item_nombre: nombre, calificacion: 'Bueno', foto_url: null, comentario: null }));
    try {
        const resultado = await inspApi.crearInspeccion(datos.token, {
            placa: datos.vehiculo.placa,
            sedeId: datos.sedeId,
            auditorNombre: datos.auditorNombre,
            items,
        });
        await inspSession.cerrarSesion(telefono);
        const porcentaje = (resultado && resultado.porcentaje != null) ? resultado.porcentaje : 100;
        await enviar(session, telefono,
            `✅ *Inspección registrada*\n\n` +
            `Placa: *${datos.vehiculo.placa}*\n` +
            `Sede: *${datos.sedeNombre}*\n` +
            `Auditor: *${datos.auditorNombre}*\n` +
            `Estado del vehículo: *${porcentaje}%*\n\n` +
            `Gracias por completar la inspección.`
        );
    } catch (error) {
        const status = error.response?.status;
        if (status === 409) {
            await inspSession.cerrarSesion(telefono);
            await enviar(session, telefono, '✅ Este vehículo ya tenía registrada la inspección de hoy.');
            return;
        }
        console.error('❌ [inspeccion-flow] Error creando inspección:', error.message);
        const mensaje = inspApi.extractErrorMessage(error, 'No pudimos registrar la inspección.');
        await inspSession.cerrarSesion(telefono);
        await enviar(session, telefono, `⚠️ ${mensaje}\n\nPuedes intentar de nuevo escribiendo *INSPECCION*.`);
    }
}

/**
 * Caso "con daños": genera el link único de fotos (cámara obligatoria, una
 * por cada daño reportado) y lo envía. El backend crea la inspección cuando
 * el auditor termina de subir las fotos ahí — el bot no llama a crearInspeccion.
 */
async function enviarLinkFotos(session, telefono, datos) {
    let linkData;
    try {
        linkData = await inspApi.getUploadToken({
            placa: datos.vehiculo.placa,
            sedeId: datos.sedeId,
            sedeNombre: datos.sedeNombre,
            auditorNombre: datos.auditorNombre,
            danos: datos.danos,
        });
    } catch (error) {
        console.error('❌ [inspeccion-flow] Error generando link de fotos:', error.message);
        const mensaje = inspApi.extractErrorMessage(error, 'No pudimos generar el link para las fotos.');
        await enviar(session, telefono, `⚠️ ${mensaje}\n\nIntenta de nuevo escribiendo *INSPECCION*, o escribe *MENU* para volver al menú principal.`);
        await inspSession.cerrarSesion(telefono);
        return;
    }

    await enviar(session, telefono,
        `📸 *Último paso: fotos de los daños reportados (${datos.danos.length})*\n\n` +
        `Abre este link y toma una foto con la *cámara* de tu celular por cada daño (no puedes elegir fotos de la galería):\n\n` +
        `${linkData.uploadUrl}\n\n` +
        `⏱️ El link vence en 30 minutos. Tu inspección queda registrada automáticamente al enviar las fotos ahí.`
    );
    await inspSession.cerrarSesion(telefono);
}

module.exports = { handleMessage, hasActiveSession };
