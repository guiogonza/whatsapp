/**
 * Máquina de estados del bot de encuesta de Riesgo Psicosocial.
 * El estado "de verdad" vive en el backend de Riesgo Psicosocial (asignación/respuestas);
 * este módulo solo decide, en cada evento, qué preguntar a continuación y envía el
 * mensaje interactivo correspondiente.
 */

const cloudApi = require('../whatsapp-cloud-api');
const config = require('../../../config');
const backend = require('./backendClient');
const sesiones = require('./sesiones');
const templates = require('./templates');

/**
 * Dispara el primer mensaje (template aprobado por Meta) para abrir la conversación
 * de una encuesta recién habilitada. Llamado desde el backend de Riesgo Psicosocial.
 *
 * Dos diseños de template soportados, según ENCUESTA_PSICOSOCIAL_TEMPLATE_NAME:
 * - "invitacion_encuesta_psicosocial": botón URL directo al link web de la encuesta
 *   (usa {{1}} = nombre del empleado en el body y {{1}} = token en la URL del botón).
 *   No requiere seguimiento por chat: el empleado diligencia todo en la web.
 * - Cualquier otro nombre (ej. "encuesta_invitacion"): template simple sin parámetros;
 *   cualquier respuesta abre la ventana de 24h y el bot continúa por chat con botones/listas.
 */
async function iniciarPorTrigger(telefono, token) {
    await sesiones.abrirSesion(telefono, token);

    const templateName = config.ENCUESTA_PSICOSOCIAL_TEMPLATE_NAME;
    let components = [];

    if (templateName === 'invitacion_encuesta_psicosocial') {
        const encuesta = await backend.getEncuesta(token);
        const nombre = encuesta?.asignacion?.usuario_nombre || 'colaborador';
        components = [
            { type: 'body', parameters: [{ type: 'text', text: nombre }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] }
        ];
    }

    return cloudApi.sendTemplateMessage(
        telefono,
        templateName,
        config.ENCUESTA_PSICOSOCIAL_TEMPLATE_LANGUAGE,
        components
    );
}

/**
 * Envía el siguiente paso pendiente de la encuesta (consentimiento, gates o siguiente ítem),
 * o el mensaje de cierre si ya no queda nada por responder.
 */
async function enviarSiguientePaso(telefono, token) {
    const encuesta = await backend.getEncuesta(token);
    if (!encuesta.success) {
        return cloudApi.sendTextMessage(telefono, 'No pude cargar tu encuesta en este momento. Intenta más tarde.');
    }

    if (!encuesta.consentimiento) {
        return cloudApi.sendInteractiveMessage(telefono, templates.buildConsentimiento());
    }

    if (!encuesta.consentimiento.acepta) {
        await sesiones.cerrarSesion(telefono);
        return cloudApi.sendTextMessage(telefono, 'Entendido, no se registrarán respuestas. Gracias por tu tiempo.');
    }

    const esFormaA = encuesta.asignacion.instrumento_codigo === 'intralaboral_a';
    if (encuesta.asignacion.atiende_clientes === null) {
        const sesion = await sesiones.obtenerSesionActiva(telefono);
        const temp = sesion?.estado_temporal || {};
        if (temp.atiende_clientes === undefined) {
            return cloudApi.sendInteractiveMessage(
                telefono,
                templates.buildGate('atiende_clientes', 'En mi trabajo debo brindar servicio a clientes o usuarios:')
            );
        }
        if (esFormaA && temp.es_jefe === undefined) {
            return cloudApi.sendInteractiveMessage(
                telefono,
                templates.buildGate('es_jefe', 'Soy jefe de otras personas en mi trabajo:')
            );
        }
        // Ambos gates respondidos (o solo el primero si no es Forma A): confirmar al backend
        await backend.enviarGates(token, { atiende_clientes: temp.atiende_clientes, es_jefe: !!temp.es_jefe });
        await sesiones.actualizarEstadoTemporal(telefono, {});
        return enviarSiguientePaso(telefono, token);
    }

    const itemsResp = await backend.getItems(token);
    const siguiente = (itemsResp.items || []).find((i) => i.valor === null);
    if (siguiente) {
        const total = itemsResp.items.length;
        const respondidos = itemsResp.items.filter((i) => i.valor !== null).length;
        const progreso = `${respondidos + 1}/${total}`;
        return cloudApi.sendInteractiveMessage(telefono, templates.buildLikert(siguiente, progreso));
    }

    const resultado = await backend.completar(token);
    await sesiones.cerrarSesion(telefono);
    if (!resultado.success) {
        return cloudApi.sendTextMessage(telefono, `No pude cerrar tu encuesta: ${resultado.error}`);
    }
    return cloudApi.sendTextMessage(telefono, '¡Listo! Terminaste la encuesta. Gracias por tu participación 🙏');
}

/**
 * Procesa un mensaje entrante de WhatsApp para un teléfono con sesión de encuesta activa.
 * Devuelve true si el mensaje fue manejado por el bot de encuestas, false si no aplica
 * (para que el webhook lo deje pasar a otros manejadores: GPSwox, FX, etc.).
 */
async function procesarMensajeEntrante(telefono, message) {
    const sesion = await sesiones.obtenerSesionActiva(telefono);
    if (!sesion) return false;

    const token = sesion.token;

    if (message.type === 'interactive' && message.interactive) {
        const respuesta = templates.parseRespuestaInteractiva(message.interactive);
        if (!respuesta) return true; // era del bot de encuestas pero no reconocimos el id

        if (respuesta.tipo === 'consentimiento') {
            await backend.enviarConsentimiento(token, respuesta.valor);
            await enviarSiguientePaso(telefono, token);
            return true;
        }

        if (respuesta.tipo === 'gate') {
            const temp = { ...sesion.estado_temporal, [respuesta.gateId]: respuesta.valor };
            await sesiones.actualizarEstadoTemporal(telefono, temp);
            await enviarSiguientePaso(telefono, token);
            return true;
        }

        if (respuesta.tipo === 'item') {
            await backend.enviarRespuesta(token, respuesta.itemId, respuesta.valor);
            await enviarSiguientePaso(telefono, token);
            return true;
        }

        return true;
    }

    if (message.type === 'button' && message.button) {
        const respuesta = templates.parseRespuestaBotonPlantilla(message);
        if (respuesta && respuesta.tipo === 'consentimiento') {
            await backend.enviarConsentimiento(token, respuesta.valor);
            await enviarSiguientePaso(telefono, token);
            return true;
        }
        // Botón de plantilla no reconocido: igual reanuda el flujo (probablemente ya se
        // registró el consentimiento y toca continuar con gates/ítems).
        await enviarSiguientePaso(telefono, token);
        return true;
    }

    // Cualquier mensaje de texto (ej. respondiendo al template de invitación) reanuda el flujo
    await enviarSiguientePaso(telefono, token);
    return true;
}

module.exports = { iniciarPorTrigger, enviarSiguientePaso, procesarMensajeEntrante };
