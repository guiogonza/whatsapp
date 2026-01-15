#!/bin/bash
# Script de backup automático de la base de datos de analytics
# Crea backups incrementales con timestamp y limpia backups antiguos

BACKUP_DIR="/opt/whatsapp-bot/backups"
SOURCE_DB="/opt/whatsapp-bot/data/analytics.db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/analytics_$TIMESTAMP.db"

# Crear directorio de backups si no existe
mkdir -p "$BACKUP_DIR"

# Verificar que la base de datos existe y tiene contenido
if [ ! -f "$SOURCE_DB" ]; then
    echo "❌ Error: Base de datos no encontrada en $SOURCE_DB"
    exit 1
fi

DB_SIZE=$(stat -f%z "$SOURCE_DB" 2>/dev/null || stat -c%s "$SOURCE_DB" 2>/dev/null)
if [ "$DB_SIZE" -lt 10000 ]; then
    echo "⚠️ Advertencia: Base de datos muy pequeña ($DB_SIZE bytes), posible corrupción"
fi

# Crear backup
cp "$SOURCE_DB" "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Backup creado: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
    
    # Comprimir backup si es mayor a 1MB
    if [ "$DB_SIZE" -gt 1048576 ]; then
        gzip "$BACKUP_FILE"
        echo "📦 Backup comprimido: ${BACKUP_FILE}.gz"
        BACKUP_FILE="${BACKUP_FILE}.gz"
    fi
    
    # Mantener solo los últimos 30 backups
    cd "$BACKUP_DIR" && ls -t analytics_*.db* | tail -n +31 | xargs -r rm
    echo "🧹 Limpieza completada. Backups actuales: $(ls -1 analytics_*.db* 2>/dev/null | wc -l)"
else
    echo "❌ Error creando backup"
    exit 1
fi

# Mostrar estadísticas del backup
RECORD_COUNT=$(sqlite3 "$SOURCE_DB" "SELECT COUNT(*) FROM messages" 2>/dev/null)
if [ ! -z "$RECORD_COUNT" ]; then
    echo "📊 Registros en BD: $RECORD_COUNT"
fi

exit 0
