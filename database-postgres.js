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
                is_consolidated BOOLEAN DEFAULT FALSE,
                msg_count INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Agregar columna msg_count si no existe (para migraciones)
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'msg_count') THEN
                    ALTER TABLE messages ADD COLUMN msg_count INTEGER DEFAULT 1;
                END IF;
            END $$;
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

        // Tabla para mensajes recibidos via webhook (Cloud API)
        await client.query(`
            CREATE TABLE IF NOT EXISTS webhook_messages (
                id SERIAL PRIMARY KEY,
                message_id VARCHAR(200) UNIQUE,
                from_number VARCHAR(50) NOT NULL,
                from_name VARCHAR(200),
                message_type VARCHAR(50),
                text_content TEXT,
                media_id VARCHAR(200),
                timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
                phone_number_id VARCHAR(100),
                raw_data JSONB,
                processed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Índices para webhook_messages
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_webhook_from ON webhook_messages(from_number);
            CREATE INDEX IF NOT EXISTS idx_webhook_timestamp ON webhook_messages(timestamp DESC);
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
 * @param {boolean} isConsolidated - Si el mensaje es parte de un envío consolidado
 * @param {number} msgCount - Cantidad de mensajes individuales en el consolidado (para conteo)
 */
async function logMessage(session, phoneNumber, message, status, errorMessage = null, isConsolidated = false, msgCount = 1) {
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
            `INSERT INTO messages (timestamp, session, phone_number, message_preview, char_count, status, error_message, is_consolidated, msg_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [getColombiaTimestamp(), session, phoneNumber, messageText.substring(0, 500), charCount, finalStatus, errorMessage, isConsolidated, msgCount]
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
        return { success: false, error: 'Base de datos no conectada' };
    }

    const charCount = (message || '').length;
    
    try {
        const result = await pool.query(
            `INSERT INTO outgoing_queue (phone_number, message, char_count, arrived_at, send_type)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, arrived_at`,
            [phoneNumber, message, charCount, getColombiaTimestamp(), sendType]
        );
        
        // Obtener estadísticas de la cola
        const statsResult = await pool.query(`
            SELECT COUNT(*) as total, COUNT(DISTINCT phone_number) as pending_numbers
            FROM outgoing_queue WHERE sent_at IS NULL
        `);
        
        return { 
            success: true, 
            id: result.rows[0].id,
            charCount: charCount,
            arrivedAt: result.rows[0].arrived_at,
            total: parseInt(statsResult.rows[0].total) || 0,
            pendingNumbers: parseInt(statsResult.rows[0].pending_numbers) || 0
        };
    } catch (error) {
        console.error('❌ Error encolando mensaje:', error.message);
        return { success: false, error: error.message };
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
    if (!pool || !isConnected) return { timeline: [], top_numbers: [], sessions_stats: [], db_stats: {} };
    
    try {
        // Timeline por fecha - usar alias en español para compatibilidad
        const timelineResult = await pool.query(
            `SELECT 
                DATE(timestamp) as periodo,
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as enviados,
                COUNT(CASE WHEN status = 'error' THEN 1 END) as errores,
                COUNT(CASE WHEN status = 'queued' THEN 1 END) as en_cola
             FROM messages
             WHERE DATE(timestamp) BETWEEN $1 AND $2
             GROUP BY DATE(timestamp)
             ORDER BY periodo ASC`,
            [startDate, endDate]
        );

        // Top números - usar aliases compatibles
        const topResult = await pool.query(
            `SELECT 
                phone_number,
                COUNT(*) as total,
                COALESCE(SUM(char_count), 0) as total_chars,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as enviados,
                COUNT(CASE WHEN status = 'error' THEN 1 END) as errores,
                COUNT(CASE WHEN status = 'queued' THEN 1 END) as en_cola,
                MIN(timestamp) as first_message,
                MAX(timestamp) as last_message
             FROM messages
             WHERE DATE(timestamp) BETWEEN $1 AND $2
             GROUP BY phone_number
             ORDER BY total DESC
             LIMIT $3`,
            [startDate, endDate, topN]
        );

        // Estadísticas por sesión
        const sessionsResult = await pool.query(
            `SELECT 
                session,
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as enviados,
                COUNT(CASE WHEN status = 'error' THEN 1 END) as errores
             FROM messages
             WHERE DATE(timestamp) BETWEEN $1 AND $2
             GROUP BY session
             ORDER BY total DESC`,
            [startDate, endDate]
        );

        // Estadísticas generales
        const dbStats = await getStats();

        return {
            timeline: timelineResult.rows,
            top_numbers: topResult.rows,
            sessions_stats: sessionsResult.rows,
            db_stats: dbStats
        };
    } catch (error) {
        console.error('❌ Error obteniendo analytics:', error.message);
        return { timeline: [], top_numbers: [], sessions_stats: [], db_stats: {} };
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
        const uniquePhonesCount = await client.query('SELECT COUNT(DISTINCT phone_number) as count FROM messages');

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
                queue_pending: parseInt(pendingCount.rows[0].count),
                unique_phones: parseInt(uniquePhonesCount.rows[0].count)
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

/**
 * Obtener lista de números únicos a los que se han enviado mensajes
 */
async function getUniquePhoneNumbers() {
    if (!pool || !isConnected) return [];
    
    try {
        const result = await pool.query(`
            SELECT DISTINCT phone_number, 
                   COUNT(*) as message_count,
                   MAX(timestamp) as last_message
            FROM messages 
            GROUP BY phone_number 
            ORDER BY message_count DESC, last_message DESC
            LIMIT 500
        `);
        return result.rows;
    } catch (error) {
        console.error('❌ Error obteniendo números únicos:', error.message);
        return [];
    }
}

/**
 * Obtener lista de sesiones únicas para filtrado
 */
async function getUniqueSessions() {
    if (!pool || !isConnected) return [];
    
    try {
        const result = await pool.query(`
            SELECT DISTINCT session, 
                   COUNT(*) as message_count,
                   MAX(timestamp) as last_message
            FROM messages 
            WHERE session IS NOT NULL AND session != ''
            GROUP BY session 
            ORDER BY message_count DESC, last_message DESC
        `);
        return result.rows;
    } catch (error) {
        console.error('❌ Error obteniendo sesiones únicas:', error.message);
        return [];
    }
}

/**
 * Obtener mensajes filtrados por número y rango de fechas
 */
async function getMessagesByFilter(options = {}) {
    if (!pool || !isConnected) return { messages: [], total: 0 };
    
    const { phoneNumber, session, startDate, endDate, limit = 50, offset = 0 } = options;
    
    let conditions = [];
    let params = [];
    let paramCount = 0;
    
    if (phoneNumber) {
        paramCount++;
        conditions.push(`phone_number = $${paramCount}`);
        params.push(phoneNumber);
    }
    if (session) {
        paramCount++;
        conditions.push(`session = $${paramCount}`);
        params.push(session);
    }
    if (startDate) {
        paramCount++;
        conditions.push(`timestamp >= $${paramCount}`);
        params.push(`${startDate}T00:00:00`);
    }
    if (endDate) {
        paramCount++;
        conditions.push(`timestamp <= $${paramCount}`);
        params.push(`${endDate}T23:59:59`);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    try {
        // Obtener total
        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM messages ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].total);
        
        // Obtener mensajes paginados
        const messagesResult = await pool.query(
            `SELECT id, timestamp, session, phone_number, message_preview, char_count, status, error_message
             FROM messages 
             ${whereClause}
             ORDER BY timestamp DESC
             LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
            [...params, limit, offset]
        );
        
        return {
            messages: messagesResult.rows,
            total,
            limit,
            offset
        };
    } catch (error) {
        console.error('❌ Error obteniendo mensajes filtrados:', error.message);
        return { messages: [], total: 0, limit, offset };
    }
}

/**
 * Obtener conteo de mensajes enviados hoy por sesión
 */
async function getTodayMessagesBySession() {
    if (!pool || !isConnected) return {};
    
    try {
        // Obtener fecha de hoy en zona horaria Colombia
        const todayStart = getColombiaTimestamp().split('T')[0] + 'T00:00:00';
        const todayEnd = getColombiaTimestamp().split('T')[0] + 'T23:59:59';
        
        const result = await pool.query(`
            SELECT session, COUNT(*) as count
            FROM messages 
            WHERE status = 'sent' 
            AND timestamp >= $1 
            AND timestamp <= $2
            GROUP BY session
        `, [todayStart, todayEnd]);
        
        const sessionCounts = {};
        result.rows.forEach(row => {
            sessionCounts[row.session] = parseInt(row.count);
        });
        
        return sessionCounts;
    } catch (error) {
        console.error('❌ Error obteniendo mensajes de hoy por sesión:', error.message);
        return {};
    }
}

/**
 * Estadísticas de la cola (solo mensajes pendientes - sin enviar)
 */
async function getQueueStats() {
    if (!pool || !isConnected) return { total: 0, pendingNumbers: 0, totalChars: 0, sentToday: 0 };
    
    try {
        // Total y caracteres de mensajes pendientes
        const totalResult = await pool.query(
            `SELECT COUNT(*) as total, COALESCE(SUM(char_count), 0) as chars 
             FROM outgoing_queue WHERE sent_at IS NULL`
        );
        
        // Números únicos pendientes
        const numbersResult = await pool.query(
            `SELECT COUNT(DISTINCT phone_number) as cnt FROM outgoing_queue WHERE sent_at IS NULL`
        );
        
        // Mensajes enviados hoy
        const today = getColombiaTimestamp().split('T')[0];
        const sentTodayResult = await pool.query(
            `SELECT COUNT(*) as cnt FROM outgoing_queue 
             WHERE sent_at IS NOT NULL AND sent_at::text LIKE $1`,
            [today + '%']
        );
        
        return {
            total: parseInt(totalResult.rows[0].total),
            pendingNumbers: parseInt(numbersResult.rows[0].cnt),
            totalChars: parseInt(totalResult.rows[0].chars),
            sentToday: parseInt(sentTodayResult.rows[0].cnt)
        };
    } catch (error) {
        console.error('❌ Error obteniendo estadísticas de cola:', error.message);
        return { total: 0, pendingNumbers: 0, totalChars: 0, sentToday: 0 };
    }
}

/**
 * Obtener números encolados únicos
 */
async function getQueuedNumbers() {
    if (!pool || !isConnected) return [];
    
    try {
        const result = await pool.query(`
            SELECT phone_number, COUNT(*) as message_count, SUM(char_count) as total_chars
            FROM outgoing_queue 
            WHERE sent_at IS NULL
            GROUP BY phone_number
            ORDER BY message_count DESC
        `);
        return result.rows;
    } catch (error) {
        console.error('❌ Error obteniendo números en cola:', error.message);
        return [];
    }
}

/**
 * Obtener mensajes para un número específico
 */
async function getMessagesForNumber(phoneNumber) {
    if (!pool || !isConnected) return [];
    
    try {
        const result = await pool.query(
            `SELECT * FROM outgoing_queue 
             WHERE phone_number = $1 AND sent_at IS NULL
             ORDER BY arrived_at ASC`,
            [phoneNumber]
        );
        return result.rows;
    } catch (error) {
        console.error('❌ Error obteniendo mensajes para número:', error.message);
        return [];
    }
}

/**
 * Marcar mensajes como enviados
 */
async function markMessagesSent(messageIds, sendType = 'auto') {
    if (!pool || !isConnected || !messageIds || messageIds.length === 0) return;
    
    try {
        const timestamp = getColombiaTimestamp();
        await pool.query(
            `UPDATE outgoing_queue 
             SET sent_at = $1, send_type = $2
             WHERE id = ANY($3)`,
            [timestamp, sendType, messageIds]
        );
    } catch (error) {
        console.error('❌ Error marcando mensajes como enviados:', error.message);
    }
}

/**
 * Marcar todos los pendientes como enviados
 */
async function markAllPendingAsSent() {
    if (!pool || !isConnected) return 0;
    
    try {
        const result = await pool.query(
            `UPDATE outgoing_queue 
             SET sent_at = $1 
             WHERE sent_at IS NULL
             RETURNING id`,
            [getColombiaTimestamp()]
        );
        return result.rowCount;
    } catch (error) {
        console.error('❌ Error marcando todos como enviados:', error.message);
        return 0;
    }
}

/**
 * Limpiar cola para un número
 */
async function clearQueueForNumber(phoneNumber) {
    if (!pool || !isConnected) return 0;
    
    try {
        const result = await pool.query(
            `DELETE FROM outgoing_queue WHERE phone_number = $1 AND sent_at IS NULL`,
            [phoneNumber]
        );
        return result.rowCount;
    } catch (error) {
        console.error('❌ Error limpiando cola:', error.message);
        return 0;
    }
}

/**
 * Obtener mensajes encolados con paginación
 */
async function getQueuedMessages(limit = 50, status = 'pending') {
    if (!pool || !isConnected) return [];
    
    try {
        let query;
        if (status === 'pending') {
            query = `SELECT * FROM outgoing_queue 
                     WHERE sent_at IS NULL 
                     ORDER BY arrived_at ASC 
                     LIMIT $1`;
        } else if (status === 'sent') {
            query = `SELECT * FROM outgoing_queue 
                     WHERE sent_at IS NOT NULL 
                     ORDER BY sent_at DESC 
                     LIMIT $1`;
        } else {
            query = `SELECT * FROM outgoing_queue 
                     ORDER BY arrived_at DESC 
                     LIMIT $1`;
        }
        
        const result = await pool.query(query, [limit]);
        return result.rows;
    } catch (error) {
        console.error('❌ Error obteniendo mensajes encolados:', error.message);
        return [];
    }
}

/**
 * Obtener estadísticas por sesión desde la BD
 * Devuelve contadores de mensajes enviados, recibidos y consolidados por sesión (solo día actual)
 */
async function getSessionStats() {
    if (!pool || !isConnected) return {};
    
    try {
        // Obtener contadores por sesión del día actual (hora Colombia)
        // - sent_count: suma de msg_count (total de mensajes individuales enviados)
        // - received_count: mensajes recibidos
        // - consolidated_count: cantidad de operaciones de envío (filas con status='sent')
        const result = await pool.query(`
            SELECT 
                session,
                COALESCE(SUM(CASE WHEN status = 'sent' THEN COALESCE(msg_count, 1) END), 0) as sent_count,
                COUNT(CASE WHEN status = 'received' THEN 1 END) as received_count,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as consolidated_count
            FROM messages
            WHERE session NOT IN ('consolidation', 'queue')
              AND DATE(timestamp AT TIME ZONE 'America/Bogota') = DATE(NOW() AT TIME ZONE 'America/Bogota')
            GROUP BY session
        `);
        
        const stats = {};
        result.rows.forEach(row => {
            stats[row.session] = {
                sentCount: parseInt(row.sent_count) || 0,
                receivedCount: parseInt(row.received_count) || 0,
                consolidatedCount: parseInt(row.consolidated_count) || 0
            };
        });
        
        return stats;
    } catch (error) {
        console.error('❌ Error obteniendo estadísticas por sesión:', error.message);
        return {};
    }
}

/**
 * Ejecutar query SQL directa (para uso avanzado)
 */
async function query(sql, params = []) {
    if (!pool || !isConnected) {
        throw new Error('Base de datos no conectada');
    }
    return await pool.query(sql, params);
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
    getColombiaTimestamp,
    query,
    // Nuevas funciones para compatibilidad con monitor
    getUniquePhoneNumbers,
    getUniqueSessions,
    getMessagesByFilter,
    getTodayMessagesBySession,
    getQueueStats,
    getQueuedNumbers,
    getMessagesForNumber,
    markMessagesSent,
    markAllPendingAsSent,
    clearQueueForNumber,
    getQueuedMessages,
    getSessionStats,
    // Aliases para compatibilidad
    init: initDatabase,
    close: closeDatabase,
    getDbStats: getStats
};
