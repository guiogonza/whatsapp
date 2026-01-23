const { Pool } = require('pg');

async function main() {
    const pool = new Pool({
        host: process.env.POSTGRES_HOST || 'wpp-postgres',
        port: process.env.POSTGRES_PORT || 5432,
        database: process.env.POSTGRES_DB || 'whatsapp_analytics',
        user: process.env.POSTGRES_USER || 'whatsapp',
        password: process.env.POSTGRES_PASSWORD || 'whatsapp_secure_2024'
    });
    
    try {
        console.log('=== Muestra de timestamps ===');
        const r = await pool.query("SELECT timestamp FROM messages ORDER BY id DESC LIMIT 3");
        r.rows.forEach(row => console.log(row.timestamp));
        
        console.log('\n=== Estadísticas generales ===');
        const r2 = await pool.query("SELECT status, COUNT(*) as total FROM messages GROUP BY status");
        r2.rows.forEach(row => console.log(`${row.status}: ${row.total}`));
        
        console.log('\n=== Total de mensajes ===');
        const r3 = await pool.query("SELECT COUNT(*) as total FROM messages");
        console.log('Total:', r3.rows[0].total);
        
        console.log('\n=== Rango de fechas ===');
        const r4 = await pool.query("SELECT MIN(created_at) as primero, MAX(created_at) as ultimo FROM messages");
        console.log('Primer mensaje:', r4.rows[0].primero);
        console.log('Último mensaje:', r4.rows[0].ultimo);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}
main();
