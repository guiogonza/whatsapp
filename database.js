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
const BACKUP_PATH = path.join(DATA_DIR, 'analytics.db.backup');

let db = null;
let saveTimeout = null;
let backupInterval = null;

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
        const fileSize = buffer.length;
        
        // Si el archivo es muy pequeño, puede estar corrupto - intentar restaurar backup
        if (fileSize < 5000 && fs.existsSync(BACKUP_PATH)) {
            const backupSize = fs.statSync(BACKUP_PATH).size;
            if (backupSize > fileSize * 2) {
                console.warn(`⚠️ Archivo DB muy pequeño (${fileSize} bytes), restaurando desde backup (${backupSize} bytes)...`);
                fs.copyFileSync(BACKUP_PATH, DB_PATH);
                const restoredBuffer = fs.readFileSync(DB_PATH);
                db = new SQL.Database(restoredBuffer);
                console.log('✅ Base de datos restaurada desde backup');
            } else {
                db = new SQL.Database(buffer);
                console.log('📊 Base de datos de analytics cargada');
            }
        } else {
            db = new SQL.Database(buffer);
            console.log(`📊 Base de datos de analytics cargada (${Math.round(fileSize/1024)}KB)`);
        }
    } else if (fs.existsSync(BACKUP_PATH)) {
        // No existe el archivo principal pero sí el backup - restaurar
        console.warn('⚠️ Archivo DB no existe, restaurando desde backup...');
        fs.copyFileSync(BACKUP_PATH, DB_PATH);
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        console.log('✅ Base de datos restaurada desde backup');
    } else {
        db = new SQL.Database();
        console.log('📊 Base de datos de analytics creada (nueva)');
    }
    
    // Iniciar backups periódicos
    startPeriodicBackups();
    
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
    try {
        db.run(`ALTER TABLE outgoing_queue ADD COLUMN send_type TEXT DEFAULT 'auto'`);
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
 * Guardar la base de datos a disco (con debounce y protección de datos)
 */
function saveDatabase() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        if (db) {
            try {
                const data = db.export();
                const buffer = Buffer.from(data);
                
                // Protección: no sobreescribir si el nuevo archivo sería mucho más pequeño
                if (fs.existsSync(DB_PATH)) {
                    const existingSize = fs.statSync(DB_PATH).size;
                    // Si el nuevo archivo es menos del 50% del tamaño anterior, hacer backup primero
                    if (buffer.length < existingSize * 0.5 && existingSize > 10000) {
                        console.warn(`⚠️ Protección de datos: nuevo archivo (${buffer.length}) mucho menor que existente (${existingSize}). Haciendo backup...`);
                        fs.copyFileSync(DB_PATH, BACKUP_PATH + '.emergency');
                    }
                }
                
                fs.writeFileSync(DB_PATH, buffer);
            } catch (error) {
                console.error('❌ Error guardando base de datos:', error.message);
            }
        }
    }, 1000); // Guardar después de 1 segundo de inactividad
}

/**
 * Crear backup de la base de datos
 */
function createBackup() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const stats = fs.statSync(DB_PATH);
            // Solo hacer backup si el archivo tiene datos (más de 10KB)
            if (stats.size > 10000) {
                fs.copyFileSync(DB_PATH, BACKUP_PATH);
                console.log(`📦 Backup de analytics creado (${Math.round(stats.size/1024)}KB)`);
            }
        }
    } catch (error) {
        console.error('❌ Error creando backup:', error.message);
    }
}

/**
 * Iniciar backups periódicos (cada 30 minutos)
 */
function startPeriodicBackups() {
    if (backupInterval) clearInterval(backupInterval);
    // Backup inmediato al iniciar
    setTimeout(createBackup, 5000);
    // Backup cada 30 minutos
    backupInterval = setInterval(createBackup, 30 * 60 * 1000);
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
        INSERT INTO outgoing_queue (phone_number, message, char_count, arrived_at, sent_at)
        VALUES (?, ?, ?, ?, NULL)
    `, [num, msg, charCount, arrivedAt]);
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
 * @param {Array} messageIds - IDs de mensajes a marcar
 * @param {string} sendType - 'auto' o 'manual'
 */
function markMessagesSent(messageIds, sendType = 'auto') {
    if (!db || !messageIds || messageIds.length === 0) return false;
    const ids = messageIds.join(',');
    const sentAt = getColombiaTimestamp();
    db.run(`UPDATE outgoing_queue SET sent_at = ?, send_type = ? WHERE id IN (${ids})`, [sentAt, sendType]);
    saveDatabase();
    return true;
}

/**
 * Marcar TODOS los mensajes pendientes como enviados manualmente
 * @returns {number} Cantidad de mensajes marcados
 */
function markAllPendingAsSent() {
    if (!db) return 0;
    const sentAt = getColombiaTimestamp();
    
    // Primero contar cuántos hay pendientes
    const countRes = db.exec(`SELECT COUNT(*) as cnt FROM outgoing_queue WHERE sent_at IS NULL`);
    const count = queryToObjects(countRes)[0]?.cnt || 0;
    
    if (count > 0) {
        db.run(`UPDATE outgoing_queue SET sent_at = ?, send_type = 'manual' WHERE sent_at IS NULL`, [sentAt]);
        saveDatabase();
    }
    
    return count;
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
 * @param {number} limit - Límite de resultados
 * @param {string} status - 'pending', 'sent', 'all' (default: 'pending')
 */
function getQueuedMessages(limit = 50, status = 'pending') {
    if (!db) return [];
    
    let whereClause = '';
    let orderBy = 'arrived_at DESC';
    
    if (status === 'pending') {
        whereClause = 'WHERE sent_at IS NULL';
        orderBy = 'arrived_at ASC';
    } else if (status === 'sent') {
        whereClause = 'WHERE sent_at IS NOT NULL';
        orderBy = 'sent_at DESC';
    }
    
    const res = db.exec(`
        SELECT id, phone_number, message, char_count, arrived_at, sent_at, send_type,
               CASE WHEN sent_at IS NULL THEN 'pending' ELSE 'sent' END as status
        FROM outgoing_queue
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ${parseInt(limit) || 50}
    `);
    return queryToObjects(res);
}

/**
 * Estadísticas de la cola (solo mensajes pendientes - sin enviar)
 */
function getQueueStats() {
    if (!db) return { total: 0, pendingNumbers: 0, totalChars: 0, sentToday: 0 };
    const totalRes = db.exec(`SELECT COUNT(*) as total, SUM(char_count) as chars FROM outgoing_queue WHERE sent_at IS NULL`);
    const numbersRes = db.exec(`SELECT COUNT(DISTINCT phone_number) as cnt FROM outgoing_queue WHERE sent_at IS NULL`);
    
    // Mensajes enviados hoy
    const today = getColombiaTimestamp().split('T')[0];
    const sentTodayRes = db.exec(`SELECT COUNT(*) as cnt FROM outgoing_queue WHERE sent_at IS NOT NULL AND sent_at LIKE '${today}%'`);
    
    const total = queryToObjects(totalRes)[0]?.total || 0;
    const totalChars = queryToObjects(totalRes)[0]?.chars || 0;
    const pendingNumbers = queryToObjects(numbersRes)[0]?.cnt || 0;
    const sentToday = queryToObjects(sentTodayRes)[0]?.cnt || 0;
    
    return { total, pendingNumbers, totalChars, sentToday };
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
        GROUP BY phone_number 
        ORDER BY message_count DESC, last_message DESC
        LIMIT 500
    `);
    return queryToObjects(res);
}

/**
 * Obtener lista de sesiones únicas para filtrado
 */
function getUniqueSessions() {
    if (!db) return [];
    const res = db.exec(`
        SELECT DISTINCT session, 
               COUNT(*) as message_count,
               MAX(timestamp) as last_message
        FROM messages 
        WHERE session IS NOT NULL AND session != ''
        GROUP BY session 
        ORDER BY message_count DESC, last_message DESC
    `);
    return queryToObjects(res);
}

/**
 * Obtener mensajes filtrados por número y rango de fechas
 */
function getMessagesByFilter(options = {}) {
    if (!db) return { messages: [], total: 0 };
    
    const { phoneNumber, session, startDate, endDate, limit = 50, offset = 0 } = options;
    
    let conditions = [];
    
    if (phoneNumber) {
        // Escapar comillas simples para evitar SQL injection
        const escapedPhone = String(phoneNumber).replace(/'/g, "''");
        conditions.push(`phone_number = '${escapedPhone}'`);
    }
    if (session) {
        const escapedSession = String(session).replace(/'/g, "''");
        conditions.push(`session = '${escapedSession}'`);
    }
    if (startDate) {
        // El timestamp está en formato ISO string (YYYY-MM-DDTHH:MM:SS)
        // Comparar como string: fecha inicio a las 00:00:00
        conditions.push(`timestamp >= '${startDate}T00:00:00'`);
    }
    if (endDate) {
        // Fecha fin a las 23:59:59
        conditions.push(`timestamp <= '${endDate}T23:59:59'`);
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

/**
 * Obtener conteo de mensajes enviados hoy por sesión
 * @returns {Object} Objeto con session como clave y count como valor
 */
function getTodayMessagesBySession() {
    if (!db) return {};
    
    // Obtener fecha de hoy en zona horaria Colombia
    const now = new Date();
    const colombiaOffset = -5 * 60; // UTC-5 en minutos
    const localOffset = now.getTimezoneOffset();
    const colombiaTime = new Date(now.getTime() + (localOffset - colombiaOffset) * 60000);
    
    const year = colombiaTime.getFullYear();
    const month = String(colombiaTime.getMonth() + 1).padStart(2, '0');
    const day = String(colombiaTime.getDate()).padStart(2, '0');
    const todayStart = `${year}-${month}-${day} 00:00:00`;
    const todayEnd = `${year}-${month}-${day} 23:59:59`;
    
    const res = db.exec(`
        SELECT session, COUNT(*) as count
        FROM messages 
        WHERE status = 'sent' 
        AND timestamp >= '${todayStart}' 
        AND timestamp <= '${todayEnd}'
        GROUP BY session
    `);
    
    const rows = queryToObjects(res);
    const result = {};
    rows.forEach(row => {
        result[row.session] = row.count;
    });
    
    return result;
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
    markAllPendingAsSent,
    clearQueueForNumber,
    getQueueStats,
    getQueuedMessages,
    getUniquePhoneNumbers,
    getUniqueSessions,
    getMessagesByFilter,
    getTodayMessagesBySession,
    close
};
