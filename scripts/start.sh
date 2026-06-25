#!/bin/bash
# V3 启动脚本 - nohup 后台守护, 终端关闭不影响
set -e
cd "$(dirname "$0")/.."

LOG_DIR="$(pwd)/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/server.log"
PID_FILE="$LOG_DIR/server.pid"

# 已运行则跳过
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[start] Server already running, PID=$(cat "$PID_FILE")"
  echo "[start] Local: http://localhost:3000"
  echo "[start] Public: https://ppt.gllpsce.cn"
  exit 0
fi

# 清理旧 PID
rm -f "$PID_FILE"

# 启动 (nohup + setsid 让进程完全脱离当前会话)
export PATH="/Users/soldier/.bun/bin:$PATH"
nohup setsid bun run src/api/server.ts > "$LOG_FILE" 2>&1 < /dev/null &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

# 等待启动
sleep 2
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "[start] ✓ Server started, PID=$NEW_PID"
  echo "[start] Log: $LOG_FILE"
  echo "[start] Local: http://localhost:3000"
  echo "[start] Public: https://ppt.gllpsce.cn"
else
  echo "[start] ✗ Failed, see $LOG_FILE"
  cat "$LOG_FILE" | tail -20
  exit 1
fi
