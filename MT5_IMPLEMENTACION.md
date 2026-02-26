# 📊 Sistema de Proxy/Forwarding FX para MT5

## 🎯 Objetivo Completado

Se implementó un sistema **proxy/forwarding** que **recibe mensajes con número destino** y los **reenvía automáticamente** a ese número específico a través de sesiones FX de WhatsApp.

---

## ✅ Características Implementadas

### 1. Detección Automática ✓
- ✅ Detecta mensajes que contengan:
  - "Ticket" (palabra clave principal)
  - "ALERTA MT5"
  - "Simbolo:", "Apertura:", "Profit:", etc.
- ✅ Funciona en tiempo real, sin intervención manual
- ✅ Se ejecuta **ANTES** de cualquier otra lógica de mensajes

### 2. Extracción de Número Destino ✓
- ✅ Reconoce formatos:
  - "Para: +5549999999999"
  - "Enviar a: 5549999999999"
  - "To: +55 49 99999-9999"
  - Primer número de teléfono en el mensaje
- ✅ Limpia formato automáticamente (espacios, guiones)
- ✅ Valida números de al menos 10 dígitos

### 3. Formateo Inteligente (Opcional) ✓
- ✅ Si el mensaje contiene datos MT5 (ticket, profit, etc.):
  - 🚨 Emojis según nivel (CRÍTICO, ADVERTENCIA, INFO)
  - 📈📉 Emojis según tipo de operación (BUY/SELL)
  - 💰📛 Emojis según profit (ganancia/pérdida)
  - **Negrita** para información clave
- ✅ Si no tiene datos MT5:
  - Reenvía contenido tal cual (sin formateo)

### 4. Reenvío Directo ✓
- ✅ Envía **solo al número especificado** en el mensaje
- ✅ No requiere suscriptores configurados
- ✅ Funciona como proxy transparente
- ✅ Logging completo de cada acción

---

## 📂 Archivos Creados/Modificados

### Nuevos Archivos

```
lib/session/mt5-detector.js              # Módulo principal de detección
tests/unit/mt5-detector.test.js          # Tests unitarios completos
MT5_MODULE.md                             # Documentación completa
MT5_IMPLEMENTACION.md                     # Este archivo
```

### Archivos Modificados

```
lib/session/core.js                       # Integración en handleIncomingMessage
```

---

## 🔄 Flujo de Ejecución

```
┌───────────────────────────────────────────────────────────┐
│  WhatsApp recibe mensaje en CUALQUIER sesión             │
│  Ejemplo: Sesión "cliente01" recibe:                     │
│           "Para: +5549999999999                          │
│           ALERTA MT5                                      │
│           Ticket: #123456                                 │
│           Profit: $10.00"                                 │
└─────────────────┬─────────────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────────────────┐
│  core.js - handleIncomingMessage()                       │
│  • Recibido por: cliente01                               │
│  • Extrae texto del mensaje                              │
│  • Obtiene número del remitente                          │
└─────────────────┬─────────────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────────────────┐
│  🎯 DETECCIÓN MT5/FX (PRIORIDAD ALTA)                     │
│  mt5Detector.isMT5Alert(text)                            │
│  • ¿Contiene "Ticket"? → SÍ                              │
│  • ¿Contiene "Para:"? → SÍ                               │
│  • ¿Contiene número telefónico? → SÍ                     │
└─────────────────┬─────────────────────────────────────────┘
                  │ Es mensaje FX
                  ▼
┌───────────────────────────────────────────────────────────┐
│  🔍 BUSCAR SESIÓN FX DISPONIBLE                           │
│  • Obtener sesiones FX: ['fx01', 'fx02']                 │
│  • Verificar cuál está conectada y activa                │
│  • Seleccionar: fx01 (primera disponible)                │
│  • Obtener socket de fx01                                │
└─────────────────┬─────────────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────────────────┐
│  📞 EXTRAER NÚMERO DESTINO                                │
│  mt5Detector.extractTargetPhone(text)                    │
│  • Buscar "Para:" o "Enviar a:" o "To:"                  │
│  • Extraer: +5549999999999                               │
│  • Limpiar formato (espacios, guiones)                   │
│  • Resultado: 5549999999999@s.whatsapp.net               │
└─────────────────┬─────────────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────────────────┐
│  📋 EXTRAER CONTENIDO                                     │
│  • Remover línea con número destino                      │
│  • Contenido: "ALERTA MT5\nTicket: #123456..."          │
└─────────────────┬─────────────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────────────────┐
│  📊 PARSEAR Y FORMATEAR (si tiene datos MT5)              │
│  • ¿Tiene Ticket? → SÍ, formatear con emojis             │
│  • ¿No tiene Ticket? → Enviar tal cual                   │
│  • Resultado: Mensaje formateado o texto original        │
└─────────────────┬─────────────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────────────────┐
│  📤 ENVIAR DESDE SESIÓN FX                                │
│  sendMessageWithRetry(fx01.socket, target, content)     │
│  • Emisor: SESIÓN FX01 (no cliente01)                    │
│  • Destino: 5549999999999@s.whatsapp.net                 │
│  • Contenido: Mensaje formateado                         │
└─────────────────┬─────────────────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────────────────┐
│  ✅ COMPLETADO                                            │
│  • Log: "Mensaje FX procesado y reenviado por fx01"     │
│  • return; (no procesar otras lógicas)                   │
└───────────────────────────────────────────────────────────┘
```

**✨ Ventaja Arquitectural:**
- ✅ Recibes mensajes en **cualquier sesión**
- ✅ Envías siempre desde **sesión FX dedicada**
- ✅ Separación de responsabilidades
- ✅ Evita sobrecarga de sesiones normales

---

## 📊 Ejemplo Práctico

### Escenario

1. **Sistema A** (MetaTrader 5 o Bot) genera alerta
2. **Sistema A** envía mensaje a tu bot FX con formato:
   ```
   Para: +5549999999999
   ALERTA MT5
   Ticket: #220141699
   Profit: -$5.00 (-5%)
   ```
3. **Tu Bot FX** recibe el mensaje y lo procesa

### ¿Qué Sucede Automáticamente?

```
1. Sistema detecta mensaje entrante
   📥 "¡Nuevo mensaje recibido!"

2. Sistema identifica palabra "Ticket" y número destino
   📊 "Detectada alerta MT5/FX, procesando..."
   🎯 "Número destino extraído: 5549999999999"

3. Sistema extrae contenido (sin línea de "Para:")
   🔍 Contenido:
      "ALERTA MT5
      Ticket: #220141699
      Profit: -$5.00 (-5%)"

4. Sistema detecta estructura MT5 y formatea
   ✨ "Mensaje formateado con emojis y estructura MT5"
   
   Resultado:
   🚨 *ALERTA MT5 - CRITICAL*
   *Ticket:* #220141699
   📛 *Profit:* -$5.00 (-5.00%)

5. Sistema envía al número destino
   📤 Enviando a: 5549999999999@s.whatsapp.net
   
6. Confirmación
   ✅ "Mensaje FX enviado exitosamente a 5549999999999"
```

### Ejemplo 2: Mensaje Simple (sin datos MT5)

**Entrada:**
```
Enviar a: 5511888888888
Hola, este es un mensaje de prueba para FX.
```

**Proceso:**
```
1. Detecta keyword (puede ser "ticket" o patrón de número)
2. Extrae destino: 5511888888888
3. Extrae contenido: "Hola, este es un mensaje de prueba para FX."
4. No detecta estructura MT5 → envía tal cual
5. ✅ Enviado sin formateo especial
```

### Ejemplo 3: Múltiples Formatos Soportados

```
✅ "Para: +5549999999999\n[mensaje]"
✅ "Enviar a: 5549999999999\n[mensaje]"
✅ "To: +55 49 99999-9999\n[mensaje]"
✅ "Destino: 5549999999999\n[mensaje]"
✅ "5549999999999\n[mensaje]" (número al inicio)
```

---

## 🧪 Testing

### Tests Creados (30+ casos)

```bash
✓ detecta alertas con palabra "Ticket"
✓ detecta alertas con "ALERTA MT5"
✓ detecta alertas con información de trading
✓ no detecta mensajes normales
✓ parsea alerta crítica completa
✓ parsea alerta con SL/TP configurados
✓ parsea alerta con profit positivo
✓ formatea alerta completa correctamente
✓ usa emoji correcto según nivel
✓ usa emoji correcto según tipo de operación
✓ muestra emoji de profit correcto
✓ procesa alerta MT5 y retorna true
✓ maneja errores al enviar mensaje
```

### Ejecutar Tests

```bash
# Todos los tests
npm test

# Solo MT5
npm test tests/unit/mt5-detector.test.js

# Con coverage
npm run test:coverage
```

---

## 🎨 Transformación Visual

### ANTES (Mensaje Original)
```
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

### DESPUÉS (Mensaje Formateado)
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

**Mejoras:**
- ✅ Emojis contextuales (📈 BUY, 📛 pérdida)
- ✅ Texto en negrita para info clave
- ✅ Formato más limpio y profesional
- ✅ Emojis de sección (💵 Balance, 💡 Recomendación, ⏰ Hora)

---

## 🔗 Integración con Sistema Existente

### Compatible con:
- ✅ Sesiones FX (usa `fx-session.js`)
- ✅ Sistema de suscripciones
- ✅ Base de datos (preparado para logging)
- ✅ Módulo GPSwox (no interfiere)
- ✅ Auto-respuesta IA (tiene prioridad)

### No Interfiere con:
- ✅ Webhook forwarding
- ✅ Mensajes manuales del usuario
- ✅ Historias de WhatsApp (status@broadcast)
- ✅ Mensajes de grupos

---

## 💡 Casos de Uso

### 1. Trading Individual
**Usuario:** Trader que usa MT5
**Beneficio:** Recibe alertas formateadas automáticamente
**Flujo:** MT5 → WhatsApp personal → Sistema detecta → Formatea → Guarda

### 2. Grupo de Trading
**Usuario:** Administrador de señales
**Beneficio:** Distribuye alertas a múltiples traders
**Flujo:** MT5 → Sistema → Detecta → Envía a 10+ suscriptores FX

### 3. Monitor de Cuentas
**Usuario:** Gestor de capital
**Beneficio:** Monitorea múltiples cuentas MT5
**Flujo:** Varias cuentas MT5 → Sistema unifica → Envía dashboard consolidado

### 4. Alertas Críticas
**Usuario:** Risk Manager
**Beneficio:** Notificación inmediata de pérdidas
**Flujo:** MT5 pérdida > 5% → Sistema detecta "CRITICO" → Envía alerta urgente

---

## 📈 Próximos Pasos Sugeridos

### Corto Plazo (Semana 1-2)
- [ ] Probar con alertas MT5 reales
- [ ] Configurar primeros suscriptores FX
- [ ] Ajustar formateo según feedback
- [ ] Monitorear logs y performance

### Medio Plazo (Mes 1)
- [ ] Almacenar alertas en base de datos
- [ ] Dashboard de alertas del día
- [ ] Reportes semanales de trading
- [ ] Filtros por símbolo (solo EUR, solo USD, etc.)

### Largo Plazo (Mes 2-3)
- [ ] Integración directa API MT5
- [ ] Alertas proactivas (antes de SL)
- [ ] Machine Learning para predicciones
- [ ] Panel de control web

---

## 🚀 Cómo Empezar a Usar

### 1. Asegúrate que el servidor está corriendo
```bash
node server-baileys-new.js
```

### 2. Conéctate con una sesión de WhatsApp
```bash
# El bot debe tener una sesión activa de WhatsApp
# Al iniciar, escanea el QR code con tu WhatsApp
```

### 3. Envía mensaje con número destino

**Formato requerido:**
```
Para: +5549999999999
[Tu mensaje aquí]
```

**Ejemplos:**

#### Mensaje MT5 Completo
```
Para: +5549888888888
🚨 ALERTA MT5 - CRITICO

Ticket: #220141699
Simbolo: EURUSD | BUY 0.01 lot
Apertura: 1.08549 | Actual: 1.03499
SL: NO CONFIGURADO | TP: NO CONFIGURADO
Profit: $-5.00 (-5%)
Balance: $995.00

Recomendacion: Cerrar posicion para evitar mayores perdidas.
```

#### Mensaje Simple
```
Enviar a: 5511777777777
Hola, esta es una notificación de trading.
```

### 4. Verifica logs en consola
```
📊 Detectada alerta MT5/FX, procesando...
🎯 Número destino extraído: 5549999999999
✨ Mensaje formateado con emojis y estructura MT5
✅ Mensaje FX enviado exitosamente a 5549999999999
```

### 5. El destinatario recibe el mensaje

El número **5549999999999** recibirá el mensaje formateado automáticamente.

---

## 📝 Formatos de Número Destino Soportados

```
✅ "Para: +5549999999999"
✅ "Enviar a: 5549999999999"  
✅ "To: +55 49 99999-9999"
✅ "Destino: 5549999999999"
✅ "5549999999999" (número al inicio del mensaje)
```

El sistema limpia automáticamente:
- Espacios
- Guiones
- Paréntesis
- Símbolos + al inicio

---

## 📚 Documentación Relacionada

- [MT5_MODULE.md](./MT5_MODULE.md) - Documentación técnica completa
- [FX_MODULE.md](./FX_MODULE.md) - Sistema de sesiones FX
- [GPSWOX_MODULE.md](./GPSWOX_MODULE.md) - Módulo de rastreo de vehículos
- [REFACTORIZACIÓN_COMPLETADA.md](./REFACTORIZACIÓN_COMPLETADA.md) - Arquitectura general

---

## 🎉 Resumen

### ✅ Completado
- ✅ Detección automática de mensajes FX/MT5
- ✅ Extracción de número destino del mensaje
- ✅ Parsing de información MT5 (ticket, profit, etc.)
- ✅ Formateo con emojis contextuales (opcional)
- ✅ Reenvío directo al número especificado
- ✅ Soporte múltiples formatos de número
- ✅ Integración con sistema existente
- ✅ Tests completos (30+ casos)
- ✅ Documentación completa

### 🎯 Resultado
Sistema completamente funcional que opera como **proxy/forwarding**:
1. **Recibe** mensajes con número destino
2. **Detecta** si contiene keywords ("Ticket", etc.)
3. **Extrae** número destino del mensaje
4. **Formatea** si tiene estructura MT5 (opcional)
5. **Reenvía** solo al número especificado
6. **Registra** todo en logs

### 💡 Casos de Uso

#### 1. Bot de Trading → Clientes
```
Bot MT5 genera alerta
→ Envía a tu sistema: "Para: +5549999999999\n[alerta]"
→ Tu sistema reenvía al cliente final
```

#### 2. Sistema de Notificaciones
```
Servidor backend
→ Envía notificación: "Enviar a: +5511888888888\nSaldo: $1000"
→ Cliente recibe notificación por WhatsApp
```

#### 3. Forwarding Condicional
```
Sistema detecta condición crítica
→ Envía alerta formateada a trader específico
→ Trader recibe mensaje enriquecido con emojis
```

**¡El sistema de proxy FX está listo para usar!** 🚀

---

**Última actualización:** 2024
**Versión:** 1.0.0
**Estado:** ✅ Implementación Completada
