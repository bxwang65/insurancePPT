#!/bin/bash
# 从 ECS 拉 .env 到本地，保证本地 dev 和 ECS 行为一致
# 用法: bash scripts/sync-env.sh
set -e

ECS_IP="${ECS_IP:-47.242.58.70}"
APP_DIR=/opt/insurance-ppt
LOCAL_ENV="$(dirname "$0")/../.env"

SSH_OPTS=(
  -i "${HOME}/.ssh/id_rsa"
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o PubkeyAcceptedAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
)

if [ ! -f "$LOCAL_ENV" ]; then
  echo "→ 首次同步: 创建本地 .env"
else
  echo "→ 备份现有 .env → .env.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$LOCAL_ENV" "$LOCAL_ENV.bak.$(date +%Y%m%d-%H%M%S)"
fi

scp "${SSH_OPTS[@]}" "root@$ECS_IP:$APP_DIR/.env" "$LOCAL_ENV"
echo "✓ .env 已同步"
echo ""
echo "→ 本地依赖检查:"
command -v python3.11 >/dev/null && echo "  ✓ python3.11: $(python3.11 --version)" || echo "  ✗ python3.11 缺失 (fitz 兜底会挂)"
command -v soffice >/dev/null && echo "  ✓ soffice: $(soffice --version | head -1)" || echo "  ⚠ soffice 缺失 (PPT 预览失败)"
[ -d /opt/insurance-deck ] && echo "  ✓ /opt/insurance-deck" || echo "  ⚠ /opt/insurance-deck 缺失 (渲染失败)"
echo ""
echo "下一步: bun run dev  (启动本地 3000 端口)"