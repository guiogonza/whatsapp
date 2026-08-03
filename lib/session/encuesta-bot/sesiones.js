/**
 * Mapeo teléfono -> token de encuesta activa, para el bot de Riesgo Psicosocial.
 * El estado real de la encuesta (consentimiento, gates, ítems respondidos) vive en el
 * backend de Riesgo Psicosocial; aquí solo se guarda qué token corresponde a qué teléfono
 * y un pequeño estado temporal para pasos que requieren más de una respuesta (ej. gates).
 */

const database = require('../../../database-postgres');

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
        `SELECT telefono, token, estado_temporal FROM encuesta_bot_sesiones WHERE telefono = $1 AND activa = TRUE`,
        [telefono]
    );
    return rows[0] || null;
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

module.exports = { abrirSesion, obtenerSesionActiva, actualizarEstadoTemporal, cerrarSesion };
