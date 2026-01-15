#!/bin/bash
# Backup externo con copia a ubicación segura
# Se ejecuta automáticamente cada 6 horas vía cron

SOURCE_DIR="/opt/whatsapp-bot/data"
BACKUP_ROOT="/opt/backups/whatsapp"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DAILY_BACKUP="$BACKUP_ROOT/daily"
WEEKLY_BACKUP="$BACKUP_ROOT/weekly"
MONTHLY_BACKUP="$BACKUP_ROOT/monthly"

# Crear directorios de backup
mkdir -p "$DAILY_BACKUP" "$WEEKLY_BACKUP" "$MONTHLY_BACKUP"

# Backup diario completo
tar -czf "$DAILY_BACKUP/whatsapp_$TIMESTAMP.tar.gz" "$SOURCE_DIR" 2>/dev/null
if [ $? -eq 0 ]; then
    SIZE=$(du -h "$DAILY_BACKUP/whatsapp_$TIMESTAMP.tar.gz" | cut -f1)
    echo "$(date): ✅ Backup diario creado ($SIZE)"
else
    echo "$(date): ❌ Error creando backup diario"
    exit 1
fi

# Backup semanal (domingos)
if [ $(date +%u) -eq 7 ]; then
    cp "$DAILY_BACKUP/whatsapp_$TIMESTAMP.tar.gz" "$WEEKLY_BACKUP/"
    echo "$(date): ✅ Backup semanal creado"
fi

# Backup mensual (día 1 de cada mes)
if [ $(date +%d) -eq 01 ]; then
    cp "$DAILY_BACKUP/whatsapp_$TIMESTAMP.tar.gz" "$MONTHLY_BACKUP/"
    echo "$(date): ✅ Backup mensual creado"
fi

# Limpiar backups antiguos
# Diarios: mantener 7 días
find "$DAILY_BACKUP" -name "*.tar.gz" -mtime +7 -delete
# Semanales: mantener 4 semanas (30 días)
find "$WEEKLY_BACKUP" -name "*.tar.gz" -mtime +30 -delete
# Mensuales: mantener 12 meses (365 días)
find "$MONTHLY_BACKUP" -name "*.tar.gz" -mtime +365 -delete

echo "$(date): 🧹 Limpieza de backups antiguos completada"

# Resumen de backups disponibles
DAILY_COUNT=$(ls -1 "$DAILY_BACKUP"/*.tar.gz 2>/dev/null | wc -l)
WEEKLY_COUNT=$(ls -1 "$WEEKLY_BACKUP"/*.tar.gz 2>/dev/null | wc -l)
MONTHLY_COUNT=$(ls -1 "$MONTHLY_BACKUP"/*.tar.gz 2>/dev/null | wc -l)
echo "$(date): 📊 Backups: $DAILY_COUNT diarios, $WEEKLY_COUNT semanales, $MONTHLY_COUNT mensuales"

exit 0
