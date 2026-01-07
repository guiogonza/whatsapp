@echo off
:: Instalar servidor SOCKS5 como servicio usando PM2
:: Ejecutar como Administrador

echo === Instalador SOCKS5 con PM2 ===
echo.

:: Verificar permisos de administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Este script debe ejecutarse como Administrador
    echo Haz clic derecho y selecciona "Ejecutar como administrador"
    pause
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"

:: Verificar Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado
    pause
    exit /b 1
)

echo Verificando PM2...
call npm list -g pm2 >nul 2>&1
if %errorlevel% neq 0 (
    echo Instalando PM2 globalmente...
    call npm install -g pm2
    call npm install -g pm2-windows-startup
)

:: Detener proceso existente si existe
echo.
echo Deteniendo proceso existente...
call pm2 delete socks5-proxy >nul 2>&1

:: Agregar regla de firewall
echo.
echo Configurando firewall para puerto 1080...
netsh advfirewall firewall delete rule name="SOCKS5 Proxy Server" >nul 2>&1
netsh advfirewall firewall add rule name="SOCKS5 Proxy Server" dir=in action=allow protocol=tcp localport=1080 >nul

:: Iniciar con PM2
echo.
echo Iniciando servidor SOCKS5...
cd /d "%SCRIPT_DIR%"
call pm2 start socks5-server.js --name socks5-proxy

:: Configurar inicio automático
echo.
echo Configurando inicio automatico con Windows...
call pm2 save
call pm2-startup install >nul 2>&1

:: Mostrar estado
echo.
call pm2 status

:: Obtener IP de Tailscale
echo.
for /f "tokens=*" %%i in ('powershell -Command "tailscale ip -4 2>$null"') do set TAILSCALE_IP=%%i

echo.
echo ============================================
echo    SERVIDOR SOCKS5 INSTALADO
echo ============================================
echo.
echo El servidor SOCKS5 esta corriendo en el puerto 1080
echo Se iniciara automaticamente con Windows
echo.
echo Tu IP de Tailscale: %TAILSCALE_IP%
echo.
echo Configura en tu VPS ^(.env^):
echo SOCKS_PROXY=socks5://%TAILSCALE_IP%:1080
echo.

pause
