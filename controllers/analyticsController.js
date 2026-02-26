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

module.exports = {
    getMessages
};
