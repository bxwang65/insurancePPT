#!/bin/bash
# V3 ECS 状态检查 (在 Mac 上跑)
ECS_IP="${ECS_IP:-47.242.58.70}"
APP_DIR=/opt/insurance-ppt
SSH_KEY="${HOME}/.ssh/id_rsa"

# Mac OpenSSH 10.0 vs Ubuntu 20.04 OpenSSH 8.2 兼容 (KEXINIT 卡死的解法)
SSH_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o PubkeyAcceptedAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
)

echo "=== V3 ECS Status ==="
echo "ECS IP: $ECS_IP"
echo ""

# 1. ECS 进程
echo "[1] Bun server 进程状态:"
ssh "${SSH_OPTS[@]}" root@$ECS_IP "
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
ssh "${SSH_OPTS[@]}" root@$ECS_IP "
  echo -n '  CPU: '; uptime | awk -F'load average:' '{print \$2}'
  echo -n '  Mem: '; free -h | grep Mem | awk '{print \$3 \"/\" \$2}'
  echo -n '  Disk: '; df -h / | tail -1 | awk '{print \$3 \"/\" \$2 \" (\" \$5 \")\"}'
"
