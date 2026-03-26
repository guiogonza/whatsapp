/**
 * Controller de Analytics
 * Maneja las estadísticas y analíticas de mensajes
 */

const database = require('../database-postgres');

/**
 * GET /api/analytics/messages
 * Obtener estadísticas de mensajes por período
 */
async function getMessages(req, res) {
    try {
        const { start_date, end_date, top = 10, limit = 50, session } = req.query;
        
        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                error: 'Se requieren start_date y end_date'
            });
        }

        // Timeline: mensajes agrupados por día
        let timelineQuery = `
            SELECT 
                DATE(timestamp) as periodo,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'SUCCESS' OR status = 'SENT' THEN 1 ELSE 0 END) as enviados,
                SUM(CASE WHEN status = 'ERROR' OR status = 'FAILED' THEN 1 ELSE 0 END) as errores,
                SUM(CASE WHEN status = 'PENDING' OR status = 'QUEUED' THEN 1 ELSE 0 END) as en_cola
            FROM messages_sent
            WHERE timestamp >= $1 AND timestamp <= $2
        `;
        
        const timelineParams = [start_date, end_date + ' 23:59:59'];
        
        if (session) {
            timelineQuery += ` AND session_name = $3`;
            timelineParams.push(session);
        }
        
        timelineQuery += ` GROUP BY DATE(timestamp) ORDER BY periodo`;
        
        const timelineResult = await database.query(timelineQuery, timelineParams);

        // Top números
        let topQuery = `
            SELECT 
                phone_number,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'SUCCESS' OR status = 'SENT' THEN 1 ELSE 0 END) as enviados,
                SUM(CASE WHEN status = 'ERROR' OR status = 'FAILED' THEN 1 ELSE 0 END) as errores,
                SUM(CASE WHEN status = 'PENDING' OR status = 'QUEUED' THEN 1 ELSE 0 END) as en_cola
            FROM messages_sent
            WHERE timestamp >= $1 AND timestamp <= $2
        `;
        
        const topParams = [start_date, end_date + ' 23:59:59'];
        
        if (session) {
            topQuery += ` AND session_name = $${topParams.length + 1}`;
            topParams.push(session);
        }
        
        topQuery += ` GROUP BY phone_number ORDER BY total DESC LIMIT $${topParams.length + 1}`;
        topParams.push(parseInt(top) || 10);
        
        const topResult = await database.query(topQuery, topParams);

        // Estadísticas de base de datos
        const dbSizeResult = await database.query(`
            SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `);
        
        const totalByStatusResult = await database.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM messages_sent
            WHERE timestamp >= $1 AND timestamp <= $2
            GROUP BY status
        `, [start_date, end_date + ' 23:59:59']);

        const totalByStatus = {};
        totalByStatusResult.rows.forEach(row => {
            totalByStatus[row.status] = parseInt(row.count);
        });

        res.json({
            success: true,
            timeline: timelineResult.rows.map(row => ({
                periodo: row.periodo,
                total: parseInt(row.total) || 0,
                enviados: parseInt(row.enviados) || 0,
                errores: parseInt(row.errores) || 0,
                en_cola: parseInt(row.en_cola) || 0
            })),
            top_numbers: topResult.rows.map(row => ({
                phone_number: row.phone_number,
                total: parseInt(row.total) || 0,
                enviados: parseInt(row.enviados) || 0,
                errores: parseInt(row.errores) || 0,
                en_cola: parseInt(row.en_cola) || 0
            })),
            db_stats: {
                db_size_mb: dbSizeResult.rows[0]?.size || '0',
                total_by_status: totalByStatus
            }
        });

    } catch (error) {
        console.error('Error en analytics/messages:', error);
        
        // Si las tablas no existen, devolver datos vacíos
        if (error.message && error.message.includes('does not exist')) {
            return res.json({
                success: true,
                timeline: [],
                top_numbers: [],
                db_stats: {
                    db_size_mb: '0',
                    total_by_status: {}
                }
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/analytics/sessions-monthly
 * Mensajes por sesión agrupados por mes (para gráfica anual)
 */
async function getSessionsMonthly(req, res) {
    try {
        const { year } = req.query;
        const targetYear = parseInt(year) || new Date().getFullYear();
        const startDate = `${targetYear}-01-01`;
        const endDate = `${targetYear}-12-31 23:59:59`;

        const result = await database.query(`
            SELECT 
                TO_CHAR(timestamp, 'YYYY-MM') as mes,
                session,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as enviados
            FROM messages
            WHERE timestamp >= $1 AND timestamp <= $2
            AND session IS NOT NULL AND session != '' AND session != 'consolidation'
            GROUP BY TO_CHAR(timestamp, 'YYYY-MM'), session
            ORDER BY mes, session
        `, [startDate, endDate]);

        res.json({
            success: true,
            year: targetYear,
            data: result.rows.map(row => ({
                mes: row.mes,
                session: row.session,
                total: parseInt(row.total) || 0,
                enviados: parseInt(row.enviados) || 0
            }))
        });
    } catch (error) {
        console.error('Error en analytics/sessions-monthly:', error);
        if (error.message && error.message.includes('does not exist')) {
            return res.json({ success: true, year: new Date().getFullYear(), data: [] });
        }
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * GET /api/analytics/export-sent
 * Mensajes enviados del período con paginación opcional.
 * Sin limit/offset → devuelve todos (hasta 50000) para Excel.
 * Con limit/offset → devuelve página para la tabla.
 */
async function getExportSent(req, res) {
    try {
        const { start_date, end_date, session, limit, offset } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                error: 'Se requieren start_date y end_date'
            });
        }

        const baseConditions = ['timestamp >= $1', 'timestamp <= $2',
            "(status ILIKE 'sent' OR status ILIKE 'success')"];
        const params = [`${start_date} 00:00:00`, `${end_date} 23:59:59`];

        if (session) {
            baseConditions.push(`session = $${params.length + 1}`);
            params.push(session);
        }

        const whereClause = `WHERE ${baseConditions.join(' AND ')}`;

        // Total count
        const countResult = await database.query(
            `SELECT COUNT(*) as total FROM messages ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].total) || 0;

        // Data con paginación opcional
        const pageLimit  = limit  ? Math.min(parseInt(limit),  50000) : 50000;
        const pageOffset = offset ? parseInt(offset) : 0;

        const dataParams = [...params, pageLimit, pageOffset];
        const dataResult = await database.query(
            `SELECT timestamp, phone_number, message_preview, char_count, session, status
             FROM messages
             ${whereClause}
             ORDER BY timestamp DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            dataParams
        );

        res.json({
            success: true,
            messages: dataResult.rows,
            total,
            limit: pageLimit,
            offset: pageOffset
        });
    } catch (error) {
        console.error('Error en analytics/export-sent:', error);
        if (error.message && error.message.includes('does not exist')) {
            return res.json({ success: true, messages: [], total: 0, limit: 50000, offset: 0 });
        }
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    getMessages,
    getSessionsMonthly,
    getExportSent
};
