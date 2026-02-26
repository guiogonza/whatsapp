# 🤖 Sistema WhatsApp Multi-Propósito

Sistema completo de automatización de WhatsApp con 3 modos especializados integrados.

## 🎯 Modos de Operación

### 1. 📊 Bot FX Proxy/Forwarding
**¿Para qué sirve?** Reenviar mensajes de trading/notificaciones a números específicos

```
Funcionalidad:
- Cualquier sesión puede recibir mensajes con número destino
- Extrae número automáticamente
- Usa sesión FX dedicada para reenviar el contenido
- Formateo automático para alertas MT5

Flujo:
  [Sesión A recibe]: "Para: +5549999999999\nTicket: #123"
  [Sistema detecta]: Es mensaje FX/MT5
  [Sesión FX envía]: Mensaje formateado a 5549999999999
  
✨ Ventaja: Recibes en cualquier sesión, envías desde FX
```

📖 **Guía:** [FX_PROXY_GUIA.md](./FX_PROXY_GUIA.md)  
📖 **Documentación:** [MT5_MODULE.md](./MT5_MODULE.md)

---

### 2. 🚗 Bot GPSwox (Rastreo de Vehículos)
**¿Para qué sirve?** Sistema de consultas de vehículos por placa

```
Funcionalidad:
- Usuario envía placa de vehículo
- Bot consulta API de GPSwox
- Responde con ubicación y estado
- Manejo de conversaciones por usuario

Ejemplo:
  Usuario: "ABC1234"
  Bot: "🚗 Vehículo ABC1234
        📍 Ubicación: Florianópolis, SC
        ⚡ Estado: Movimiento
        🕐 Última actualización: hace 5 min"
```

📖 **Documentación:** [GPSWOX_MODULE.md](./GPSWOX_MODULE.md)

---

### 3. 💬 Sistema Base (Auto-respuesta y Webhooks)
**¿Para qué sirve?** Funciones generales de WhatsApp

```
Funcionalidad:
- Auto-respuesta con IA
- Forwarding de webhooks
- Gestión de múltiples sesiones
- Rotación automática de sesiones
- API REST completa

Endpoints:
  GET  /sessions          - Listar sesiones
  POST /send              - Enviar mensaje
  POST /webhook           - Configurar webhook
  GET  /health            - Estado del sistema
```

📖 **Documentación:** [RESUMEN_IMPLEMENTACION.md](./RESUMEN_IMPLEMENTACION.md)

---

## 🚀 Inicio Rápido

### Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp config.js.example config.js
# Editar config.js con tus credenciales

# 3. Iniciar servidor
node server-baileys-new.js

# 4. Escanear QR code con WhatsApp
# El QR aparecerá en la consola
```

### Configuración Rápida

```javascript
// config.js
module.exports = {
    // Servidor
    PORT: 3000,
    
    // GPSwox (si usas rastreo de vehículos)
    GPSWOX_API_URL: 'https://api.gpswox.com',
    GPSWOX_USER_API_HASH: 'tu-hash-aqui',
    GPSWOX_DEDICATED_SESSION: 'gpswox01',
    
    // Base de datos (opcional)
    DB_HOST: 'localhost',
    DB_USER: 'usuario',
    DB_PASSWORD: 'password',
    DB_DATABASE: 'whatsapp_db',
    
    // FX/MT5 (no requiere configuración especial)
    // Solo envía mensajes con formato "Para: [número]"
};
```

---

## 📁 Estructura del Proyecto

```
whatsapp-docker/
├── server-baileys-new.js       # Servidor principal (354 líneas)
├── config.js                   # Configuración
├── database-postgres.js        # Conexión BD
│
├── routes/                     # Rutas REST API
│   ├── sessions.js            # Gestión de sesiones
│   ├── messages.js            # Envío de mensajes
│   ├── gpswox.js              # Endpoints GPSwox
│   ├── fx.js                  # Endpoints FX
│   └── ...
│
├── controllers/                # Lógica de negocio
│   ├── sessionController.js
│   ├── messageController.js
│   ├── gpswoxController.js
│   └── fxController.js
│
├── lib/session/               # Core del sistema
│   ├── core.js               # Gestión de sesiones WhatsApp
│   ├── messaging.js          # Envío de mensajes
│   ├── gpswox-api.js         # Integración GPSwox
│   ├── fx-api.js             # Formateo MT5
│   ├── mt5-detector.js       # Detector FX Proxy
│   └── adapters/             # Adaptadores WhatsApp
│
├── tests/                     # Tests automatizados
│   ├── unit/                 # Tests unitarios
│   └── integration/          # Tests integración
│
└── docs/                      # Documentación
    ├── FX_PROXY_GUIA.md      # Guía FX Proxy
    ├── MT5_MODULE.md         # Doc técnica MT5
    ├── GPSWOX_MODULE.md      # Doc GPSwox
    └── ...
```

---

## 🔌 API REST Endpoints

### Sesiones

```bash
# Listar todas las sesiones
GET /sessions

# Crear nueva sesión
POST /sessions
{
  "sessionName": "mi-sesion",
  "adapter": "baileys"
}

# Eliminar sesión
DELETE /sessions/:sessionName
```

### Mensajes

```bash
# Enviar mensaje simple
POST /send
{
  "sessionName": "mi-sesion",
  "to": "5549999999999",
  "text": "Hola mundo"
}

# Enviar con botones
POST /send
{
  "sessionName": "mi-sesion",
  "to": "5549999999999",
  "text": "Elige una opción",
  "buttons": [
    { "id": "1", "text": "Opción 1" },
    { "id": "2", "text": "Opción 2" }
  ]
}
```

### GPSwox

```bash
# Consultar vehículo por placa
GET /gpswox/vehicles/:plate

# Iniciar conversación GPSwox
POST /gpswox/conversations
{
  "phoneNumber": "5549999999999",
  "sessionName": "gpswox01"
}
```

### FX/MT5 (Proxy)

```bash
# No requiere endpoints especiales
# Simplemente envía mensajes con formato:
# "Para: +5549999999999\n[contenido]"

# El sistema detecta y reenvía automáticamente
```

---

## 🧪 Testing

```bash
# Ejecutar todos los tests
npm test

# Tests específicos
npm test tests/unit/mt5-detector.test.js
npm test tests/unit/fx.test.js
npm test tests/integration/

# Con coverage
npm run test:coverage
```

---

## 📊 Monitoreo y Logs

### Logs en Consola

```bash
# Sesiones
✅ gpswox01 iniciada y conectada
📱 fx01 escaneando QR code...

# Mensajes FX
📊 Detectada alerta MT5/FX, procesando...
🎯 Número destino extraído: 5549999999999
✅ Mensaje FX enviado exitosamente

# Mensajes GPSwox
🚗 Consultando vehículo ABC1234
✅ Vehículo encontrado: ABC1234 en Florianópolis

# Errores
❌ Error enviando mensaje: Connection timeout
⚠️ Sesión desconectada, reconectando...
```

### Health Check

```bash
# Verificar estado del sistema
GET /health

# Respuesta:
{
  "status": "ok",
  "sessions": 3,
  "activeSessions": 2,
  "uptime": 86400
}
```

---

## 🔧 Configuración Avanzada

### Sesiones FX (Trading/Notificaciones)

Las sesiones FX son sesiones dedicadas para enviar mensajes FX/MT5:

```javascript
// config.js o .env
FX_SESSION_NAMES=fx01,fx02,fx03

// Verificar configuración:
node verify-fx-sessions.js
```

**Ventajas:**
- ✅ Recepción en cualquier sesión
- ✅ Envío desde sesiones dedicadas
- ✅ Distribución de carga
- ✅ Mayor redundancia

**Configuración:**
1. Definir sesiones FX en config
2. Iniciar servidor
3. Escanear QR de cada sesión FX
4. Verificar con `verify-fx-sessions.js`

---

### Múltiples Sesiones

Puedes tener varias sesiones simultáneas:

```javascript
// Sesión para FX/Trading
POST /sessions { "sessionName": "fx-trading" }

// Sesión para GPSwox
POST /sessions { "sessionName": "gpswox-fleet" }

// Sesión para clientes
POST /sessions { "sessionName": "clientes-soporte" }
```

### Rotación Automática

El sistema rota sesiones automáticamente para evitar ban:

```javascript
// config.js
MAX_MESSAGES_PER_SESSION: 100,
SESSION_COOLDOWN_MS: 300000,  // 5 minutos
AUTO_ROTATE_ENABLED: true
```

### Proxy/VPN

Para mayor seguridad, usa proxies SOCKS5:

```javascript
// config.js
PROXY_ENABLED: true,
PROXY_HOST: '127.0.0.1',
PROXY_PORT: 1080,
PROXY_USERNAME: 'user',
PROXY_PASSWORD: 'pass'
```

---

## 🐛 Troubleshooting

### Problema: QR Code no aparece

```bash
# Solución:
1. Verificar que el puerto 3000 está libre
2. Eliminar carpeta whatsapp-sessions/
3. Reiniciar servidor
```

### Problema: Sesión se desconecta constantemente

```bash
# Solución:
1. Reducir MAX_MESSAGES_PER_SESSION
2. Aumentar SESSION_COOLDOWN_MS
3. Usar proxy/VPN
4. No usar WhatsApp Web en paralelo
```

### Problema: Mensajes FX no se reenvían

```bash
# Solución:
1. Verificar formato: "Para: +5549999999999"
2. Número debe tener al menos 10 dígitos
3. Revisar logs: 🎯 Número destino extraído...
4. Verificar que la sesión está activa
```

### Problema: GPSwox no responde

```bash
# Solución:
1. Verificar GPSWOX_USER_API_HASH en config.js
2. Verificar que la placa existe en GPSwox
3. Revisar logs: 🚗 Consultando vehículo...
4. Verificar conectividad a API GPSwox
```

---

## 🔐 Seguridad

### Recomendaciones

- ✅ Usa `.env` para credenciales sensibles
- ✅ No expongas el puerto 3000 directamente
- ✅ Usa proxy/VPN en producción
- ✅ Limita rate de mensajes
- ✅ Implementa autenticación en endpoints

### Autenticación

```javascript
// Agregar middleware de auth
app.use('/send', authMiddleware);
app.use('/gpswox', authMiddleware);
```

---

## 📚 Documentación Completa

| Archivo | Descripción |
|---------|-------------|
| [FX_PROXY_GUIA.md](./FX_PROXY_GUIA.md) | Guía rápida Bot FX |
| [MT5_MODULE.md](./MT5_MODULE.md) | Documentación técnica MT5 |
| [MT5_IMPLEMENTACION.md](./MT5_IMPLEMENTACION.md) | Implementación FX Proxy |
| [GPSWOX_MODULE.md](./GPSWOX_MODULE.md) | Módulo de rastreo vehicular |
| [FX_MODULE.md](./FX_MODULE.md) | Sistema FX avanzado |
| [REFACTORIZACIÓN_COMPLETADA.md](./REFACTORIZACIÓN_COMPLETADA.md) | Arquitectura del sistema |

---

## 🤝 Contribuir

### Agregar Nuevo Módulo

1. Crear detector en `lib/session/`
2. Integrar en `lib/session/core.js`
3. Crear endpoints en `routes/`
4. Crear controller en `controllers/`
5. Agregar tests en `tests/`
6. Documentar en `.md`

### Reportar Bugs

Abre un issue con:
- Descripción del problema
- Logs relevantes
- Pasos para reproducir
- Configuración usada

---

## 📄 Licencia

MIT License - Uso libre para proyectos personales y comerciales.

---

## 🎯 Roadmap

### v2.1 (Próximo)
- [ ] WebUI para gestión de sesiones
- [ ] Dashboard de métricas
- [ ] Base de datos para histórico de mensajes
- [ ] Integración con más APIs de trading

### v3.0 (Futuro)
- [ ] Clustering multi-servidor
- [ ] Machine Learning para auto-respuestas
- [ ] Análisis de sentimiento
- [ ] Webhooks bidireccionales

---

**Última actualización:** Febrero 2026  
**Versión:** 2.0.0  
**Stack:** Node.js + Baileys + PostgreSQL + Express.js

---

## 🆘 Soporte

- 📖 Documentación: [Ver archivos .md](./)
- 🐛 Issues: Reportar bugs
- 💬 Preguntas: Abrir discusión

---

**¡Sistema listo para usar! 🚀**
