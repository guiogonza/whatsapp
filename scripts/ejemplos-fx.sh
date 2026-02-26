# Ejemplo de notificación FX desde cURL

# 1. Señal de Trading
curl -X POST http://localhost:3010/api/fx/notify \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
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
  }'

# 2. Alerta de Precio
curl -X POST http://localhost:3010/api/fx/notify \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "type": "alert",
    "accountNumber": "12345678",
    "webhookSecret": "mt5_secret_2026",
    "data": {
      "symbol": "EURUSD",
      "currentPrice": 1.0850,
      "alertType": "STOP_LOSS",
      "alertPrice": 1.0800,
      "position": "BUY"
    }
  }'

# 3. Posición Abierta
curl -X POST http://localhost:3010/api/fx/notify \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "type": "position",
    "accountNumber": "12345678",
    "webhookSecret": "mt5_secret_2026",
    "data": {
      "action": "OPENED",
      "ticket": 12345,
      "type": "BUY",
      "symbol": "EURUSD",
      "volume": 0.1,
      "openPrice": 1.0850,
      "stopLoss": 1.0800,
      "takeProfit": 1.0950
    }
  }'

# 4. Reporte de Cuenta
curl -X POST http://localhost:3010/api/fx/notify \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "type": "account",
    "accountNumber": "12345678",
    "webhookSecret": "mt5_secret_2026",
    "data": {
      "accountNumber": "12345678",
      "balance": 10000.00,
      "equity": 10150.00,
      "margin": 1000.00,
      "freeMargin": 9150.00,
      "marginLevel": 1015.00,
      "profit": 150.00,
      "openPositions": 2
    }
  }'

# 5. Suscribir Usuario
curl -X POST http://localhost:3010/api/fx/subscribe \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "phoneNumber": "573123456789",
    "accountNumber": "12345678",
    "notificationTypes": ["signal", "alert", "position", "account"]
  }'

# 6. Ver Estadísticas
curl http://localhost:3010/api/fx/stats \
  -H "x-api-key: YOUR_API_KEY"

# 7. Ver Historial
curl http://localhost:3010/api/fx/history?limit=20 \
  -H "x-api-key: YOUR_API_KEY"

# 8. Ver Suscriptores
curl http://localhost:3010/api/fx/subscribers \
  -H "x-api-key: YOUR_API_KEY"
