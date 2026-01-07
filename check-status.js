const fs = require('fs');
async function main() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const data = fs.readFileSync('/app/data/analytics.db');
    const db = new SQL.Database(data);
    
    console.log('=== Muestra de timestamps ===');
    const r = db.exec("SELECT timestamp FROM messages ORDER BY id DESC LIMIT 3");
    if (r[0]) {
        r[0].values.forEach(v => console.log(v[0]));
    }
    
    console.log('\n=== Prueba filtro 2026-01-06 a 2026-01-07 ===');
    const r2 = db.exec("SELECT COUNT(*) FROM messages WHERE timestamp >= '2026-01-06T00:00:00' AND timestamp <= '2026-01-07T23:59:59'");
    if (r2[0]) {
        console.log('Encontrados:', r2[0].values[0][0]);
    }
    
    console.log('\n=== Prueba sin filtro ===');
    const r3 = db.exec("SELECT COUNT(*) FROM messages");
    if (r3[0]) {
        console.log('Total:', r3[0].values[0][0]);
    }
}
main();
