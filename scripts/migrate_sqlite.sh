#!/bin/bash
DB="/root/riobot/data/analytics.db"

echo "=== Exportando SQLite ==="
# Exportar solo columnas simples 
sqlite3 "$DB" "SELECT id || '|' || timestamp || '|' || session || '|' || phone_number || '|' || COALESCE(char_count,0) || '|' || status || '|' || created_at FROM messages;" > /tmp/sqlite_simple.csv

echo "Exported $(wc -l < /tmp/sqlite_simple.csv) rows"

# Copiar archivo al contenedor
docker cp /tmp/sqlite_simple.csv wpp-postgres:/tmp/

echo "=== Importando a PostgreSQL ==="
# Ejecutar todo en una sola sesión psql
docker exec wpp-postgres psql -U whatsapp -d whatsapp_analytics << 'EOSQL'
-- Crear tabla temporal
CREATE TEMP TABLE temp_import (
    id INTEGER,
    ts TEXT,
    sess TEXT,
    phone TEXT,
    charcount INTEGER,
    stat TEXT,
    createdat TEXT
);

-- Importar datos
\copy temp_import FROM '/tmp/sqlite_simple.csv' WITH (FORMAT csv, DELIMITER '|');

-- Contar importados
SELECT COUNT(*) as registros_importados FROM temp_import;

-- Insertar evitando duplicados
INSERT INTO messages (timestamp, session, phone_number, char_count, status, is_consolidated, msg_count, created_at)
SELECT 
    replace(ts,'T',' ')::timestamp,
    sess,
    phone,
    charcount,
    stat,
    false,
    1,
    createdat::timestamp
FROM temp_import ti
WHERE NOT EXISTS (
    SELECT 1 FROM messages m 
    WHERE m.timestamp = replace(ti.ts,'T',' ')::timestamp
    AND m.phone_number = ti.phone
);

-- Total final
SELECT COUNT(*) as total_mensajes FROM messages;
EOSQL

echo "=== Migracion completada ==="
