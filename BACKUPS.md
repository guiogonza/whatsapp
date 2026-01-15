# Sistema de Backups Automáticos

Este proyecto cuenta con un **sistema robusto de backups en múltiples niveles** para proteger los datos de analytics y mensajes.

## 🔒 Niveles de Protección

### 1. Backups Internos (cada 15 minutos)
**Ubicación:** `/opt/whatsapp-bot/data/backups/`

- Se ejecutan automáticamente desde el código Node.js
- Frecuencia: cada 15 minutos
- Retención: últimos 50 backups
- Formato: `analytics_YYYY-MM-DDTHH-MM-SS.db`
- Sin comprimir para acceso rápido

**Características:**
- ✅ Backup con timestamp único
- ✅ Limpieza automática de archivos antiguos
- ✅ Protección contra corrupción (no sobrescribe si el archivo es sospechosamente pequeño)
- ✅ Logs en consola del contenedor Docker

### 2. Backups Externos (cada 6 horas)
**Ubicación:** `/opt/backups/whatsapp/`

- Se ejecutan automáticamente vía cron
- Frecuencia: cada 6 horas (0:00, 6:00, 12:00, 18:00)
- Formato: `whatsapp_YYYYMMDD_HHMMSS.tar.gz`
- Comprimido para ahorrar espacio

**Estructura de retención:**
```
/opt/backups/whatsapp/
├── daily/      → Últimos 7 días
├── weekly/     → Últimos 30 días (domingos)
└── monthly/    → Últimos 12 meses (día 1 de cada mes)
```

**Características:**
- ✅ Backup completo del directorio `data/`
- ✅ Retención automática multinivel
- ✅ Logs en `/var/log/whatsapp-backup.log`
- ✅ Backups semanales y mensuales automáticos

## 📋 Comandos Útiles

### Ver logs de backups externos
```bash
tail -f /var/log/whatsapp-backup.log
```

### Ejecutar backup manual
```bash
/opt/whatsapp-bot/scripts/external-backup.sh
```

### Listar backups disponibles
```bash
# Backups internos
ls -lh /opt/whatsapp-bot/data/backups/

# Backups externos
ls -lh /opt/backups/whatsapp/daily/
ls -lh /opt/backups/whatsapp/weekly/
ls -lh /opt/backups/whatsapp/monthly/
```

### Ver tareas cron activas
```bash
crontab -l
```

### Editar configuración de cron
```bash
crontab -e
```

## 🔧 Restaurar desde Backup

### Opción 1: Restaurar backup interno
```bash
cd /opt/whatsapp-bot/data
cp backups/analytics_2026-01-15T15-53-03.db analytics.db
docker restart wpp-bot
```

### Opción 2: Restaurar backup externo
```bash
cd /opt/whatsapp-bot
tar -xzf /opt/backups/whatsapp/daily/whatsapp_20260115_165612.tar.gz
docker restart wpp-bot
```

## 🚨 Recuperación ante Desastres

Si se pierden todos los backups locales, siempre existen:

1. **Backups internos** en `/opt/whatsapp-bot/data/backups/` (últimos 50)
2. **Backups diarios** en `/opt/backups/whatsapp/daily/` (últimos 7 días)
3. **Backups semanales** en `/opt/backups/whatsapp/weekly/` (últimas 4 semanas)
4. **Backups mensuales** en `/opt/backups/whatsapp/monthly/` (últimos 12 meses)

## ⚙️ Configuración

### Cambiar frecuencia de backups internos
Editar `database.js` línea ~260:
```javascript
backupInterval = setInterval(createBackup, 15 * 60 * 1000); // 15 minutos
```

### Cambiar frecuencia de backups externos
```bash
crontab -e
# Cambiar: 0 */6 * * * 
# A por ejemplo: 0 */3 * * * (cada 3 horas)
```

### Cambiar retención de backups
Editar `scripts/external-backup.sh`:
```bash
find "$DAILY_BACKUP" -name "*.tar.gz" -mtime +7 -delete    # Cambiar +7 por +14 para 14 días
find "$WEEKLY_BACKUP" -name "*.tar.gz" -mtime +30 -delete  # Cambiar +30 por +60 para 60 días
find "$MONTHLY_BACKUP" -name "*.tar.gz" -mtime +365 -delete # Cambiar +365 por +730 para 2 años
```

## 📊 Monitoreo

### Verificar último backup interno
```bash
docker-compose logs wpp-bot | grep "Backup"
```

### Verificar último backup externo
```bash
ls -lt /opt/backups/whatsapp/daily/ | head -3
```

### Ver estadísticas de backups
```bash
echo "=== Backups Internos ==="
ls -1 /opt/whatsapp-bot/data/backups/ | wc -l
du -sh /opt/whatsapp-bot/data/backups/

echo "=== Backups Externos ==="
find /opt/backups/whatsapp -name "*.tar.gz" | wc -l
du -sh /opt/backups/whatsapp/
```

## ✅ Estado Actual del Sistema

- ✅ Backups internos: **Activo** (cada 15 min)
- ✅ Backups externos: **Activo** (cada 6 horas vía cron)
- ✅ Volúmenes Docker: **Persistentes**
- ✅ Retención multinivel: **Configurada**
- ✅ Limpieza automática: **Activa**

## 🛡️ Protección de Datos

Este sistema garantiza que **NO SE PIERDAN DATOS** porque:

1. Backups frecuentes (cada 15 minutos internos)
2. Múltiples copias en diferentes ubicaciones
3. Retención a largo plazo (hasta 12 meses)
4. Protección contra corrupción
5. Logs detallados de todas las operaciones
6. Volúmenes Docker persistentes

---

**Última actualización:** 15 de enero de 2026
