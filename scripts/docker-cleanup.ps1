# Script de limpieza de Docker
# Ejecutar semanalmente para evitar que el disco crezca

Write-Host "=== Limpieza de Docker ===" -ForegroundColor Cyan
Write-Host "Fecha: $(Get-Date)" 

# 1. Limpiar imágenes huérfanas y contenedores detenidos
Write-Host "`nLimpiando recursos no utilizados..." -ForegroundColor Yellow
docker system prune -f

# 2. Limpiar imágenes sin tag (dangling)
Write-Host "`nLimpiando imágenes dangling..." -ForegroundColor Yellow
docker image prune -f

# 3. Limpiar build cache
Write-Host "`nLimpiando build cache..." -ForegroundColor Yellow
docker builder prune -f

# 4. Mostrar uso actual
Write-Host "`n=== Uso actual de Docker ===" -ForegroundColor Green
docker system df

# 5. Mostrar tamaño del VHDX
$vhdxSize = [math]::Round((Get-Item "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx").Length / 1GB, 2)
Write-Host "`nTamaño del disco VHDX: $vhdxSize GB" -ForegroundColor Cyan

if ($vhdxSize -gt 50) {
    Write-Host "⚠️  ADVERTENCIA: El disco supera 50GB. Considera compactarlo." -ForegroundColor Red
    Write-Host "   Ejecuta: wsl --shutdown && diskpart (compact vdisk)"
}

Write-Host "`n✅ Limpieza completada" -ForegroundColor Green
