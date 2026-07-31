#!/bin/bash
# V3 ECS 重启服务 (在 ECS 上跑)
set -e
APP_DIR=/opt/insurance-ppt
cd "$APP_DIR"

echo "=== [1] 停止旧进程 ==="
if [ -f logs/server.pid ]; then
  PID=$(cat logs/server.pid)
  if kill -0 $PID 2>/dev/null; then
    kill $PID
    sleep 2
    if kill -0 $PID 2>/dev/null; then
      kill -9 $PID
      echo "  Force killed PID=$PID"
    else
      echo "  Gracefully stopped PID=$PID"
    fi
  fi
fi
rm -f logs/server.pid

echo "=== [2] 启动新进程 (port 80) ==="
mkdir -p logs
nohup env PORT=80 bun run src/api/server.ts > logs/server.log 2>&1 &
NEW_PID=$!
disown $NEW_PID 2>/dev/null || true
echo $NEW_PID > logs/server.pid

sleep 3
if kill -0 $NEW_PID 2>/dev/null; then
  echo "  ✓ Started PID=$NEW_PID"
else
  echo "  ✗ Failed, see logs/server.log"
  tail -20 logs/server.log
  exit 1
fi

echo "=== [3] 健康检查 ==="
sleep 2
curl -s http://localhost:80/api/health
echo ""
echo "✓ ECS 服务已重启"
