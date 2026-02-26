# Script de migración al servidor refactorizado (Windows PowerShell)
# Ejecuta: .\migrate.ps1

Write-Host "🔄 === MIGRACIÓN AL SERVIDOR REFACTORIZADO ===" -ForegroundColor Cyan
Write-Host ""

# Backup del servidor viejo
Write-Host "📦 1/4 - Creando backup del servidor anterior..." -ForegroundColor Yellow
if (Test-Path "server-baileys.js") {
    Copy-Item "server-baileys.js" "server-baileys-old.js"
    Write-Host "✅ Backup creado: server-baileys-old.js" -ForegroundColor Green
} else {
    Write-Host "⚠️ server-baileys.js no encontrado" -ForegroundColor Yellow
}

# Renombrar nuevo servidor
Write-Host ""
Write-Host "🔄 2/4 - Activando nuevo servidor..." -ForegroundColor Yellow
if (Test-Path "server-baileys-new.js") {
    Move-Item "server-baileys-new.js" "server-baileys.js" -Force
    Write-Host "✅ Nuevo servidor activado: server-baileys.js" -ForegroundColor Green
} else {
    Write-Host "❌ server-baileys-new.js no encontrado" -ForegroundColor Red
    exit 1
}

# Instalar dependencias
Write-Host ""
Write-Host "📦 3/4 - Instalando dependencias de testing..." -ForegroundColor Yellow
npm install --save-dev jest supertest
Write-Host "✅ Dependencias instaladas" -ForegroundColor Green

# Ejecutar tests
Write-Host ""
Write-Host "🧪 4/4 - Ejecutando tests..." -ForegroundColor Yellow
npm test

Write-Host ""
Write-Host "✅ === MIGRACIÓN COMPLETADA ===" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Próximos pasos:" -ForegroundColor Cyan
Write-Host "1. Configurar variables de entorno FX en .env"
Write-Host "2. Crear sesiones FX: POST /api/fx/sessions/create-all"
Write-Host "3. Verificar que todo funcione: npm start"
Write-Host ""
Write-Host "🔙 Para revertir: Move-Item server-baileys-old.js server-baileys.js -Force" -ForegroundColor Yellow
