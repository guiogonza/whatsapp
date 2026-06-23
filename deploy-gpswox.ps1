# Script de Despliegue Automático - GPSwox WhatsApp Bot
# Uso: .\deploy-gpswox.ps1

param(
    [switch]$SkipRestart,
    [switch]$OnlyDocs,
    [switch]$CreateSession
)

# Configuración
$SERVER = "root@164.68.118.86"
$KEY = "C:\Users\guiog\.ssh\id_rsa"
$LOCAL_DIR = "C:\Users\guiog\OneDrive\Documentos\whatsapp docker"
$REMOTE_DIR = "/root/whatsapp-docker"

# Colores
function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host $msg -ForegroundColor Red }

Write-Info "🚀 Iniciando despliegue al servidor..."
Write-Info "📍 Servidor: $SERVER"
Write-Info "📂 Directorio local: $LOCAL_DIR"
Write-Info ""

# Verificar que existe la carpeta local
if (-not (Test-Path $LOCAL_DIR)) {
    Write-Error "❌ Error: No se encontró el directorio local: $LOCAL_DIR"
    exit 1
}

# Cambiar al directorio de trabajo
Set-Location $LOCAL_DIR

# Solo desplegar documentación
if ($OnlyDocs) {
    Write-Info "📄 Desplegando solo documentación..."
    
    scp -i $KEY "GPSWOX_MODULE.md" "${SERVER}:${REMOTE_DIR}/"
    scp -i $KEY "DEPLOY_GPSWOX.md" "${SERVER}:${REMOTE_DIR}/"
    scp -i $KEY "RESUMEN_IMPLEMENTACION.md" "${SERVER}:${REMOTE_DIR}/"
    scp -i $KEY "ejemplos-gpswox.js" "${SERVER}:${REMOTE_DIR}/"
    
    Write-Success "✅ Documentación desplegada"
    exit 0
}

Write-Info "📦 Copiando archivos al servidor..."
Write-Info ""

# Archivos principales
Write-Info "  📄 config.js"
scp -i $KEY "config.js" "${SERVER}:${REMOTE_DIR}/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando config.js"
    exit 1
}

Write-Info "  📄 server-baileys.js"
scp -i $KEY "server-baileys.js" "${SERVER}:${REMOTE_DIR}/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando server-baileys.js"
    exit 1
}

# Módulos GPSwox
Write-Info "  📄 lib/session/core.js"
scp -i $KEY "lib/session/core.js" "${SERVER}:${REMOTE_DIR}/lib/session/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando core.js"
    exit 1
}

Write-Info "  📄 lib/session/gpswox-api.js"
scp -i $KEY "lib/session/gpswox-api.js" "${SERVER}:${REMOTE_DIR}/lib/session/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando gpswox-api.js"
    exit 1
}

Write-Info "  📄 lib/session/gpswox-session.js"
scp -i $KEY "lib/session/gpswox-session.js" "${SERVER}:${REMOTE_DIR}/lib/session/"
scp -i $KEY "lib/session/gpswox-operational.js" "${SERVER}:${REMOTE_DIR}/lib/session/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando gpswox-session.js"
    exit 1
}

Write-Info "  📄 lib/session/utils.js"
scp -i $KEY "lib/session/utils.js" "${SERVER}:${REMOTE_DIR}/lib/session/"
scp -i $KEY "routes/operational.js" "${SERVER}:${REMOTE_DIR}/routes/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando utils.js"
    exit 1
}

Write-Info "  📄 database-postgres.js"
scp -i $KEY "database-postgres.js" "${SERVER}:${REMOTE_DIR}/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando database-postgres.js"
    exit 1
}

Write-Info "  📄 public/index.html"
scp -i $KEY "public/index.html" "${SERVER}:${REMOTE_DIR}/public/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando index.html"
    exit 1
}

Write-Info "  📄 public/js/app.js"
scp -i $KEY "public/js/app.js" "${SERVER}:${REMOTE_DIR}/public/js/"
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Error copiando app.js"
    exit 1
}

# Documentación
Write-Info "  📄 Documentación"
scp -i $KEY "GPSWOX_MODULE.md" "${SERVER}:${REMOTE_DIR}/" 2>$null
scp -i $KEY "DEPLOY_GPSWOX.md" "${SERVER}:${REMOTE_DIR}/" 2>$null
scp -i $KEY "RESUMEN_IMPLEMENTACION.md" "${SERVER}:${REMOTE_DIR}/" 2>$null
scp -i $KEY "ejemplos-gpswox.js" "${SERVER}:${REMOTE_DIR}/" 2>$null

Write-Success "✅ Archivos copiados exitosamente"
Write-Info ""

# Actualizar .env en el servidor
Write-Info "🔧 Configurando variables de entorno..."
$envCommands = @"
cd ${REMOTE_DIR}
if ! grep -q 'GPSWOX_SESSION_NAME' .env 2>/dev/null; then
    echo '' >> .env
    echo '# Sesión GPSwox Dedicada' >> .env
    echo 'GPSWOX_SESSION_NAME=gpswox-session' >> .env
    echo 'GPSWOX_DEDICATED_MODE=true' >> .env
    echo 'Variables GPSwox agregadas a .env'
else
    echo 'Variables GPSwox ya existen en .env'
fi
"@

ssh -i $KEY $SERVER $envCommands
Write-Success "✅ Variables de entorno configuradas"
Write-Info ""

# Reiniciar servicio
if (-not $SkipRestart) {
    Write-Info "🔄 Reiniciando servicio Docker..."
    ssh -i $KEY $SERVER "cd ${REMOTE_DIR} && docker-compose restart wpp-bot"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "✅ Servicio reiniciado exitosamente"
    } else {
        Write-Error "❌ Error reiniciando servicio"
        exit 1
    }
    
    Write-Info ""
    Write-Info "⏳ Esperando 5 segundos para que el servicio inicie..."
    Start-Sleep -Seconds 5
} else {
    Write-Warning "⚠️  Reinicio omitido (parámetro -SkipRestart)"
}

Write-Info ""
Write-Success "✅ ¡Despliegue completado exitosamente!"
Write-Info ""

# Verificar estado del servidor
Write-Info "Verificando estado del servidor..."
try {
    $response = Invoke-WebRequest -Uri "http://164.68.118.86/health" -TimeoutSec 10 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($response.StatusCode -eq 200) {
        Write-Success "Servidor respondiendo correctamente"
    }
} catch {
    Write-Warning "No se pudo verificar el estado del servidor"
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

Write-Success "Todo listo para usar!"
Write-Info ""
Write-Info "Consulta DEPLOY_GPSWOX.md para mas informacion"
