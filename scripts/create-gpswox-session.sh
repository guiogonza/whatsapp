#!/bin/bash
curl -s -X POST http://localhost:3010/api/sessions/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"gpswox-session"}'
