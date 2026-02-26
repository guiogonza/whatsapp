# 📱 Guía Rápida: Bot FX Proxy/Forwarding

## 🎯 ¿Qué hace este bot?

El bot FX funciona como un **proxy/forwarding inteligente**:
1. **Cualquier sesión** recibe mensajes con número destino
2. Extrae el número automáticamente
3. **Usa sesión FX** para reenviar el contenido al número especificado
4. Si detecta estructura MT5, formatea con emojis

**✨ Ventaja clave:** Recibes mensajes en cualquier sesión, pero **siempre envía desde sesiones FX dedicadas**.

---

## 🔄 Flujo del Sistema

```
[Cualquier sesión] → Recibe mensaje con "Para: +numero"
         ↓
[Sistema] → Detecta keyword MT5/FX
         ↓
[Sistema] → Obtiene sesión FX disponible
         ↓
[Sesión FX] → Envía mensaje al número destino
```

**Importante:** No importa qué sesión reciba el mensaje, siempre se enviará desde una **sesión FX**.

---

## 🚀 Uso Básico

### Requisitos Previos

**1. Configurar sesiones FX** en tu sistema:

```javascript
// config.js o .env
FX_SESSION_NAMES=fx01,fx02,fx03

// O en config.js:
module.exports = {
    // ... otras configs
    FX_SESSION_NAMES: ['fx01', 'fx02', 'fx03']
};
```

**2. Iniciar sesiones FX:**

```bash
# Al iniciar el servidor, las sesiones FX se crean automáticamente
node server-baileys-new.js

# Escanea el QR code de cada sesión FX con un WhatsApp diferente
# fx01 → WhatsApp Business #1
# fx02 → WhatsApp Business #2
# fx03 → WhatsApp Business #3 (backup)
```

**3. Verificar sesiones activas:**

```bash
# Opción 1: Script automático de verificación
node verify-fx-sessions.js

# Salida esperada:
# ✅ Sesiones FX configuradas: fx01, fx02, fx03
# ✅ Servidor WhatsApp está corriendo
# ✅ Todas las sesiones FX (3) están ACTIVAS
# ✅ SISTEMA COMPLETAMENTE LISTO

# Opción 2: API endpoint
GET http://localhost:3000/sessions

# Buscar en respuesta:
{
  "name": "fx01",
  "state": "ACTIVE",  # ✅ Debe estar ACTIVE
  "phoneNumber": "+5549999999999"
}
```

---

### Formato del Mensaje

```
[Palabra clave de destino]: [Número]
[Contenido del mensaje]
```

### Palabras Clave Soportadas

- `Para:`
- `Enviar a:`
- `To:`
- `Destino:`
- O simplemente el número al inicio

---

## 📝 Ejemplos Completos

### Ejemplo 1: Mensaje Simple

**Envías al bot (a cualquier sesión):**
```
Para: +5549999999999
Hola, este es un mensaje de prueba.
```

**Lo que sucede internamente:**
```
1. Sesión "cliente01" recibe el mensaje
2. Sistema detecta "Para: +5549999999999"
3. Sistema busca sesión FX disponible
4. Encuentra "fx01" conectada
5. fx01 envía a 5549999999999: "Hola, este es un mensaje de prueba."
```

**El destinatario ve:**
```
De: WhatsApp de FX01
"Hola, este es un mensaje de prueba."
```

**Logs del bot:**
```
📊 cliente01 detectó mensaje FX/MT5 de 5511888888888
🎯 Usando sesión FX: fx01
🎯 Número destino extraído: 5549999999999
📄 Enviando mensaje sin formateo especial
✅ Mensaje FX enviado exitosamente a 5549999999999
✅ Mensaje FX procesado y reenviado por fx01
```

---

### Ejemplo 2: Alerta MT5 Completa

**Envías al bot:**
```
Enviar a: 5549888888888
🚨 ALERTA MT5 - CRITICO

Ticket: #220141699
Simbolo: EURUSD | BUY 0.01 lot
Apertura: 1.08549 | Actual: 1.03499
SL: NO CONFIGURADO | TP: NO CONFIGURADO
Profit: $-5.00 (-5%)
Balance: $995.00

Recomendacion: Cerrar posicion para evitar mayores perdidas.

07/04/2024 10:15:00
```

**El bot formatea y envía a 5549888888888:**
```
🚨 *ALERTA MT5 - CRITICAL*

*Ticket:* #220141699
📈 *EURUSD* | BUY 0.01 lot
*Apertura:* 1.08549 | *Actual:* 1.03499
*SL:* NO CONFIGURADO | *TP:* NO CONFIGURADO
📛 *Profit:* -$5.00 (-5.00%)
💵 *Balance:* $995.00

💡 *Recomendación:* Cerrar posicion para evitar mayores perdidas.

⏰ 07/04/2024 10:15:00
```

**Logs del bot:**
```
📊 Detectada alerta MT5/FX, procesando...
🎯 Número destino extraído: 5549888888888
✨ Mensaje formateado con emojis y estructura MT5
✅ Mensaje FX enviado exitosamente a 5549888888888
```

---

### Ejemplo 3: Diferentes Formatos de Número

Todos estos son válidos y funcionan igual:

```
✅ Para: +5549999999999
✅ Enviar a: 5549999999999
✅ To: +55 49 99999-9999
✅ Destino: 55 49 9 9999-9999
✅ 5549999999999
   [mensaje aquí]
```

El bot limpia automáticamente espacios, guiones y símbolos.

---

## 🔍 Detección de Mensajes MT5

El bot detecta automaticamente si el mensaje contiene:
- `ticket`
- `alerta mt5`
- `simbolo:`
- `apertura:`
- `profit:`
- `balance:`
- `stop loss` / `take profit`

Si detecta estos keywords, aplica formato especial con emojis.

---

## ❌ Casos de Error

### Error 1: No se encuentra número destino

**Envías:**
```
Hola, este es un mensaje sin número destino.
```

**Bot responde con log:**
```
⚠️ No se encontró número destino en el mensaje
💡 Formato esperado: "Para: +5549999999999" o "Enviar a: 5549999999999"
❌ Mensaje no procesado
```

### Error 2: Número inválido

**Envías:**
```
Para: 123
Este número es muy corto
```

**Bot responde con log:**
```
⚠️ No se encontró número destino válido (mínimo 10 dígitos)
❌ Mensaje no procesado
```

---

## 🎨 Formateo Automático

### ¿Cuándo se aplica formateo?

**SE APLICA** formateo si el mensaje contiene:
- Ticket: #123456
- Profit: $X.XX
- Símbolo: XXXXX
- O cualquier combinación de keywords MT5

**NO SE APLICA** formateo si es mensaje simple sin keywords.

### Emojis Usados

| Contexto | Emoji | Uso |
|----------|-------|-----|
| Crítico | 🚨 | Alerta CRITICAL |
| Advertencia | ⚠️ | Alerta WARNING |
| Info | ℹ️ | Alerta INFO |
| Compra | 📈 | BUY |
| Venta | 📉 | SELL |
| Ganancia | 💰 | Profit positivo |
| Pérdida | 📛 | Profit negativo |
| Balance | 💵 | Balance actual |
| Recomendación | 💡 | Sugerencias |
| Hora | ⏰ | Timestamp |

---

## 🔧 Integración con Sistemas Externos

### Arquitectura del Sistema

```
┌─────────────────┐
│   Sistema MT5   │ (Genera alertas)
│   o Bot Trader  │
└────────┬────────┘
         │
         │ Envía mensaje
         ▼
┌─────────────────────────────────────┐
│   WhatsApp → Sesión "cliente01"    │
│   Mensaje: "Para: +5549999999999   │
│            ALERTA MT5..."           │
└────────┬────────────────────────────┘
         │
         │ Detecta keyword FX
         ▼
┌─────────────────────────────────────┐
│   Sistema de Detección              │
│   - Extrae número destino           │
│   - Identifica si es MT5            │
│   - Formatea si necesario           │
└────────┬────────────────────────────┘
         │
         │ Busca sesión FX
         ▼
┌─────────────────────────────────────┐
│   Pool de Sesiones FX               │
│   ┌──────┐  ┌──────┐  ┌──────┐    │
│   │ FX01 │  │ FX02 │  │ FX03 │    │
│   │ACTIVE│  │IDLE  │  │IDLE  │    │
│   └───┬──┘  └──────┘  └──────┘    │
└───────┼─────────────────────────────┘
        │
        │ fx01 seleccionada
        ▼
┌─────────────────────────────────────┐
│   WhatsApp Destino                  │
│   +5549999999999                   │
│   Recibe: "🚨 ALERTA MT5..."       │
└─────────────────────────────────────┘
```

---

### Caso de Uso 1: Bot de Trading MT5

```javascript
// Tu bot MT5 (Python, Node.js, etc.)
function enviarAlerta(clienteNumero, alertaMT5) {
    const mensaje = `Para: ${clienteNumero}\n${alertaMT5}`;
    enviarAWhatsApp(mensaje); // Envía a tu bot FX
}

// Ejemplo de uso
enviarAlerta("+5549999999999", `
🚨 ALERTA MT5 - CRITICO
Ticket: #123456
Profit: $-5.00 (-5%)
`);
```

### Caso de Uso 2: Sistema de Notificaciones Backend

```javascript
// Tu backend (Express, Flask, etc.)
app.post('/notificar', (req, res) => {
    const { numeroCliente, mensaje } = req.body;
    
    const mensajeFX = `Enviar a: ${numeroCliente}\n${mensaje}`;
    
    // Envía al bot FX via WhatsApp
    whatsappAPI.send(mensajeFX);
    
    res.json({ success: true });
});
```

### Caso de Uso 3: Webhook de Trading View

```javascript
// TradingView webhook → Tu servidor → Bot FX
app.post('/tradingview-webhook', (req, res) => {
    const alerta = req.body;
    
    // Extraer info de TradingView
    const mensaje = `
    Para: ${process.env.TRADER_PHONE}
    🚨 ALERTA TRADING VIEW
    
    Símbolo: ${alerta.ticker}
    Precio: ${alerta.close}
    Acción: ${alerta.strategy_order_action}
    `;
    
    // Enviar al bot FX
    enviarABotFX(mensaje);
    
    res.sendStatus(200);
});
```

---

## 📊 Logs y Monitoreo

### Logs Exitosos

```
✅ Procesamiento exitoso:
   📊 Detectada alerta MT5/FX, procesando...
   🎯 Número destino extraído: 5549999999999
   ✨ Mensaje formateado con emojis y estructura MT5
   ✅ Mensaje FX enviado exitosamente a 5549999999999
```

### Logs de Error

```
❌ Procesamiento fallido:
   ⚠️ No se encontró número destino en el mensaje
   💡 Formato esperado: "Para: +5549999999999"
   
   O
   
   ❌ Error enviando a 5549999999999: Connection timeout
```

---

## 🧪 Pruebas Rápidas

### Test 1: Mensaje Simple
```
Para: +5549999999999
Hola mundo
```
**Esperado:** Cliente recibe "Hola mundo" sin cambios

### Test 2: Alerta MT5 Básica
```
Enviar a: 5549999999999
Ticket: #123456
Profit: $10.00 (2%)
```
**Esperado:** Cliente recibe mensaje formateado con emojis

### Test 3: Sin Número Destino
```
Este mensaje no tiene destino
```
**Esperado:** Log de error, no se envía nada

---

## 🚨 Troubleshooting

### Problema: Mensajes no se envían

**Ejecuta diagnóstico automático:**
```bash
node verify-fx-sessions.js
```

**Posibles causas:**
1. ✅ **Servidor no corriendo:** `node server-baileys-new.js`
2. ✅ **Sesiones FX no configuradas:** Agregar `FX_SESSION_NAMES=fx01,fx02` en config
3. ✅ **Sesiones FX no activas:** Escanear QR code de cada sesión FX
4. ✅ **Formato de número incorrecto:** Mínimo 10 dígitos
5. ✅ **Logs del sistema:** Revisar consola para ver errores

**Verificación rápida:**
```bash
# 1. Ver logs del sistema
📊 cliente01 detectó mensaje FX/MT5 de 5511888888888
🎯 Usando sesión FX: fx01  # ✅ Debe aparecer
✅ Mensaje FX procesado y reenviado por fx01

# 2. Si ves esto, hay problema:
⚠️ Ninguna sesión FX está conectada actualmente
⚠️ No hay sesiones FX configuradas
```

---

### Problema: Se usa sesión incorrecta (no FX)

**Síntoma:** Los mensajes se envían desde la sesión que recibió, no desde FX

**Solución:**
1. Verificar logs correctos:
   ```
   ✅ CORRECTO:
   🎯 Usando sesión FX: fx01
   ✅ Mensaje FX procesado y reenviado por fx01
   
   ❌ INCORRECTO:
   ⚠️ Ninguna sesión FX está conectada actualmente
   (No se menciona sesión FX específica)
   ```

2. Verificar sesiones FX activas:
   ```bash
   GET http://localhost:3000/sessions
   # Buscar: { "name": "fx01", "state": "ACTIVE" }
   ```

3. Reiniciar servidor si es necesario

---

### Problema: Sesiones FX se desconectan frecuentemente

**Causas comunes:**
- WhatsApp detecta uso automatizado
- Demasiados mensajes desde una sesión
- Conexión inestable de red

**Soluciones:**
1. **Múltiples sesiones FX:** Configurar fx01, fx02, fx03 para redundancia
2. **Delays entre mensajes:** Implementar throttling
3. **Proxies/VPN:** Usar IP diferente por sesión
4. **Monitoreo continuo:** `node verify-fx-sessions.js` cada 5 minutos

---

### Problema: Formato no se aplica

**Solución:**
- El formateo solo se aplica si detecta keywords MT5
- Para forzar formateo, incluir "Ticket: #123" en el mensaje
- Mensajes simples NO se formatean (comportamiento esperado)

---

### Problema: Número no se extrae correctamente

**Solución:**
- Usar formato explícito: "Para: +5549999999999"
- Colocar el número al principio del mensaje
- Verificar que el número tiene al menos 10 dígitos
- No usar letras o caracteres especiales (excepto +, espacios, guiones)

---

## 📚 Recursos Adicionales

- [MT5_MODULE.md](./MT5_MODULE.md) - Documentación técnica completa
- [MT5_IMPLEMENTACION.md](./MT5_IMPLEMENTACION.md) - Detalles de implementación
- [FX_MODULE.md](./FX_MODULE.md) - Sistema de sesiones FX (avanzado)

---

**Última actualización:** 2024
**Versión:** 2.0.0 (Proxy/Forwarding)
**Modo:** Reenvío directo (no broadcasting)
