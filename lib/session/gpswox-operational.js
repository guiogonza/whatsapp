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
    DAILY_RESPONSE: 'daily_response'
};

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

async function findStatusByName(name) {
    const normalized = normalizeText(name);
    const result = await database.query('SELECT * FROM operational_statuses WHERE active = TRUE');
    return result.rows.find(status => normalizeText(status.name) === normalized) || null;
}

async function getStatusById(id) {
    const result = await database.query('SELECT * FROM operational_statuses WHERE id = $1', [id]);
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

    const result = await database.query(`
        SELECT v.id, v.plate, v.gpswox_device_id, v.last_observation, v.active, v.created_at, v.updated_at,
               s.id AS site_id, s.name AS site_name,
               st.id AS status_id, st.name AS status_name, st.is_operational
        FROM operational_vehicles v
        JOIN operational_sites s ON s.id = v.site_id
        JOIN operational_statuses st ON st.id = v.status_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.name, st.is_operational ASC, st.name, v.plate
    `, params);
    return result.rows;
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
        `Buenos dias. Seguimiento operativo - Sede ${siteName}`,
        '',
        'Vehiculos no operativos del dia anterior:',
        ''
    ];

    vehicles.forEach((vehicle, index) => {
        lines.push(`${index + 1}. ${vehicle.plate} - ${vehicle.status_name}`);
        if (vehicle.last_observation) lines.push(`   Obs: ${vehicle.last_observation}`);
        lines.push('');
    });

    lines.push('Responde por numero:');
    lines.push('1 igual - observacion');
    lines.push('1 operativo');
    lines.push('1 taller - nueva observacion');
    lines.push('agregar ABC123 taller - observacion');
    lines.push('finalizar');
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

async function getNonOperationalMessage(siteNameInput = null) {
    const normalizedSiteName = normalizeText(siteNameInput);
    if (normalizedSiteName && normalizedSiteName !== 'todos' && normalizedSiteName !== 'todas') {
        const site = await findSiteByName(siteNameInput);
        if (!site) {
            return `Sede no encontrada: ${siteNameInput}\n\nUsa: jamundi, buga, tulua, zarzal o todos.`;
        }

        const vehicles = await listVehicles({ siteId: site.id, onlyNonOperational: true });
        return buildNonOperationalListMessage(vehicles, site.name);
    }

    const vehicles = await listVehicles({ onlyNonOperational: true });
    return buildNonOperationalListMessage(vehicles);
}

async function createFollowupForResponsible(responsible) {
    const vehicles = await listVehicles({ siteId: responsible.site_id, onlyNonOperational: true });
    if (vehicles.length === 0) return null;

    const { date } = getColombiaDateParts();
    const message = buildDailyPrompt(responsible.site_name, vehicles);
    const followup = await database.query(`
        INSERT INTO operational_followups (followup_date, site_id, responsible_id, phone_number, message, sent_at, status)
        VALUES ($1, $2, $3, $4, $5, NOW(), 'sent')
        ON CONFLICT (followup_date, site_id, phone_number) DO UPDATE
        SET message = EXCLUDED.message,
            sent_at = NOW(),
            status = 'sent',
            completed_at = NULL
        RETURNING *
    `, [date, responsible.site_id, responsible.id, responsible.phone_number, message]);

    await database.query('DELETE FROM operational_followup_items WHERE followup_id = $1', [followup.rows[0].id]);

    for (let index = 0; index < vehicles.length; index++) {
        await database.query(`
            INSERT INTO operational_followup_items (followup_id, vehicle_id, item_number, previous_status_id, current_status_id, observation)
            VALUES ($1, $2, $3, $4, $4, $5)
        `, [followup.rows[0].id, vehicles[index].id, index + 1, vehicles[index].status_id, vehicles[index].last_observation || null]);
    }

    return { followup: followup.rows[0], message };
}

async function sendDailyPrompts(sessionManager) {
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
        const payload = await createFollowupForResponsible(responsible);
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
            const sent = await sendDailyPrompts(sessionManager);
            console.log(`Seguimiento operatividad enviado a ${sent.length} responsables`);
        } catch (error) {
            console.error(`Error enviando seguimiento operatividad: ${error.message}`);
        }
    }, 60 * 1000);

    console.log('Scheduler de operatividad activo: lunes a sabado 8:00 a. m.');
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

    if (!conversation && (normalized === 'operatividad' || normalized.startsWith('operatividad '))) {
        const parts = input.split(/\s+/);
        const siteName = parts.slice(1).join(' ');
        if (siteName) {
            const site = await findSiteByName(siteName);
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
        await socket.sendMessage(senderPhone, { text: `Carga de operatividad\n\nEnvia la sede:\n${sites.map(s => `- ${s.name}`).join('\n')}` });
        return true;
    }

    if (!conversation) return false;

    if (normalized === 'menu') {
        activeConversations.delete(key);
        return false;
    }

    if (normalized === 'cancelar') {
        activeConversations.delete(key);
        await socket.sendMessage(senderPhone, { text: 'Flujo de operatividad cancelado.' });
        return true;
    }

    conversation.lastActivity = Date.now();

    if (conversation.state === CONVERSATION_STATES.LOAD_SITE) {
        const site = await findSiteByName(input);
        if (!site) {
            await socket.sendMessage(senderPhone, { text: 'Sede no encontrada. Envia una sede valida o escribe cancelar.' });
            return true;
        }
        conversation.siteId = site.id;
        conversation.siteName = site.name;
        conversation.state = CONVERSATION_STATES.LOAD_PLATE;
        await socket.sendMessage(senderPhone, { text: `Sede ${site.name} seleccionada.\n\nEnvia la placa del vehiculo.` });
        return true;
    }

    if (conversation.state === CONVERSATION_STATES.LOAD_PLATE) {
        const plate = formatPlate(input);
        if (!isValidPlateFormat(plate)) {
            await socket.sendMessage(senderPhone, { text: 'Formato de placa invalido. Ejemplo: ABC123 o ABC-123.' });
            return true;
        }
        await socket.sendMessage(senderPhone, { text: `Validando placa ${plate} en la plataforma GPS...` });
        const device = await findDeviceByPlate(plate);
        if (!device) {
            await socket.sendMessage(senderPhone, { text: `No encontre la placa ${plate} en la plataforma GPS. Verifica la placa e intenta de nuevo.` });
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

async function handleDailyResponse(socket, senderPhone, conversation, input) {
    const normalized = normalizeText(input);
    const cleanPhone = normalizeWhatsAppPhone(senderPhone);

    if (normalized === 'finalizar') {
        await database.query(`
            UPDATE operational_followups
            SET completed_at = NOW(), status = 'completed'
            WHERE id = $1
        `, [conversation.followupId]);
        activeConversations.delete(senderPhone);
        await socket.sendMessage(senderPhone, { text: 'Seguimiento finalizado. Gracias.' });
        return;
    }

    if (normalized.startsWith('agregar ')) {
        await handleAddVehicleFromDaily(socket, senderPhone, conversation, input);
        return;
    }

    const match = input.match(/^(\d+)\s+(.+)$/);
    if (!match) {
        await socket.sendMessage(senderPhone, { text: 'No entendi la respuesta. Ejemplo: 1 igual - observacion, 1 operativo, agregar ABC123 taller - observacion, finalizar.' });
        return;
    }

    const itemNumber = parseInt(match[1], 10);
    const rest = match[2].trim();
    const [statusPartRaw, ...obsParts] = rest.split(/\s+-\s+/);
    const statusPart = normalizeText(statusPartRaw);
    const observation = obsParts.join(' - ').trim() || null;

    const items = await getFollowupItems(conversation.followupId);
    const item = items.find(row => row.item_number === itemNumber);
    if (!item) {
        await socket.sendMessage(senderPhone, { text: `No existe el numero ${itemNumber} en el seguimiento activo.` });
        return;
    }

    let status = null;
    if (statusPart === 'igual' || statusPart === 'mismo') {
        status = await getStatusById(item.previous_status_id);
    } else {
        status = await findStatusByName(statusPartRaw);
    }

    if (!status) {
        await socket.sendMessage(senderPhone, { text: 'Estado no valido. Usa igual, operativo, Back-up, Inoperativo, Siniestro o Taller.' });
        return;
    }

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
    `, [status.id, observation || item.last_observation || null, input, item.id]);

    const suffix = status.is_operational ? ' Ya no se consultara mientras siga operativo.' : '';
    await socket.sendMessage(senderPhone, { text: `${item.plate} actualizado a ${status.name}.${suffix}` });
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

    await socket.sendMessage(senderPhone, { text: `Validando placa ${plate} en la plataforma GPS...` });
    const device = await findDeviceByPlate(plate);
    if (!device) {
        await socket.sendMessage(senderPhone, { text: `No encontre la placa ${plate} en la plataforma GPS. No fue agregada.` });
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

    const result = await database.query(`
        SELECT h.id, h.changed_at, h.observation, h.source, h.changed_by_phone,
               v.plate,
               os.name AS old_status,
               ns.name AS new_status,
               site.name AS site_name
        FROM operational_vehicle_history h
        JOIN operational_vehicles v ON v.id = h.vehicle_id
        LEFT JOIN operational_statuses os ON os.id = h.old_status_id
        JOIN operational_statuses ns ON ns.id = h.new_status_id
        LEFT JOIN operational_sites site ON site.id = h.new_site_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY h.changed_at DESC
        LIMIT 1000
    `, params);
    return result.rows;
}

module.exports = {
    processOperationalMessage,
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
    getReport
};
