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
# Mac OpenSSH 10.0 vs Ubuntu 20.04 OpenSSH 8.2 兼容: 必须显式指定 Kex/HostKey, 不然 KEXINIT 之后无响应
SSH_BASE_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o PubkeyAcceptedAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
)
ssh "${SSH_BASE_OPTS[@]}" root@$ECS_IP "echo SSH_OK" 2>/dev/null || {
  echo "✗ SSH 无密钥登录失败, 请确认 ~/.ssh/id_rsa.pub 已上传到 ECS"
  exit 1
}

echo ""
echo "=== 2. rsync 同步代码 (排除 downloads + .env) ==="
# 关键: --exclude='.env' 防止本地 .env 覆盖 ECS secrets (每个环境的 API key 不同)
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
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  ./ \
  "root@$ECS_IP:$APP_DIR/"

echo ""
echo "=== 3. ECS 上确保依赖 + 重启服务 ==="
ssh "${SSH_BASE_OPTS[@]}" root@$ECS_IP "bash -s" << 'REMOTE_SCRIPT'
set -e
APP_DIR=/opt/insurance-ppt

# soffice (LibreOffice) 用于 PPTX → PDF 预览; ECS 上若缺失则安装并 symlink
if ! command -v soffice >/dev/null 2>&1; then
  echo "  - 安装 libreoffice..."
  DEBIAN_FRONTEND=noninteractive apt-get install -y libreoffice-core libreoffice-impress >/dev/null
fi
mkdir -p /opt/homebrew/bin
ln -sf /usr/bin/soffice /opt/homebrew/bin/soffice
echo "  ✓ soffice: $(readlink -f /opt/homebrew/bin/soffice)"

# insurance-deck 模块 (Python) 用于增强渲染; 若缺失则 rsync
if [ ! -d /opt/insurance-deck/insdeck/render/pptx_renderer.py ]; then
  echo "  - 警告: /opt/insurance-deck 缺失, 渲染会失败"
fi

bash $APP_DIR/scripts/ecs-restart.sh
REMOTE_SCRIPT

echo ""
echo "=== 4. 健康检查 ==="
sleep 2
curl -s -o /dev/null -w "ppt.gllpsce.cn = HTTP %{http_code}, time=%{time_total}s\n" --max-time 10 http://ppt.gllpsce.cn

echo ""
echo "✓ 部署完成"
