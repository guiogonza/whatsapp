/**
 * Rutas para monitoreo de base de datos
 */

const express = require('express');
const router = express.Router();
const database = require('../database-postgres');

/**
 * GET /api/database/status
 * Obtener estado de la base de datos
 */
router.get('/status', async (req, res) => {
    try {
        // Test de conexión
        await database.query('SELECT 1');
        
        // Obtener versión
        const versionResult = await database.query('SELECT version()');
        const version = versionResult.rows[0].version;
        
        // Obtener nombre de la base de datos
        const dbResult = await database.query('SELECT current_database()');
        const dbName = dbResult.rows[0].current_database;
        
        // Obtener tamaño de la base de datos
        const sizeResult = await database.query(`
            SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `);
        const size = sizeResult.rows[0].size;
        
        // Estadísticas de mensajes
        const stats = {};
        
        // Total de mensajes  (de todas las tablas)
        try {
            const messagesResult = await database.query(`
                SELECT 
                    (SELECT COUNT(*) FROM messages_sent WHERE session_type = 'baileys') +
                    (SELECT COUNT(*) FROM gpswox_messaging) +
                    (SELECT COUNT(*) FROM fx_messages) as total
            `);
            stats.total_messages = parseInt(messagesResult.rows[0].total) || 0;
        } catch (err) {
            stats.total_messages = 0;
        }
        
        // Números únicos
        try {
            const phonesResult = await database.query(`
                SELECT COUNT(DISTINCT phone_number) as unique_phones 
                FROM messages_sent 
                WHERE phone_number IS NOT NULL
            `);
            stats.unique_phones = parseInt(phonesResult.rows[0].unique_phones) || 0;
        } catch (err) {
            stats.unique_phones = 0;
        }
        
        // Alertas GPSwox
        try {
            const gpswoxResult = await database.query(`
                SELECT COUNT(*) as count FROM gpswox_messaging
            `);
            stats.gpswox_alerts = parseInt(gpswoxResult.rows[0].count) || 0;
        } catch (err) {
            stats.gpswox_alerts = 0;
        }
        
        // Reenvíos FX
        try {
            const fxResult = await database.query(`
                SELECT COUNT(*) as count FROM fx_messages WHERE status = 'FORWARDED'
            `);
            stats.fx_forwards = parseInt(fxResult.rows[0].count) || 0;
        } catch (err) {
            stats.fx_forwards = 0;
        }
        
        res.json({
            success: true,
            connected: true,
            version,
            database: dbName,
            size,
            stats
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo estado de BD:', error);
        res.json({
            success: false,
            connected: false,
            error: error.message
        });
    }
});

module.exports = router;
