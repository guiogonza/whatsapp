/**
 * Reenvío de alertas de geozonas "control ..." a las personas asignadas a cada placa.
 * CRUD en data/alert-vehicles.json (carpeta montada como volumen, sobrevive a reinicios).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseAlertMessage } = require('./session/whatsapp-cloud-api');

const DATA_DIR = path.join(__dirname, '..', 'data', 'alert-vehicles');
const DATA_FILE = path.join(DATA_DIR, 'alert-vehicles.json');
const LOG_FILE = path.join(DATA_DIR, 'sent-log.jsonl');
const LOG_MAX_RETURN = 20000;

// Solo se reenvían alertas cuya geozona empieza por "control", ej: (control darien)
const CONTROL_GEOFENCE_REGEX = /\(\s*control\b[^)]*\)/i;
const FORWARD_DELAY_MS = 2000;
const DEDUP_TTL_MS = 10 * 60 * 1000;

const recentAlerts = new Map();

function normalizePlate(plate) {
    return String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Celular colombiano de 10 dígitos (ej: 3196319531) -> se antepone el indicativo 57
function normalizePhone(phone) {
    const digits = String(phone || '').replace(/[^\d]/g, '');
    return digits.length === 10 ? '57' + digits : digits;
}

function load() {
    try {
        if (!fs.existsSync(DATA_FILE)) return [];
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('❌ alert-vehicles.json ilegible:', error.message);
        return [];
    }
}

function save(records) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
    fs.renameSync(tmp, DATA_FILE);
}

// Celular colombiano: exactamente 10 dígitos que empiezan por 3 (se ignoran espacios y guiones).
// El indicativo 57 lo agrega este módulo al guardar; el usuario nunca lo escribe.
function toLocalPhone(phone) {
    const digits = String(phone == null ? '' : phone).replace(/[\s\-.()]/g, '');
    return /^3\d{9}$/.test(digits) ? digits : null;
}

const PHONE_ERROR = 'El WhatsApp debe tener 10 dígitos y empezar por 3 (ej: 3196319531)';

// El front nunca ve el 57: se guarda con indicativo y se expone solo con 10 dígitos
function publicRecord(r) {
    return { ...r, whatsapp: String(r.whatsapp).slice(-10) };
}

function validate({ plate, name, whatsapp }) {
    const p = normalizePlate(plate);
    const n = String(name == null ? '' : name).trim();
    const local = toLocalPhone(whatsapp);
    if (!p) return { error: 'La placa es requerida' };
    if (p.length < 5 || p.length > 8) return { error: 'La placa debe tener entre 5 y 8 caracteres' };
    if (!n) return { error: 'El nombre de la persona es requerido' };
    if (n.length > 80) return { error: 'El nombre no puede superar 80 caracteres' };
    if (!local) return { error: PHONE_ERROR };
    return { value: { plate: p, name: n, whatsapp: '57' + local } };
}

// ---------------------------- CRUD ----------------------------

function list() {
    return load()
        .sort((a, b) => a.plate.localeCompare(b.plate) || a.name.localeCompare(b.name))
        .map(publicRecord);
}

function create(input) {
    const { error, value } = validate(input);
    if (error) return { error };
    const records = load();
    if (records.some(r => r.plate === value.plate && r.whatsapp === value.whatsapp)) {
        return { error: `${value.plate} ya tiene asignado el WhatsApp ${value.whatsapp.slice(-10)}` };
    }
    const record = { id: crypto.randomUUID(), ...value };
    records.push(record);
    save(records);
    return { record: publicRecord(record) };
}

function update(id, input) {
    const { error, value } = validate(input);
    if (error) return { error };
    const records = load();
    const index = records.findIndex(r => r.id === id);
    if (index === -1) return { notFound: true };
    if (records.some(r => r.id !== id && r.plate === value.plate && r.whatsapp === value.whatsapp)) {
        return { error: `${value.plate} ya tiene asignado el WhatsApp ${value.whatsapp.slice(-10)}` };
    }
    records[index] = { id, ...value };
    save(records);
    return { record: publicRecord(records[index]) };
}

function remove(id) {
    const records = load();
    const remaining = records.filter(r => r.id !== id);
    if (remaining.length === records.length) return { notFound: true };
    save(remaining);
    return { ok: true };
}

// Carga masiva (Excel): valida cada fila; las inválidas se reportan, las repetidas se omiten
function bulkCreate(rows) {
    const records = load();
    const result = { created: 0, duplicates: 0, errors: [] };
    rows.forEach((row, index) => {
        const { error, value } = validate(row || {});
        if (error) {
            result.errors.push({ row: index, error });
            return;
        }
        if (records.some(r => r.plate === value.plate && r.whatsapp === value.whatsapp)) {
            result.duplicates++;
            return;
        }
        records.push({ id: crypto.randomUUID(), ...value });
        result.created++;
    });
    if (result.created > 0) save(records);
    return result;
}

// ---------------------------- Registro de envíos ----------------------------

function appendLog(entry) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    } catch (error) {
        console.error('❌ No se pudo registrar el envío:', error.message);
    }
}

function listLog() {
    try {
        if (!fs.existsSync(LOG_FILE)) return [];
        const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
        return lines.slice(-LOG_MAX_RETURN).map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean).map(entry => ({ ...entry, whatsapp: String(entry.whatsapp).slice(-10) }));
    } catch (error) {
        console.error('❌ sent-log.jsonl ilegible:', error.message);
        return [];
    }
}

// ---------------------------- Reenvío ----------------------------

/**
 * Si el mensaje es una alerta de geozona "control ...", lo reenvía a las personas
 * asignadas a la placa. `sendFn(numero, mensaje)` envía por el mismo canal que el bot.
 * `originalTo` es el destino original de la alerta: no se le reenvía de nuevo.
 */
async function forwardControlAlert(message, originalTo, sendFn, originalResult) {
    const alert = parseAlertMessage(message);
    if (!alert || !CONTROL_GEOFENCE_REGEX.test(alert.evento || '')) return;

    const plate = normalizePlate(alert.vehiculo);

    // Envío al destino original de la alerta (sin nombre: no es una persona asignada)
    const originalEntry = {
        ts: new Date().toISOString(),
        plate,
        name: '',
        original: true,
        whatsapp: normalizePhone(originalTo),
        event: alert.evento,
        location: alert.ubicacion,
        ok: !(originalResult && originalResult.success === false)
    };
    if (!originalEntry.ok) {
        originalEntry.error = String((originalResult.error && originalResult.error.message) || originalResult.error || 'envío fallido');
    }
    appendLog(originalEntry);

    // La plataforma puede enviar la misma alerta a varios destinos: se reenvía una sola vez
    const now = Date.now();
    for (const [key, ts] of recentAlerts) {
        if (now - ts > DEDUP_TTL_MS) recentAlerts.delete(key);
    }
    const dedupKey = `${plate}|${alert.evento}|${alert.hora}`;
    if (recentAlerts.has(dedupKey)) return;
    recentAlerts.set(dedupKey, now);

    const skip = normalizePhone(originalTo);
    const recipients = load().filter(r => r.plate === plate && r.whatsapp !== skip);
    if (recipients.length === 0) {
        console.log(`📍 Alerta control de ${plate} sin personas asignadas`);
        return;
    }

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        const entry = {
            ts: new Date().toISOString(),
            plate,
            name: r.name,
            whatsapp: r.whatsapp,
            event: alert.evento,
            location: alert.ubicacion,
            ok: true
        };
        try {
            await sendFn(r.whatsapp, message);
            console.log(`📍➡️ Alerta control de ${plate} reenviada a ${r.name} (${r.whatsapp})`);
        } catch (error) {
            entry.ok = false;
            entry.error = error.message;
            console.error(`❌ Error reenviando alerta de ${plate} a ${r.name} (${r.whatsapp}): ${error.message}`);
        }
        appendLog(entry);
        if (i < recipients.length - 1) {
            await new Promise(resolve => setTimeout(resolve, FORWARD_DELAY_MS));
        }
    }
}

module.exports = { list, create, update, remove, bulkCreate, listLog, forwardControlAlert };
