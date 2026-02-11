# 🚀 Guía de Despliegue - Sesión GPSwox Dedicada

## 📋 Cambios Implementados

### ✅ Nueva Funcionalidad: Sesión Dedicada GPSwox

Se ha creado una sesión especial de WhatsApp exclusivamente para el flujo de registro GPSwox.

**Características:**
- ✅ Sesión independiente solo para GPSwox
- ✅ Ignora todos los otros tipos de mensajes
- ✅ Mensaje de bienvenida automático
- ✅ Endpoints API dedicados
- ✅ Modo configurable (dedicado o compartido)

## 🔧 Configuración

### Variables de Entorno (.env)

Agrega estas líneas a tu archivo `.env`:

```bash
# Sesión GPSwox Dedicada
GPSWOX_SESSION_NAME=gpswox-session
GPSWOX_DEDICATED_MODE=true
```

**Opciones:**
- `GPSWOX_SESSION_NAME`: Nombre de la sesión (por defecto: "gpswox-session")
- `GPSWOX_DEDICATED_MODE`: 
  - `true` = Solo procesa GPSwox, ignora todo lo demás
  - `false` = Procesa GPSwox y otros mensajes (modo híbrido)

## 📡 Endpoints API Nuevos

### 1. Crear Sesión GPSwox

```http
POST http://164.68.118.86/api/gpswox/session/create
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Sesión GPSwox creada exitosamente",
  "sessionName": "gpswox-session",
  "dedicatedMode": true,
  "qrEndpoint": "/api/sessions/gpswox-session/qr"
}
```

### 2. Consultar Estado de Sesión GPSwox

```http
GET http://164.68.118.86/api/gpswox/session/status
```

**Respuesta:**
```json
{
  "success": true,
  "exists": true,
  "session": {
    "name": "gpswox-session",
    "state": "READY",
    "phoneNumber": "573001234567",
    "dedicatedMode": true,
    "uptime": 45,
    "messagesReceived": 12,
    "messagesSent": 24
  }
}
```

### 3. Ver Conversaciones Activas

```http
GET http://164.68.118.86/api/gpswox/conversations
```

### 4. Obtener QR de la Sesión GPSwox

```http
GET http://164.68.118.86/api/sessions/gpswox-session/qr
```

## 🎯 Flujo de Uso

### Paso 1: Crear la Sesión

```bash
curl -X POST http://164.68.118.86/api/gpswox/session/create
```

### Paso 2: Obtener el QR

```bash
curl http://164.68.118.86/api/sessions/gpswox-session/qr
```

Abre el QR en el navegador y escanea con WhatsApp.

### Paso 3: Verificar Estado

```bash
curl http://164.68.118.86/api/gpswox/session/status
```

### Paso 4: ¡Listo!

Los usuarios ahora pueden enviar mensajes al número de WhatsApp de la sesión GPSwox.

**Ejemplo de conversación:**

```
Usuario: Hola

Bot: 👋 ¡Bienvenido al sistema de registro GPSwox!

     Para comenzar, por favor envía tu correo electrónico
     registrado en el sistema.
     
     Ejemplo: usuario@ejemplo.com

Usuario: admin@sistemagps.com

Bot: 🔍 Validando correo: admin@sistemagps.com
     Por favor espera...

Bot: ✅ ¡Usuario encontrado!
     
     📧 Correo: admin@sistemagps.com
     👤 Nombre: Administrador
     
     Ahora envía la placa del vehículo

Usuario: ABC123

Bot: 📝 Placa formateada: ABC-123
     ✅ ¡Asignación exitosa!
```

## 🚀 Despliegue al Servidor

### Opción 1: SCP (Recomendado)

```powershell
# Desde Windows (PowerShell)
cd "C:\Users\guiog\OneDrive\Documentos\whatsapp docker"

# Copiar archivos modificados
scp -i C:\Users\guiog\.ssh\id_rsa config.js root@164.68.118.86:/root/whatsapp-docker/
scp -i C:\Users\guiog\.ssh\id_rsa server-baileys.js root@164.68.118.86:/root/whatsapp-docker/
scp -i C:\Users\guiog\.ssh\id_rsa lib/session/core.js root@164.68.118.86:/root/whatsapp-docker/lib/session/
scp -i C:\Users\guiog\.ssh\id_rsa lib/session/gpswox-api.js root@164.68.118.86:/root/whatsapp-docker/lib/session/
scp -i C:\Users\guiog\.ssh\id_rsa lib/session/gpswox-session.js root@164.68.118.86:/root/whatsapp-docker/lib/session/

# Reiniciar contenedor Docker
ssh -i C:\Users\guiog\.ssh\id_rsa root@164.68.118.86 "cd /root/whatsapp-docker && docker-compose restart whatsapp-backend"
```

### Opción 2: Git (Si usas repositorio)

```bash
# En el servidor
ssh root@164.68.118.86
cd /root/whatsapp-docker
git pull
docker-compose restart whatsapp-backend
```

### Opción 3: Script Automatizado

Guarda esto como `deploy.ps1`:

```powershell
# Deploy al servidor
$SERVER = "root@164.68.118.86"
$KEY = "C:\Users\guiog\.ssh\id_rsa"
$LOCAL = "C:\Users\guiog\OneDrive\Documentos\whatsapp docker"
$REMOTE = "/root/whatsapp-docker"

Write-Host "📦 Desplegando archivos al servidor..." -ForegroundColor Cyan

# Copiar archivos
scp -i $KEY "$LOCAL/config.js" "${SERVER}:${REMOTE}/"
scp -i $KEY "$LOCAL/server-baileys.js" "${SERVER}:${REMOTE}/"
scp -i $KEY "$LOCAL/lib/session/core.js" "${SERVER}:${REMOTE}/lib/session/"
scp -i $KEY "$LOCAL/lib/session/gpswox-api.js" "${SERVER}:${REMOTE}/lib/session/"
scp -i $KEY "$LOCAL/lib/session/gpswox-session.js" "${SERVER}:${REMOTE}/lib/session/"

Write-Host "✅ Archivos copiados" -ForegroundColor Green

# Reiniciar
Write-Host "🔄 Reiniciando servicio..." -ForegroundColor Cyan
ssh -i $KEY $SERVER "cd ${REMOTE} && docker-compose restart whatsapp-backend"

Write-Host "✅ Despliegue completado!" -ForegroundColor Green
Write-Host "🌐 Servidor: http://164.68.118.86/" -ForegroundColor Yellow
```

Ejecuta: `.\deploy.ps1`

## 🧪 Pruebas Post-Despliegue

### 1. Verificar que el servidor está activo

```bash
curl http://164.68.118.86/health
```

### 2. Crear sesión GPSwox

```bash
curl -X POST http://164.68.118.86/api/gpswox/session/create
```

### 3. Obtener QR

```bash
curl http://164.68.118.86/api/sessions/gpswox-session/qr > qr.html
# Abrir qr.html en navegador
```

### 4. Escanear QR con WhatsApp

1. Abre WhatsApp en tu teléfono
2. Ve a Dispositivos Vinculados
3. Escanea el QR
4. Espera confirmación

### 5. Verificar estado

```bash
curl http://164.68.118.86/api/gpswox/session/status
```

Debe mostrar `"state": "READY"`

### 6. Probar flujo completo

Envía un mensaje al número de WhatsApp de la sesión:
1. Envía: `test@ejemplo.com`
2. El bot debe responder con el flujo GPSwox

## 📊 Monitoreo

### Ver logs en tiempo real

```bash
ssh root@164.68.118.86
docker logs -f whatsapp-backend
```

### Ver conversaciones activas

```bash
curl http://164.68.118.86/api/gpswox/conversations
```

### Ver todas las sesiones

```bash
curl http://164.68.118.86/api/sessions
```

## 🐛 Solución de Problemas

### Error: Sesión ya existe

**Solución:**
```bash
# Eliminar sesión existente
curl -X DELETE http://164.68.118.86/api/sessions/gpswox-session

# Crear nuevamente
curl -X POST http://164.68.118.86/api/gpswox/session/create
```

### Error: No responde mensajes

**Verificar:**
1. Estado de la sesión: `curl http://164.68.118.86/api/gpswox/session/status`
2. Que `GPSWOX_DEDICATED_MODE=true` en .env
3. Logs del servidor: `docker logs whatsapp-backend`

### Error: QR expirado

**Solución:**
```bash
# Eliminar y recrear sesión
curl -X DELETE http://164.68.118.86/api/sessions/gpswox-session
curl -X POST http://164.68.118.86/api/gpswox/session/create
curl http://164.68.118.86/api/sessions/gpswox-session/qr
```

## 📁 Archivos Modificados

1. ✅ `config.js` - Configuración de sesión GPSwox
2. ✅ `server-baileys.js` - Endpoints API
3. ✅ `lib/session/core.js` - Lógica de procesamiento
4. ✅ `lib/session/gpswox-api.js` - Cliente API GPSwox
5. ✅ `lib/session/gpswox-session.js` - Gestor de conversaciones

## 🔐 Variables de Entorno Requeridas

Asegúrate de tener estas variables en el servidor (`.env`):

```bash
# API GPSwox (ya configurado en gpswox-api.js)
# No requiere variables adicionales

# Sesión GPSwox
GPSWOX_SESSION_NAME=gpswox-session
GPSWOX_DEDICATED_MODE=true

# Otras variables del sistema (ya existentes)
PORT=3010
DATABASE_URL=postgresql://...
```

## ✨ Características Exclusivas

### Modo Dedicado (GPSWOX_DEDICATED_MODE=true)
- ✅ Solo procesa flujo GPSwox
- ✅ Ignora mensajes de IA automática
- ✅ Ignora auto-respuestas
- ✅ Mensaje de bienvenida personalizado
- ✅ Ideal para usuarios finales

### Modo Híbrido (GPSWOX_DEDICATED_MODE=false)
- ✅ Procesa GPSwox y otros flujos
- ✅ Respuestas automáticas activas
- ✅ Ideal para sesiones multi-propósito

## 🎉 ¡Listo!

Tu sesión GPSwox dedicada está lista para usar.

**Próximos pasos:**
1. Desplegar archivos al servidor ✅
2. Crear sesión GPSwox ✅
3. Escanear QR ✅
4. Probar con usuario real ✅

---

**Desarrollado:** Febrero 2026  
**Servidor:** http://164.68.118.86/  
**Estado:** ✅ Listo para Producción
