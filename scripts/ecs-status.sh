#!/bin/bash
# V3 ECS 状态检查 (在 Mac 上跑)
ECS_IP="${ECS_IP:-47.242.58.70}"
APP_DIR=/opt/insurance-ppt

echo "=== V3 ECS Status ==="
echo "ECS IP: $ECS_IP"
echo ""

# 1. ECS 进程
echo "[1] Bun server 进程状态:"
ssh -o BatchMode=yes root@$ECS_IP "
  if [ -f $APP_DIR/logs/server.pid ]; then
    PID=\$(cat $APP_DIR/logs/server.pid)
    if kill -0 \$PID 2>/dev/null; then
      echo \"  ✓ RUNNING (PID=\$PID)\"
      ps -p \$PID -o pid,etime,rss,command | tail -1
    else
      echo \"  ✗ PID file exists but process dead\"
    fi
  else
    echo \"  ✗ NOT RUNNING (no PID file)\"
  fi
"

echo ""
echo "[2] 公网访问测试:"
LOCAL=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000 2>&1 || echo "FAIL")
PUBLIC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://ppt.gllpsce.cn 2>&1 || echo "FAIL")
echo "  localhost:3000     -> $LOCAL (Mac 本地, 备用)"
echo "  ppt.gllpsce.cn     -> $PUBLIC (公网域名)"

echo ""
echo "[3] ECS 资源:"
ssh -o BatchMode=yes root@$ECS_IP "
  echo -n '  CPU: '; uptime | awk -F'load average:' '{print \$2}'
  echo -n '  Mem: '; free -h | grep Mem | awk '{print \$3 \"/\" \$2}'
  echo -n '  Disk: '; df -h / | tail -1 | awk '{print \$3 \"/\" \$2 \" (\" \$5 \")\"}'
"
