#!/bin/bash
curl -s http://localhost:3010/api/sessions 2>/dev/null | python3 -c "
import json,sys
data=json.load(sys.stdin)
items = data if isinstance(data,list) else data.get('data',[])
for s in items:
    print(s.get('name','?'), s.get('status','?'), s.get('connected','?'))
"
echo "---"
# Try other endpoints
curl -s http://localhost:3010/api/sessions/list 2>/dev/null | head -c 500
echo ""
echo "---"
# Try sending a test message to see format
curl -s http://localhost:3010/api/ 2>/dev/null | head -c 300
