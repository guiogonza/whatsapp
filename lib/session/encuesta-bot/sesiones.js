/**
 * Mapeo teléfono -> token de encuesta activa, para el bot de Riesgo Psicosocial.
 * El estado real de la encuesta (consentimiento, gates, ítems respondidos) vive en el
 * backend de Riesgo Psicosocial; aquí solo se guarda qué token corresponde a qué teléfono
 * y un pequeño estado temporal para pasos que requieren más de una respuesta (ej. gates).
 */

const database = require('../../../database-postgres');
const config = require('../../../config');

let tablaLista = false;

async function asegurarTabla() {
    if (tablaLista) return;
    await database.query(`
        CREATE TABLE IF NOT EXISTS encuesta_bot_sesiones (
            telefono VARCHAR(30) PRIMARY KEY,
            token UUID NOT NULL,
            estado_temporal JSONB NOT NULL DEFAULT '{}',
            activa BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    tablaLista = true;
}

async function abrirSesion(telefono, token) {
    await asegurarTabla();
    await database.query(
        `INSERT INTO encuesta_bot_sesiones (telefono, token, estado_temporal, activa, updated_at)
         VALUES ($1, $2, '{}', TRUE, NOW())
         ON CONFLICT (telefono) DO UPDATE
           SET token = EXCLUDED.token, estado_temporal = '{}', activa = TRUE, updated_at = NOW()`,
        [telefono, token]
    );
}

async function obtenerSesionActiva(telefono) {
    await asegurarTabla();
    const { rows } = await database.query(
        `SELECT telefono, token, estado_temporal, EXTRACT(EPOCH FROM (NOW() - updated_at)) AS inactiva_seg
           FROM encuesta_bot_sesiones WHERE telefono = $1 AND activa = TRUE`,
        [telefono]
    );
    const fila = rows[0];
    if (!fila) return null;
    // Sin respuesta durante BOT_ENCUESTA_INACTIVIDAD_MIN minutos la sesion se cierra y el mensaje sigue su camino normal
    if (Number(fila.inactiva_seg) > config.BOT_ENCUESTA_INACTIVIDAD_MIN * 60) {
        await cerrarSesion(telefono);
        return null;
    }
    return { telefono: fila.telefono, token: fila.token, estado_temporal: fila.estado_temporal };
}

/** Reinicia la cuenta de inactividad (cada mensaje de la persona cuenta como actividad). */
async function tocarSesion(telefono) {
    await asegurarTabla();
    await database.query(`UPDATE encuesta_bot_sesiones SET updated_at = NOW() WHERE telefono = $1 AND activa = TRUE`, [telefono]);
}

async function actualizarEstadoTemporal(telefono, estadoTemporal) {
    await asegurarTabla();
    await database.query(
        `UPDATE encuesta_bot_sesiones SET estado_temporal = $2, updated_at = NOW() WHERE telefono = $1`,
        [telefono, JSON.stringify(estadoTemporal)]
    );
}

async function cerrarSesion(telefono) {
    await asegurarTabla();
    await database.query(
        `UPDATE encuesta_bot_sesiones SET activa = FALSE, updated_at = NOW() WHERE telefono = $1`,
        [telefono]
    );
}

module.exports = { abrirSesion, obtenerSesionActiva, tocarSesion, actualizarEstadoTemporal, cerrarSesion };
