#!/bin/bash
# V3 一键 rsync + 部署到阿里云 HK ECS (在 Mac 上跑)
# 用法: bash scripts/ecs-deploy.sh
set -e

# ECS 配置 (从 V3.0.1 起固定)
ECS_IP="${ECS_IP:-47.242.58.70}"
APP_DIR=/opt/insurance-ppt
SSH_KEY="${HOME}/.ssh/id_rsa"

cd "$(dirname "$0")/.."

echo "=== 1. 测试 SSH 连通 ==="
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 root@$ECS_IP "echo SSH_OK" 2>/dev/null || {
  echo "✗ SSH 无密钥登录失败, 请确认 ~/.ssh/id_rsa.pub 已上传到 ECS"
  exit 1
}

echo ""
echo "=== 2. rsync 同步代码 (排除 downloads) ==="
rsync -avz --progress \
  --exclude='node_modules' \
  --exclude='logs' \
  --exclude='public/downloads' \
  --exclude='.cache' \
  --exclude='outputs' \
  --exclude='uploads' \
  --exclude='sessions' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  ./ \
  "root@$ECS_IP:$APP_DIR/"

echo ""
echo "=== 3. ECS 上重启服务 ==="
ssh -i "$SSH_KEY" -o BatchMode=yes root@$ECS_IP "bash $APP_DIR/scripts/ecs-restart.sh"

echo ""
echo "=== 4. 健康检查 ==="
sleep 2
curl -s -o /dev/null -w "ppt.gllpsce.cn = HTTP %{http_code}, time=%{time_total}s\n" --max-time 10 http://ppt.gllpsce.cn

echo ""
echo "✓ 部署完成"
