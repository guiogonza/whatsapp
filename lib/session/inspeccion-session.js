/**
 * CRUD de sesiones conversacionales del bot de Inspección (Hesego).
 * Una fila por teléfono en inspeccion_bot_sesiones (creada en database-postgres.js/initDatabase).
 * Todo el estado de la máquina de estados vive en la columna JSONB `datos`.
 */

const database = require('../../database-postgres');
const config = require('../../config');

// Pasos que esperan algo FUERA del chat (minutos propios en vez de BOT_INACTIVIDAD_MIN)
const MINUTOS_PASO_EXTERNO = { ESPERANDO_FOTOS_VEHICULO: 30 };

async function obtenerSesionActiva(telefono) {
    const { rows } = await database.query(
        `SELECT telefono, datos, EXTRACT(EPOCH FROM (NOW() - updated_at)) AS inactiva_seg FROM inspeccion_bot_sesiones WHERE telefono = $1 AND activa = TRUE`,
        [telefono]
    );
    const fila = rows[0];
    if (!fila) return null;
    // Sin respuesta durante BOT_INACTIVIDAD_MIN minutos: se borra y la conversacion arranca de cero
    const paso = (fila.datos || {}).step;
    const minutos = MINUTOS_PASO_EXTERNO[paso] || config.BOT_INACTIVIDAD_MIN;
    if (Number(fila.inactiva_seg) > minutos * 60) {
        await cerrarSesion(telefono);
        return null;
    }
    return { telefono: fila.telefono, datos: fila.datos };
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
