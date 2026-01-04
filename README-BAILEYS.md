# WhatsApp Bot con Baileys

## ✨ Migración Completada

Se ha migrado de **whatsapp-web.js** a **@whiskeysockets/baileys** para mayor seguridad y menor probabilidad de detección.

## 🔥 Ventajas de Baileys

- ✅ Implementación de bajo nivel del protocolo de WhatsApp
- ✅ Más difícil de detectar por WhatsApp
- ✅ Mejor rendimiento y estabilidad
- ✅ Soporte multi-dispositivo nativo
- ✅ No requiere navegador (Puppeteer)
- ✅ Menor consumo de recursos

## 🚀 Inicio Rápido

### Instalación
```bash
npm install
```

### Iniciar con Baileys (Nuevo)
```bash
npm start
# o en desarrollo
npm run dev
```

### Iniciar con whatsapp-web.js (Antiguo - Solo respaldo)
```bash
npm run start:old
```

## 📡 API Endpoints

### Sesiones

#### Crear sesión
```bash
POST http://localhost:3010/api/sessions/create
Content-Type: application/json

{
  "name": "session1"
}
```

#### Obtener QR
```bash
GET http://localhost:3010/api/sessions/session1/qr
```

#### Ver estado de sesión
```bash
GET http://localhost:3010/api/sessions/session1/status
```

#### Listar todas las sesiones
```bash
GET http://localhost:3010/api/sessions
```

#### Cerrar sesión
```bash
DELETE http://localhost:3010/api/sessions/session1?deleteData=true
```

### Mensajes

#### Enviar mensaje individual
```bash
POST http://localhost:3010/api/messages/send
Content-Type: application/json

{
  "phoneNumber": "573001234567",
  "message": "Hola desde Baileys!"
}
```

#### Enviar mensajes masivos
```bash
POST http://localhost:3010/api/messages/send-bulk
Content-Type: application/json

{
  "contacts": [
    "573001234567",
    "573007654321"
  ],
  "message": "Mensaje masivo desde Baileys"
}
```

#### Ver mensajes recientes
```bash
GET http://localhost:3010/api/messages/recent?limit=50
```

### Analytics

#### Estadísticas
```bash
GET http://localhost:3010/api/analytics/stats
```

#### Historial de mensajes
```bash
GET http://localhost:3010/api/analytics/messages?limit=100&session=session1
```

### Health Check
```bash
GET http://localhost:3010/health
```

## 🔄 Balanceo de Carga

El sistema utiliza **round-robin automático**:
- Cada mensaje usa una sesión diferente automáticamente
- Distribuye la carga entre todas las sesiones activas
- Reduce el riesgo de detección

## 📂 Estructura de Archivos

```
whatsapp-docker/
├── server-baileys.js              # Servidor principal con Baileys (NUEVO)
├── sessionManager-baileys.js      # Gestor de sesiones con Baileys (NUEVO)
├── server.js                      # Servidor antiguo (respaldo)
├── sessionManager.js              # Gestor antiguo (respaldo)
├── config.js                      # Configuración
├── database.js                    # Base de datos SQLite
├── utils.js                       # Utilidades
├── whatsapp-sessions/             # Datos de autenticación de sesiones
│   ├── session1/                  # Archivos de autenticación
│   └── session2/
├── public/                        # Frontend
│   ├── index.html
│   └── js/
└── routes/                        # Rutas API (opcional - integrado en server-baileys)
```

## ⚙️ Variables de Entorno (.env)

```env
PORT=3010
CONSOLE_CLEAR_ENABLED=true
CONSOLE_CLEAR_INTERVAL_MINUTES=5

# Rotación de sesiones (0 = balanceo automático por mensaje)
SESSION_ROTATION_MINUTES=0

# Balanceo round-robin (true = cada mensaje usa sesión diferente)
LOAD_BALANCING_ENABLED=true

# Notificaciones
NOTIFICATION_NUMBER=573183499539
HABLAME_API_KEY=tu_api_key_aqui

# Auto-respuesta (opcional)
AUTO_RESPONSE=Gracias por tu mensaje. Te responderemos pronto.
```

## 🔐 Diferencias con whatsapp-web.js

| Característica | whatsapp-web.js | Baileys |
|---------------|-----------------|---------|
| Protocolo | WebSocket navegador | Protocolo nativo |
| Puppeteer | ✅ Requerido | ❌ No necesario |
| Recursos | Alto | Bajo |
| Detección | Más fácil | Más difícil |
| QR | Via navegador | Via terminal/API |
| Multi-dispositivo | Limitado | Nativo |

## 🛠️ Solución de Problemas

### La sesión no se conecta
1. Verifica que el QR se genere correctamente
2. Escanea el QR rápidamente (expira en ~20 segundos)
3. Asegúrate de tener buena conexión a internet

### Error de módulos
```bash
rm -rf node_modules package-lock.json
npm install
```

### QR no aparece
- Verifica que la sesión esté en estado `WAITING_FOR_QR`
- Consulta el endpoint `/api/sessions/:name/qr`

### Sesión se desconecta frecuentemente
- Verifica tu conexión a internet
- Asegúrate de no tener WhatsApp Web abierto en el mismo número
- Revisa los logs del servidor

## 📝 Notas Importantes

1. **Multi-dispositivo**: Baileys usa la API multi-dispositivo de WhatsApp por defecto
2. **Autenticación**: Los archivos de autenticación se guardan en `whatsapp-sessions/[nombre-sesion]/`
3. **QR Code**: Se genera automáticamente y se puede obtener via API
4. **Persistencia**: Las sesiones se mantienen aunque reinicies el servidor
5. **Seguridad**: Baileys es más seguro pero siempre usa con moderación

## 🎯 Próximos Pasos

1. Inicia el servidor: `npm start`
2. Crea una sesión: `POST /api/sessions/create`
3. Obtén el QR: `GET /api/sessions/:name/qr`
4. Escanea el QR con WhatsApp
5. Espera a que se conecte (estado READY)
6. Envía mensajes: `POST /api/messages/send`

## 📞 Soporte

Para más información sobre Baileys:
- GitHub: https://github.com/WhiskeySockets/Baileys
- Documentación: https://whiskeysockets.github.io/Baileys/

---

**Versión**: 2.0.0 con Baileys  
**Última actualización**: Enero 2026
