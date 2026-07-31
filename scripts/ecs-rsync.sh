#!/bin/bash
# V3 一键 rsync 到 ECS 脚本 (在 Mac 上跑)
# 用法: ECS_IP=47.243.x.x bash scripts/ecs-rsync.sh
set -e

ECS_IP="${ECS_IP:?请设置 ECS_IP 环境变量, 例如: ECS_IP=47.243.x.x bash scripts/ecs-rsync.sh}"
APP_DIR=/opt/insurance-ppt

echo "=== 同步代码到 ECS ($ECS_IP:$APP_DIR) ==="
echo "排除: node_modules, logs, public/downloads, .cache, outputs, uploads, sessions, .env (单独传)"
echo ""

rsync -avz --progress \
  --exclude='node_modules' \
  --exclude='logs' \
  --exclude='public/downloads' \
  --exclude='.cache' \
  --exclude='outputs' \
  --exclude='uploads' \
  --exclude='sessions' \
  --exclude='.env' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  /Users/soldier/insurance-ppt-v3/ \
  "root@$ECS_IP:$APP_DIR/"

echo ""
echo "=== 单独传 .env (避免 rsync 全量同步时泄露) ==="
scp /Users/soldier/insurance-ppt-v3/.env "root@$ECS_IP:$APP_DIR/.env"
ssh "root@$ECS_IP" "chmod 600 $APP_DIR/.env && echo '✓ .env 上传并锁定权限'"

echo ""
echo "=== 上传完成 ==="
echo "接下来 SSH 到 ECS 跑部署:"
echo "  ssh root@$ECS_IP"
echo "  bash $APP_DIR/scripts/deploy-ecs.sh"
