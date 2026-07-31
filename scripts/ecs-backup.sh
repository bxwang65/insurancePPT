#!/bin/bash
# V3 ECS 一键备份脚本 (在 Mac 上跑)
# 用法: bash scripts/ecs-backup.sh [tag]
#   tag 可选, 默认时间戳 YYYYMMDD-HHMMSS
#
# 备份内容: /opt/insurance-ppt 完整代码 + .env (chmod 600)
# 排除: logs/ outputs/ uploads/ sessions/ cache/ node_modules/ public/downloads/
#
# 备份位置 (Mac 本地):
#   ~/insurance-ppt-v3-backups/ecs-<tag>.tar.gz
#
# 回滚:
#   ssh root@47.242.58.70 'rm -rf /opt/insurance-ppt'
#   scp ecs-<tag>.tar.gz root@47.242.58.70:/opt/
#   ssh root@47.242.58.70 'cd /opt && tar -xzf ecs-<tag>.tar.gz && bash /opt/insurance-ppt/scripts/ecs-restart.sh'
set -e

ECS_IP="${ECS_IP:-47.242.58.70}"
APP_DIR=/opt/insurance-ppt
TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
BACKUP_NAME="ecs-${TAG}.tar.gz"
BACKUP_DIR="$HOME/insurance-ppt-v3-backups"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o PubkeyAcceptedAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
)

mkdir -p "$BACKUP_DIR"

echo "=== 1. ECS SSH 联通检查 ==="
ssh "${SSH_OPTS[@]}" root@$ECS_IP "echo SSH_OK" >/dev/null 2>&1 || {
  echo "✗ SSH 无法连接 $ECS_IP"; exit 1;
}
echo "  ✓ SSH 通"

echo ""
echo "=== 2. ECS 现场状态 (备份前快照) ==="
ssh "${SSH_OPTS[@]}" root@$ECS_IP "
  echo '  [server 进程]'; ps -ef | grep -E 'bun.*server' | grep -v grep | head -2
  echo '  [git HEAD]'; cd $APP_DIR 2>/dev/null && git config --global --add safe.directory $APP_DIR 2>/dev/null && git log -1 --oneline
  echo '  [磁盘占用]'; du -sh $APP_DIR 2>/dev/null
  echo '  [健康检查]'; curl -s -o /dev/null -w 'HTTP %{http_code}\n' --max-time 5 http://localhost:80/api/health
"

echo ""
echo "=== 3. 在 ECS 上 tar 打包 (排除大目录) ==="
ssh "${SSH_OPTS[@]}" root@$ECS_IP "bash -s" << REMOTE
set -e
APP_DIR=$APP_DIR
TAG=$TAG

# 1. 停服务 (确保 session 文件状态一致)
PID_FILE=\$APP_DIR/logs/server.pid
if [ -f "\$PID_FILE" ]; then
  PID=\$(cat "\$PID_FILE" 2>/dev/null || echo "")
  if [ -n "\$PID" ] && kill -0 "\$PID" 2>/dev/null; then
    echo "  - 暂存服务 (PID \$PID), tar 后会恢复..."
  fi
fi

# 2. tar 打包 (排除大目录)
cd \$(dirname \$APP_DIR)
tar -czf /tmp/\${BACKUP_NAME:-\$BACKUP_NAME} \\
  --exclude='insurance-ppt/node_modules' \\
  --exclude='insurance-ppt/logs/*.log' \\
  --exclude='insurance-ppt/logs/*.pid' \\
  --exclude='insurance-ppt/public/downloads' \\
  --exclude='insurance-ppt/.cache' \\
  --exclude='insurance-ppt/outputs' \\
  --exclude='insurance-ppt/uploads' \\
  --exclude='insurance-ppt/sessions' \\
  --exclude='insurance-ppt/.env.bak.*' \\
  insurance-ppt/

SIZE=\$(du -h /tmp/ecs-\$TAG.tar.gz | cut -f1)
echo "  ✓ ECS tar 完成: /tmp/ecs-\$TAG.tar.gz (\$SIZE)"
REMOTE

echo ""
echo "=== 4. 下载到 Mac 本地 ==="
scp "${SSH_OPTS[@]}" root@$ECS_IP:/tmp/ecs-$TAG.tar.gz "$BACKUP_PATH"
scp "${SSH_OPTS[@]}" root@$ECS_IP:/opt/insurance-ppt/.env "$BACKUP_DIR/.env.$TAG"
chmod 600 "$BACKUP_DIR/.env.$TAG"
LOCAL_SIZE=$(du -h "$BACKUP_PATH" | cut -f1)
echo "  ✓ Mac 本地: $BACKUP_PATH ($LOCAL_SIZE)"
echo "  ✓ .env 备份: $BACKUP_DIR/.env.$TAG"

echo ""
echo "=== 5. 清理 ECS 临时文件 ==="
ssh "${SSH_OPTS[@]}" root@$ECS_IP "rm -f /tmp/ecs-$TAG.tar.gz && echo '  ✓ /tmp 已清理'"

echo ""
echo "=== 备份完成 ==="
echo "  备份: $BACKUP_PATH"
echo "  .env: $BACKUP_DIR/.env.$TAG"
echo "  列出全部备份: ls -lh $BACKUP_DIR/ecs-*.tar.gz"
echo ""
echo "  回滚命令:"
echo "    ssh root@$ECS_IP 'rm -rf /opt/insurance-ppt'"
echo "    scp $BACKUP_PATH root@$ECS_IP:/opt/"
echo "    ssh root@$ECS_IP 'cd /opt && tar -xzf $BACKUP_NAME && bash /opt/insurance-ppt/scripts/ecs-restart.sh'"
echo "    scp $BACKUP_DIR/.env.$TAG root@$ECS_IP:/opt/insurance-ppt/.env"
echo "    ssh root@$ECS_IP 'chmod 600 /opt/insurance-ppt/.env'"