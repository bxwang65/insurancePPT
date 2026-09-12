#!/bin/bash
# ECS ↔ 本地 双向 rsync 同步 (insurance-ppt-v3 ↔ hk-ecs)
#
# 设计原则:
#   - hk-ecs (47.243.245.225) 是 source of truth (hksgtools.cn 实际生产服务器)
#   - 默认 pull (ECS → 本地), 用 --direction push 反向
#   - 默认 --dry-run, 加 --apply 才落地 (保险)
#   - 排除 .env / users.json / downloads / outputs / sessions / *.bak.* 等本地专属或生产数据
#   - 加 --backup 把本地被覆盖文件存到 .rsync-backup-YYYYMMDD-HHMM/
#
# 用法:
#   bash scripts/ecs-sync.sh                              # pull, dry-run
#   bash scripts/ecs-sync.sh --apply                      # pull, 实际覆盖
#   bash scripts/ecs-sync.sh --direction push --apply     # 推本地到 ECS
#   bash scripts/ecs-sync.sh --apply --include-frontend   # 只同步 frontend
#   bash scripts/ecs-sync.sh --apply --backup             # 覆盖前备份本地
#
# 同步子模块 (默认全开, --include-X 只保留指定):
#   --include-backend    /opt/insurance-ppt/{src,scripts,config,docs,package.json,bun.lock,Dockerfile,docker-compose*,insurance-deck}
#   --include-frontend   /opt/4in1/src/{src,public,vite.config.js,index.html,package.json,package-lock.json,.env,STITCH_BRIEF.md}
#   --include-renderer   /opt/insurance-ppt/docker/insurance-deck/ → 本地 docker/insurance-deck/
#   --include-data       /opt/insurance-ppt/data/{products,company-evidence,company-facts*,company-knowledge-index,firebase-service-account.json,template-asset-index,templates,signatures} (排除 users.json)
#
# 注意: 本脚本不能修改 .env, users.json, downloads, outputs, sessions, logs, node_modules。
#   .env 故意: 本地 .env 含 LOCAL dev keys; ECS .env 含 prod keys (GMAIL_APP_PWD 等), 不允许混。

set -euo pipefail

# === ECS 配置 ===
ECS_IP="${ECS_IP:-47.243.245.225}"   # 默认 hk-ecs (用户 2026-08-07 通知: 新服务器)
ECS_ALIAS="${ECS_ALIAS:-hk-ecs}"     # 用 SSH alias (拉 ~/.ssh/config 的 hk-ecs-2026.pem key)
SSH_KEY="${SSH_KEY:-}"               # 用 alias 时留空

LOCAL_REPO="$(cd "$(dirname "$0")"/.. && pwd)"
LOCAL_4IN1_SRC="${LOCAL_4IN1_SRC:-/Users/soldier/Desktop/4in1/src}"

# === 解析参数 ===
DIRECTION="pull"           # pull = ECS→本地, push = 本地→ECS
DRY_RUN=1
DO_BACKUP=0
INCLUDE_BACKEND=0
INCLUDE_FRONTEND=0
INCLUDE_RENDERER=0
INCLUDE_DATA=0
INCLUDE_ALL=1

print_help() {
  sed -n '2,40p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --direction) DIRECTION="$2"; shift 2 ;;
    --apply) DRY_RUN=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --backup) DO_BACKUP=1; shift ;;
    --include-backend)    INCLUDE_BACKEND=1;    INCLUDE_ALL=0; shift ;;
    --include-frontend)   INCLUDE_FRONTEND=1;   INCLUDE_ALL=0; shift ;;
    --include-renderer)   INCLUDE_RENDERER=1;   INCLUDE_ALL=0; shift ;;
    --include-data)       INCLUDE_DATA=1;       INCLUDE_ALL=0; shift ;;
    --ecs-ip) ECS_IP="$2"; shift 2 ;;
    --ecs-alias) ECS_ALIAS="$2"; shift 2 ;;
    -h|--help) print_help ;;
    *) echo "未知参数: $1" >&2; print_help ;;
  esac
done

if [[ $INCLUDE_ALL == 1 ]]; then
  INCLUDE_BACKEND=1
  INCLUDE_FRONTEND=1
  INCLUDE_RENDERER=1
  INCLUDE_DATA=1
fi

# === SSH 参数 (Mac OpenSSH 10.0 ↔ Ubuntu 20.04 OpenSSH 8.2 兼容) ===
SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o PubkeyAcceptedAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
)

if [[ -n "$SSH_KEY" ]]; then
  SSH_OPTS=( -i "$SSH_KEY" "${SSH_OPTS[@]}" )
fi

# 用 alias 时 SSH 自动从 ~/.ssh/config 读 IdentityFile, 否则用 IP+key
if [[ -n "$ECS_ALIAS" && "$ECS_ALIAS" != "ip" ]]; then
  REMOTE_HOST="$ECS_ALIAS"
else
  REMOTE_HOST="root@$ECS_IP"
  if [[ -z "$SSH_KEY" ]]; then
    SSH_KEY="$HOME/.ssh/hk-ecs-2026.pem"
    SSH_OPTS=( -i "$SSH_KEY" "${SSH_OPTS[@]}" )
    chmod 600 "$SSH_KEY" 2>/dev/null || true
  fi
fi

# === 通用 rsync 排除项 ===
COMMON_EXCLUDES=(
  --exclude='.env'
  --exclude='.env.local'
  --exclude='.env.*.local'
  --exclude='node_modules'
  --exclude='node_modules/**'
  --exclude='logs'
  --exclude='logs/**'
  --exclude='public/downloads'
  --exclude='public/downloads/**'
  --exclude='outputs'
  --exclude='outputs/**'
  --exclude='uploads'
  --exclude='uploads/**'
  --exclude='sessions'
  --exclude='sessions/**'
  --exclude='.cache'
  --exclude='.cache/**'
  --exclude='*.log'
  --exclude='*.bak'
  --exclude='*.bak.*'
  --exclude='dist.bak.*'
  --exclude='.DS_Store'
  --exclude='.git'
  --exclude='.git/**'
  --exclude='data/users.json'   # 保留本地 admin 测试账号 (3 个 user@example.com)
  --exclude='.rsync-backup-*'
)

# === dry-run 包装 ===
run_rsync() {
  local src="$1" dst="$2"
  local flags=( -avz --human-readable --progress )
  if [[ $DRY_RUN == 1 ]]; then
    flags+=( --dry-run )
  fi
  if [[ $DO_BACKUP == 1 && $DIRECTION == "pull" ]]; then
    local backup_dir="${LOCAL_REPO}/.rsync-backup-$(date +%Y%m%d-%H%M%S)"
    flags+=( --backup --backup-dir="$backup_dir" )
    echo "→ 覆盖前备份到: $backup_dir"
    mkdir -p "$backup_dir"
  fi
  echo ""
  echo "rsync ${DIRECTION}: $src  →  $dst"
  echo "(dry-run=$DRY_RUN, backup=$DO_BACKUP)"
  rsync "${flags[@]}" "${COMMON_EXCLUDES[@]}" "$src" "$dst"
}

# === SSH 测试连通 ===
echo "=== SSH 连通测试 ==="
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "hostname && date" || {
  echo "✗ SSH 无法连接 $REMOTE_HOST" >&2
  exit 1
}
echo ""

# === 同步子模块 ===
ran_any=0

if [[ $INCLUDE_BACKEND == 1 ]]; then
  ran_any=1
  echo "=== [backend] insurance-ppt src + scripts + docker ==="
  if [[ $DIRECTION == "pull" ]]; then
    # ECS /opt/insurance-ppt/ → 本地 (排除 insurance-deck 这个子目录, 走 --include-renderer)
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/src/" "${LOCAL_REPO}/src/"
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/scripts/" "${LOCAL_REPO}/scripts/"
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/config/" "${LOCAL_REPO}/config/"
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/docs/" "${LOCAL_REPO}/docs/"
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/package.json" "${LOCAL_REPO}/package.json"
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/bun.lock" "${LOCAL_REPO}/bun.lock"
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/Dockerfile" "${LOCAL_REPO}/Dockerfile"
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/docker-compose.yml" "${LOCAL_REPO}/docker-compose.yml"
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/docker-compose.ecs.yml" "${LOCAL_REPO}/docker-compose.ecs.yml"
  else
    # push: 本地 → ECS
    run_rsync "${LOCAL_REPO}/src/" "${REMOTE_HOST}:/opt/insurance-ppt/src/"
    run_rsync "${LOCAL_REPO}/scripts/" "${REMOTE_HOST}:/opt/insurance-ppt/scripts/"
    run_rsync "${LOCAL_REPO}/config/" "${REMOTE_HOST}:/opt/insurance-ppt/config/"
    run_rsync "${LOCAL_REPO}/docs/" "${REMOTE_HOST}:/opt/insurance-ppt/docs/"
    run_rsync "${LOCAL_REPO}/package.json" "${REMOTE_HOST}:/opt/insurance-ppt/package.json"
    run_rsync "${LOCAL_REPO}/bun.lock" "${REMOTE_HOST}:/opt/insurance-ppt/bun.lock"
    run_rsync "${LOCAL_REPO}/Dockerfile" "${REMOTE_HOST}:/opt/insurance-ppt/Dockerfile"
    run_rsync "${LOCAL_REPO}/docker-compose.yml" "${REMOTE_HOST}:/opt/insurance-ppt/docker-compose.yml"
    run_rsync "${LOCAL_REPO}/docker-compose.ecs.yml" "${REMOTE_HOST}:/opt/insurance-ppt/docker-compose.ecs.yml"
  fi
fi

if [[ $INCLUDE_RENDERER == 1 ]]; then
  ran_any=1
  echo "=== [renderer] insurance-deck (Python) ==="
  if [[ $DIRECTION == "pull" ]]; then
    run_rsync "${REMOTE_HOST}:/opt/insurance-ppt/docker/insurance-deck/" "${LOCAL_REPO}/docker/insurance-deck/"
  else
    run_rsync "${LOCAL_REPO}/docker/insurance-deck/" "${REMOTE_HOST}:/opt/insurance-ppt/docker/insurance-deck/"
  fi
fi

if [[ $INCLUDE_FRONTEND == 1 ]]; then
  ran_any=1
  echo "=== [frontend] 4in1 Vue (source only, dist 要本地 npm run build 重生) ==="
  if [[ $DIRECTION == "pull" ]]; then
    # ECS /opt/4in1/src/src/ → 本地 4in1 src root
    # 注意: ECS 路径在 /opt/4in1/src/src/ (多一层 src/), 本地在 /Users/soldier/Desktop/4in1/src/ (根)
    rsync -avz --human-readable --progress \
      --exclude='node_modules' \
      --exclude='node_modules/**' \
      --exclude='.DS_Store' \
      --exclude='*.log' \
      --exclude='.bak.*' \
      "$REMOTE_HOST:/opt/4in1/src/src/" "${LOCAL_4IN1_SRC}/"
    # 顶层 config 文件 (index.html, vite.config.js, package*.json, .env, STITCH_BRIEF.md, public/)
    rsync -avz --human-readable --progress \
      --exclude='node_modules' \
      --exclude='node_modules/**' \
      --exclude='dist' \
      --exclude='dist/**' \
      --exclude='dist.bak.*' \
      --exclude='.DS_Store' \
      --exclude='*.log' \
      --exclude='*.bak' \
      --exclude='*.bak.*' \
      "$REMOTE_HOST:/opt/4in1/src/index.html" "${LOCAL_4IN1_SRC}/index.html"
    rsync -avz --human-readable --progress \
      --exclude='node_modules' \
      --exclude='node_modules/**' \
      --exclude='.DS_Store' \
      "$REMOTE_HOST:/opt/4in1/src/vite.config.js" "${LOCAL_4IN1_SRC}/vite.config.js"
    rsync -avz --human-readable --progress \
      --exclude='node_modules' \
      --exclude='node_modules/**' \
      --exclude='.DS_Store' \
      "$REMOTE_HOST:/opt/4in1/src/package.json" "${LOCAL_4IN1_SRC}/package.json"
    rsync -avz --human-readable --progress \
      --exclude='node_modules' \
      --exclude='node_modules/**' \
      --exclude='.DS_Store' \
      "$REMOTE_HOST:/opt/4in1/src/package-lock.json" "${LOCAL_4IN1_SRC}/package-lock.json"
    rsync -avz --human-readable --progress \
      --exclude='node_modules' \
      --exclude='node_modules/**' \
      --exclude='dist' \
      --exclude='dist/**' \
      --exclude='dist.bak.*' \
      --exclude='.DS_Store' \
      "$REMOTE_HOST:/opt/4in1/src/public/" "${LOCAL_4IN1_SRC}/public/"
  else
    # push: 本地 → ECS (镜像 pull 路径)
    rsync -avz --human-readable --progress \
      --exclude='node_modules' \
      --exclude='node_modules/**' \
      --exclude='.DS_Store' \
      --exclude='*.log' \
      --exclude='*.bak.*' \
      "${LOCAL_4IN1_SRC}/" "$REMOTE_HOST:/opt/4in1/src/src/"
  fi
fi

if [[ $INCLUDE_DATA == 1 ]]; then
  ran_any=1
  echo "=== [data] (排除 users.json, 保留本地 admin 测试账号) ==="
  if [[ $DIRECTION == "pull" ]]; then
    rsync -avz --human-readable --progress \
      --exclude='users.json' \
      --exclude='*.bak' \
      --exclude='*.bak.*' \
      --exclude='.DS_Store' \
      "$REMOTE_HOST:/opt/insurance-ppt/data/" "${LOCAL_REPO}/data/"
  else
    rsync -avz --human-readable --progress \
      --exclude='users.json' \
      --exclude='*.bak' \
      --exclude='*.bak.*' \
      --exclude='.DS_Store' \
      "${LOCAL_REPO}/data/" "$REMOTE_HOST:/opt/insurance-ppt/data/"
  fi
fi

if [[ $ran_any == 0 ]]; then
  echo "✗ 没选任何 --include-* 开关, 啥也没干" >&2
  print_help
fi

echo ""
echo "✓ 同步脚本执行完"
echo "  direction: $DIRECTION"
echo "  dry-run:   $DRY_RUN"
echo "  backup:    $DO_BACKUP"
echo "  modules:   backend=$INCLUDE_BACKEND frontend=$INCLUDE_FRONTEND renderer=$INCLUDE_RENDERER data=$INCLUDE_DATA"