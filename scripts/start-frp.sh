#!/bin/bash
# V3 frp 守护启动
set -e
cd "$(dirname "$0")/.."

LOG_DIR="$(pwd)/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/frpc.log"
PID_FILE="$LOG_DIR/frpc.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[start-frp] Already running, PID=$(cat "$PID_FILE")"
  exit 0
fi
rm -f "$PID_FILE"

FRPC_BIN="/opt/homebrew/bin/frpc"
if [ ! -x "$FRPC_BIN" ]; then
  echo "[start-frp] ✗ frpc not found at $FRPC_BIN"
  exit 1
fi

nohup "$FRPC_BIN" -c "$(pwd)/frpc.toml" > "$LOG_FILE" 2>&1 < /dev/null &
NEW_PID=$!
disown $NEW_PID 2>/dev/null || true
echo "$NEW_PID" > "$PID_FILE"

sleep 3
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "[start-frp] ✓ frpc started, PID=$NEW_PID"
  echo "[start-frp] Log: $LOG_FILE"
  echo "[start-frp] Public URL: http://ppt.gllpsce.cn:58048"
else
  echo "[start-frp] ✗ Failed, see $LOG_FILE"
  tail -20 "$LOG_FILE"
  exit 1
fi
