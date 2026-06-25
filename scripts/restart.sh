#!/bin/bash
# V3 重启脚本
cd "$(dirname "$0")/.."
bash scripts/stop.sh
sleep 1
bash scripts/start.sh
