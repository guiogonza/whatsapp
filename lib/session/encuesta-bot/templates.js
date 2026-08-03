/**
 * Constructores de mensajes interactivos (Meta Cloud API) para el bot de la
 * encuesta de Riesgo Psicosocial. Cada función devuelve el objeto "interactive"
 * listo para pasarle a whatsapp-cloud-api.sendInteractiveMessage(telefono, interactive).
 */

const OPCIONES_LIKERT = [
    { valor: 4, titulo: 'Siempre' },
    { valor: 3, titulo: 'Casi siempre' },
    { valor: 2, titulo: 'Algunas veces' },
    { valor: 1, titulo: 'Casi nunca' },
    { valor: 0, titulo: 'Nunca' }
];

const TEXTO_CONSENTIMIENTO = [
    'Usted está invitado a colaborar en el estudio "Identificación de Factores de Riesgo Psicosocial", ',
    'que busca identificar los factores de riesgo psicosocial presentes en la empresa, con el propósito ',
    'de prevenir y disminuir dichos riesgos, dando cumplimiento a la Resolución 2646/2008 y 2404/2019.\n\n',
    'Su participación es voluntaria y confidencial. La información recolectada será usada de forma agregada; ',
    'sus respuestas individuales solo serán conocidas por usted mismo si lo solicita.\n\n',
    '¿Acepta participar libremente en el estudio?'
].join('');

function buildConsentimiento() {
    return {
        type: 'button',
        header: { type: 'text', text: 'Consentimiento informado' },
        body: { text: TEXTO_CONSENTIMIENTO },
        footer: { text: 'Batería de Riesgo Psicosocial · Res. 2646/2008' },
        action: {
            buttons: [
                { type: 'reply', reply: { id: 'consentimiento_acepto', title: 'Acepto' } },
                { type: 'reply', reply: { id: 'consentimiento_no_acepto', title: 'No acepto' } }
            ]
        }
    };
}

function buildGate(itemId, pregunta) {
    return {
        type: 'button',
        body: { text: pregunta },
        action: {
            buttons: [
                { type: 'reply', reply: { id: `gate_${itemId}_si`, title: 'Sí' } },
                { type: 'reply', reply: { id: `gate_${itemId}_no`, title: 'No' } }
            ]
        }
    };
}

function buildLikert(item, progreso) {
    return {
        type: 'list',
        header: { type: 'text', text: `${item.seccion} · ${progreso}` },
        body: { text: item.texto },
        footer: { text: 'Responde tocando una opción' },
        action: {
            button: 'Responder',
            sections: [
                {
                    title: 'Opciones',
                    rows: OPCIONES_LIKERT.map((o) => ({
                        id: `item_${item.id}_valor_${o.valor}`,
                        title: o.titulo
                    }))
                }
            ]
        }
    };
}

function parseRespuestaInteractiva(interactive) {
    const id = interactive.list_reply ? interactive.list_reply.id : interactive.button_reply?.id;
    if (!id) return null;

    let m = id.match(/^item_(.+)_valor_(\d)$/);
    if (m) return { tipo: 'item', itemId: m[1], valor: Number(m[2]) };

    m = id.match(/^gate_(.+)_(si|no)$/);
    if (m) return { tipo: 'gate', gateId: m[1], valor: m[2] === 'si' };

    if (id === 'consentimiento_acepto') return { tipo: 'consentimiento', valor: true };
    if (id === 'consentimiento_no_acepto') return { tipo: 'consentimiento', valor: false };

    return null;
}

/**
 * Respuesta a los botones QUICK_REPLY de la plantilla "encuesta_invitacion" (mensaje tipo
 * "button", no "interactive" — es el primer mensaje, la ventana de 24h aún no está abierta).
 * Esta WABA no soporta payload personalizado en botones de plantilla, así que se compara
 * por el texto del botón (payload cae de vuelta al texto cuando no se configura uno).
 */
function parseRespuestaBotonPlantilla(message) {
    if (message.type !== 'button' || !message.button) return null;
    const texto = (message.button.payload || message.button.text || '').trim().toLowerCase();
    if (texto === 'acepto') return { tipo: 'consentimiento', valor: true };
    if (texto === 'no acepto') return { tipo: 'consentimiento', valor: false };
    return null;
}

module.exports = {
    OPCIONES_LIKERT,
    TEXTO_CONSENTIMIENTO,
    buildConsentimiento,
    buildGate,
    buildLikert,
    parseRespuestaInteractiva,
    parseRespuestaBotonPlantilla
};
