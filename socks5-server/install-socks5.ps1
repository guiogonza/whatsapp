# Script para instalar y configurar servidor SOCKS5 con Dante o 3proxy en Windows
# Este script descarga y configura un servidor SOCKS5 simple

Write-Host "=== Instalador de Servidor SOCKS5 para Windows ===" -ForegroundColor Cyan
Write-Host ""

# Verificar si ya está corriendo
$existingProcess = Get-NetTCPConnection -LocalPort 1080 -ErrorAction SilentlyContinue
if ($existingProcess) {
    Write-Host "Ya hay un servicio escuchando en el puerto 1080" -ForegroundColor Yellow
    exit
}

# Crear directorio para el servidor
$serverDir = "$PSScriptRoot"
$exePath = "$serverDir\microsocks.exe"

# Descargar microsocks si no existe
if (-not (Test-Path $exePath)) {
    Write-Host "Descargando microsocks..." -ForegroundColor Yellow
    $url = "https://github.com/rofl0r/microsocks/releases/download/v1.0.4/microsocks-v1.0.4-win64.zip"
    $zipPath = "$serverDir\microsocks.zip"
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $serverDir -Force
        Remove-Item $zipPath -ErrorAction SilentlyContinue
        
        # Buscar el exe en subdirectorios
        $foundExe = Get-ChildItem -Path $serverDir -Recurse -Filter "microsocks.exe" | Select-Object -First 1
        if ($foundExe -and $foundExe.FullName -ne $exePath) {
            Move-Item $foundExe.FullName $exePath -Force
        }
        
        Write-Host "microsocks descargado correctamente" -ForegroundColor Green
    }
    catch {
        Write-Host "Error descargando microsocks: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "Descargalo manualmente de: https://github.com/rofl0r/microsocks/releases" -ForegroundColor Yellow
        exit 1
    }
}

# Obtener IP de Tailscale
$tailscaleIP = & tailscale ip -4 2>$null
if (-not $tailscaleIP) {
    Write-Host "Error: Tailscale no está conectado" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Tu IP de Tailscale es: $tailscaleIP" -ForegroundColor Cyan
Write-Host ""

# Agregar regla de firewall si no existe
$ruleName = "SOCKS5 Proxy Server"
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existingRule) {
    Write-Host "Agregando regla de firewall..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 1080 -Action Allow | Out-Null
    Write-Host "Regla de firewall agregada" -ForegroundColor Green
}

Write-Host ""
Write-Host "Iniciando servidor SOCKS5 en puerto 1080..." -ForegroundColor Green
Write-Host "Escuchando en: 0.0.0.0:1080" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para usar este proxy desde tu VPS, configura:" -ForegroundColor Yellow
Write-Host "SOCKS_PROXY=socks5://${tailscaleIP}:1080" -ForegroundColor White
Write-Host ""
Write-Host "Presiona Ctrl+C para detener el servidor" -ForegroundColor Gray
Write-Host ""

# Ejecutar el servidor SOCKS5
& $exePath -i 0.0.0.0 -p 1080
