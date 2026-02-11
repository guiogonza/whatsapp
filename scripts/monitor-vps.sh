#!/bin/bash
# ============================================================
# Script de monitoreo VPS - Envía reporte por WhatsApp cada 24h
# Se ejecuta vía cron: 0 8 * * * /root/monitor-vps.sh
# ============================================================

BOT_URL="http://localhost:3010"
PHONE="573183499539"
LOG_FILE="/var/log/monitor-vps.log"

# Recopilar métricas
CPU_CORES=$(nproc)
LOAD=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
UPTIME=$(uptime -p)

MEM_TOTAL=$(free -m | awk '/Mem:/{print $2}')
MEM_USED=$(free -m | awk '/Mem:/{print $3}')
MEM_FREE=$(free -m | awk '/Mem:/{print $4}')
MEM_PCT=$((MEM_USED * 100 / MEM_TOTAL))

SWAP_TOTAL=$(free -m | awk '/Swap:/{print $2}')
SWAP_USED=$(free -m | awk '/Swap:/{print $3}')
SWAP_PCT=0
if [ "$SWAP_TOTAL" -gt 0 ]; then
    SWAP_PCT=$((SWAP_USED * 100 / SWAP_TOTAL))
fi

DISK_TOTAL=$(df -h / | awk 'NR==2{print $2}')
DISK_USED=$(df -h / | awk 'NR==2{print $3}')
DISK_AVAIL=$(df -h / | awk 'NR==2{print $4}')
DISK_PCT=$(df / | awk 'NR==2{print $5}' | tr -d '%')

# Estado de contenedores Docker
DOCKER_TOTAL=$(docker ps -q 2>/dev/null | wc -l)
DOCKER_UNHEALTHY=$(docker ps --filter "health=unhealthy" -q 2>/dev/null | wc -l)
DOCKER_STOPPED=$(docker ps -a --filter "status=exited" -q 2>/dev/null | wc -l)

# Top 5 contenedores por RAM
TOP_CONTAINERS=$(docker stats --no-stream --format '{{.Name}}: {{.MemUsage}} ({{.MemPerc}}) CPU:{{.CPUPerc}}' 2>/dev/null | sort -t'(' -k2 -rn | head -5)

# Estado de wpp-bot
WPP_STATUS=$(docker ps --filter "name=wpp-bot" --format '{{.Status}}' 2>/dev/null)

# Alertas
ALERTS=""
if [ "$MEM_PCT" -gt 90 ]; then
    ALERTS="${ALERTS}🔴 RAM critica: ${MEM_PCT}%\n"
fi
if [ "$SWAP_PCT" -gt 50 ]; then
    ALERTS="${ALERTS}🟡 Swap alto: ${SWAP_PCT}%\n"
fi
if [ "$DISK_PCT" -gt 80 ]; then
    ALERTS="${ALERTS}🔴 Disco critico: ${DISK_PCT}%\n"
fi
LOAD_INT=$(echo "$LOAD" | awk '{printf "%d", $1}')
if [ "$LOAD_INT" -gt "$CPU_CORES" ]; then
    ALERTS="${ALERTS}🟡 CPU sobrecargada: load ${LOAD} (${CPU_CORES} cores)\n"
fi
if [ "$DOCKER_UNHEALTHY" -gt 0 ]; then
    ALERTS="${ALERTS}🔴 ${DOCKER_UNHEALTHY} contenedor(es) unhealthy\n"
fi
if [ -z "$ALERTS" ]; then
    ALERTS="✅ Todo normal"
fi

# Construir mensaje
read -r -d '' MSG << ENDMSG
📊 *Reporte VPS 164.68.118.86*
📅 $(date '+%d/%m/%Y %H:%M')
⏱️ ${UPTIME}

*🖥️ CPU* (${CPU_CORES} cores)
  Load: ${LOAD}

*🧠 RAM*
  ${MEM_USED}MB / ${MEM_TOTAL}MB (${MEM_PCT}%)

*💾 Swap*
  ${SWAP_USED}MB / ${SWAP_TOTAL}MB (${SWAP_PCT}%)

*💿 Disco*
  ${DISK_USED} / ${DISK_TOTAL} (${DISK_PCT}%) - ${DISK_AVAIL} libre

*🐳 Docker*
  Activos: ${DOCKER_TOTAL} | Unhealthy: ${DOCKER_UNHEALTHY} | Detenidos: ${DOCKER_STOPPED}
  wpp-bot: ${WPP_STATUS}

*📦 Top 5 por RAM:*
$(echo "$TOP_CONTAINERS" | while read line; do echo "  • $line"; done)

*⚠️ Alertas:*
$(echo -e "$ALERTS")
ENDMSG

# Escapar el mensaje para JSON
MSG_JSON=$(echo "$MSG" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

# Enviar mensaje directo usando el endpoint sin consolidación
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BOT_URL/api/send-direct" \
    -H "Content-Type: application/json" \
    -d "{\"phoneNumber\": \"$PHONE\", \"message\": $MSG_JSON}" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo "$(date): ✅ Reporte enviado exitosamente a ${PHONE}" >> "$LOG_FILE"
else
    echo "$(date): ❌ Error enviando reporte (HTTP $HTTP_CODE): $BODY" >> "$LOG_FILE"
fi
