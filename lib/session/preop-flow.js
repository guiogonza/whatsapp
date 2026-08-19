/**
 * Flujo conversacional del bot de Preoperacional (Hesego).
 * Máquina de estados por teléfono (paso guardado en preop_bot_sesiones.datos.step),
 * reutilizando la misma sesión de WhatsApp dedicada a GPSwox.
 *
 * Este módulo NO decide cuándo interceptar un mensaje — eso lo hace el gancho en
 * lib/session/core.js (trigger explícito PREOP/PREOPERACIONAL o conversación en curso).
 */

const config = require('../../config');
const preopApi = require('./preop-api');
const preopSession = require('./preop-session');
const { sendMessageWithRetry } = require('./messaging');

/**
 * ¿El teléfono tiene una conversación de preoperacional activa?
 * Usado por el gancho en core.js para decidir si intercepta el mensaje.
 */
async function hasActiveSession(telefono) {
    const sesion = await preopSession.obtenerSesionActiva(telefono);
    return !!sesion;
}

async function enviar(session, telefono, texto) {
    await sendMessageWithRetry(session, telefono, texto, 3);
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

    // MENU/MENÚ en cualquier paso: sale del preoperacional y vuelve al menú de plataformagps
    if (textoUpper === 'MENU' || textoUpper === 'MENÚ') {
        const sesionActiva = await preopSession.obtenerSesionActiva(senderPhone);
        if (sesionActiva) await preopSession.cerrarSesion(senderPhone);
        const { showMenu, startConversation, endConversation } = require('./gpswox-session');
        endConversation(senderPhone);
        startConversation(senderPhone);
        await showMenu(socket, senderPhone);
        return;
    }

    const esTrigger = config.PREOP_TRIGGER_KEYWORDS.includes(textoUpper);
    const sesion = await preopSession.obtenerSesionActiva(senderPhone);

    if (esTrigger) {
        // Nueva conversación (o reinicio si ya había una en curso)
        await iniciarConversacion(session, senderPhone);
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
            case 'ESPERANDO_PLACA':
                await pasoPlaca(session, senderPhone, datos, texto);
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

async function iniciarConversacion(session, telefono) {
    let empresas;
    try {
        empresas = await preopApi.getEmpresas();
    } catch (error) {
        console.error('❌ [preop-flow] Error obteniendo empresas:', error.message);
        await enviar(session, telefono, '⚠️ No pudimos conectar con el sistema de preoperacional en este momento. Intenta nuevamente en unos minutos escribiendo *PREOP*.');
        return;
    }

    if (!Array.isArray(empresas) || empresas.length === 0) {
        await enviar(session, telefono, '⚠️ No hay empresas configuradas en el sistema de preoperacional. Por favor contacta al administrador.');
        return;
    }

    const saludo = '👋 Bienvenido al *Preoperacional Hesego*.\n\nVamos a registrar la inspección preoperacional de tu vehículo. En cualquier momento puedes escribir *CANCELAR* para salir, o *MENU* para volver al menú principal.';

    if (empresas.length === 1) {
        const empresa = empresas[0];
        await preopSession.abrirSesion(telefono, {
            step: 'ESPERANDO_PLACA',
            empresaId: empresa.id,
            empresaNombre: empresa.nombre
        });
        await enviar(session, telefono, `${saludo}\n\nEmpresa: *${empresa.nombre}*\n\nPor favor escribe la *placa* del vehículo (sin espacios ni guiones).`);
        return;
    }

    const lista = empresas.map((e, i) => `${i + 1}. ${e.nombre}`).join('\n');
    await preopSession.abrirSesion(telefono, {
        step: 'ELEGIR_EMPRESA',
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
    const placa = texto.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{5,6}$/.test(placa)) {
        await enviar(session, telefono, 'La placa no parece válida. Escríbela sin espacios ni guiones, por ejemplo *ABC123* (5 a 6 caracteres).\n\nIntenta con otra placa, o escribe *MENU* para volver al menú principal.');
        return;
    }

    let loginData;
    try {
        loginData = await preopApi.loginVehiculo(datos.empresaId, placa);
    } catch (error) {
        // No cerramos la sesión: el usuario se queda en este mismo paso y puede
        // escribir otra placa directamente, sin tener que volver a escribir PREOP.
        const mensaje = preopApi.extractErrorMessage(error, 'No pudimos validar la placa. Verifica que sea correcta o contacta al administrador.');
        await enviar(session, telefono, `⚠️ ${mensaje}\n\nIntenta con otra placa, o escribe *MENU* para volver al menú principal.`);
        return;
    }

    const { token, vehiculo, empresa } = loginData;

    let hoy;
    try {
        hoy = await preopApi.getPreoperacionalHoy(token, vehiculo.placa);
    } catch (error) {
        console.error('❌ [preop-flow] Error consultando preoperacional/hoy:', error.message);
        await preopSession.cerrarSesion(telefono);
        await enviar(session, telefono, '⚠️ No pudimos verificar el historial de hoy para este vehículo. Intenta más tarde escribiendo *PREOP*, o escribe *MENU* para volver al menú principal.');
        return;
    }

    if (hoy && hoy.exists) {
        await preopSession.cerrarSesion(telefono);
        await enviar(session, telefono, `✅ El vehículo *${vehiculo.placa}* ya tiene registrada la inspección preoperacional de hoy. ¡Buen viaje!\n\nEscribe *MENU* para volver al menú principal.`);
        return;
    }

    datos.step = 'ESPERANDO_NOMBRE';
    datos.token = token;
    datos.vehiculo = vehiculo;
    datos.empresaNombre = (empresa && empresa.nombre) || datos.empresaNombre;
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, `Vehículo encontrado: *${vehiculo.placa}* (${vehiculo.marca || ''} ${vehiculo.modelo || ''})\n\nPor favor escribe el *nombre completo* del conductor.`);
}

async function pasoNombre(session, telefono, datos, texto) {
    if (!texto || texto.length < 3) {
        await enviar(session, telefono, 'Por favor escribe el nombre completo del conductor.');
        return;
    }
    datos.step = 'ESPERANDO_ODOMETRO';
    datos.conductorNombre = texto;
    await preopSession.actualizarDatos(telefono, datos);
    await enviar(session, telefono, 'Escribe el *kilometraje del odómetro* (solo el número), o escribe *SALTAR* si no lo tienes a mano.');
}

async function pasoOdometro(session, telefono, datos, texto) {
    const textoUpper = texto.toUpperCase();
    if (textoUpper === 'SALTAR') {
        datos.odometro = null;
    } else {
        const normalizado = texto.replace(',', '.').replace(/[^\d.]/g, '');
        const numero = parseFloat(normalizado);
        if (!Number.isFinite(numero)) {
            await enviar(session, telefono, 'No entendí el kilometraje. Escribe solo el número (ej: 15234.5) o *SALTAR*.');
            return;
        }
        datos.odometro = numero;
    }
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
        });
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
        });
    } catch (error) {
        console.error('❌ [preop-flow] Error generando link de fotos:', error.message);
        const mensaje = preopApi.extractErrorMessage(error, 'No pudimos generar el link para las fotos.');
        await enviar(session, telefono, `⚠️ ${mensaje}\n\nIntenta de nuevo escribiendo *PREOP*, o escribe *MENU* para volver al menú principal.`);
        await preopSession.cerrarSesion(telefono);
        return;
    }

    const esMoto = (datos.vehiculo.tipo || '').toLowerCase().includes('moto');
    const totalFotos = esMoto ? 3 : 5;

    await enviar(session, telefono,
        `📸 *Último paso: fotos del vehículo (obligatorias)*\n\n` +
        `Abre este link y toma las ${totalFotos} fotos con la *cámara* de tu celular (no puedes elegir fotos de la galería):\n\n` +
        `${linkData.uploadUrl}\n\n` +
        `⏱️ El link vence en 30 minutos. Tu preoperacional queda registrado automáticamente al enviar las fotos ahí.`
    );
    await preopSession.cerrarSesion(telefono);
}

module.exports = { handleMessage, hasActiveSession };
