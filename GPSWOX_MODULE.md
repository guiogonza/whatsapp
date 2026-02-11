# Módulo GPSwox - Registro Automático de Placas

## 📋 Descripción

Este módulo implementa un flujo conversacional automático en WhatsApp para registrar usuarios y asignar placas (vehículos) en el sistema GPSwox.

## 🎯 Funcionalidades

1. **Validación de correo electrónico**: Verifica que el usuario exista en GPSwox
2. **Formato automático de placas**: Agrega guion después de 3 caracteres (ABC123 → ABC-123)
3. **Validación de placas**: Verifica que la placa exista en el sistema GPS
4. **Asignación automática**: Asocia el vehículo al usuario en GPSwox

## 🔄 Flujo de Conversación

```
Usuario: usuario@ejemplo.com
Bot: 🔍 Validando correo...
     ✅ ¡Usuario encontrado!
     Ahora envía la placa del vehículo

Usuario: ABC123
Bot: 📝 Placa formateada: ABC-123
     🔍 Validando placa...
     ✅ ¡Vehículo encontrado!
     🔗 Asignando al usuario...
     ✅ ¡Asignación exitosa!
```

## 🚀 Uso

### Inicio Automático

El usuario simplemente envía un correo electrónico válido a cualquier sesión de WhatsApp activa. El sistema detecta automáticamente que es un correo y comienza el flujo.

**Ejemplo:**
```
Usuario: contacto@empresa.com
```

### Inicio Manual (API)

También puedes iniciar una conversación manualmente mediante la API:

```bash
POST http://localhost:3010/api/gpswox/conversation/573001234567/start
```

## 📡 Endpoints API

### 1. Obtener estadísticas de conversaciones

```http
GET /api/gpswox/conversations
```

**Respuesta:**
```json
{
  "success": true,
  "stats": {
    "total": 3,
    "byState": {
      "waiting_email": 1,
      "waiting_plate": 2
    }
  }
}
```

### 2. Consultar estado de conversación

```http
GET /api/gpswox/conversation/:phoneNumber
```

**Ejemplo:**
```bash
GET /api/gpswox/conversation/573001234567
```

**Respuesta:**
```json
{
  "success": true,
  "active": true,
  "conversation": {
    "state": "waiting_plate",
    "email": "usuario@ejemplo.com",
    "plate": null,
    "startTime": 1738972800000,
    "lastActivity": 1738972850000
  }
}
```

### 3. Iniciar conversación

```http
POST /api/gpswox/conversation/:phoneNumber/start
```

**Ejemplo:**
```bash
POST /api/gpswox/conversation/573001234567/start
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Conversación iniciada exitosamente",
  "phoneNumber": "573001234567"
}
```

### 4. Finalizar conversación

```http
DELETE /api/gpswox/conversation/:phoneNumber
```

**Ejemplo:**
```bash
DELETE /api/gpswox/conversation/573001234567
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Conversación finalizada exitosamente"
}
```

## ⚙️ Configuración

### Configurar credenciales de GPSwox

Edita el archivo `lib/session/gpswox-api.js`:

```javascript
const GPSWOX_CONFIG = {
    BASE_URL: 'https://plataforma.sistemagps.online/api',
    API_HASH: 'TU_HASH_DE_API_AQUI'
};
```

### Ajustar endpoints de la API

Si los endpoints de GPSwox son diferentes, modifica las funciones en `lib/session/gpswox-api.js`:

- `findUserByEmail()` - Buscar usuarios
- `findDeviceByPlate()` - Buscar dispositivos/vehículos
- `assignDeviceToUser()` - Asignar dispositivo a usuario
- `getUserDevices()` - Listar dispositivos de un usuario

## 📊 Estados de Conversación

| Estado | Descripción |
|--------|-------------|
| `waiting_email` | Esperando que el usuario envíe su correo electrónico |
| `validating_email` | Validando correo en GPSwox |
| `waiting_plate` | Esperando que el usuario envíe la placa del vehículo |
| `validating_plate` | Validando placa en GPSwox |
| `assigning_device` | Asignando dispositivo al usuario |
| `completed` | Proceso completado exitosamente |
| `error` | Error en el proceso |

## 🛡️ Validaciones

### Formato de Correo
- Debe ser un correo electrónico válido
- Ejemplo: `usuario@dominio.com`

### Formato de Placa
- Se acepta con o sin guion
- El sistema formatea automáticamente
- Ejemplos válidos:
  - `ABC123` → `ABC-123` ✅
  - `ABC-123` → `ABC-123` ✅
  - `XYZ789` → `XYZ-789` ✅

## 🔒 Seguridad

- Las conversaciones inactivas se eliminan automáticamente después de 30 minutos
- Se valida que el usuario exista antes de solicitar la placa
- Se valida que la placa exista antes de realizar la asignación
- Se registran todos los eventos en los logs del servidor

## 🧪 Pruebas

### Prueba completa del flujo

1. Envía un mensaje de WhatsApp con un correo válido:
   ```
   573001234567: admin@sistemagps.com
   ```

2. El bot responde pidiendo la placa:
   ```
   Bot: ✅ ¡Usuario encontrado!
        Ahora envía la placa del vehículo
   ```

3. Envía la placa:
   ```
   573001234567: ABC123
   ```

4. El bot confirma la asignación:
   ```
   Bot: ✅ ¡Asignación exitosa!
   ```

## 📝 Logs

Todos los eventos se registran en la consola del servidor:

```
🆕 Iniciando conversación de registro con 573001234567
🔍 Buscando usuario con email: usuario@ejemplo.com
✅ Usuario encontrado: usuario@ejemplo.com (ID: 123)
🔍 Buscando dispositivo con placa: ABC-123
✅ Dispositivo encontrado: ABC-123 (ID: 456)
🔗 Asignando dispositivo 456 al usuario 123
✅ Dispositivo asignado exitosamente
✅ Finalizando conversación con 573001234567
```

## 🐛 Solución de Problemas

### El usuario no recibe respuesta

1. Verifica que la sesión de WhatsApp esté activa
2. Revisa los logs del servidor para ver si hay errores
3. Verifica que el correo sea válido

### Error al validar correo

1. Verifica las credenciales de la API en `gpswox-api.js`
2. Comprueba que el endpoint de usuarios sea correcto
3. Revisa los logs para ver el error específico

### Error al asignar placa

1. Verifica que la placa exista en el sistema GPS
2. Comprueba que el endpoint de asignación sea correcto
3. Revisa los permisos del API hash

## 📚 Archivos del Módulo

```
lib/session/
├── gpswox-api.js           # Cliente API de GPSwox
├── gpswox-session.js       # Gestor de conversaciones
└── core.js                 # Integración con WhatsApp (modificado)

server-baileys.js           # Endpoints API (modificado)
```

## 🔄 Limpieza Automática

El sistema limpia conversaciones inactivas cada 10 minutos. Una conversación se considera inactiva si no ha tenido actividad en los últimos 30 minutos.

## 📞 Soporte

Para reportar problemas o solicitar ayuda, contacta al administrador del sistema.

---

**Versión:** 1.0.0  
**Última actualización:** Febrero 2026
