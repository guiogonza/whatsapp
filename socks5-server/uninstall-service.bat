@echo off
:: Desinstalar el servicio SOCKS5
:: Ejecutar como Administrador

echo === Desinstalador del Servicio SOCKS5 ===
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Este script debe ejecutarse como Administrador
    pause
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "NSSM=%SCRIPT_DIR%nssm.exe"
set "SERVICE_NAME=SOCKS5Proxy"

if exist "%NSSM%" (
    echo Deteniendo servicio...
    "%NSSM%" stop %SERVICE_NAME% >nul 2>&1
    
    echo Eliminando servicio...
    "%NSSM%" remove %SERVICE_NAME% confirm >nul 2>&1
    
    echo Eliminando regla de firewall...
    netsh advfirewall firewall delete rule name="SOCKS5 Proxy Server" >nul 2>&1
    
    echo.
    echo Servicio SOCKS5 desinstalado correctamente.
) else (
    echo NSSM no encontrado. El servicio puede no estar instalado.
)

echo.
pause
