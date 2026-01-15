/**
 * Módulo de Base de Datos PostgreSQL para Analytics
 * Reemplazo de sql.js con PostgreSQL para mayor robustez y rendimiento
 */

const { Pool } = require('pg');
const config = require('./config');

let pool = null;
let isConnected = false;

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
 * Inicializar conexión a PostgreSQL
 */
async function initDatabase() {
    try {
        pool = new Pool({
            host: config.POSTGRES_HOST,
            port: config.POSTGRES_PORT,
            database: config.POSTGRES_DB,
            user: config.POSTGRES_USER,
            password: config.POSTGRES_PASSWORD,
            max: 20, // máximo de conexiones en el pool
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });

        // Probar conexión
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        
        isConnected = true;
        console.log(`✅ PostgreSQL conectado: ${config.POSTGRES_HOST}:${config.POSTGRES_PORT}/${config.POSTGRES_DB}`);
        console.log(`⏰ Hora del servidor: ${result.rows[0].now}`);

        // Crear tablas si no existen
        await createTables();
        
        return pool;
    } catch (error) {
        isConnected = false;
        console.error('❌ Error conectando a PostgreSQL:', error.message);
        throw error;
    }
}

/**
 * Crear tablas si no existen
 */
async function createTables() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Tabla de mensajes
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
                session VARCHAR(100) NOT NULL,
                phone_number VARCHAR(50) NOT NULL,
                message_preview TEXT,
                char_count INTEGER DEFAULT 0,
                status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'error', 'queued', 'received')),
                error_message TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Índices para mensajes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number);
            CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session);
            CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(DATE(timestamp));
        `);

        // Tabla de cola de mensajes salientes
        await client.query(`
            CREATE TABLE IF NOT EXISTS outgoing_queue (
                id SERIAL PRIMARY KEY,
                phone_number VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                char_count INTEGER DEFAULT 0,
                arrived_at TIMESTAMP NOT NULL DEFAULT NOW(),
                sent_at TIMESTAMP,
                tries INTEGER DEFAULT 0,
                last_error TEXT,
                send_type VARCHAR(20) DEFAULT 'auto'
            )
        `);

        // Índices para cola
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_queue_pending ON outgoing_queue(sent_at, phone_number) WHERE sent_at IS NULL;
            CREATE INDEX IF NOT EXISTS idx_queue_phone ON outgoing_queue(phone_number);
        `);

        await client.query('COMMIT');
        console.log('✅ Tablas de PostgreSQL creadas/verificadas');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error creando tablas:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Registrar un mensaje enviado
 */
async function logMessage(session, phoneNumber, message, status, errorMessage = null) {
    if (!pool || !isConnected) {
        console.error('❌ Base de datos no conectada');
        return;
    }

    // Validar y normalizar status
    let finalStatus = (status || '').toLowerCase();
    const allowed = ['sent', 'error', 'queued', 'received'];
    if (finalStatus === 'success') finalStatus = 'sent';
    if (!allowed.includes(finalStatus)) finalStatus = 'queued';

    // Calcular caracteres
    const messageText = message || '';
    const charCount = messageText.length;

    try {
        await pool.query(
            `INSERT INTO messages (timestamp, session, phone_number, message_preview, char_count, status, error_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [getColombiaTimestamp(), session, phoneNumber, messageText.substring(0, 500), charCount, finalStatus, errorMessage]
        );
    } catch (error) {
        console.error('❌ Error registrando mensaje:', error.message);
    }
}

/**
 * Agregar mensaje a la cola
 */
async function enqueueMessage(phoneNumber, message, sendType = 'auto') {
    if (!pool || !isConnected) {
        console.error('❌ Base de datos no conectada');
        return null;
    }

    const charCount = (message || '').length;
    
    try {
        const result = await pool.query(
            `INSERT INTO outgoing_queue (phone_number, message, char_count, arrived_at, send_type)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [phoneNumber, message, charCount, getColombiaTimestamp(), sendType]
        );
        return result.rows[0].id;
    } catch (error) {
        console.error('❌ Error encolando mensaje:', error.message);
        return null;
    }
}

/**
 * Marcar mensaje como enviado
 */
async function markAsSent(queueId) {
    if (!pool || !isConnected) return;
    
    try {
        await pool.query(
            `UPDATE outgoing_queue SET sent_at = $1 WHERE id = $2`,
            [getColombiaTimestamp(), queueId]
        );
    } catch (error) {
        console.error('❌ Error marcando mensaje como enviado:', error.message);
    }
}

/**
 * Registrar intento fallido
 */
async function recordFailedAttempt(queueId, errorMsg) {
    if (!pool || !isConnected) return;
    
    try {
        await pool.query(
            `UPDATE outgoing_queue SET tries = tries + 1, last_error = $1 WHERE id = $2`,
            [errorMsg, queueId]
        );
    } catch (error) {
        console.error('❌ Error registrando intento fallido:', error.message);
    }
}

/**
 * Obtener mensajes pendientes
 */
async function getPendingMessages(limit = 100) {
    if (!pool || !isConnected) return [];
    
    try {
        const result = await pool.query(
            `SELECT * FROM outgoing_queue 
             WHERE sent_at IS NULL 
             ORDER BY arrived_at ASC 
             LIMIT $1`,
            [limit]
        );
        return result.rows;
    } catch (error) {
        console.error('❌ Error obteniendo mensajes pendientes:', error.message);
        return [];
    }
}

/**
 * Obtener analytics (función adaptadora para compatibilidad con frontend)
 */
async function getAnalytics(options = {}) {
    const { period = 'day', range = 'today', top = 10, startDate, endDate } = options;
    
    let start, end;
    const now = new Date();
    
    // Calcular fechas según el rango
    if (period === 'custom' && startDate && endDate) {
        start = startDate;
        end = endDate;
    } else {
        switch (range) {
            case 'today':
                start = end = now.toISOString().split('T')[0];
                break;
            case 'week':
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                start = weekAgo.toISOString().split('T')[0];
                end = now.toISOString().split('T')[0];
                break;
            case 'month':
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                start = monthAgo.toISOString().split('T')[0];
                end = now.toISOString().split('T')[0];
                break;
            default:
                start = end = now.toISOString().split('T')[0];
        }
    }
    
    return await getAnalyticsByDateRange(start, end, top);
}

/**
 * Obtener estadísticas generales
 */
async function getStats() {
    if (!pool || !isConnected) return {};
    
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
                COUNT(CASE WHEN status = 'error' THEN 1 END) as failed,
                COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued
            FROM messages
        `);
        
        return result.rows[0];
    } catch (error) {
        console.error('❌ Error obteniendo estadísticas:', error.message);
        return {};
    }
}

/**
 * Obtener estadísticas de analytics por rango de fechas
 */
async function getAnalyticsByDateRange(startDate, endDate, topN = 10) {
    if (!pool || !isConnected) return { timeline: [], top: [] };
    
    try {
        // Timeline por fecha
        const timelineResult = await pool.query(
            `SELECT 
                DATE(timestamp) as date,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
                COUNT(CASE WHEN status = 'error' THEN 1 END) as failed,
                COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued
             FROM messages
             WHERE DATE(timestamp) BETWEEN $1 AND $2
             GROUP BY DATE(timestamp)
             ORDER BY date ASC`,
            [startDate, endDate]
        );

        // Top números
        const topResult = await pool.query(
            `SELECT 
                phone_number,
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
                COUNT(CASE WHEN status = 'error' THEN 1 END) as failed,
                SUM(char_count) as total_chars,
                MIN(timestamp) as first_message,
                MAX(timestamp) as last_message
             FROM messages
             WHERE DATE(timestamp) BETWEEN $1 AND $2
             GROUP BY phone_number
             ORDER BY total DESC
             LIMIT $3`,
            [startDate, endDate, topN]
        );

        return {
            timeline: timelineResult.rows,
            top: topResult.rows
        };
    } catch (error) {
        console.error('❌ Error obteniendo analytics:', error.message);
        return { timeline: [], top: [] };
    }
}

/**
 * Obtener mensajes de un número específico
 */
async function getMessagesByPhone(phoneNumber, limit = 50, offset = 0) {
    if (!pool || !isConnected) return { messages: [], total: 0 };
    
    try {
        // Total de mensajes
        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM messages WHERE phone_number = $1`,
            [phoneNumber]
        );

        // Mensajes paginados
        const messagesResult = await pool.query(
            `SELECT * FROM messages 
             WHERE phone_number = $1 
             ORDER BY timestamp DESC 
             LIMIT $2 OFFSET $3`,
            [phoneNumber, limit, offset]
        );

        return {
            messages: messagesResult.rows,
            total: parseInt(countResult.rows[0].total)
        };
    } catch (error) {
        console.error('❌ Error obteniendo mensajes por teléfono:', error.message);
        return { messages: [], total: 0 };
    }
}

/**
 * Obtener estado de la base de datos
 */
async function getDatabaseStatus() {
    if (!pool) {
        return {
            connected: false,
            error: 'Pool no inicializado'
        };
    }

    try {
        const client = await pool.connect();
        
        // Información de conexión
        const versionResult = await client.query('SELECT version()');
        const sizeResult = await client.query(`
            SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `);
        
        // Información de tablas
        const tablesResult = await client.query(`
            SELECT 
                c.relname as tablename,
                pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
                n_live_tup as row_count
            FROM pg_class c
            LEFT JOIN pg_stat_user_tables s ON c.relname = s.relname
            WHERE c.relkind = 'r' 
            AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            ORDER BY pg_total_relation_size(c.oid) DESC
        `);

        // Contar registros en messages y outgoing_queue
        const messagesCount = await client.query('SELECT COUNT(*) as count FROM messages');
        const queueCount = await client.query('SELECT COUNT(*) as count FROM outgoing_queue');
        const pendingCount = await client.query('SELECT COUNT(*) as count FROM outgoing_queue WHERE sent_at IS NULL');

        client.release();

        return {
            connected: true,
            version: versionResult.rows[0].version,
            database: config.POSTGRES_DB,
            size: sizeResult.rows[0].size,
            tables: tablesResult.rows,
            stats: {
                total_messages: parseInt(messagesCount.rows[0].count),
                queue_total: parseInt(queueCount.rows[0].count),
                queue_pending: parseInt(pendingCount.rows[0].count)
            }
        };
    } catch (error) {
        return {
            connected: false,
            error: error.message
        };
    }
}

/**
 * Cerrar conexión (para shutdown graceful)
 */
async function closeDatabase() {
    if (pool) {
        await pool.end();
        isConnected = false;
        console.log('✅ Conexión a PostgreSQL cerrada');
    }
}

// Exportar funciones
module.exports = {
    initDatabase,
    logMessage,
    enqueueMessage,
    markAsSent,
    recordFailedAttempt,
    getPendingMessages,
    getAnalytics,
    getStats,
    getAnalyticsByDateRange,
    getMessagesByPhone,
    getDatabaseStatus,
    closeDatabase,
    getColombiaTimestamp
};
