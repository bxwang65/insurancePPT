#!/bin/bash
# V3 frp 停止
set -e
cd "$(dirname "$0")/.."

PID_FILE="$(pwd)/logs/frpc.pid"
if [ ! -f "$PID_FILE" ]; then
  echo "[stop-frp] No PID file"
  exit 0
fi

PID=$(cat "$PID_FILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  sleep 1
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID"
    echo "[stop-frp] Force killed PID=$PID"
  else
    echo "[stop-frp] Gracefully stopped PID=$PID"
  fi
fi
rm -f "$PID_FILE"
