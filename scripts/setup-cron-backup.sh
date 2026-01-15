#!/bin/bash
# Configurar backup automático con cron
# Ejecuta el backup cada 6 horas

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/external-backup.sh"
LOG_FILE="/var/log/whatsapp-backup.log"

# Crear archivo de log si no existe
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

# Definir el cron job (cada 6 horas)
CRON_JOB="0 */6 * * * $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

# Verificar si ya existe el cron job
if crontab -l 2>/dev/null | grep -q "$BACKUP_SCRIPT"; then
    echo "✅ Cron job ya configurado"
    echo "📋 Configuración actual:"
    crontab -l | grep "$BACKUP_SCRIPT"
else
    # Agregar cron job
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "✅ Cron job agregado exitosamente"
    echo "📋 Backup automático configurado cada 6 horas"
    echo "📝 Logs en: $LOG_FILE"
fi

echo ""
echo "🔍 Tareas cron actuales:"
crontab -l

echo ""
echo "💡 Comandos útiles:"
echo "  - Ver logs: tail -f $LOG_FILE"
echo "  - Ejecutar manualmente: $BACKUP_SCRIPT"
echo "  - Listar backups: ls -lh /opt/backups/whatsapp/*/"
echo "  - Eliminar cron: crontab -e (y eliminar la línea del backup)"

exit 0
