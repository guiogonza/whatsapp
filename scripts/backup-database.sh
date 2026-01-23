#!/bin/bash
# Script de backup automático de PostgreSQL
# Crea backups incrementales con timestamp y limpia backups antiguos

BACKUP_DIR="/opt/whatsapp-bot/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/postgres_$TIMESTAMP.sql"

# Configuración PostgreSQL
PG_CONTAINER="wpp-postgres"
PG_USER="whatsapp"
PG_DB="whatsapp_analytics"

# Crear directorio de backups si no existe
mkdir -p "$BACKUP_DIR"

# Verificar que el contenedor de PostgreSQL está corriendo
if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
    echo "❌ Error: Contenedor PostgreSQL ($PG_CONTAINER) no está corriendo"
    exit 1
fi

# Crear backup con pg_dump
docker exec $PG_CONTAINER pg_dump -U $PG_USER $PG_DB > "$BACKUP_FILE"

if [ $? -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
    echo "✅ Backup creado: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
    
    # Comprimir backup
    gzip "$BACKUP_FILE"
    echo "📦 Backup comprimido: ${BACKUP_FILE}.gz"
    BACKUP_FILE="${BACKUP_FILE}.gz"
    
    # Mantener solo los últimos 30 backups
    cd "$BACKUP_DIR" && ls -t postgres_*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm
    echo "🧹 Limpieza completada. Backups actuales: $(ls -1 postgres_*.sql.gz 2>/dev/null | wc -l)"
else
    echo "❌ Error creando backup"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Mostrar estadísticas del backup
RECORD_COUNT=$(docker exec $PG_CONTAINER psql -U $PG_USER -d $PG_DB -t -c "SELECT COUNT(*) FROM messages" 2>/dev/null | tr -d ' ')
if [ ! -z "$RECORD_COUNT" ]; then
    echo "📊 Registros en BD: $RECORD_COUNT"
fi

exit 0
