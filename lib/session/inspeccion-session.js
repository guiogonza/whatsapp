/**
 * CRUD de sesiones conversacionales del bot de Inspección (Hesego).
 * Una fila por teléfono en inspeccion_bot_sesiones (creada en database-postgres.js/initDatabase).
 * Todo el estado de la máquina de estados vive en la columna JSONB `datos`.
 */

const database = require('../../database-postgres');

async function obtenerSesionActiva(telefono) {
    const { rows } = await database.query(
        `SELECT telefono, datos FROM inspeccion_bot_sesiones WHERE telefono = $1 AND activa = TRUE`,
        [telefono]
    );
    return rows[0] || null;
}

async function abrirSesion(telefono, datosIniciales = {}) {
    await database.query(
        `INSERT INTO inspeccion_bot_sesiones (telefono, datos, activa, updated_at)
         VALUES ($1, $2, TRUE, NOW())
         ON CONFLICT (telefono) DO UPDATE
           SET datos = EXCLUDED.datos, activa = TRUE, updated_at = NOW()`,
        [telefono, JSON.stringify(datosIniciales)]
    );
}

async function actualizarDatos(telefono, datos) {
    await database.query(
        `UPDATE inspeccion_bot_sesiones SET datos = $2, updated_at = NOW() WHERE telefono = $1`,
        [telefono, JSON.stringify(datos)]
    );
}

async function cerrarSesion(telefono) {
    await database.query(
        `DELETE FROM inspeccion_bot_sesiones WHERE telefono = $1`,
        [telefono]
    );
}

module.exports = { obtenerSesionActiva, abrirSesion, actualizarDatos, cerrarSesion };
