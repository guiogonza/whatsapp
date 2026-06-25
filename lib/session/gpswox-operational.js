const database = require('../../database-postgres');
const config = require('../../config');
const {
    formatPlate,
    isValidPlateFormat,
    findDeviceByPlate
} = require('./gpswox-api');

const COLOMBIA_TIME_ZONE = 'America/Bogota';
const NON_OPERATIONAL_PROMPT_HOUR = 8;
const activeConversations = new Map();
let schedulerInterval = null;
let lastSchedulerRunKey = null;

const CONVERSATION_STATES = {
    LOAD_SITE: 'load_site',
    LOAD_PLATE: 'load_plate',
    LOAD_STATUS: 'load_status',
    LOAD_OBSERVATION: 'load_observation',
    CONSULT_SITE: 'consult_site',
    MOVE_PLATE: 'move_plate',
    MOVE_SITE: 'move_site',
    DOC_ACTION: 'doc_action',
    DOC_PLATE: 'doc_plate',
    DOC_TYPE: 'doc_type',
    DOC_DATE: 'doc_date',
    DAILY_RESPONSE: 'daily_response'
};

const DOCUMENT_TYPES = [
    { key: 'soat', label: 'SOAT' },
    { key: 'tecnomecanica', label: 'Tecnomecanica' },
    { key: 'poliza', label: 'Poliza' },
    { key: 'extintor', label: 'Extintor' },
    { key: 'cambio_aceite', label: 'Cambio aceite' }
];

function cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    return String(phoneNumber).replace('@s.whatsapp.net', '').replace('@c.us', '').split(':')[0].replace(/\D/g, '');
}

function normalizeWhatsAppPhone(phoneNumber) {
    const clean = cleanPhoneNumber(phoneNumber);
    if (clean.length === 10 && clean.startsWith('3')) return `57${clean}`;
    return clean;
}

function toJid(phoneNumber) {
    const clean = normalizeWhatsAppPhone(phoneNumber);
    return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
}

function normalizeText(value) {
    return String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function normalizeDocumentType(value) {
    const normalized = normalizeText(value).replace(/[\s-]+/g, '_');
    const aliases = {
        soat: 'soat',
        tecno: 'tecnomecanica',
        tecnomecanica: 'tecnomecanica',
        tecnico_mecanica: 'tecnomecanica',
        tecnico_mecanico: 'tecnomecanica',
        tecnicomecanica: 'tecnomecanica',
        poliza: 'poliza',
        póliza: 'poliza',
        extintor: 'extintor',
        aceite: 'cambio_aceite',
        cambio_aceite: 'cambio_aceite',
        cambio_de_aceite: 'cambio_aceite'
    };
    return aliases[normalized] || null;
}

function getDocumentTypeLabel(key) {
    return (DOCUMENT_TYPES.find(type => type.key === key) || {}).label || key;
}

function buildDocumentTypeOptionsMessage(prefix = 'Selecciona el documento:') {
    return [
        prefix,
        ...DOCUMENT_TYPES.map((type, index) => `${index + 1}. ${type.label}`)
    ].join('\n');
}

function parseDocumentTypeInput(input) {
    const numeric = parseInt(normalizeText(input), 10);
    if (String(numeric) === normalizeText(input) && numeric >= 1 && numeric <= DOCUMENT_TYPES.length) {
        return DOCUMENT_TYPES[numeric - 1].key;
    }
    return normalizeDocumentType(input);
}

function parseDateInput(input) {
    const value = String(input || '').trim();
    let match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return value;
    match = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!match) return null;
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    return `${match[3]}-${month}-${day}`;
}

function formatDateCo(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return new Intl.DateTimeFormat('es-CO', {
        timeZone: COLOMBIA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function getColombiaDateParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: COLOMBIA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: parseInt(parts.hour, 10),
        minute: parseInt(parts.minute, 10),
        weekday: parts.weekday
    };
}

function colombiaTimestampSql(column) {
    return `to_char((${column} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'), 'DD/MM/YYYY HH24:MI:SS')`;
}

function isMondayToSaturday(weekday) {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].includes(weekday);
}

async function listSites() {
    const result = await database.query(`
        SELECT s.id, s.name, s.active,
               COALESCE(json_agg(
                   json_build_object('id', r.id, 'name', r.name, 'phone_number', r.phone_number, 'active', r.active)
                   ORDER BY r.name
               ) FILTER (WHERE r.id IS NOT NULL), '[]') AS responsibles
        FROM operational_sites s
        LEFT JOIN operational_site_responsibles r ON r.site_id = s.id
        GROUP BY s.id
        ORDER BY s.name
    `);
    return result.rows;
}

async function listStatuses(includeInactive = false) {
    const result = await database.query(`
        SELECT id, name, is_operational, active
        FROM operational_statuses
        ${includeInactive ? '' : 'WHERE active = TRUE'}
        ORDER BY is_operational ASC, name ASC
    `);
    return result.rows;
}

async function findSiteByName(name) {
    const normalized = normalizeText(name);
    const result = await database.query('SELECT * FROM operational_sites WHERE active = TRUE');
    return result.rows.find(site => normalizeText(site.name) === normalized) || null;
}

async function findSiteByInput(input) {
    const normalized = normalizeText(input);
    const sites = (await listSites()).filter(site => site.active);
    const numeric = parseInt(normalized, 10);
    if (String(numeric) === normalized && numeric >= 1 && numeric <= sites.length) {
        return sites[numeric - 1];
    }
    return sites.find(site => normalizeText(site.name) === normalized) || null;
}

async function findStatusByName(name) {
    const normalized = normalizeText(name);
    const result = await database.query('SELECT * FROM operational_statuses WHERE active = TRUE');
    return result.rows.find(status => normalizeText(status.name) === normalized) || null;
}

async function getStatusById(id) {
    const result = await database.query('SELECT * FROM operational_statuses WHERE id = $1', [id]);
    return result.rows[0] || null;
}

async function findOperationalVehicleByPlate(plate) {
    const result = await database.query(`
        SELECT v.*, s.name AS site_name, st.name AS status_name, st.is_operational
        FROM operational_vehicles v
        JOIN operational_sites s ON s.id = v.site_id
        JOIN operational_statuses st ON st.id = v.status_id
        WHERE v.plate = $1 AND v.active = TRUE
        LIMIT 1
    `, [plate]);
    return result.rows[0] || null;
}

async function upsertVehicle({ plate, deviceId, siteId, statusId, observation, changedByPhone, source = 'bot' }) {
    const existing = await database.query('SELECT * FROM operational_vehicles WHERE plate = $1', [plate]);

    if (existing.rows.length === 0) {
        const inserted = await database.query(`
            INSERT INTO operational_vehicles (plate, gpswox_device_id, site_id, status_id, last_observation, created_by_phone)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [plate, deviceId || null, siteId, statusId, observation || null, changedByPhone || null]);

        await database.query(`
            INSERT INTO operational_vehicle_history (vehicle_id, new_status_id, new_site_id, observation, source, changed_by_phone)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [inserted.rows[0].id, statusId, siteId, observation || null, source, changedByPhone || null]);

        return inserted.rows[0];
    }

    const current = existing.rows[0];
    const updated = await database.query(`
        UPDATE operational_vehicles
        SET gpswox_device_id = COALESCE($2, gpswox_device_id),
            site_id = $3,
            status_id = $4,
            last_observation = $5,
            active = TRUE,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [current.id, deviceId || null, siteId, statusId, observation || current.last_observation || null]);

    if (current.status_id !== statusId || current.site_id !== siteId || observation) {
        await database.query(`
            INSERT INTO operational_vehicle_history (
                vehicle_id, old_status_id, new_status_id, old_site_id, new_site_id, observation, source, changed_by_phone
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [current.id, current.status_id, statusId, current.site_id, siteId, observation || null, source, changedByPhone || null]);
    }

    return updated.rows[0];
}

async function updateVehicle(id, data) {
    const existing = await database.query('SELECT * FROM operational_vehicles WHERE id = $1', [id]);
    if (existing.rows.length === 0) return null;

    const current = existing.rows[0];
    const nextSiteId = data.siteId || current.site_id;
    const nextStatusId = data.statusId || current.status_id;
    const nextObservation = Object.prototype.hasOwnProperty.call(data, 'observation')
        ? data.observation
        : current.last_observation;

    const result = await database.query(`
        UPDATE operational_vehicles
        SET plate = COALESCE($2, plate),
            gpswox_device_id = COALESCE($3, gpswox_device_id),
            site_id = $4,
            status_id = $5,
            last_observation = $6,
            active = COALESCE($7, active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [
        id,
        data.plate || null,
        data.deviceId || null,
        nextSiteId,
        nextStatusId,
        nextObservation || null,
        typeof data.active === 'boolean' ? data.active : null
    ]);

    if (current.status_id !== nextStatusId || current.site_id !== nextSiteId || nextObservation !== current.last_observation) {
        await database.query(`
            INSERT INTO operational_vehicle_history (
                vehicle_id, old_status_id, new_status_id, old_site_id, new_site_id, observation, source, changed_by_phone
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            id,
            current.status_id,
            nextStatusId,
            current.site_id,
            nextSiteId,
            nextObservation || null,
            data.source || 'dashboard',
            data.changedByPhone || 'dashboard'
        ]);
    }

    return result.rows[0];
}

async function deactivateVehicle(id) {
    const result = await database.query(`
        UPDATE operational_vehicles
        SET active = FALSE, updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [id]);
    return result.rows[0] || null;
}

function getPagination(filters = {}, defaultLimit = 25, maxLimit = 100) {
    const page = Math.max(parseInt(filters.page || '1', 10) || 1, 1);
    const requestedLimit = parseInt(filters.limit || String(defaultLimit), 10) || defaultLimit;
    const limit = Math.min(Math.max(requestedLimit, 1), maxLimit);
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

function buildPagination(total, page, limit) {
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    return {
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages
    };
}

async function listVehicles(filters = {}) {
    const params = [];
    const where = ['v.active = TRUE'];
    if (filters.siteId) {
        params.push(filters.siteId);
        where.push(`v.site_id = $${params.length}`);
    }
    if (filters.statusId) {
        params.push(filters.statusId);
        where.push(`v.status_id = $${params.length}`);
    }
    if (filters.onlyNonOperational) {
        where.push('st.is_operational = FALSE');
    }
    if (filters.search) {
        params.push(`%${String(filters.search).trim()}%`);
        where.push(`(v.plate ILIKE $${params.length} OR s.name ILIKE $${params.length} OR st.name ILIKE $${params.length})`);
    }

    const baseQuery = `
        FROM operational_vehicles v
        JOIN operational_sites s ON s.id = v.site_id
        JOIN operational_statuses st ON st.id = v.status_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `;

    if (filters.paginate) {
        const { page, limit, offset } = getPagination(filters, 25, 100);
        const countResult = await database.query(`SELECT COUNT(*)::int AS total ${baseQuery}`, params);
        const queryParams = [...params, limit, offset];
        const result = await database.query(`
            SELECT v.id, v.plate, v.gpswox_device_id, v.last_observation, v.active, v.created_at, v.updated_at,
                   s.id AS site_id, s.name AS site_name,
                   st.id AS status_id, st.name AS status_name, st.is_operational
            ${baseQuery}
            ORDER BY s.name, st.is_operational ASC, st.name, v.plate
            LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
        `, queryParams);
        const total = countResult.rows[0]?.total || 0;
        return { rows: result.rows, pagination: buildPagination(total, page, limit) };
    }

    const result = await database.query(`
        SELECT v.id, v.plate, v.gpswox_device_id, v.last_observation, v.active, v.created_at, v.updated_at,
               s.id AS site_id, s.name AS site_name,
               st.id AS status_id, st.name AS status_name, st.is_operational
        ${baseQuery}
        ORDER BY s.name, st.is_operational ASC, st.name, v.plate
    `, params);
    return result.rows;
}

function normalizeDocumentPayload(data = {}) {
    const plate = formatPlate(data.plate || '');
    const documentType = normalizeDocumentType(data.documentType || data.document_type || '');
    const expiryDate = parseDateInput(data.expiryDate || data.expiry_date || '');
    return {
        plate,
        documentType,
        expiryDate,
        lastChangeDate: parseDateInput(data.lastChangeDate || data.last_change_date || '') || null,
        lastChangeKm: data.lastChangeKm || data.last_change_km || null,
        nextChangeKm: data.nextChangeKm || data.next_change_km || null,
        observation: data.observation || null,
        createdBy: data.createdBy || data.created_by || 'dashboard'
    };
}

async function listDocumentExpirations(filters = {}) {
    const params = [];
    const where = ['active = TRUE'];
    if (filters.plate) {
        params.push(formatPlate(filters.plate));
        where.push(`plate = $${params.length}`);
    }
    if (filters.documentType) {
        const type = normalizeDocumentType(filters.documentType);
        if (type) {
            params.push(type);
            where.push(`document_type = $${params.length}`);
        }
    }
    if (filters.search) {
        params.push(`%${String(filters.search).trim()}%`);
        where.push(`(plate ILIKE $${params.length} OR document_type ILIKE $${params.length})`);
    }

    const selectSql = `
        SELECT id, plate, document_type, expiry_date, last_change_date, last_change_km, next_change_km,
               observation, active, created_by, created_at, updated_at,
               to_char(expiry_date, 'DD/MM/YYYY') AS expiry_date_co,
               CASE WHEN last_change_date IS NULL THEN NULL ELSE to_char(last_change_date, 'DD/MM/YYYY') END AS last_change_date_co,
               (expiry_date - CURRENT_DATE)::int AS days_remaining
        FROM operational_document_expirations
        WHERE ${where.join(' AND ')}
    `;

    if (filters.paginate) {
        const { page, limit, offset } = getPagination(filters, 25, 200);
        const countResult = await database.query(`
            SELECT COUNT(*)::int AS total
            FROM operational_document_expirations
            WHERE ${where.join(' AND ')}
        `, params);
        const queryParams = [...params, limit, offset];
        const result = await database.query(`
            ${selectSql}
            ORDER BY expiry_date ASC, plate ASC, document_type ASC
            LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
        `, queryParams);
        const total = countResult.rows[0]?.total || 0;
        return { rows: result.rows, pagination: buildPagination(total, page, limit) };
    }

    const result = await database.query(`
        ${selectSql}
        ORDER BY expiry_date ASC, plate ASC, document_type ASC
    `, params);
    return result.rows;
}

async function upsertDocumentExpiration(data = {}) {
    const payload = normalizeDocumentPayload(data);
    if (!isValidPlateFormat(payload.plate)) {
        throw new Error('Formato de placa invalido. Ejemplo: ABC123 o ABC-123');
    }
    if (!payload.documentType) {
        throw new Error('Tipo de documento invalido');
    }
    if (!payload.expiryDate) {
        throw new Error('Fecha de vencimiento invalida. Usa DD/MM/AAAA');
    }

    const result = await database.query(`
        INSERT INTO operational_document_expirations (
            plate, document_type, expiry_date, last_change_date, last_change_km, next_change_km, observation, created_by, active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
        ON CONFLICT (plate, document_type) DO UPDATE
        SET expiry_date = EXCLUDED.expiry_date,
            last_change_date = EXCLUDED.last_change_date,
            last_change_km = EXCLUDED.last_change_km,
            next_change_km = EXCLUDED.next_change_km,
            observation = EXCLUDED.observation,
            active = TRUE,
            updated_at = NOW()
        RETURNING *,
            to_char(expiry_date, 'DD/MM/YYYY') AS expiry_date_co,
            CASE WHEN last_change_date IS NULL THEN NULL ELSE to_char(last_change_date, 'DD/MM/YYYY') END AS last_change_date_co,
            (expiry_date - CURRENT_DATE)::int AS days_remaining
    `, [
        payload.plate,
        payload.documentType,
        payload.expiryDate,
        payload.lastChangeDate,
        payload.lastChangeKm ? parseInt(payload.lastChangeKm, 10) : null,
        payload.nextChangeKm ? parseInt(payload.nextChangeKm, 10) : null,
        payload.observation,
        payload.createdBy
    ]);
    return result.rows[0];
}

async function updateDocumentExpiration(id, data = {}) {
    const currentResult = await database.query('SELECT * FROM operational_document_expirations WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) return null;
    const current = currentResult.rows[0];
    const documentType = data.documentType || data.document_type
        ? normalizeDocumentType(data.documentType || data.document_type)
        : current.document_type;
    const expiryDate = data.expiryDate || data.expiry_date
        ? parseDateInput(data.expiryDate || data.expiry_date)
        : current.expiry_date;

    const result = await database.query(`
        UPDATE operational_document_expirations
        SET plate = $2,
            document_type = $3,
            expiry_date = $4,
            last_change_date = $5,
            last_change_km = $6,
            next_change_km = $7,
            observation = $8,
            active = COALESCE($9, active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *,
            to_char(expiry_date, 'DD/MM/YYYY') AS expiry_date_co,
            CASE WHEN last_change_date IS NULL THEN NULL ELSE to_char(last_change_date, 'DD/MM/YYYY') END AS last_change_date_co,
            (expiry_date - CURRENT_DATE)::int AS days_remaining
    `, [
        id,
        data.plate ? formatPlate(data.plate) : current.plate,
        documentType,
        expiryDate,
        Object.prototype.hasOwnProperty.call(data, 'lastChangeDate') ? parseDateInput(data.lastChangeDate) : current.last_change_date,
        Object.prototype.hasOwnProperty.call(data, 'lastChangeKm') ? (data.lastChangeKm ? parseInt(data.lastChangeKm, 10) : null) : current.last_change_km,
        Object.prototype.hasOwnProperty.call(data, 'nextChangeKm') ? (data.nextChangeKm ? parseInt(data.nextChangeKm, 10) : null) : current.next_change_km,
        Object.prototype.hasOwnProperty.call(data, 'observation') ? data.observation : current.observation,
        typeof data.active === 'boolean' ? data.active : null
    ]);
    return result.rows[0] || null;
}

async function deleteDocumentExpiration(id) {
    const result = await database.query(`
        UPDATE operational_document_expirations
        SET active = FALSE, updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [id]);
    return result.rows[0] || null;
}

function buildDocumentExpirationMessage(rows, plate = null) {
    if (!rows || rows.length === 0) {
        return plate ? `No hay vencimientos registrados para ${plate}.` : 'No hay vencimientos registrados.';
    }
    const lines = [plate ? `Vencimientos - ${plate}` : 'Vencimientos de documentos', ''];
    rows.forEach((row, index) => {
        const days = Number(row.days_remaining);
        const status = days < 0 ? `vencido hace ${Math.abs(days)} dias` : `faltan ${days} dias`;
        lines.push(`${index + 1}. ${row.plate} - ${getDocumentTypeLabel(row.document_type)}: ${row.expiry_date_co || formatDateCo(row.expiry_date)} (${status})`);
        if (row.document_type === 'cambio_aceite' && (row.last_change_km || row.next_change_km)) {
            lines.push(`   Km: ${row.last_change_km || '-'} -> ${row.next_change_km || '-'}`);
        }
        if (row.observation) lines.push(`   Obs: ${row.observation}`);
    });
    return lines.join('\n');
}

async function getResponsibleForPhone(phoneNumber) {
    const clean = normalizeWhatsAppPhone(phoneNumber);
    const result = await database.query(`
        SELECT r.*, s.name AS site_name
        FROM operational_site_responsibles r
        JOIN operational_sites s ON s.id = r.site_id
        WHERE r.phone_number = $1 AND r.active = TRUE AND s.active = TRUE
        ORDER BY r.id
        LIMIT 1
    `, [clean]);
    return result.rows[0] || null;
}

async function getOpenFollowupForPhone(phoneNumber) {
    const clean = normalizeWhatsAppPhone(phoneNumber);
    const result = await database.query(`
        SELECT f.*, s.name AS site_name
        FROM operational_followups f
        JOIN operational_sites s ON s.id = f.site_id
        WHERE f.phone_number = $1 AND f.status = 'sent' AND f.completed_at IS NULL
        ORDER BY f.followup_date DESC, f.id DESC
        LIMIT 1
    `, [clean]);
    return result.rows[0] || null;
}

async function getFollowupItems(followupId) {
    const result = await database.query(`
        SELECT i.*, v.plate, v.last_observation, ps.name AS previous_status_name,
               cs.name AS current_status_name
        FROM operational_followup_items i
        JOIN operational_vehicles v ON v.id = i.vehicle_id
        LEFT JOIN operational_statuses ps ON ps.id = i.previous_status_id
        LEFT JOIN operational_statuses cs ON cs.id = i.current_status_id
        WHERE i.followup_id = $1
        ORDER BY i.item_number
    `, [followupId]);
    return result.rows;
}

function buildDailyPrompt(siteName, vehicles) {
    const lines = [
        `🚗 *Seguimiento operativo diario*`,
        `📍 Sede: *${siteName}*`,
        '',
        '🔧 *Vehiculos pendientes del dia anterior:*',
        ''
    ];

    vehicles.forEach((vehicle, index) => {
        lines.push(`${index + 1}. 🚙 *${vehicle.plate}* - ${vehicle.status_name}`);
        if (vehicle.last_observation) lines.push(`   📝 Obs: ${vehicle.last_observation}`);
        lines.push('');
    });

    lines.push('✅ *Como responder:*');
    lines.push('1 igual: sigue igual');
    lines.push('2 modificar: cambiar estado u observacion');
    lines.push('3 agregar: registrar otra placa');

    return lines.join('\n');
}

function buildNonOperationalListMessage(vehicles, siteName = null) {
    if (!vehicles || vehicles.length === 0) {
        return siteName
            ? `No hay vehiculos no operativos registrados para ${siteName}.`
            : 'No hay vehiculos no operativos registrados.';
    }

    const grouped = vehicles.reduce((acc, vehicle) => {
        const key = vehicle.site_name || siteName || 'Sin sede';
        if (!acc[key]) acc[key] = [];
        acc[key].push(vehicle);
        return acc;
    }, {});

    const lines = [
        siteName
            ? `Vehiculos no operativos - ${siteName}`
            : 'Vehiculos no operativos por sede',
        ''
    ];

    for (const [groupName, groupVehicles] of Object.entries(grouped)) {
        if (!siteName) {
            lines.push(`*${groupName}*`);
        }

        groupVehicles.forEach((vehicle, index) => {
            lines.push(`${index + 1}. ${vehicle.plate} - ${vehicle.status_name}`);
            if (vehicle.last_observation) {
                lines.push(`   Obs: ${vehicle.last_observation}`);
            }
        });
        lines.push('');
    }

    lines.push('Para registrar otro vehiculo envia: operatividad sede');
    return lines.join('\n').trim();
}

function buildSiteOptionsMessage(title, sites) {
    const activeSites = sites.filter(site => site.active);
    return [
        title,
        '',
        ...activeSites.map((site, index) => `${index + 1}. ${site.name}`),
        '',
        'Responde con el numero o el nombre de la sede.'
    ].join('\n');
}

function buildConsultSiteOptionsMessage(sites) {
    const activeSites = sites.filter(site => site.active);
    return [
        '📋 *Consultar vehículos no operativos*',
        '',
        ...activeSites.map((site, index) => `${index + 1}. ${site.name}`),
        `${activeSites.length + 1}. Todos`,
        '',
        'Responde con el numero o el nombre de la sede.'
    ].join('\n');
}

async function getNonOperationalMessage(siteNameInput = null) {
    const normalizedSiteName = normalizeText(siteNameInput);
    if (normalizedSiteName && normalizedSiteName !== 'todos' && normalizedSiteName !== 'todas') {
        const site = await findSiteByInput(siteNameInput);
        if (!site) {
            return `Sede no encontrada: ${siteNameInput}\n\nUsa: jamundi, buga, tulua, zarzal o todos.`;
        }

        const vehicles = await listVehicles({ siteId: site.id, onlyNonOperational: true });
        return buildNonOperationalListMessage(vehicles, site.name);
    }

    const vehicles = await listVehicles({ onlyNonOperational: true });
    return buildNonOperationalListMessage(vehicles);
}

async function createFollowupForResponsible(responsible, sendType = 'automatico') {
    const vehicles = await listVehicles({ siteId: responsible.site_id, onlyNonOperational: true });
    if (vehicles.length === 0) return null;

    const { date } = getColombiaDateParts();
    const message = buildDailyPrompt(responsible.site_name, vehicles);
    const normalizedSendType = sendType === 'manual' ? 'manual' : 'automatico';
    let followup;

    if (normalizedSendType === 'automatico') {
        const existing = await database.query(`
            SELECT id
            FROM operational_followups
            WHERE followup_date = $1 AND site_id = $2 AND phone_number = $3 AND send_type = 'automatico'
            ORDER BY id DESC
            LIMIT 1
        `, [date, responsible.site_id, responsible.phone_number]);

        if (existing.rows[0]) {
            followup = await database.query(`
                UPDATE operational_followups
                SET responsible_id = $2,
                    message = $3,
                    sent_at = NOW(),
                    status = 'sent',
                    completed_at = NULL
                WHERE id = $1
                RETURNING *
            `, [existing.rows[0].id, responsible.id, message]);
        }
    }

    if (!followup) {
        followup = await database.query(`
            INSERT INTO operational_followups (followup_date, site_id, responsible_id, phone_number, message, send_type, sent_at, status)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'sent')
            RETURNING *
        `, [date, responsible.site_id, responsible.id, responsible.phone_number, message, normalizedSendType]);
    }

    await database.query('DELETE FROM operational_followup_items WHERE followup_id = $1', [followup.rows[0].id]);

    for (let index = 0; index < vehicles.length; index++) {
        await database.query(`
            INSERT INTO operational_followup_items (followup_id, vehicle_id, item_number, previous_status_id, current_status_id, observation)
            VALUES ($1, $2, $3, $4, $4, $5)
        `, [followup.rows[0].id, vehicles[index].id, index + 1, vehicles[index].status_id, vehicles[index].last_observation || null]);
    }

    return { followup: followup.rows[0], message };
}

async function sendDailyPrompts(sessionManager, options = {}) {
    const sendType = options.sendType === 'manual' ? 'manual' : 'automatico';
    const result = await database.query(`
        SELECT r.*, s.name AS site_name
        FROM operational_site_responsibles r
        JOIN operational_sites s ON s.id = r.site_id
        WHERE r.active = TRUE AND s.active = TRUE
        ORDER BY s.name, r.name
    `);

    const gpswoxSessionName = config.GPSWOX_SESSION_NAME || 'gpswox-session';
    const session = sessionManager.getSession(gpswoxSessionName);
    const sender = session && session.socket && session.state === config.SESSION_STATES.READY
        ? async (phone, message) => {
            await session.socket.sendMessage(toJid(phone), { text: message });
            return { success: true, session: gpswoxSessionName };
        }
        : async (phone, message) => sessionManager.sendMessageWithRotation(phone, message);

    const sent = [];
    for (const responsible of result.rows) {
        const payload = await createFollowupForResponsible(responsible, sendType);
        if (!payload) continue;

        await sender(responsible.phone_number, payload.message);
        activeConversations.set(toJid(responsible.phone_number), {
            state: CONVERSATION_STATES.DAILY_RESPONSE,
            followupId: payload.followup.id,
            siteId: responsible.site_id,
            siteName: responsible.site_name,
            phoneNumber: responsible.phone_number,
            lastActivity: Date.now()
        });
        sent.push({ phoneNumber: responsible.phone_number, siteName: responsible.site_name });
    }

    return sent;
}

async function startMoveSiteFlow(socket, senderPhone) {
    const cleanPhone = normalizeWhatsAppPhone(senderPhone);
    activeConversations.set(senderPhone, {
        state: CONVERSATION_STATES.MOVE_PLATE,
        phoneNumber: cleanPhone,
        lastActivity: Date.now()
    });
    await socket.sendMessage(senderPhone, {
        text: '🔁 *Mover vehiculo a otra sede*\n\nEnvia la placa del vehiculo que deseas mover.'
    });
}

async function startConsultFlow(socket, senderPhone) {
    const cleanPhone = normalizeWhatsAppPhone(senderPhone);
    activeConversations.set(senderPhone, {
        state: CONVERSATION_STATES.CONSULT_SITE,
        phoneNumber: cleanPhone,
        lastActivity: Date.now()
    });
    const sites = await listSites();
    await socket.sendMessage(senderPhone, { text: buildConsultSiteOptionsMessage(sites) });
}

async function startDocumentExpirationFlow(socket, senderPhone) {
    const cleanPhone = normalizeWhatsAppPhone(senderPhone);
    activeConversations.set(senderPhone, {
        state: CONVERSATION_STATES.DOC_ACTION,
        phoneNumber: cleanPhone,
        lastActivity: Date.now()
    });
    await socket.sendMessage(senderPhone, {
        text: [
            '📅 *Vencimientos de documentos*',
            '',
            'Selecciona una opcion:',
            '1. Crear vencimiento',
            '2. Consultar vencimientos',
            '3. Modificar vencimiento',
            '',
            'Escribe *menu* para volver.'
        ].join('\n')
    });
}

function startDailyScheduler(sessionManager) {
    if (schedulerInterval) clearInterval(schedulerInterval);

    schedulerInterval = setInterval(async () => {
        const parts = getColombiaDateParts();
        const runKey = `${parts.date}-${NON_OPERATIONAL_PROMPT_HOUR}`;
        if (!isMondayToSaturday(parts.weekday)) return;
        if (parts.hour !== NON_OPERATIONAL_PROMPT_HOUR || parts.minute > 10) return;
        if (lastSchedulerRunKey === runKey) return;

        lastSchedulerRunKey = runKey;
        try {
            const sent = await sendDailyPrompts(sessionManager, { sendType: 'automatico' });
            console.log(`Seguimiento operatividad enviado a ${sent.length} responsables`);
        } catch (error) {
            console.error(`Error enviando seguimiento operatividad: ${error.message}`);
        }
    }, 60 * 1000);

    console.log('Scheduler de operatividad activo: lunes a sabado 8:00 a. m.');
}

async function cancelOpenFollowup(conversation) {
    if (!conversation || !conversation.followupId) return;
    await database.query(`
        UPDATE operational_followups
        SET status = 'cancelled', completed_at = NOW()
        WHERE id = $1 AND completed_at IS NULL
    `, [conversation.followupId]);
}

async function processOperationalMessage(session, sessionName, socket, senderPhone, messageText) {
    const input = String(messageText || '').trim();
    const cleanPhone = normalizeWhatsAppPhone(senderPhone);
    const key = senderPhone;
    const normalized = normalizeText(input);
    let conversation = activeConversations.get(key);

    if (!conversation) {
        const openFollowup = await getOpenFollowupForPhone(cleanPhone);
        if (openFollowup) {
            conversation = {
                state: CONVERSATION_STATES.DAILY_RESPONSE,
                followupId: openFollowup.id,
                siteId: openFollowup.site_id,
                siteName: openFollowup.site_name,
                phoneNumber: cleanPhone,
                lastActivity: Date.now()
            };
            activeConversations.set(key, conversation);
        }
    }

    if (!conversation && (
        normalized === 'consultar operatividad' ||
        normalized.startsWith('consultar operatividad ') ||
        normalized === 'consultar no operativos' ||
        normalized.startsWith('consultar no operativos ')
    )) {
        const siteName = normalized.startsWith('consultar operatividad')
            ? input.replace(/^consultar\s+operatividad\s*/i, '').trim()
            : input.replace(/^consultar\s+no\s+operativos\s*/i, '').trim();
        const message = await getNonOperationalMessage(siteName || null);
        await socket.sendMessage(senderPhone, { text: message });
        return true;
    }

    if (!conversation && (
        normalized === 'mover sede' ||
        normalized === 'mover vehiculo' ||
        normalized === 'mover vehículo' ||
        normalized.startsWith('mover sede ') ||
        normalized.startsWith('mover vehiculo ') ||
        normalized.startsWith('mover vehículo ')
    )) {
        const plateInput = input.replace(/^mover\s+(sede|vehiculo|vehículo)\s*/i, '').trim();
        if (plateInput) {
            const plate = formatPlate(plateInput);
            activeConversations.set(key, {
                state: CONVERSATION_STATES.MOVE_PLATE,
                phoneNumber: cleanPhone,
                lastActivity: Date.now()
            });
            conversation = activeConversations.get(key);
            await handleMovePlate(socket, senderPhone, conversation, plate);
            return true;
        }

        await startMoveSiteFlow(socket, senderPhone);
        return true;
    }

    if (!conversation && (
        normalized === 'vencimientos' ||
        normalized === 'vencimiento' ||
        normalized === 'documentos' ||
        normalized === 'vencimientos documentos'
    )) {
        await startDocumentExpirationFlow(socket, senderPhone);
        return true;
    }

    if (!conversation && (normalized === 'operatividad' || normalized.startsWith('operatividad '))) {
        const parts = input.split(/\s+/);
        const siteName = parts.slice(1).join(' ');
        if (siteName) {
            const site = await findSiteByInput(siteName);
            if (site) {
                activeConversations.set(key, {
                    state: CONVERSATION_STATES.LOAD_PLATE,
                    siteId: site.id,
                    siteName: site.name,
                    phoneNumber: cleanPhone,
                    lastActivity: Date.now()
                });
                await socket.sendMessage(senderPhone, { text: `Carga de operatividad - Sede ${site.name}\n\nEnvia la placa del vehiculo.` });
                return true;
            }
        }

        activeConversations.set(key, {
            state: CONVERSATION_STATES.LOAD_SITE,
            phoneNumber: cleanPhone,
            lastActivity: Date.now()
        });
        const sites = await listSites();
        await socket.sendMessage(senderPhone, { text: buildSiteOptionsMessage('Carga de operatividad\n\nSelecciona la sede:', sites) });
        return true;
    }

    if (!conversation) return false;

    if (normalized === 'menu') {
        await cancelOpenFollowup(conversation);
        activeConversations.delete(key);
        return false;
    }

    if (normalized === 'cancelar') {
        await cancelOpenFollowup(conversation);
        activeConversations.delete(key);
        await socket.sendMessage(senderPhone, { text: 'Flujo de operatividad cancelado.' });
        return true;
    }

    conversation.lastActivity = Date.now();

    if (conversation.state === CONVERSATION_STATES.CONSULT_SITE) {
        await handleConsultSite(socket, senderPhone, conversation, input);
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.LOAD_SITE) {
        const site = await findSiteByInput(input);
        if (!site) {
            const sites = await listSites();
            await socket.sendMessage(senderPhone, { text: buildSiteOptionsMessage('Sede no encontrada. Selecciona una sede valida:', sites) });
            return true;
        }
        conversation.siteId = site.id;
        conversation.siteName = site.name;
        conversation.state = CONVERSATION_STATES.LOAD_PLATE;
        await socket.sendMessage(senderPhone, { text: `Sede ${site.name} seleccionada.\n\nEnvia la placa del vehiculo.` });
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.MOVE_PLATE) {
        await handleMovePlate(socket, senderPhone, conversation, input);
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.MOVE_SITE) {
        await handleMoveSite(socket, senderPhone, conversation, input, cleanPhone);
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.DOC_ACTION) {
        await handleDocumentAction(socket, senderPhone, conversation, input);
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.DOC_PLATE) {
        await handleDocumentPlate(socket, senderPhone, conversation, input);
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.DOC_TYPE) {
        await handleDocumentType(socket, senderPhone, conversation, input);
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.DOC_DATE) {
        await handleDocumentDate(socket, senderPhone, conversation, input, cleanPhone);
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.LOAD_PLATE) {
        const plate = formatPlate(input);
        if (!isValidPlateFormat(plate)) {
            await socket.sendMessage(senderPhone, { text: 'Formato de placa invalido. Ejemplo: ABC123 o ABC-123.' });
            return true;
        }
        await socket.sendMessage(senderPhone, { text: `Validando placa ${plate} en plataformagps...` });
        const device = await findDeviceByPlate(plate);
        if (!device) {
            await socket.sendMessage(senderPhone, { text: `No encontre la placa ${plate} en plataformagps. Verifica la placa e intenta de nuevo.` });
            return true;
        }
        conversation.plate = plate;
        conversation.deviceId = device.id;
        conversation.state = CONVERSATION_STATES.LOAD_STATUS;
        const statuses = (await listStatuses()).filter(status => !status.is_operational);
        await socket.sendMessage(senderPhone, { text: `Placa ${plate} validada.\n\nEnvia el estado:\n${statuses.map(s => `- ${s.name}`).join('\n')}` });
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.LOAD_STATUS) {
        const status = await findStatusByName(input);
        if (!status || status.is_operational) {
            await socket.sendMessage(senderPhone, { text: 'Estado no valido para carga inicial. Usa Back-up, Inoperativo, Siniestro o Taller.' });
            return true;
        }
        conversation.statusId = status.id;
        conversation.statusName = status.name;
        conversation.state = CONVERSATION_STATES.LOAD_OBSERVATION;
        await socket.sendMessage(senderPhone, { text: `Estado ${status.name} guardado temporalmente.\n\nEnvia la observacion.` });
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.LOAD_OBSERVATION) {
        await upsertVehicle({
            plate: conversation.plate,
            deviceId: conversation.deviceId,
            siteId: conversation.siteId,
            statusId: conversation.statusId,
            observation: input,
            changedByPhone: cleanPhone,
            source: 'bot-load'
        });
        conversation.state = CONVERSATION_STATES.LOAD_PLATE;
        delete conversation.plate;
        delete conversation.deviceId;
        delete conversation.statusId;
        delete conversation.statusName;
        await socket.sendMessage(senderPhone, { text: `Vehiculo guardado.\n\nEnvia otra placa para ${conversation.siteName}, escribe menu para salir.` });
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.DAILY_RESPONSE) {
        await handleDailyResponse(socket, senderPhone, conversation, input);
        return true;
    }

    return false;
}

async function handleDocumentAction(socket, senderPhone, conversation, input) {
    const normalized = normalizeText(input);
    const actionMap = {
        '1': 'create',
        crear: 'create',
        '2': 'consult',
        consultar: 'consult',
        consulta: 'consult',
        '3': 'update',
        modificar: 'update',
        actualizar: 'update'
    };
    const action = actionMap[normalized];
    if (!action) {
        await socket.sendMessage(senderPhone, { text: 'Opcion no valida. Responde 1 crear, 2 consultar o 3 modificar.' });
        return;
    }
    conversation.docAction = action;
    conversation.state = CONVERSATION_STATES.DOC_PLATE;
    const verb = action === 'consult' ? 'consultar' : (action === 'update' ? 'modificar' : 'crear');
    await socket.sendMessage(senderPhone, { text: `Envia la placa para ${verb} vencimientos.\n\nEjemplo: ABC123` });
}

async function handleDocumentPlate(socket, senderPhone, conversation, input) {
    const plate = formatPlate(input);
    if (!isValidPlateFormat(plate)) {
        await socket.sendMessage(senderPhone, { text: 'Formato de placa invalido. Ejemplo: ABC123 o ABC-123.' });
        return;
    }
    conversation.plate = plate;

    if (conversation.docAction === 'consult') {
        const rows = await listDocumentExpirations({ plate });
        await socket.sendMessage(senderPhone, { text: buildDocumentExpirationMessage(rows, plate) });
        activeConversations.delete(senderPhone);
        return;
    }

    conversation.state = CONVERSATION_STATES.DOC_TYPE;
    await socket.sendMessage(senderPhone, { text: buildDocumentTypeOptionsMessage(`Placa ${plate}.\n\nSelecciona el documento:`) });
}

async function handleDocumentType(socket, senderPhone, conversation, input) {
    const documentType = parseDocumentTypeInput(input);
    if (!documentType) {
        await socket.sendMessage(senderPhone, { text: buildDocumentTypeOptionsMessage('Documento no valido. Selecciona uno:') });
        return;
    }
    conversation.documentType = documentType;
    conversation.state = CONVERSATION_STATES.DOC_DATE;
    await socket.sendMessage(senderPhone, {
        text: `Documento: ${getDocumentTypeLabel(documentType)}\n\nEnvia la fecha de vencimiento en formato DD/MM/AAAA.\n\nEjemplo: 18/07/2026`
    });
}

async function handleDocumentDate(socket, senderPhone, conversation, input, cleanPhone) {
    const expiryDate = parseDateInput(input);
    if (!expiryDate) {
        await socket.sendMessage(senderPhone, { text: 'Fecha invalida. Usa DD/MM/AAAA. Ejemplo: 18/07/2026' });
        return;
    }

    const row = await upsertDocumentExpiration({
        plate: conversation.plate,
        documentType: conversation.documentType,
        expiryDate,
        createdBy: cleanPhone
    });
    const actionText = conversation.docAction === 'update' ? 'modificado' : 'creado';
    await socket.sendMessage(senderPhone, {
        text: `Vencimiento ${actionText}.\n\n${row.plate} - ${getDocumentTypeLabel(row.document_type)}\nFecha: ${row.expiry_date_co}\nDias restantes: ${row.days_remaining}`
    });
    activeConversations.delete(senderPhone);
}

async function handleConsultSite(socket, senderPhone, conversation, input) {
    const normalized = normalizeText(input);
    const sites = (await listSites()).filter(site => site.active);
    const numeric = parseInt(normalized, 10);
    let message;

    if (normalized === 'todos' || normalized === 'todas' || numeric === sites.length + 1) {
        message = await getNonOperationalMessage('todos');
    } else {
        const site = await findSiteByInput(input);
        if (!site) {
            await socket.sendMessage(senderPhone, { text: buildConsultSiteOptionsMessage(sites) });
            return;
        }
        message = await getNonOperationalMessage(site.name);
    }

    activeConversations.delete(senderPhone);
    await socket.sendMessage(senderPhone, { text: message });
}

async function handleMovePlate(socket, senderPhone, conversation, input) {
    const plate = formatPlate(input);
    if (!isValidPlateFormat(plate)) {
        await socket.sendMessage(senderPhone, { text: 'Formato de placa invalido. Ejemplo: ABC123 o ABC-123.' });
        return;
    }

    const vehicle = await findOperationalVehicleByPlate(plate);
    if (!vehicle) {
        await socket.sendMessage(senderPhone, { text: `No encontre la placa ${plate} registrada en operatividad. Verifica la placa o registrala primero.` });
        return;
    }

    conversation.vehicleId = vehicle.id;
    conversation.plate = vehicle.plate;
    conversation.currentSiteId = vehicle.site_id;
    conversation.currentSiteName = vehicle.site_name;
    conversation.statusId = vehicle.status_id;
    conversation.state = CONVERSATION_STATES.MOVE_SITE;

    const sites = await listSites();
    await socket.sendMessage(senderPhone, {
        text: buildSiteOptionsMessage(`📍 ${vehicle.plate} esta en ${vehicle.site_name}.\n\nSelecciona la nueva sede:`, sites)
    });
}

async function handleMoveSite(socket, senderPhone, conversation, input, cleanPhone) {
    const site = await findSiteByInput(input);
    if (!site) {
        const sites = await listSites();
        await socket.sendMessage(senderPhone, { text: buildSiteOptionsMessage('Sede no encontrada. Selecciona la nueva sede:', sites) });
        return;
    }

    if (Number(site.id) === Number(conversation.currentSiteId)) {
        await socket.sendMessage(senderPhone, { text: `${conversation.plate} ya esta en ${site.name}. Selecciona otra sede o escribe cancelar.` });
        return;
    }

    await updateVehicle(conversation.vehicleId, {
        siteId: site.id,
        statusId: conversation.statusId,
        observation: `Cambio de sede: ${conversation.currentSiteName} -> ${site.name}`,
        changedByPhone: cleanPhone,
        source: 'bot-move-site'
    });

    activeConversations.delete(senderPhone);
    await socket.sendMessage(senderPhone, { text: `✅ ${conversation.plate} movido de ${conversation.currentSiteName} a ${site.name}.` });
}

async function handleDailyResponse(socket, senderPhone, conversation, input) {
    const normalized = normalizeText(input);
    const cleanPhone = normalizeWhatsAppPhone(senderPhone);
    const items = await getFollowupItems(conversation.followupId);

    if (normalized === 'finalizar' || normalized === 'salir') {
        await completeDailyFollowup(senderPhone, conversation);
        await socket.sendMessage(senderPhone, { text: 'Seguimiento finalizado. Gracias.' });
        return;
    }

    if (conversation.dailyStep) {
        await handleDailyStep(socket, senderPhone, conversation, input, items, cleanPhone);
        return;
    }

    if (normalized === '1' || normalized === 'igual') {
        await confirmDailyItemsSame(senderPhone, conversation, items, cleanPhone);
        await socket.sendMessage(senderPhone, { text: '✅ Seguimiento confirmado. Los vehiculos quedan en el mismo estado.' });
        return;
    }

    if (normalized === '2' || normalized === 'modificar') {
        await startDailyModify(socket, senderPhone, conversation, items);
        return;
    }

    if (normalized === '3' || normalized === 'agregar') {
        startDailyAdd(conversation);
        await socket.sendMessage(senderPhone, { text: '🚙 Envia la placa que deseas agregar.' });
        return;
    }

    if (normalized.startsWith('agregar ')) {
        await handleAddVehicleFromDaily(socket, senderPhone, conversation, input);
        return;
    }

    await socket.sendMessage(senderPhone, { text: buildDailyHelpMessage(items.length) });
}

async function handleDailyStep(socket, senderPhone, conversation, input, items, cleanPhone) {
    const normalized = normalizeText(input);

    if (conversation.dailyStep === 'select_modify_item') {
        const itemNumber = parseInt(input, 10);
        const item = items.find(row => row.item_number === itemNumber);
        if (!item) {
            await socket.sendMessage(senderPhone, { text: buildVehicleSelectionMessage(items) });
            return;
        }

        conversation.dailyItemNumber = item.item_number;
        conversation.dailyStep = 'modify_status';
        await socket.sendMessage(senderPhone, { text: buildStatusSelectionMessage(true) });
        return;
    }

    if (conversation.dailyStep === 'modify_status') {
        const status = await parseDailyStatus(input, true);
        if (!status) {
            await socket.sendMessage(senderPhone, { text: buildStatusSelectionMessage(true) });
            return;
        }

        conversation.dailyStatusId = status.id;
        conversation.dailyStatusName = status.name;
        conversation.dailyStep = 'modify_observation';
        await socket.sendMessage(senderPhone, { text: `📝 Envia la observacion para dejar ${status.name}. Si no aplica, escribe "sin observacion".` });
        return;
    }

    if (conversation.dailyStep === 'modify_observation') {
        const item = items.find(row => row.item_number === conversation.dailyItemNumber);
        const status = await getStatusById(conversation.dailyStatusId);
        if (!item || !status) {
            clearDailyStep(conversation);
            await socket.sendMessage(senderPhone, { text: buildDailyHelpMessage(items.length) });
            return;
        }

        await saveDailyItemUpdate(senderPhone, conversation, item, status, normalizeObservation(input), cleanPhone, input);
        clearDailyStep(conversation);
        const suffix = status.is_operational ? ' Ya no se consultara mientras siga operativo.' : '';
        await socket.sendMessage(senderPhone, { text: `✅ ${item.plate} actualizado a ${status.name}.${suffix}\n\n${buildDailyActionMenu()}` });
        return;
    }

    if (conversation.dailyStep === 'add_plate') {
        const plate = formatPlate(input);
        if (!isValidPlateFormat(plate)) {
            await socket.sendMessage(senderPhone, { text: 'Formato de placa invalido. Ejemplo: ABC123 o ABC-123.' });
            return;
        }

        await socket.sendMessage(senderPhone, { text: `Validando placa ${plate} en plataformagps...` });
        const device = await findDeviceByPlate(plate);
        if (!device) {
            await socket.sendMessage(senderPhone, { text: `No encontre la placa ${plate} en plataformagps. Verifica la placa e intenta de nuevo.` });
            return;
        }

        conversation.dailyPlate = plate;
        conversation.dailyDeviceId = device.id;
        conversation.dailyStep = 'add_status';
        await socket.sendMessage(senderPhone, { text: `✅ Placa ${plate} validada.\n\n${buildStatusSelectionMessage(false)}` });
        return;
    }

    if (conversation.dailyStep === 'add_status') {
        const status = await parseDailyStatus(input, false);
        if (!status) {
            await socket.sendMessage(senderPhone, { text: buildStatusSelectionMessage(false) });
            return;
        }

        conversation.dailyStatusId = status.id;
        conversation.dailyStatusName = status.name;
        conversation.dailyStep = 'add_observation';
        await socket.sendMessage(senderPhone, { text: `📝 Envia la observacion para ${conversation.dailyPlate}. Si no aplica, escribe "sin observacion".` });
        return;
    }

    if (conversation.dailyStep === 'add_observation') {
        const status = await getStatusById(conversation.dailyStatusId);
        if (!status || !conversation.dailyPlate) {
            clearDailyStep(conversation);
            await socket.sendMessage(senderPhone, { text: buildDailyHelpMessage(items.length) });
            return;
        }

        await upsertVehicle({
            plate: conversation.dailyPlate,
            deviceId: conversation.dailyDeviceId,
            siteId: conversation.siteId,
            statusId: status.id,
            observation: normalizeObservation(input),
            changedByPhone: cleanPhone,
            source: 'daily-add'
        });

        const plate = conversation.dailyPlate;
        clearDailyStep(conversation);
        await socket.sendMessage(senderPhone, { text: `✅ ${plate} agregada en estado ${status.name}.\n\n${buildDailyActionMenu()}` });
        return;
    }

    clearDailyStep(conversation);
    await socket.sendMessage(senderPhone, { text: buildDailyHelpMessage(items.length) });
}

async function confirmDailyItemsSame(senderPhone, conversation, items, cleanPhone) {
    for (const item of items) {
        const status = await getStatusById(item.previous_status_id);
        await saveDailyItemUpdate(senderPhone, conversation, item, status, item.last_observation || null, cleanPhone, 'igual');
    }
    await completeDailyFollowup(senderPhone, conversation);
}

async function saveDailyItemUpdate(senderPhone, conversation, item, status, observation, cleanPhone, responseText) {
    await upsertVehicle({
        plate: item.plate,
        deviceId: null,
        siteId: conversation.siteId,
        statusId: status.id,
        observation: observation || item.last_observation || null,
        changedByPhone: cleanPhone,
        source: 'daily-followup'
    });

    await database.query(`
        UPDATE operational_followup_items
        SET current_status_id = $1,
            observation = $2,
            response_text = $3,
            answered_at = NOW()
        WHERE id = $4
    `, [status.id, observation || item.last_observation || null, responseText, item.id]);
}

async function completeDailyFollowup(senderPhone, conversation) {
    await database.query(`
        UPDATE operational_followups
        SET completed_at = NOW(), status = 'completed'
        WHERE id = $1
    `, [conversation.followupId]);
    activeConversations.delete(senderPhone);
}

function buildDailyHelpMessage(itemCount) {
    if (itemCount === 1) {
        return [
            'No entendi la respuesta.',
            '',
            '1 igual: sigue igual',
            '2 modificar: cambiar estado u observacion',
            '3 agregar: registrar otra placa'
        ].join('\n');
    }

    return [
        'No entendi la respuesta.',
        '',
        'Responde una opcion:',
        '1 igual: todos siguen igual',
        '2 modificar: cambiar un vehiculo',
        '3 agregar: registrar otra placa'
    ].join('\n');
}

function buildDailyActionMenu() {
    return [
        'Puedes responder:',
        '1 igual: confirmar los restantes y cerrar',
        '2 modificar: cambiar otro vehiculo',
        '3 agregar: registrar otra placa',
        'finalizar: cerrar seguimiento'
    ].join('\n');
}

async function startDailyModify(socket, senderPhone, conversation, items) {
    if (items.length === 1) {
        conversation.dailyItemNumber = items[0].item_number;
        conversation.dailyStep = 'modify_status';
        await socket.sendMessage(senderPhone, { text: buildStatusSelectionMessage(true) });
        return;
    }

    conversation.dailyStep = 'select_modify_item';
    await socket.sendMessage(senderPhone, { text: buildVehicleSelectionMessage(items) });
}

function startDailyAdd(conversation) {
    conversation.dailyStep = 'add_plate';
    delete conversation.dailyItemNumber;
    delete conversation.dailyStatusId;
    delete conversation.dailyStatusName;
    delete conversation.dailyPlate;
    delete conversation.dailyDeviceId;
}

function clearDailyStep(conversation) {
    delete conversation.dailyStep;
    delete conversation.dailyItemNumber;
    delete conversation.dailyStatusId;
    delete conversation.dailyStatusName;
    delete conversation.dailyPlate;
    delete conversation.dailyDeviceId;
}

function buildVehicleSelectionMessage(items) {
    const lines = [
        '¿Que vehiculo deseas modificar?',
        ''
    ];
    items.forEach(item => {
        lines.push(`${item.item_number}. ${item.plate} - ${item.current_status_name || item.previous_status_name}`);
    });
    lines.push('');
    lines.push('Responde solo el numero del vehiculo.');
    return lines.join('\n');
}

function buildStatusSelectionMessage(includeOperational) {
    const lines = [
        'Selecciona el nuevo estado:',
        ''
    ];
    if (includeOperational) {
        lines.push('1 operativo');
        lines.push('2 taller');
        lines.push('3 inoperativo');
        lines.push('4 back-up');
        lines.push('5 siniestro');
    } else {
        lines.push('1 taller');
        lines.push('2 inoperativo');
        lines.push('3 back-up');
        lines.push('4 siniestro');
    }
    lines.push('');
    lines.push('Puedes responder numero o palabra.');
    return lines.join('\n');
}

async function parseDailyStatus(input, includeOperational) {
    const normalized = normalizeText(input);
    const map = includeOperational
        ? {
            '1': 'Operativo',
            operativo: 'Operativo',
            '2': 'Taller',
            taller: 'Taller',
            '3': 'Inoperativo',
            inoperativo: 'Inoperativo',
            '4': 'Back-up',
            backup: 'Back-up',
            bakup: 'Back-up',
            'back-up': 'Back-up',
            'back up': 'Back-up',
            '5': 'Siniestro',
            siniestro: 'Siniestro'
        }
        : {
            '1': 'Taller',
            taller: 'Taller',
            '2': 'Inoperativo',
            inoperativo: 'Inoperativo',
            '3': 'Back-up',
            backup: 'Back-up',
            bakup: 'Back-up',
            'back-up': 'Back-up',
            'back up': 'Back-up',
            '4': 'Siniestro',
            siniestro: 'Siniestro'
        };
    return findStatusByName(map[normalized] || input);
}

function normalizeObservation(input) {
    const normalized = normalizeText(input);
    if (['sin observacion', 'sin obs', 'no', 'ninguna', '.', '-'].includes(normalized)) return null;
    return String(input || '').trim() || null;
}

async function handleAddVehicleFromDaily(socket, senderPhone, conversation, input) {
    const cleanPhone = normalizeWhatsAppPhone(senderPhone);
    const match = input.match(/^agregar\s+([A-Za-z0-9-]+)\s+(.+)$/i);
    if (!match) {
        await socket.sendMessage(senderPhone, { text: 'Formato: agregar ABC123 taller - observacion' });
        return;
    }

    const plate = formatPlate(match[1]);
    if (!isValidPlateFormat(plate)) {
        await socket.sendMessage(senderPhone, { text: 'Formato de placa invalido. Ejemplo: ABC123 o ABC-123.' });
        return;
    }

    const [statusNameRaw, ...obsParts] = match[2].trim().split(/\s+-\s+/);
    const status = await findStatusByName(statusNameRaw);
    if (!status) {
        await socket.sendMessage(senderPhone, { text: 'Estado no valido para agregar vehiculo.' });
        return;
    }

    await socket.sendMessage(senderPhone, { text: `Validando placa ${plate} en plataformagps...` });
    const device = await findDeviceByPlate(plate);
    if (!device) {
        await socket.sendMessage(senderPhone, { text: `No encontre la placa ${plate} en plataformagps. No fue agregada.` });
        return;
    }

    const observation = obsParts.join(' - ').trim() || null;
    await upsertVehicle({
        plate,
        deviceId: device.id,
        siteId: conversation.siteId,
        statusId: status.id,
        observation,
        changedByPhone: cleanPhone,
        source: 'daily-add'
    });

    await socket.sendMessage(senderPhone, { text: `${plate} agregada en estado ${status.name}.` });
}

async function createSite({ name, active = true }) {
    const result = await database.query(`
        INSERT INTO operational_sites (name, active)
        VALUES ($1, $2)
        ON CONFLICT (name) DO UPDATE SET active = EXCLUDED.active, updated_at = NOW()
        RETURNING *
    `, [name, active]);
    return result.rows[0];
}

async function updateSite(id, data) {
    const result = await database.query(`
        UPDATE operational_sites
        SET name = COALESCE($2, name),
            active = COALESCE($3, active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [id, data.name || null, typeof data.active === 'boolean' ? data.active : null]);
    return result.rows[0];
}

async function upsertResponsible({ id, siteId, name, phoneNumber, active = true }) {
    const clean = normalizeWhatsAppPhone(phoneNumber);
    if (id) {
        const result = await database.query(`
            UPDATE operational_site_responsibles
            SET site_id = COALESCE($2, site_id),
                name = COALESCE($3, name),
                phone_number = COALESCE($4, phone_number),
                active = COALESCE($5, active),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [id, siteId || null, name || null, clean || null, typeof active === 'boolean' ? active : null]);
        return result.rows[0];
    }

    const result = await database.query(`
        INSERT INTO operational_site_responsibles (site_id, name, phone_number, active)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (site_id, phone_number) DO UPDATE
        SET name = EXCLUDED.name,
            active = EXCLUDED.active,
            updated_at = NOW()
        RETURNING *
    `, [siteId, name, clean, active]);
    return result.rows[0];
}

async function deactivateResponsible(id) {
    const result = await database.query(`
        UPDATE operational_site_responsibles
        SET active = FALSE, updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [id]);
    return result.rows[0] || null;
}

async function getReport(filters = {}) {
    const params = [];
    const where = [];
    if (filters.dateFrom) {
        params.push(filters.dateFrom);
        where.push(`h.changed_at::date >= $${params.length}`);
    }
    if (filters.dateTo) {
        params.push(filters.dateTo);
        where.push(`h.changed_at::date <= $${params.length}`);
    }
    if (filters.siteId) {
        params.push(filters.siteId);
        where.push(`h.new_site_id = $${params.length}`);
    }
    if (filters.search) {
        params.push(`%${String(filters.search).trim()}%`);
        where.push(`(v.plate ILIKE $${params.length} OR COALESCE(h.observation, '') ILIKE $${params.length} OR site.name ILIKE $${params.length})`);
    }

    const baseQuery = `
        FROM operational_vehicle_history h
        JOIN operational_vehicles v ON v.id = h.vehicle_id
        LEFT JOIN operational_statuses os ON os.id = h.old_status_id
        JOIN operational_statuses ns ON ns.id = h.new_status_id
        LEFT JOIN operational_sites site ON site.id = h.new_site_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `;

    if (filters.paginate) {
        const { page, limit, offset } = getPagination(filters, 25, 100);
        const countResult = await database.query(`SELECT COUNT(*)::int AS total ${baseQuery}`, params);
        const queryParams = [...params, limit, offset];
        const result = await database.query(`
            SELECT h.id, h.changed_at, h.observation, h.source, h.changed_by_phone,
                   ${colombiaTimestampSql('h.changed_at')} AS changed_at_co,
                   v.plate,
                   os.name AS old_status,
                   ns.name AS new_status,
                   site.name AS site_name
            ${baseQuery}
            ORDER BY h.changed_at DESC
            LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
        `, queryParams);
        const total = countResult.rows[0]?.total || 0;
        return { rows: result.rows, pagination: buildPagination(total, page, limit) };
    }

    const result = await database.query(`
        SELECT h.id, h.changed_at, h.observation, h.source, h.changed_by_phone,
               ${colombiaTimestampSql('h.changed_at')} AS changed_at_co,
               v.plate,
               os.name AS old_status,
               ns.name AS new_status,
               site.name AS site_name
        ${baseQuery}
        ORDER BY h.changed_at DESC
        LIMIT 1000
    `, params);
    return result.rows;
}

async function deleteHistoryEntry(id) {
    const result = await database.query(`
        DELETE FROM operational_vehicle_history
        WHERE id = $1
        RETURNING *
    `, [id]);
    return result.rows[0] || null;
}

async function getFollowupReport(filters = {}) {
    const params = [];
    const where = [];

    const requestedDate = filters.date || getColombiaDateParts().date;
    if (requestedDate && requestedDate !== 'all') {
        params.push(requestedDate);
        where.push(`f.followup_date = $${params.length}`);
    }
    if (filters.siteId) {
        params.push(filters.siteId);
        where.push(`f.site_id = $${params.length}`);
    }
    if (filters.status === 'pending') {
        where.push(`f.status = 'sent' AND f.completed_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM operational_followup_items fi
            WHERE fi.followup_id = f.id AND fi.answered_at IS NOT NULL
        )`);
    } else if (filters.status === 'responded') {
        where.push(`(f.status = 'completed' OR EXISTS (
            SELECT 1 FROM operational_followup_items fi
            WHERE fi.followup_id = f.id AND fi.answered_at IS NOT NULL
        ))`);
    }

    const baseQuery = `
        FROM operational_followups f
        JOIN operational_sites s ON s.id = f.site_id
        LEFT JOIN operational_site_responsibles r ON r.id = f.responsible_id
        LEFT JOIN operational_followup_items i ON i.followup_id = f.id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY f.id, s.name, r.name
    `;

    const selectSql = `
        SELECT f.id, f.followup_date, f.phone_number, f.send_type, f.sent_at, f.completed_at, f.status,
               to_char(f.followup_date, 'DD/MM/YYYY') AS followup_date_co,
               ${colombiaTimestampSql('f.sent_at')} AS sent_at_co,
               ${colombiaTimestampSql('f.completed_at')} AS completed_at_co,
               s.name AS site_name,
               COALESCE(r.name, 'Sin responsable') AS responsible_name,
               COUNT(i.id)::int AS vehicle_count,
               COUNT(i.answered_at)::int AS answered_count,
               MAX(i.answered_at) AS last_answered_at,
               ${colombiaTimestampSql('MAX(i.answered_at)')} AS last_answered_at_co
        ${baseQuery}
    `;

    if (filters.paginate) {
        const { page, limit, offset } = getPagination(filters, 25, 100);
        const countResult = await database.query(`
            SELECT COUNT(*)::int AS total
            FROM (
                SELECT f.id ${baseQuery}
            ) counted
        `, params);
        const queryParams = [...params, limit, offset];
        const result = await database.query(`
            ${selectSql}
            ORDER BY f.followup_date DESC, s.name, responsible_name
            LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
        `, queryParams);
        const total = countResult.rows[0]?.total || 0;
        return {
            rows: mapFollowupRows(result.rows),
            pagination: buildPagination(total, page, limit)
        };
    }

    const result = await database.query(`
        ${selectSql}
        ORDER BY f.followup_date DESC, s.name, responsible_name
        LIMIT 500
    `, params);

    return mapFollowupRows(result.rows);
}

async function getFollowupItemsReport(followupId) {
    const result = await database.query(`
        SELECT i.id, i.item_number, i.observation, i.response_text, i.answered_at,
               ${colombiaTimestampSql('i.answered_at')} AS answered_at_co,
               v.plate,
               ps.name AS previous_status_name,
               cs.name AS current_status_name
        FROM operational_followup_items i
        JOIN operational_vehicles v ON v.id = i.vehicle_id
        LEFT JOIN operational_statuses ps ON ps.id = i.previous_status_id
        LEFT JOIN operational_statuses cs ON cs.id = i.current_status_id
        WHERE i.followup_id = $1
        ORDER BY i.item_number
    `, [followupId]);
    return result.rows.map(row => ({
        ...row,
        response_status: row.answered_at ? 'Respondio' : 'Pendiente'
    }));
}

function mapFollowupRows(rows) {
    return rows.map(row => {
        const answered = Number(row.answered_count) > 0;
        const responded = row.status === 'completed' || answered;
        const cancelled = row.status === 'cancelled';
        return {
            ...row,
            response_status: responded ? 'Respondio' : (cancelled ? 'Cancelado' : 'Pendiente'),
            response_at_co: responded ? (row.last_answered_at_co || row.completed_at_co || null) : null,
            send_type_label: row.send_type === 'manual' ? 'Manual' : 'Automatico'
        };
    });
}

async function deleteFollowup(id) {
    const result = await database.query(`
        DELETE FROM operational_followups
        WHERE id = $1
        RETURNING *
    `, [id]);
    return result.rows[0] || null;
}

module.exports = {
    processOperationalMessage,
    startConsultFlow,
    startMoveSiteFlow,
    startDocumentExpirationFlow,
    startDailyScheduler,
    sendDailyPrompts,
    listSites,
    createSite,
    updateSite,
    listStatuses,
    listVehicles,
    upsertVehicle,
    updateVehicle,
    deactivateVehicle,
    upsertResponsible,
    deactivateResponsible,
    getReport,
    deleteHistoryEntry,
    getFollowupReport,
    getFollowupItemsReport,
    deleteFollowup,
    listDocumentExpirations,
    upsertDocumentExpiration,
    updateDocumentExpiration,
    deleteDocumentExpiration,
    DOCUMENT_TYPES
};
