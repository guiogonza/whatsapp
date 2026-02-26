# 📊 Módulo FX - MetaTrader5 Notifications

Sistema de notificaciones de trading para MetaTrader5 integrado con WhatsApp.

## 🎯 Características

- **Sesiones dedicadas**: Sesiones de WhatsApp exclusivas para notificaciones de trading
- **Múltiples tipos de notificaciones**: Señales, alertas, posiciones, reportes de cuenta, noticias
- **Sistema de suscripciones**: Los usuarios pueden suscribirse a cuentas específicas de trading
- **Formato profesional**: Mensajes formateados con emojis y estructura clara
- **Webhooks seguros**: Validación de secret para autenticar webhooks desde MT5
- **Estadísticas detalladas**: Tracking de notificaciones enviadas y suscriptores
- **Alta prioridad**: Baja latencia para notificaciones críticas de trading

## 📋 Tipos de Notificaciones

### 1. **Señales de Trading** (`signal`)
```javascript
{
  type: "BUY/SELL",
  symbol: "EURUSD",
  entry: 1.0850,
  stopLoss: 1.0800,
  takeProfit: 1.0950,
  lotSize: 0.1,
  timeframe: "H1",
  reason: "Breakout strategy"
}
```

### 2. **Alertas de Precio** (`alert`)
```javascript
{
  symbol: "EURUSD",
  currentPrice: 1.0850,
  alertType: "STOP_LOSS/TAKE_PROFIT",
  alertPrice: 1.0800,
  position: "BUY/SELL"
}
```

### 3. **Posiciones** (`position`)
```javascript
{
  action: "OPENED/CLOSED/MODIFIED",
  ticket: 12345,
  type: "BUY/SELL",
  symbol: "EURUSD",
  volume: 0.1,
  openPrice: 1.0850,
  closePrice: 1.0950,
  profit: 100.50,
  stopLoss: 1.0800,
  takeProfit: 1.0950
}
```

### 4. **Reporte de Cuenta** (`account`)
```javascript
{
  accountNumber: "12345678",
  balance: 10000.00,
  equity: 10150.00,
  margin: 1000.00,
  freeMargin: 9150.00,
  marginLevel: 1015.00,
  profit: 150.00,
  openPositions: 2
}
```

### 5. **Noticias del Mercado** (`news`)
```javascript
{
  title: "US NFP Report",
  impact: "HIGH/MEDIUM/LOW",
  currency: "USD",
  forecast: "200K",
  previous: "185K",
  actual: "210K"
}
```

### 6. **Mensaje Personalizado** (`custom`)
```javascript
{
  title: "NOTIFICACIÓN",
  message: "Mensaje personalizado aquí"
}
```

## 🚀 Configuración

### Variables de Entorno (.env)

```bash
# Sesiones FX dedicadas (separadas por coma)
FX_SESSION_NAMES=fx-session-1,fx-session-2

# Modo dedicado: true = solo envían notificaciones FX
FX_DEDICATED_MODE=true

# API de MetaTrader5 (opcional)
MT5_API_BASE_URL=https://api.metatrader5.com
MT5_API_KEY=your_mt5_api_key

# Secret para validar webhooks
MT5_WEBHOOK_SECRET=mt5_secret_2026
```

## 📡 API Endpoints

### Crear Sesión FX

**POST** `/api/fx/session/create`

```json
{
  "sessionName": "fx-session-1"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Sesión FX 'fx-session-1' creada exitosamente",
  "sessionName": "fx-session-1",
  "dedicatedMode": true,
  "qr": "data:image/png;base64,..."
}
```

### Crear Todas las Sesiones FX

**POST** `/api/fx/sessions/create-all`

**Response:**
```json
{
  "success": true,
  "message": "Proceso completado para 2 sesiones",
  "dedicatedMode": true,
  "results": [
    {
      "sessionName": "fx-session-1",
      "success": true,
      "message": "Creada exitosamente",
      "qr": "..."
    }
  ]
}
```

### Enviar Notificación (Webhook desde MT5)

**POST** `/api/fx/notify`

```json
{
  "type": "signal",
  "accountNumber": "12345678",
  "webhookSecret": "mt5_secret_2026",
  "data": {
    "type": "BUY",
    "symbol": "EURUSD",
    "entry": 1.0850,
    "stopLoss": 1.0800,
    "takeProfit": 1.0950,
    "lotSize": 0.1,
    "timeframe": "H1",
    "reason": "Breakout strategy"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Notificación procesada",
  "sent": 5,
  "failed": 0,
  "results": [
    {
      "phone": "573123456789",
      "success": true
    }
  ]
}
```

### Suscribir Usuario

**POST** `/api/fx/subscribe`

```json
{
  "phoneNumber": "573123456789",
  "accountNumber": "12345678",
  "notificationTypes": ["signal", "alert", "position"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Suscripción exitosa"
}
```

### Desuscribir Usuario

**POST** `/api/fx/unsubscribe`

```json
{
  "phoneNumber": "573123456789",
  "accountNumber": "12345678"
}
```

### Listar Suscriptores

**GET** `/api/fx/subscribers`

**Response:**
```json
{
  "success": true,
  "count": 10,
  "subscribers": [
    {
      "phoneNumber": "573123456789",
      "accounts": ["12345678", "87654321"],
      "notificationTypes": ["signal", "alert", "position"]
    }
  ]
}
```

### Obtener Suscriptores de una Cuenta

**GET** `/api/fx/subscribers/:accountNumber`

**Response:**
```json
{
  "success": true,
  "accountNumber": "12345678",
  "count": 5,
  "subscribers": ["573123456789", "573987654321"]
}
```

### Estadísticas

**GET** `/api/fx/stats`

**Response:**
```json
{
  "success": true,
  "totalSent": 1250,
  "totalSubscribers": 45,
  "totalAccounts": 10,
  "byType": {
    "signal": 450,
    "alert": 300,
    "position": 250,
    "account": 150,
    "news": 80,
    "custom": 20
  },
  "byAccount": {
    "12345678": 600,
    "87654321": 650
  },
  "errors": 5,
  "lastNotification": "2026-02-26T15:30:00.000Z",
  "accountDetails": [
    {
      "account": "12345678",
      "subscribers": 25
    }
  ]
}
```

### Historial

**GET** `/api/fx/history?limit=50`

**Response:**
```json
{
  "success": true,
  "count": 50,
  "history": [
    {
      "type": "signal",
      "accountNumber": "12345678",
      "message": "📈 *SEÑAL DE TRADING*\n\n*Tipo:* BUY...",
      "recipients": 5,
      "sent": 5,
      "timestamp": "2026-02-26T15:30:00.000Z"
    }
  ]
}
```

### Tipos de Notificaciones Disponibles

**GET** `/api/fx/types`

**Response:**
```json
{
  "success": true,
  "types": ["signal", "alert", "position", "account", "news", "custom"],
  "descriptions": {
    "signal": "Señales de trading (BUY/SELL)",
    "alert": "Alertas de precio (Stop Loss, Take Profit)",
    "position": "Apertura/cierre de posiciones",
    "account": "Reportes de cuenta (Balance, Equity, Margin)",
    "news": "Noticias del mercado Forex",
    "custom": "Mensajes personalizados"
  }
}
```

## 💻 Uso desde MetaTrader5

### Ejemplo MQL5 (Expert Advisor)

```mql5
//+------------------------------------------------------------------+
//| Enviar notificación de señal                                      |
//+------------------------------------------------------------------+
void SendTradingSignal(string signal_type, string symbol, double entry, double sl, double tp)
{
    string url = "https://tu-servidor.com/api/fx/notify";
    string headers = "Content-Type: application/json\r\n";
    char post[], result[];
    string json = StringFormat(
        "{\"type\":\"signal\",\"accountNumber\":\"%s\",\"webhookSecret\":\"%s\",\"data\":{\"type\":\"%s\",\"symbol\":\"%s\",\"entry\":%f,\"stopLoss\":%f,\"takeProfit\":%f,\"lotSize\":%f,\"timeframe\":\"%s\",\"reason\":\"Expert Advisor Signal\"}}",
        AccountInfoString(ACCOUNT_LOGIN),
        "mt5_secret_2026",
        signal_type,
        symbol,
        entry,
        sl,
        tp,
        0.1,
        "H1"
    );
    
    StringToCharArray(json, post);
    int res = WebRequest("POST", url, headers, 5000, post, result, headers);
    
    if(res == 200)
    {
        Print("✅ Señal enviada exitosamente");
    }
    else
    {
        Print("❌ Error enviando señal: ", res);
    }
}

//+------------------------------------------------------------------+
//| Llamar cuando se abre una posición                               |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
    if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
    {
        // Enviar notificación de posición abierta
        SendPositionNotification(trans);
    }
}
```

## 🔒 Seguridad

- **Webhook Secret**: Todas las notificaciones deben incluir el secret configurado
- **API Key**: Opcionalmente se puede configurar autenticación API con X-API-Key header
- **Validación**: Los números de cuenta y símbolos se validan antes de procesar

## 📊 Base de Datos

El sistema crea automáticamente la tabla `fx_notifications`:

```sql
CREATE TABLE fx_notifications (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL,
    type VARCHAR(50) NOT NULL,
    account_number VARCHAR(20),
    message TEXT NOT NULL,
    recipients INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🛠️ Desarrollo

### Tests Unitarios

```bash
npm run test:unit
```

### Tests de Integración

```bash
# Asegúrate de que el servidor esté corriendo
npm start

# En otra terminal
npm run test:integration
```

## 📝 Ejemplos Adicionales

### Notificación de Cierre de Posición

```javascript
const notification = {
  type: 'position',
  accountNumber: '12345678',
  webhookSecret: 'mt5_secret_2026',
  data: {
    action: 'CLOSED',
    ticket: 12345,
    type: 'BUY',
    symbol: 'EURUSD',
    volume: 0.1,
    openPrice: 1.0850,
    closePrice: 1.0950,
    profit: 100.50
  }
};
```

### Alerta de Stop Loss

```javascript
const notification = {
  type: 'alert',
  accountNumber: '12345678',
  webhookSecret: 'mt5_secret_2026',
  data: {
    symbol: 'GBPJPY',
    currentPrice: 189.50,
    alertType: 'STOP_LOSS',
    alertPrice: 189.00,
    position: 'BUY'
  }
};
```

### Reporte Diario de Cuenta

```javascript
const notification = {
  type: 'account',
  accountNumber: '12345678',
  webhookSecret: 'mt5_secret_2026',
  data: {
    accountNumber: '12345678',
    balance: 10000.00,
    equity: 10150.00,
    margin: 1000.00,
    freeMargin: 9150.00,
    marginLevel: 1015.00,
    profit: 150.00,
    openPositions: 2
  }
};
```

## 🤝 Soporte

Para reportar problemas o solicitar funcionalidades, contacta al equipo de desarrollo.

## 📄 Licencia

Uso interno - Todos los derechos reservados
