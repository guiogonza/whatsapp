const axios = require('axios');
const config = require('../../../config');

function baseUrl() {
    const url = config.ENCUESTA_PSICOSOCIAL_API_URL;
    if (!url) throw new Error('ENCUESTA_PSICOSOCIAL_API_URL no configurada');
    return url.replace(/\/$/, '');
}

async function getEncuesta(token) {
    const { data } = await axios.get(`${baseUrl()}/encuesta/${token}`, { timeout: 15000 });
    return data;
}

async function enviarConsentimiento(token, acepta) {
    const { data } = await axios.post(`${baseUrl()}/encuesta/${token}/consentimiento`, { acepta }, { timeout: 15000 });
    return data;
}

async function enviarGates(token, { atiende_clientes, es_jefe }) {
    const { data } = await axios.post(`${baseUrl()}/encuesta/${token}/gates`, { atiende_clientes, es_jefe }, { timeout: 15000 });
    return data;
}

async function getItems(token) {
    const { data } = await axios.get(`${baseUrl()}/encuesta/${token}/items`, { timeout: 15000 });
    return data;
}

async function enviarRespuesta(token, itemId, valor) {
    const { data } = await axios.post(`${baseUrl()}/encuesta/${token}/respuesta`, { itemId, valor }, { timeout: 15000 });
    return data;
}

async function completar(token) {
    const { data } = await axios.post(`${baseUrl()}/encuesta/${token}/completar`, {}, { timeout: 15000 });
    return data;
}

module.exports = { getEncuesta, enviarConsentimiento, enviarGates, getItems, enviarRespuesta, completar };
