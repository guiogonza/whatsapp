@echo off
:: Script para instalar microsocks como servicio de Windows usando NSSM
:: Ejecutar como Administrador

echo === Instalador de SOCKS5 como Servicio de Windows ===
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
set "MICROSOCKS=%SCRIPT_DIR%microsocks.exe"
set "NSSM=%SCRIPT_DIR%nssm.exe"
set "SERVICE_NAME=SOCKS5Proxy"

:: Descargar microsocks si no existe
if not exist "%MICROSOCKS%" (
    echo Descargando microsocks...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/rofl0r/microsocks/releases/download/v1.0.4/microsocks-v1.0.4-win64.zip' -OutFile '%SCRIPT_DIR%microsocks.zip'"
    powershell -Command "Expand-Archive -Path '%SCRIPT_DIR%microsocks.zip' -DestinationPath '%SCRIPT_DIR%' -Force"
    
    :: Buscar y mover el exe
    for /r "%SCRIPT_DIR%" %%f in (microsocks.exe) do (
        if not "%%f"=="%MICROSOCKS%" copy "%%f" "%MICROSOCKS%" >nul
    )
    del "%SCRIPT_DIR%microsocks.zip" 2>nul
    echo microsocks descargado.
)

:: Descargar NSSM si no existe (para crear servicios Windows)
if not exist "%NSSM%" (
    echo Descargando NSSM ^(gestor de servicios^)...
    powershell -Command "Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile '%SCRIPT_DIR%nssm.zip'"
    powershell -Command "Expand-Archive -Path '%SCRIPT_DIR%nssm.zip' -DestinationPath '%SCRIPT_DIR%' -Force"
    copy "%SCRIPT_DIR%nssm-2.24\win64\nssm.exe" "%NSSM%" >nul
    rmdir /s /q "%SCRIPT_DIR%nssm-2.24" 2>nul
    del "%SCRIPT_DIR%nssm.zip" 2>nul
    echo NSSM descargado.
)

:: Detener servicio existente si existe
echo.
echo Deteniendo servicio existente si existe...
"%NSSM%" stop %SERVICE_NAME% >nul 2>&1
"%NSSM%" remove %SERVICE_NAME% confirm >nul 2>&1

:: Agregar regla de firewall
echo.
echo Configurando firewall...
netsh advfirewall firewall delete rule name="SOCKS5 Proxy Server" >nul 2>&1
netsh advfirewall firewall add rule name="SOCKS5 Proxy Server" dir=in action=allow protocol=tcp localport=1080 >nul
echo Regla de firewall agregada.

:: Instalar servicio
echo.
echo Instalando servicio SOCKS5...
"%NSSM%" install %SERVICE_NAME% "%MICROSOCKS%"
"%NSSM%" set %SERVICE_NAME% AppParameters "-i 0.0.0.0 -p 1080"
"%NSSM%" set %SERVICE_NAME% DisplayName "SOCKS5 Proxy Server"
"%NSSM%" set %SERVICE_NAME% Description "Servidor proxy SOCKS5 para redirigir trafico del VPS a traves de esta PC"
"%NSSM%" set %SERVICE_NAME% Start SERVICE_AUTO_START
"%NSSM%" set %SERVICE_NAME% AppStdout "%SCRIPT_DIR%socks5.log"
"%NSSM%" set %SERVICE_NAME% AppStderr "%SCRIPT_DIR%socks5-error.log"

:: Iniciar servicio
echo.
echo Iniciando servicio...
"%NSSM%" start %SERVICE_NAME%

:: Verificar estado
timeout /t 2 >nul
sc query %SERVICE_NAME% | find "RUNNING" >nul
if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo    SERVICIO INSTALADO CORRECTAMENTE
    echo ============================================
    echo.
    echo El servidor SOCKS5 esta corriendo en el puerto 1080
    echo Se iniciara automaticamente cuando enciendas tu PC
    echo.
    for /f "tokens=*" %%i in ('powershell -Command "tailscale ip -4"') do set TAILSCALE_IP=%%i
    echo Tu IP de Tailscale: %TAILSCALE_IP%
    echo.
    echo Configura en tu VPS:
    echo SOCKS_PROXY=socks5://%TAILSCALE_IP%:1080
    echo.
) else (
    echo.
    echo ERROR: El servicio no pudo iniciarse
    echo Revisa los logs en: %SCRIPT_DIR%socks5-error.log
)

echo.
pause
