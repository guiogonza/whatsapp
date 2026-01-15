#!/usr/bin/env node
/**
 * Script de migración de SQLite a PostgreSQL
 * Migra todos los datos sin pérdida de información
 */

const initSqlJs = require('sql.js');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SQLITE_DB_PATH = path.join(__dirname, 'data', 'analytics.db');

// Configuración PostgreSQL
const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'whatsapp_analytics',
    user: process.env.POSTGRES_USER || 'whatsapp',
    password: process.env.POSTGRES_PASSWORD || 'whatsapp_secure_2026',
});

async function migrate() {
    console.log('🔄 Iniciando migración de SQLite a PostgreSQL...\n');

    try {
        // 1. Verificar que existe la BD SQLite
        if (!fs.existsSync(SQLITE_DB_PATH)) {
            console.log('⚠️  No se encontró base de datos SQLite en:', SQLITE_DB_PATH);
            console.log('✅ Se creará una nueva base de datos PostgreSQL vacía');
            await pool.end();
            return;
        }

        console.log('📂 Leyendo SQLite desde:', SQLITE_DB_PATH);
        const buffer = fs.readFileSync(SQLITE_DB_PATH);
        
        const SQL = await initSqlJs();
        const db = new SQL.Database(buffer);

        // 2. Conectar a PostgreSQL
        console.log('🔌 Conectando a PostgreSQL...');
        const client = await pool.connect();
        console.log('✅ Conectado a PostgreSQL\n');

        // 3. Migrar tabla messages
        console.log('📊 Migrando tabla "messages"...');
        const messagesResult = db.exec('SELECT * FROM messages ORDER BY id');
        
        if (messagesResult.length > 0) {
            const columns = messagesResult[0].columns;
            const values = messagesResult[0].values;
            
            let migrated = 0;
            let errors = 0;

            for (const row of values) {
                try {
                    const rowData = {};
                    columns.forEach((col, idx) => {
                        rowData[col] = row[idx];
                    });

                    await client.query(
                        `INSERT INTO messages (timestamp, session, phone_number, message_preview, char_count, status, error_message, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                         ON CONFLICT DO NOTHING`,
                        [
                            rowData.timestamp || new Date().toISOString(),
                            rowData.session || 'unknown',
                            rowData.phone_number || '',
                            rowData.message_preview || null,
                            rowData.char_count || 0,
                            rowData.status || 'queued',
                            rowData.error_message || null,
                            rowData.created_at || new Date().toISOString()
                        ]
                    );
                    migrated++;
                    
                    if (migrated % 50 === 0) {
                        process.stdout.write(`\r  ✓ ${migrated} registros migrados...`);
                    }
                } catch (error) {
                    errors++;
                    console.error(`\n  ❌ Error en registro:`, error.message);
                }
            }
            
            console.log(`\n  ✅ ${migrated} registros migrados exitosamente`);
            if (errors > 0) {
                console.log(`  ⚠️  ${errors} registros con errores`);
            }
        } else {
            console.log('  ℹ️  No hay datos en la tabla messages');
        }

        // 4. Migrar tabla outgoing_queue
        console.log('\n📊 Migrando tabla "outgoing_queue"...');
        const queueResult = db.exec('SELECT * FROM outgoing_queue ORDER BY id');
        
        if (queueResult.length > 0) {
            const columns = queueResult[0].columns;
            const values = queueResult[0].values;
            
            let migrated = 0;
            let errors = 0;

            for (const row of values) {
                try {
                    const rowData = {};
                    columns.forEach((col, idx) => {
                        rowData[col] = row[idx];
                    });

                    await client.query(
                        `INSERT INTO outgoing_queue (phone_number, message, char_count, arrived_at, sent_at, tries, last_error, send_type)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                         ON CONFLICT DO NOTHING`,
                        [
                            rowData.phone_number || '',
                            rowData.message || '',
                            rowData.char_count || 0,
                            rowData.arrived_at || new Date().toISOString(),
                            rowData.sent_at || null,
                            rowData.tries || 0,
                            rowData.last_error || null,
                            rowData.send_type || 'auto'
                        ]
                    );
                    migrated++;
                    
                    if (migrated % 50 === 0) {
                        process.stdout.write(`\r  ✓ ${migrated} registros migrados...`);
                    }
                } catch (error) {
                    errors++;
                    console.error(`\n  ❌ Error en registro:`, error.message);
                }
            }
            
            console.log(`\n  ✅ ${migrated} registros migrados exitosamente`);
            if (errors > 0) {
                console.log(`  ⚠️  ${errors} registros con errores`);
            }
        } else {
            console.log('  ℹ️  No hay datos en la tabla outgoing_queue');
        }

        // 5. Verificar migración
        console.log('\n📋 Verificando migración...');
        const messagesCount = await client.query('SELECT COUNT(*) as count FROM messages');
        const queueCount = await client.query('SELECT COUNT(*) as count FROM outgoing_queue');
        
        console.log(`  📊 messages: ${messagesCount.rows[0].count} registros`);
        console.log(`  📊 outgoing_queue: ${queueCount.rows[0].count} registros`);

        // 6. Crear backup de SQLite
        const backupPath = SQLITE_DB_PATH + '.pre-postgres-backup';
        fs.copyFileSync(SQLITE_DB_PATH, backupPath);
        console.log(`\n💾 Backup de SQLite creado en: ${backupPath}`);

        client.release();
        await pool.end();
        
        console.log('\n✅ ¡Migración completada exitosamente!');
        console.log('🔄 Ahora puedes iniciar el servidor con PostgreSQL\n');

    } catch (error) {
        console.error('\n❌ Error durante la migración:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Ejecutar migración si se llama directamente
if (require.main === module) {
    migrate();
}

module.exports = { migrate };
