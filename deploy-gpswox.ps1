# Script de Despliegue Automatico - GPSwox WhatsApp Bot
# Uso: .\deploy-gpswox.ps1
#
# Nota: los mensajes de este script son ASCII puro (sin emojis/acentos)
# a proposito -- PowerShell 5.1 en este equipo corrompe silenciosamente
# las lineas con caracteres multibyte al ejecutar el .ps1, lo que hacia
# que bloques enteros del script (incluida la copia de archivos) no se
# vieran en el log sin lanzar ningun error visible.

param(
    [switch]$SkipRestart,
    [switch]$OnlyDocs,
    [switch]$CreateSession
)

# Configuracion
$SERVER = "root@164.68.118.86"
$KEY = "C:\Users\guiog\.ssh\id_rsa"
$LOCAL_DIR = "C:\Users\guiog\OneDrive\Documentos\whatsapp docker"
# IMPORTANTE: el contenedor wpp-bot en produccion corre desde el proyecto
# docker-compose "whatsapp-api" (working_dir /root/whatsapp-api), NO desde
# /root/whatsapp-docker. Ese otro directorio es una copia vieja y abandonada
# con su propio historial de git divergente -- desplegar ahi no tiene ningun
# efecto sobre el bot real. Verificado con:
#   docker inspect wpp-bot --format '{{json .Config.Labels}}'
$REMOTE_DIR = "/root/whatsapp-api"

# Colores
function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-ErrorMsg { param($msg) Write-Host $msg -ForegroundColor Red }

Write-Info "==> Iniciando despliegue al servidor..."
Write-Info "    Servidor: $SERVER"
Write-Info "    Directorio remoto: $REMOTE_DIR"
Write-Info "    Directorio local: $LOCAL_DIR"
Write-Info ""

# Verificar que existe la carpeta local
if (-not (Test-Path $LOCAL_DIR)) {
    Write-ErrorMsg "ERROR: No se encontro el directorio local: $LOCAL_DIR"
    exit 1
}

# Cambiar al directorio de trabajo
Set-Location $LOCAL_DIR

# Solo desplegar documentacion
if ($OnlyDocs) {
    Write-Info "Desplegando solo documentacion..."

    scp -i $KEY "GPSWOX_MODULE.md" "${SERVER}:${REMOTE_DIR}/"
    scp -i $KEY "DEPLOY_GPSWOX.md" "${SERVER}:${REMOTE_DIR}/"
    scp -i $KEY "RESUMEN_IMPLEMENTACION.md" "${SERVER}:${REMOTE_DIR}/"
    scp -i $KEY "ejemplos-gpswox.js" "${SERVER}:${REMOTE_DIR}/"

    Write-Success "Documentacion desplegada"
    exit 0
}

Write-Info "Copiando archivos al servidor..."
Write-Info ""

# Lista de archivos a desplegar: [origen local, destino remoto relativo]
$files = @(
    @{ Local = "config.js";                          Remote = "" },
    @{ Local = "server-baileys.js";                   Remote = "" },
    @{ Local = "lib/session/core.js";                 Remote = "lib/session/" },
    @{ Local = "lib/session/gpswox-api.js";            Remote = "lib/session/" },
    @{ Local = "lib/session/gpswox-session.js";        Remote = "lib/session/" },
    @{ Local = "lib/session/gpswox-operational.js";    Remote = "lib/session/" },
    @{ Local = "lib/session/utils.js";                 Remote = "lib/session/" },
    @{ Local = "routes/operational.js";                Remote = "routes/" },
    @{ Local = "database-postgres.js";                 Remote = "" },
    @{ Local = "public/index.html";                    Remote = "public/" },
    @{ Local = "public/js/app.js";                     Remote = "public/js/" }
)

foreach ($f in $files) {
    $dest = "${SERVER}:${REMOTE_DIR}/$($f.Remote)"
    Write-Info "  $($f.Local) -> $dest"
    scp -i $KEY $f.Local $dest
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "ERROR copiando $($f.Local)"
        exit 1
    }
}

# Documentacion (no critica, no aborta el despliegue si falla)
scp -i $KEY "GPSWOX_MODULE.md" "${SERVER}:${REMOTE_DIR}/" 2>$null
scp -i $KEY "DEPLOY_GPSWOX.md" "${SERVER}:${REMOTE_DIR}/" 2>$null
scp -i $KEY "RESUMEN_IMPLEMENTACION.md" "${SERVER}:${REMOTE_DIR}/" 2>$null
scp -i $KEY "ejemplos-gpswox.js" "${SERVER}:${REMOTE_DIR}/" 2>$null

Write-Success "Archivos copiados exitosamente"
Write-Info ""

# Actualizar .env en el servidor
# NOTA: enviado como UNA sola linea (sin heredoc) a proposito. Un heredoc de
# PowerShell (@"..."@) usa saltos de linea CRLF; al mandarlo tal cual por ssh
# a un bash remoto, los \r quedan pegados a cada comando y rompen el script
# remoto (ej: "cd: $'/root/whatsapp-api\r': No such file or directory").
$envCmd = "cd $REMOTE_DIR && (grep -q 'GPSWOX_SESSION_NAME' .env 2>/dev/null && echo 'Variables GPSwox ya existen en .env' || (printf '\n# Sesion GPSwox Dedicada\nGPSWOX_SESSION_NAME=gpswox-session\nGPSWOX_DEDICATED_MODE=true\n' >> .env && echo 'Variables GPSwox agregadas a .env'))"
Write-Info "Configurando variables de entorno..."
ssh -i $KEY $SERVER $envCmd
Write-Success "Variables de entorno verificadas"
Write-Info ""

# Reconstruir y recrear el contenedor
# NOTA: wpp-bot se construye con "COPY . ." en el Dockerfile -- el codigo NO
# esta montado como volumen. Un simple "restart" reutiliza la imagen vieja y
# NO aplica ningun cambio de codigo. Hay que reconstruir la imagen y recrear
# el contenedor con "up -d" (up, no restart).
if (-not $SkipRestart) {
    Write-Info "Reconstruyendo imagen wpp-bot..."
    ssh -i $KEY $SERVER "cd $REMOTE_DIR && docker compose build wpp-bot"
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "ERROR construyendo la imagen wpp-bot"
        exit 1
    }

    Write-Info "Recreando contenedor wpp-bot..."
    ssh -i $KEY $SERVER "cd $REMOTE_DIR && docker compose up -d wpp-bot"
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "ERROR recreando el contenedor wpp-bot"
        exit 1
    }

    Write-Success "Contenedor reconstruido y recreado exitosamente"
    Write-Info ""
    Write-Info "Esperando 15 segundos para que el servicio inicie..."
    Start-Sleep -Seconds 15

    Write-Info "Estado del contenedor:"
    ssh -i $KEY $SERVER "docker ps --format 'table {{.Names}}\t{{.Status}}' | grep wpp-bot"
} else {
    Write-Warning "Build/recreacion omitidos (parametro -SkipRestart)"
}

Write-Info ""
Write-Success "Despliegue completado exitosamente!"
Write-Info ""

# Verificar estado del servidor
Write-Info "Verificando estado del servidor..."
try {
    $response = Invoke-WebRequest -Uri "http://164.68.118.86/health" -TimeoutSec 10 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) {
        Write-Success "Servidor respondiendo correctamente"
    }
} catch {
    Write-Warning "No se pudo verificar el estado del servidor por HTTP"
}

Write-Info ""
Write-Info "Informacion del despliegue:"
Write-Info "  URL: http://164.68.118.86/"
Write-Info "  API: http://164.68.118.86/api/"
Write-Info ""

# Crear sesion automaticamente si se especifico
if ($CreateSession) {
    Write-Info "Creando sesion GPSwox..."
    try {
        $createResponse = Invoke-RestMethod -Uri "http://164.68.118.86/api/gpswox/session/create" -Method Post -UseBasicParsing -ErrorAction SilentlyContinue
        if ($createResponse.success) {
            Write-Success "Sesion GPSwox creada: $($createResponse.sessionName)"
            Write-Info "  Obten el QR en: http://164.68.118.86/api/sessions/$($createResponse.sessionName)/qr"
        } else {
            Write-Warning "  $($createResponse.error)"
        }
    } catch {
        Write-Warning "  No se pudo crear la sesion automaticamente"
        Write-Info "  Creala manualmente con: curl -X POST http://164.68.118.86/api/gpswox/session/create"
    }
    Write-Info ""
}

Write-Info "Proximos pasos:"
Write-Info ""
Write-Info "  1. Crear sesion GPSwox:"
Write-Info "     Invoke-WebRequest -Uri http://164.68.118.86/api/gpswox/session/create -Method Post"
Write-Info ""
Write-Info "  2. Obtener QR para escanear:"
Write-Info "     Start-Process http://164.68.118.86/api/sessions/gpswox-session/qr"
Write-Info ""
Write-Info "  3. Verificar estado:"
Write-Info "     Invoke-WebRequest -Uri http://164.68.118.86/api/gpswox/session/status"
Write-Info ""

Write-Success "Todo listo!"
Write-Info ""
Write-Info "Consulta DEPLOY_GPSWOX.md para mas informacion"
