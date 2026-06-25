#!/bin/bash
# V3 状态检查
cd "$(dirname "$0")/.."

PID_FILE="$(pwd)/logs/server.pid"

echo "=== V3 Status ==="
echo "Path: $(pwd)"
echo "Version: $(cat VERSION.txt 2>/dev/null | head -1)"
echo ""

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  PID=$(cat "$PID_FILE")
  echo "Server: RUNNING (PID=$PID)"
  ps -p "$PID" -o pid,etime,rss,command 2>/dev/null | tail -1
else
  echo "Server: NOT RUNNING"
fi

echo ""
echo "=== Health Check ==="
LOCAL=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000 2>&1 || echo "FAIL")
echo "localhost:3000      -> $LOCAL"
PUBLIC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://ppt.gllpsce.cn 2>&1 || echo "FAIL")
echo "https://ppt.gllpsce.cn -> $PUBLIC"

echo ""
echo "=== Tunnel ==="
TUNNEL_PID=$(pgrep -f "cloudflared.*14ae1918" | head -1)
if [ -n "$TUNNEL_PID" ]; then
  echo "Cloudflared: RUNNING (PID=$TUNNEL_PID)"
else
  echo "Cloudflared: NOT RUNNING (start: cloudflared tunnel run 14ae1918-7d62-4a2c-b74d-bf6367449cc3 &)"
fi
