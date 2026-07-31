#!/bin/bash
# V3 停止脚本
set -e
cd "$(dirname "$0")/.."

PID_FILE="$(pwd)/logs/server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "[stop] No PID file, nothing to stop"
  exit 0
fi

PID=$(cat "$PID_FILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  sleep 1
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID"
    echo "[stop] Force killed PID=$PID"
  else
    echo "[stop] Gracefully stopped PID=$PID"
  fi
fi
rm -f "$PID_FILE"
