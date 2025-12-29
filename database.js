/**
 * Módulo de Base de Datos para Analytics
 * Usa sql.js (SQLite compilado a WebAssembly) para almacenar historial de mensajes
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'analytics.db');

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
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
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
    
    const normalizedStatus = status === 'success' ? 'sent' : (status === 'error' ? 'error' : 'queued');
    
    db.run(`
        INSERT INTO messages (timestamp, session, phone_number, message_preview, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [
        getColombiaTimestamp(), // Usar hora Colombia GMT-5
        session || 'unknown',
        phoneNumber || 'unknown',
        (message || '').substring(0, 100),
        normalizedStatus,
        errorMessage
    ]);
    
    saveDatabase();
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
    
    // Estadísticas de la BD
    const dbStats = getDbStats();
    
    return {
        timeline,
        top_numbers: topNumbers,
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

module.exports = {
    initDatabase,
    logMessage,
    getAnalytics,
    getDbStats,
    close
};
