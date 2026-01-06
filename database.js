/**
 * Módulo de Base de Datos para Analytics
 * Usa sql.js (SQLite compilado a WebAssembly) para almacenar historial de mensajes
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Asegurar que el directorio de datos existe
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'analytics.db');

let db = null;
let saveTimeout = null;

/**
 * Obtiene la fecha/hora actual en zona horaria de Colombia (GMT-5)
 */
function getColombiaTimestamp() {
    return new Date().toLocaleString('sv-SE', { 
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).replace(' ', 'T');
}

/**
 * Inicializar la base de datos
 */
async function initDatabase() {
    const SQL = await initSqlJs();
    
    // Cargar base de datos existente o crear nueva
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        console.log('📊 Base de datos de analytics cargada');
    } else {
        db = new SQL.Database();
        console.log('📊 Base de datos de analytics creada');
    }
    
    // Crear tabla de mensajes si no existe
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            session TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            message_preview TEXT,
            char_count INTEGER DEFAULT 0,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Agregar columna char_count si no existe (para BD existentes)
    try {
        db.run(`ALTER TABLE messages ADD COLUMN char_count INTEGER DEFAULT 0`);
        console.log('📊 Columna char_count agregada a messages');
    } catch (e) {
        // Columna ya existe, ignorar
    }
    
    // Actualizar registros existentes que no tienen char_count calculado
    db.run(`
        UPDATE messages 
        SET char_count = LENGTH(COALESCE(message_preview, '')) 
        WHERE char_count = 0 OR char_count IS NULL
    `);

    // Cola persistente de mensajes salientes para consolidación
    db.run(`
        CREATE TABLE IF NOT EXISTS outgoing_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT NOT NULL,
            message TEXT NOT NULL,
            char_count INTEGER DEFAULT 0,
            arrived_at TEXT NOT NULL,
            sent_at TEXT,
            tries INTEGER DEFAULT 0,
            last_error TEXT
        )
    `);
    
    // Agregar columnas nuevas si no existen (para BD existentes)
    try {
        db.run(`ALTER TABLE outgoing_queue ADD COLUMN arrived_at TEXT`);
    } catch (e) { /* ya existe */ }
    try {
        db.run(`ALTER TABLE outgoing_queue ADD COLUMN sent_at TEXT`);
    } catch (e) { /* ya existe */ }
    try {
        db.run(`ALTER TABLE outgoing_queue ADD COLUMN char_count INTEGER DEFAULT 0`);
    } catch (e) { /* ya existe */ }
    
    // Migrar datos antiguos: si arrived_at está vacío, usar enqueued_at (solo si la columna existe)
    try {
        const cols = db.exec("PRAGMA table_info(outgoing_queue)");
        const hasEnqueuedAt = cols[0]?.values?.some(row => row[1] === 'enqueued_at');
        if (hasEnqueuedAt) {
            db.run(`UPDATE outgoing_queue SET arrived_at = enqueued_at WHERE arrived_at IS NULL OR arrived_at = ''`);
        }
    } catch (e) { /* columna no existe, no hay nada que migrar */ }
    
    // Índice para búsqueda de pendientes
    db.run(`CREATE INDEX IF NOT EXISTS idx_queue_pending ON outgoing_queue(sent_at, phone_number)`);
    
    // Crear índices
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session)`);
    
    // Guardar después de crear tablas
    saveDatabase();
    
    return db;
}

/**
 * Guardar la base de datos a disco (con debounce)
 */
function saveDatabase() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        if (db) {
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(DB_PATH, buffer);
        }
    }, 1000); // Guardar después de 1 segundo de inactividad
}

/**
 * Registrar un mensaje enviado
 */
function logMessage(session, phoneNumber, message, status, errorMessage = null) {
    if (!db) {
        console.error('Base de datos no inicializada');
        return;
    }

    // Aceptar estados conocidos tal cual; mapear 'success' a 'sent'
    let finalStatus = (status || '').toLowerCase();
    const allowed = new Set(['sent', 'error', 'queued', 'received']);
    if (finalStatus === 'success') finalStatus = 'sent';
    if (!allowed.has(finalStatus)) finalStatus = 'queued';

    // Calcular cantidad de caracteres incluyendo espacios
    const messageText = message || '';
    const charCount = messageText.length;

    db.run(`
        INSERT INTO messages (timestamp, session, phone_number, message_preview, char_count, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
        getColombiaTimestamp(),
        session || 'unknown',
        phoneNumber || 'unknown',
        messageText,
        charCount,
        finalStatus,
        errorMessage
    ]);

    saveDatabase();
}

/**
 * Encolar mensaje en la cola persistente para consolidación
 * Guarda la hora de llegada (arrived_at) y deja sent_at vacío hasta que se envíe
 */
function enqueueMessage(phoneNumber, message) {
    if (!db) return { success: false, error: 'DB no inicializada' };
    const num = (phoneNumber || '').trim();
    const msg = (message || '').trim();
    if (!num || !msg) return { success: false, error: 'Datos inválidos' };
    
    const charCount = msg.length;
    const arrivedAt = getColombiaTimestamp();
    
    db.run(`
        INSERT INTO outgoing_queue (phone_number, message, char_count, arrived_at, enqueued_at, sent_at)
        VALUES (?, ?, ?, ?, ?, NULL)
    `, [num, msg, charCount, arrivedAt, arrivedAt]);
    saveDatabase();
    
    // Resumen rápido
    const stats = getQueueStats();
    return { success: true, queued: true, arrivedAt, charCount, total: stats.total, pendingNumbers: stats.pendingNumbers };
}

/**
 * Obtener números pendientes en cola (que no han sido enviados)
 */
function getQueuedNumbers() {
    if (!db) return [];
    const res = db.exec(`
        SELECT phone_number, MIN(arrived_at) as first_at, COUNT(*) as msg_count
        FROM outgoing_queue
        WHERE sent_at IS NULL
        GROUP BY phone_number
        ORDER BY first_at ASC
    `);
    return queryToObjects(res);
}

/**
 * Obtener mensajes pendientes para un número (no enviados)
 */
function getMessagesForNumber(phoneNumber) {
    if (!db) return [];
    const res = db.exec(`
        SELECT id, message, char_count, arrived_at
        FROM outgoing_queue
        WHERE phone_number = '${phoneNumber.replace(/'/g, "''")}' AND sent_at IS NULL
        ORDER BY arrived_at ASC
    `);
    return queryToObjects(res);
}

/**
 * Marcar mensajes como enviados (actualiza sent_at)
 */
function markMessagesSent(messageIds) {
    if (!db || !messageIds || messageIds.length === 0) return false;
    const ids = messageIds.join(',');
    const sentAt = getColombiaTimestamp();
    db.run(`UPDATE outgoing_queue SET sent_at = ? WHERE id IN (${ids})`, [sentAt]);
    saveDatabase();
    return true;
}

/**
 * Limpiar cola para un número (tras envío exitoso)
 */
function clearQueueForNumber(phoneNumber) {
    if (!db) return false;
    db.run(`DELETE FROM outgoing_queue WHERE phone_number = ?`, [phoneNumber]);
    saveDatabase();
    return true;
}

/**
 * Obtener mensajes en cola con detalle (para mostrar en UI)
 */
function getQueuedMessages(limit = 50) {
    if (!db) return [];
    const res = db.exec(`
        SELECT id, phone_number, message, enqueued_at, tries
        FROM outgoing_queue
        ORDER BY enqueued_at ASC
        LIMIT ${parseInt(limit) || 50}
    `);
    return queryToObjects(res);
}

/**
 * Estadísticas de la cola (solo mensajes pendientes - sin enviar)
 */
function getQueueStats() {
    if (!db) return { total: 0, pendingNumbers: 0, totalChars: 0 };
    const totalRes = db.exec(`SELECT COUNT(*) as total, SUM(char_count) as chars FROM outgoing_queue WHERE sent_at IS NULL`);
    const numbersRes = db.exec(`SELECT COUNT(DISTINCT phone_number) as cnt FROM outgoing_queue WHERE sent_at IS NULL`);
    const total = queryToObjects(totalRes)[0]?.total || 0;
    const totalChars = queryToObjects(totalRes)[0]?.chars || 0;
    const pendingNumbers = queryToObjects(numbersRes)[0]?.cnt || 0;
    return { total, pendingNumbers, totalChars };
}

/**
 * Obtener estadísticas de analytics por período
 */
function getAnalytics(options = {}) {
    if (!db) return { timeline: [], top_numbers: [], db_stats: {} };
    
    const { period = 'day', range = 'today', top = 10, startDate, endDate } = options;
    
    // Calcular fechas según el período (usando hora Colombia)
    let dateFilter = '';
    
    // Función helper para obtener fecha Colombia
    const getColombiaDate = (daysOffset = 0) => {
        const date = new Date();
        date.setTime(date.getTime() + (daysOffset * 24 * 60 * 60 * 1000));
        return date.toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
    };
    
    if (period === 'custom' && startDate && endDate) {
        dateFilter = `WHERE date(timestamp) BETWEEN '${startDate}' AND '${endDate}'`;
    } else if (period === 'day') {
        if (range === 'today') {
            const today = getColombiaDate(0);
            dateFilter = `WHERE date(timestamp) = '${today}'`;
        } else if (range === 'yesterday') {
            const yesterday = getColombiaDate(-1);
            dateFilter = `WHERE date(timestamp) = '${yesterday}'`;
        } else {
            const days = parseInt(range) || 7;
            const pastDate = getColombiaDate(-days);
            dateFilter = `WHERE date(timestamp) >= '${pastDate}'`;
        }
    } else if (period === 'week') {
        const weeks = parseInt(range) || 4;
        const pastDate = getColombiaDate(-weeks * 7);
        dateFilter = `WHERE date(timestamp) >= '${pastDate}'`;
    } else if (period === 'month') {
        const months = parseInt(range) || 3;
        const pastDate = getColombiaDate(-months * 30);
        dateFilter = `WHERE date(timestamp) >= '${pastDate}'`;
    }
    
    // Timeline agrupado según el período
    let groupBy = "date(timestamp)";
    let periodLabel = "date(timestamp) as periodo";
    
    if (period === 'week') {
        groupBy = "strftime('%Y-W%W', timestamp)";
        periodLabel = "strftime('%Y-W%W', timestamp) as periodo";
    } else if (period === 'month') {
        groupBy = "strftime('%Y-%m', timestamp)";
        periodLabel = "strftime('%Y-%m', timestamp) as periodo";
    }
    
    // Query para timeline
    const timelineQuery = `
        SELECT 
            ${periodLabel},
            COUNT(*) as total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as enviados,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errores,
            SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as en_cola
        FROM messages
        ${dateFilter}
        GROUP BY ${groupBy}
        ORDER BY periodo ASC
    `;
    
    const timeline = queryToObjects(db.exec(timelineQuery));
    
    // Query para top números
    const topQuery = `
        SELECT 
            phone_number,
            COUNT(*) as total,
            SUM(COALESCE(char_count, 0)) as total_chars,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as enviados,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errores,
            SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as en_cola
        FROM messages
        ${dateFilter}
        GROUP BY phone_number
        ORDER BY total DESC
        LIMIT ${parseInt(top) || 10}
    `;
    
    const topNumbers = queryToObjects(db.exec(topQuery));
    
    // Query para envíos por sesión
    const sessionQuery = `
        SELECT 
            session,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as enviados,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errores
        FROM messages
        ${dateFilter}
        GROUP BY session
        ORDER BY total DESC
    `;
    
    const sessionsStats = queryToObjects(db.exec(sessionQuery));
    
    // Estadísticas de la BD
    const dbStats = getDbStats();
    
    return {
        timeline,
        top_numbers: topNumbers,
        sessions_stats: sessionsStats,
        db_stats: dbStats
    };
}

/**
 * Convertir resultado de sql.js a array de objetos
 */
function queryToObjects(result) {
    if (!result || result.length === 0) return [];
    
    const columns = result[0].columns;
    const values = result[0].values;
    
    return values.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = row[i];
        });
        return obj;
    });
}

/**
 * Obtener estadísticas generales de la BD
 */
function getDbStats() {
    if (!db) return { total_by_status: {}, db_size_mb: 0 };
    
    const result = db.exec(`SELECT status, COUNT(*) as count FROM messages GROUP BY status`);
    const rows = queryToObjects(result);
    
    const statusMap = {};
    rows.forEach(row => {
        statusMap[row.status] = row.count;
    });
    
    // Tamaño de la base de datos
    let dbSizeMb = 0;
    try {
        if (fs.existsSync(DB_PATH)) {
            const stats = fs.statSync(DB_PATH);
            dbSizeMb = (stats.size / (1024 * 1024)).toFixed(2);
        }
    } catch (e) {
        dbSizeMb = 0;
    }
    
    return {
        total_by_status: statusMap,
        db_size_mb: dbSizeMb
    };
}

/**
 * Cerrar la base de datos
 */
function close() {
    if (db) {
        saveDatabase();
        db.close();
    }
}

/**
 * Obtener lista de números únicos a los que se han enviado mensajes
 */
function getUniquePhoneNumbers() {
    if (!db) return [];
    const res = db.exec(`
        SELECT DISTINCT phone_number, 
               COUNT(*) as message_count,
               MAX(timestamp) as last_message
        FROM messages 
        WHERE status IN ('sent', 'success')
        GROUP BY phone_number 
        ORDER BY message_count DESC, last_message DESC
        LIMIT 500
    `);
    return queryToObjects(res);
}

/**
 * Obtener mensajes filtrados por número y rango de fechas
 */
function getMessagesByFilter(options = {}) {
    if (!db) return { messages: [], total: 0 };
    
    const { phoneNumber, startDate, endDate, limit = 50, offset = 0 } = options;
    
    let conditions = [];
    
    if (phoneNumber) {
        // Escapar comillas simples para evitar SQL injection
        const escapedPhone = String(phoneNumber).replace(/'/g, "''");
        conditions.push(`phone_number = '${escapedPhone}'`);
    }
    if (startDate) {
        // Convertir fecha a timestamp en milisegundos
        const startTs = new Date(startDate).getTime();
        if (!isNaN(startTs)) {
            conditions.push(`timestamp >= ${startTs}`);
        }
    }
    if (endDate) {
        // Convertir fecha a timestamp en milisegundos (fin del día)
        const endTs = new Date(endDate).getTime() + (24 * 60 * 60 * 1000 - 1);
        if (!isNaN(endTs)) {
            conditions.push(`timestamp <= ${endTs}`);
        }
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Obtener total
    const countRes = db.exec(`SELECT COUNT(*) as total FROM messages ${whereClause}`);
    const total = queryToObjects(countRes)[0]?.total || 0;
    
    // Obtener mensajes paginados
    const res = db.exec(`
        SELECT id, timestamp, session, phone_number, message_preview, char_count, status, error_message
        FROM messages 
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ${limit} OFFSET ${offset}
    `);
    
    return {
        messages: queryToObjects(res),
        total,
        limit,
        offset
    };
}

module.exports = {
    init: initDatabase,
    initDatabase,
    logMessage,
    getAnalytics,
    getStats: getDbStats,
    getDbStats,
    getMessages: getAnalytics,
    enqueueMessage,
    getQueuedNumbers,
    getMessagesForNumber,
    markMessagesSent,
    clearQueueForNumber,
    getQueueStats,
    getQueuedMessages,
    getUniquePhoneNumbers,
    getMessagesByFilter,
    close
};
