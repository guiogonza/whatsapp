# 📊 Módulo de Detección y Reenvío de Alertas MT5

## Descripción

Sistema automático de detección y procesamiento de alertas de MetaTrader 5 (MT5) que identifica notificaciones de trading y las reenvía a través de sesiones FX de WhatsApp.

## 🎯 Características Principales

### 1. Detección Automática
- ✅ Identifica mensajes que contienen palabras clave de MT5
- ✅ Detecta alertas de diferentes tipos (críticas, advertencias, informativas)
- ✅ Procesa mensajes en tiempo real sin intervención manual

### 2. Parsing Inteligente
- ✅ Extrae información estructurada de alertas MT5:
  - Número de ticket
  - Símbolo y tipo de operación (BUY/SELL)
  - Precios (apertura, actual, SL, TP)
  - Profit/Loss y porcentajes
  - Balance actual
  - Recomendaciones
  - Timestamp

### 3. Formateo Mejorado
- ✅ Convierte alertas a formato WhatsApp con emojis
- ✅ Emojis contextuales según:
  - Nivel de alerta (🚨 CRÍTICO, ⚠️ ADVERTENCIA, ℹ️ INFO)
  - Tipo de operación (📈 COMPRA, 📉 VENTA)
  - Estado de profit (💰 Ganancia, 📛 Pérdida)
- ✅ Texto con formato Markdown para WhatsApp

### 4. Reenvío Automático
- ✅ Distribuye alertas a suscriptores FX
- ✅ Respeta preferencias de notificación
- ✅ Fallback al remitente si no hay suscriptores

## 📁 Estructura de Archivos

```
lib/session/
  └── mt5-detector.js          # Detector y procesador de alertas MT5
tests/
  └── unit/
      └── mt5-detector.test.js  # Tests unitarios del detector
```

## 🔧 Configuración

### Palabras Clave de Detección

El sistema detecta mensajes que contengan:
- `ticket`
- `alerta mt5`
- `simbolo:`
- `apertura:`
- `profit:`
- `balance:`
- `stop loss`
- `take profit`

### Integración con Core.js

La detección se ejecuta **antes** de cualquier otra lógica de mensajes:
1. Mensaje entrante recibido
2. **Detección MT5** (si contiene keywords → procesar y retornar)
3. Auto-respuesta IA
4. Procesos GPSwox
5. Webhook forwarding

## 📊 Ejemplo de Uso

### Mensaje Original Recibido

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

### Mensaje Procesado y Reenviado

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

## 🔌 API del Módulo

### Funciones Principales

#### `isMT5Alert(text)`
Detecta si un mensaje es una alerta de MT5.

```javascript
const mt5Detector = require('./lib/session/mt5-detector');

if (mt5Detector.isMT5Alert(incomingText)) {
    // Es una alerta MT5
}
```

**Parámetros:**
- `text` (string): Texto del mensaje

**Retorna:**
- `boolean`: true si es alerta MT5

---

#### `parseMT5Alert(text)`
Extrae información estructurada de una alerta MT5.

```javascript
const data = mt5Detector.parseMT5Alert(messageText);
console.log(data.ticket);      // "220141699"
console.log(data.symbol);      // "EURUSD"
console.log(data.profit);      // -5.00
```

**Parámetros:**
- `text` (string): Texto de la alerta

**Retorna:**
- `Object`: Objeto con datos extraídos
  - `alertLevel`: "CRITICAL" | "WARNING" | "INFO"
  - `ticket`: Número de ticket
  - `symbol`: Símbolo del par
  - `type`: "BUY" | "SELL"
  - `lots`: Tamaño de lote
  - `openPrice`: Precio de apertura
  - `currentPrice`: Precio actual
  - `stopLoss`: Stop Loss (null si no configurado)
  - `takeProfit`: Take Profit (null si no configurado)
  - `profit`: Profit en dinero
  - `profitPercent`: Profit en porcentaje
  - `balance`: Balance actual
  - `recommendation`: Texto de recomendación
  - `timestamp`: Fecha y hora

---

#### `formatMT5Alert(data, originalText)`
Formatea datos de alerta para WhatsApp.

```javascript
const formatted = mt5Detector.formatMT5Alert(alertData, originalText);
```

**Parámetros:**
- `data` (Object): Datos extraídos por parseMT5Alert
- `originalText` (string): Texto original (fallback)

**Retorna:**
- `string`: Mensaje formateado con emojis y markdown

---

#### `processMT5Alert(senderPhone, messageText, sendMessageFunction)`
Procesa y reenvía alerta a suscriptores FX.

```javascript
const sendMsg = async (phone, text) => {
    return await sendMessageWithRetry(socket, phone, text, sessionName);
};

const success = await mt5Detector.processMT5Alert(
    senderPhone,
    incomingText,
    sendMsg
);
```

**Parámetros:**
- `senderPhone` (string): Número del remitente
- `messageText` (string): Texto del mensaje
- `sendMessageFunction` (Function): Función para enviar mensajes

**Retorna:**
- `Promise<boolean>`: true si se procesó exitosamente

---

## 🧪 Testing

### Ejecutar Tests

```bash
# Todos los tests
npm test

# Solo tests de MT5
npm test tests/unit/mt5-detector.test.js

# Con coverage
npm run test:coverage
```

### Cobertura de Tests

- ✅ Detección de diferentes tipos de alertas
- ✅ Parsing de información completa
- ✅ Formateo con emojis correctos
- ✅ Manejo de errores
- ✅ Casos edge (null, undefined, datos incompletos)

## 📈 Flujo de Procesamiento

```
┌──────────────────────────────────────────────────────────────┐
│  1. Mensaje Entrante con Alerta MT5                          │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  2. Detección Automática (isMT5Alert)                        │
│     ✓ Buscar palabras clave                                  │
│     ✓ Validar contenido                                      │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  3. Parsing de Datos (parseMT5Alert)                         │
│     ✓ Extraer ticket, símbolo, precios                       │
│     ✓ Extraer profit/loss                                    │
│     ✓ Extraer recomendaciones                                │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  4. Formateo para WhatsApp (formatMT5Alert)                  │
│     ✓ Agregar emojis contextuales                            │
│     ✓ Aplicar formato Markdown                               │
│     ✓ Mejorar legibilidad                                    │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  5. Distribución (processMT5Alert)                           │
│     ✓ Obtener suscriptores FX                                │
│     ✓ Enviar a cada suscriptor                               │
│     ✓ Log de resultados                                      │
└──────────────────────────────────────────────────────────────┘
```

## 🔗 Integración con Sesiones FX

El detector MT5 usa el módulo `fx-session` para:
1. Obtener lista de sesiones FX activas
2. Obtener suscriptores según sus preferencias
3. Distribuir alertas a los números correctos

```javascript
const fxSession = require('./fx-session');

// Obtener sesiones FX
const sessions = fxSession.getFXSessionNames(); // ['fx01', 'fx02']

// Obtener suscriptores
const subscribers = fxSession.listAllSubscribers();
// [{ phoneNumber: '5549999999999', types: ['signal', 'alert'] }]
```

## 📊 Estadísticas y Logging

### Logs Generados

- `📊 Detectada alerta MT5, procesando...`
- `📤 Reenviando alerta MT5 por sesiones FX: fx01, fx02`
- `✅ Alerta MT5 enviada a {phoneNumber}`
- `⚠️ No hay sesiones FX configuradas`
- `❌ Error procesando alerta MT5`

### Métricas Disponibles

Las alertas procesadas se pueden rastrear a través de:
- Logs de consola
- Database logs (si se integra)
- FX session stats

## 🚀 Mejoras Futuras

### Versión 1.1 (Planeado)
- [ ] Almacenar alertas en base de datos
- [ ] Dashboard de alertas MT5
- [ ] Filtros personalizados por suscriptor
- [ ] Alertas por rango de profit/loss
- [ ] Notificaciones de cierre de operaciones

### Versión 1.2 (Considerado)
- [ ] Integración directa con API de MT5
- [ ] Alertas proactivas antes de SL
- [ ] Análisis de rendimiento de trades
- [ ] Reportes diarios/semanales
- [ ] Machine Learning para predicciones

## 🐛 Troubleshooting

### Alertas No Detectadas

**Problema:** Las alertas MT5 no se están detectando.

**Solución:**
1. Verificar que el mensaje contenga palabras clave
2. Revisar logs: `📊 Detectada alerta MT5`
3. Verificar formato del mensaje

```javascript
// Debug
console.log('Texto analizado:', incomingText);
console.log('Es MT5?', mt5Detector.isMT5Alert(incomingText));
```

### No se Reenvían Alertas

**Problema:** Se detectan pero no se envían.

**Solución:**
1. Verificar sesiones FX activas: `fxSession.getFXSessionNames()`
2. Verificar suscriptores: `fxSession.listAllSubscribers()`
3. Revisar logs de envío

### Parsing Incorrecto

**Problema:** Información extraída incorrectamente.

**Solución:**
1. Verificar formato del mensaje MT5
2. Agregar regex más flexible
3. Usar log de datos parseados:

```javascript
const data = mt5Detector.parseMT5Alert(text);
console.log('Datos extraídos:', JSON.stringify(data, null, 2));
```

## 📚 Recursos

- [Documentación FX Module](./FX_MODULE.md)
- [Documentación GPSwox Module](./GPSWOX_MODULE.md)
- [MetaTrader 5 Documentation](https://www.mql5.com/en/docs)

## 🤝 Contribuir

Para agregar nuevas funcionalidades:
1. Modificar `lib/session/mt5-detector.js`
2. Agregar tests en `tests/unit/mt5-detector.test.js`
3. Actualizar esta documentación
4. Ejecutar tests: `npm test`

---

**Última actualización:** 2024
**Versión:** 1.0.0
**Autor:** Sistema WhatsApp Docker
