/**
 * Script para limpiar registros queued y actualizarlos a sent
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'analytics.db');

async function fix() {
    const SQL = await initSqlJs();
    
    if (!fs.existsSync(DB_PATH)) {
        console.log('BD no encontrada:', DB_PATH);
        return;
    }
    
    const buffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buffer);
    
    // Contar antes
    const beforeRes = db.exec("SELECT status, COUNT(*) as cnt FROM messages GROUP BY status");
    console.log('Antes:', beforeRes[0]?.values || []);
    
    // Actualizar queued a sent
    db.run("UPDATE messages SET status = 'sent' WHERE status = 'queued'");
    console.log('Actualizado: queued -> sent');
    
    // Limpiar cola persistente si existe
    try {
        db.run("DELETE FROM outgoing_queue");
        console.log('Cola outgoing_queue limpiada');
    } catch (e) {
        console.log('Tabla outgoing_queue no existe aún');
    }
    
    // Contar después
    const afterRes = db.exec("SELECT status, COUNT(*) as cnt FROM messages GROUP BY status");
    console.log('Después:', afterRes[0]?.values || []);
    
    // Guardar
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    console.log('BD guardada');
    
    db.close();
}

fix().catch(console.error);
