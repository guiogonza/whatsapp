/**
 * Empresa con la que trabaja cada teléfono en el bot: 'hesego' | 'rastrear'.
 * Se elige escribiendo el nombre de la empresa (HESEGO / RASTREAR) y queda guardada, así
 * PREOP / PREOPERACIONAL entran al preoperacional de la empresa correcta sin volver a preguntar.
 * Sin elección previa se asume 'hesego' (comportamiento que ya tenían sus conductores).
 */

const database = require('../../database-postgres');

const EMPRESAS = {
    hesego: { nombre: 'Hesego' },
    rastrear: { nombre: 'Rastrear' }
};
const POR_DEFECTO = 'hesego';

const cache = new Map(); // telefono -> empresa (evita ir a la BD en cada mensaje)

function esEmpresa(valor) {
    return Object.prototype.hasOwnProperty.call(EMPRESAS, valor);
}

/** @returns {Promise<string|null>} empresa guardada para el teléfono, o null si nunca eligió */
async function obtener(telefono) {
    if (cache.has(telefono)) return cache.get(telefono);
    try {
        const { rows } = await database.query(
            'SELECT empresa FROM bot_empresa_elegida WHERE telefono = $1', [telefono]
        );
        const empresa = rows[0] && esEmpresa(rows[0].empresa) ? rows[0].empresa : null;
        if (empresa) cache.set(telefono, empresa);
        return empresa;
    } catch (error) {
        console.error('⚠️ [empresa-pref] No se pudo leer la empresa elegida:', error.message);
        return null;
    }
}

/** Empresa a usar: la elegida o, si nunca eligió, la de por defecto. */
async function obtenerOPorDefecto(telefono) {
    return (await obtener(telefono)) || POR_DEFECTO;
}

async function guardar(telefono, empresa) {
    if (!esEmpresa(empresa)) return;
    cache.set(telefono, empresa);
    try {
        await database.query(
            `INSERT INTO bot_empresa_elegida (telefono, empresa, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (telefono) DO UPDATE SET empresa = EXCLUDED.empresa, updated_at = NOW()`,
            [telefono, empresa]
        );
    } catch (error) {
        console.error('⚠️ [empresa-pref] No se pudo guardar la empresa elegida:', error.message);
    }
}

module.exports = { EMPRESAS, POR_DEFECTO, esEmpresa, obtener, obtenerOPorDefecto, guardar };
