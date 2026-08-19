/**
 * CRUD de sesiones conversacionales del bot de Preoperacional (Hesego).
 * Una fila por teléfono en preop_bot_sesiones (creada en database-postgres.js/initDatabase).
 * Todo el estado de la máquina de estados (paso actual, empresa, vehículo, token,
 * items del checklist, fotos subidas, etc.) vive en la columna JSONB `datos`.
 */

const database = require('../../database-postgres');

/**
 * Retorna la sesión activa (si existe) para un teléfono dado.
 * @returns {Promise<{telefono: string, datos: object}|null>}
 */
async function obtenerSesionActiva(telefono) {
    const { rows } = await database.query(
        `SELECT telefono, datos FROM preop_bot_sesiones WHERE telefono = $1 AND activa = TRUE`,
        [telefono]
    );
    return rows[0] || null;
}

/**
 * Abre (o reinicia, si ya existía) una conversación de preoperacional para un teléfono.
 */
async function abrirSesion(telefono, datosIniciales = {}) {
    await database.query(
        `INSERT INTO preop_bot_sesiones (telefono, datos, activa, updated_at)
         VALUES ($1, $2, TRUE, NOW())
         ON CONFLICT (telefono) DO UPDATE
           SET datos = EXCLUDED.datos, activa = TRUE, updated_at = NOW()`,
        [telefono, JSON.stringify(datosIniciales)]
    );
}

/**
 * Reemplaza el JSONB de estado temporal de la conversación en curso.
 */
async function actualizarDatos(telefono, datos) {
    await database.query(
        `UPDATE preop_bot_sesiones SET datos = $2, updated_at = NOW() WHERE telefono = $1`,
        [telefono, JSON.stringify(datos)]
    );
}

/**
 * Cierra (borra) la conversación en curso, ya sea por éxito, cancelación o error terminal.
 */
async function cerrarSesion(telefono) {
    await database.query(
        `DELETE FROM preop_bot_sesiones WHERE telefono = $1`,
        [telefono]
    );
}

module.exports = { obtenerSesionActiva, abrirSesion, actualizarDatos, cerrarSesion };
