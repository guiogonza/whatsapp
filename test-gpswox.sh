#!/bin/bash

# Test 1: Enviar mensaje inicial para activar menú
echo "=== TEST 1: Enviar mensaje inicial ==="
curl -s -X POST http://localhost:3010/api/send \
  -H 'Content-Type: application/json' \
  -d '{"session":"gpswox-session","phone":"573183499539","message":"test"}' | jq .

sleep 3

# Test 2: Seleccionar opción 3 (Consultar usuario)
echo -e "\n=== TEST 2: Opción 3 - Consultar usuario ==="
curl -s -X POST http://localhost:3010/api/send \
  -H 'Content-Type: application/json' \
  -d '{"session":"gpswox-session","phone":"573183499539","message":"3"}' | jq .

sleep 3

# Test 3: Enviar email de prueba
echo -e "\n=== TEST 3: Enviar email elkins@rastrear.com.co ==="
curl -s -X POST http://localhost:3010/api/send \
  -H 'Content-Type: application/json' \
  -d '{"session":"gpswox-session","phone":"573183499539","message":"elkins@rastrear.com.co"}' | jq .

echo -e "\n=== Pruebas completadas. Revisa los logs del bot ==="
