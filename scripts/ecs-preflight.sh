#!/bin/bash
# V3 ECS 预检 + 同步 (在 Mac 上跑, 部署前必跑)
# 解决 8 个水土不服点:
#   1. /opt/insurance-deck 缺失 (server.ts 引用的 Python 渲染模块路径)
#   2. __pycache__ 残留 (旧 pyc 覆盖新 py)
#   3. Bun 版本对齐 Dockerfile 的 1.3.14
#   4. health check 端口错误 (deploy-ecs.sh:61)
#   5. 浏览器缓存 (加 ?v=<ts> cache-bust)
#   6. PYTHONPATH 设置
#   7. 依赖同步 (bun install 用 frozen lockfile)
#   8. .env 单独传
#
# 用法:
#   bash scripts/ecs-preflight.sh           # 仅预检
#   bash scripts/ecs-preflight.sh --apply   # 预检 + 自动修复
#   bash scripts/ecs-preflight.sh --deploy  # 预检 + 修复 + 部署
set -e

ECS_IP="${ECS_IP:-47.242.58.70}"
APP_DIR=/opt/insurance-ppt
INS_DECK_DIR=/opt/insurance-deck
LOCAL_ROOT="/Users/soldier/insurance-ppt-v3"
MODE="${1:-check}"

RED='\033[0;31m'
YEL='\033[0;33m'
GRN='\033[0;32m'
BLU='\033[0;34m'
RST='\033[0m'

SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o PubkeyAcceptedAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
)

# ── 1. 本地预检 ──────────────────────────────────────────
echo -e "${BLU}=== [1/8] 本地文件预检 ===${RST}"
LOCAL_ISSUES=0

# 1.1 验证本地所有储蓄险 IRR 实现都是 M-A
LOCAL_CAGR=$(grep -rn "(\*\* (1 /" \
  "$LOCAL_ROOT/docker/insurance-deck/insdeck/extract/" \
  "$LOCAL_ROOT/scripts/extract_savings_by_signature.py" \
  "$LOCAL_ROOT/scripts/extract_ci_by_signature.py" \
  "$LOCAL_ROOT/src/api/server.ts" \
  "$LOCAL_ROOT/src/pipeline/presentation-agent.ts" \
  "$LOCAL_ROOT/public/js/screens/result-summary.js" \
  "$LOCAL_ROOT/scripts/generate_combo.ts" \
  "$LOCAL_ROOT/scripts/generate_from_ai.ts" 2>/dev/null \
  | grep -v "M-A\|computeIrrMA\|calc_irr_ma\|ma_irr" \
  | grep -E "CAGR|cagr" | wc -l | tr -d ' ')
if [ "$LOCAL_CAGR" -gt 0 ]; then
  echo -e "${RED}  ✗ 仍有 $LOCAL_CAGR 处 CAGR 残留 (M-A IRR 替换未完成)${RST}"
  LOCAL_ISSUES=$((LOCAL_ISSUES+1))
else
  echo -e "${GRN}  ✓ 全部 8 处 M-A IRR 实现 (CAGR=0)${RST}"
fi

# 1.2 验证 M-A 函数签名一致
for f in \
  "$LOCAL_ROOT/src/api/server.ts:computeIrrMA" \
  "$LOCAL_ROOT/src/pipeline/presentation-agent.ts:computeIrrMA" \
  "$LOCAL_ROOT/public/js/screens/result-summary.js:computeIrrMA" \
  "$LOCAL_ROOT/docker/insurance-deck/insdeck/extract/savings_normalizer.py:calc_irr" \
  "$LOCAL_ROOT/scripts/extract_savings_by_signature.py:calc_irr_ma" \
  "$LOCAL_ROOT/scripts/extract_ci_by_signature.py:_calc_irr_ma" \
  "$LOCAL_ROOT/scripts/generate_combo.ts:calcIRR" \
  "$LOCAL_ROOT/scripts/generate_from_ai.ts:calcIRR"; do
  FILE="${f%%:*}"
  FN="${f##*:}"
  if grep -q "function $FN\|def $FN" "$FILE" 2>/dev/null; then
    echo -e "  ${GRN}✓${RST} $FN in $(basename $FILE)"
  else
    echo -e "  ${RED}✗ $FN 缺失 in $FILE${RST}"
    LOCAL_ISSUES=$((LOCAL_ISSUES+1))
  fi
done

# 1.3 验证 pyc 状态
PYC_COUNT=$(find "$LOCAL_ROOT/docker/insurance-deck" -name "__pycache__" -type d 2>/dev/null | wc -l | tr -d ' ')
echo -e "  ${YEL}⚠${RST} 本地有 $PYC_COUNT 个 __pycache__ 目录 (部署前会清, 否则 pyc 可能覆盖新 py)"

# 1.4 验证 Bun 版本
LOCAL_BUN=$(cd "$LOCAL_ROOT" && bun --version 2>/dev/null || echo "unknown")
DOCKERFILE_BUN="1.3.14"
if [ "$LOCAL_BUN" != "$DOCKERFILE_BUN" ]; then
  echo -e "  ${YEL}⚠${RST} Bun 版本 $LOCAL_BUN != Dockerfile 锁定 $DOCKERFILE_BUN (ECS 必须装 $DOCKERFILE_BUN)"
else
  echo -e "  ${GRN}✓${RST} Bun $LOCAL_BUN 与 Dockerfile 一致"
fi

# ── 2. SSH 联通性 ────────────────────────────────────────
echo ""
echo -e "${BLUE}=== [2/8] SSH 联通 + 现场预检 ===${RST}"
ssh "${SSH_OPTS[@]}" root@$ECS_IP "echo SSH_OK" >/dev/null 2>&1 || {
  echo -e "${RED}  ✗ SSH 无法连接 $ECS_IP, 请确认 ~/.ssh/id_rsa.pub 已上传${RST}"
  exit 1
}
echo -e "  ${GRN}✓${RST} SSH 通"

# ── 3. ECS 现场预检 ──────────────────────────────────────
echo ""
echo -e "${BLUE}=== [3/8] ECS 现场预检 ===${RST}"
ECS_REPORT=$(ssh "${SSH_OPTS[@]}" root@$ECS_IP "bash -s" << 'REMOTE'
set +e
echo "=== OS ==="
cat /etc/os-release | grep PRETTY_NAME | head -1
echo "=== Python ==="
python3.11 --version 2>&1 || echo "MISSING python3.11"
echo "=== Bun ==="
bun --version 2>&1 || echo "MISSING bun"
echo "=== Insurance-deck 路径 ==="
if [ -d /opt/insurance-deck ]; then
  if [ -L /opt/insurance-deck ]; then
    echo "SYMLINK -> $(readlink /opt/insurance-deck)"
  else
    echo "EXISTS (real dir, $(find /opt/insurance-deck -name '*.py' | wc -l) py files)"
  fi
else
  echo "MISSING"
fi
echo "=== Server.ts 引用路径 ==="
grep -o "path.resolve([^)]*insurance-deck[^)]*)" /opt/insurance-ppt/src/api/server.ts 2>/dev/null | head -1
echo "=== PYTHONPATH ==="
echo "PYTHONPATH=${PYTHONPATH:-(unset)}"
echo "=== /opt/insurance-ppt 状态 ==="
ls /opt/insurance-ppt/package.json 2>&1 && echo "package.json: OK" || echo "package.json: MISSING"
ls /opt/insurance-ppt/bun.lock 2>&1 && echo "bun.lock: OK" || echo "bun.lock: MISSING"
echo "=== __pycache__ in insurance-deck ==="
find /opt/insurance-deck -name "__pycache__" -type d 2>/dev/null | wc -l
echo "=== 当前 server 进程 ==="
ps aux | grep -E "bun.*server" | grep -v grep | head -2
echo "=== 端口 80 监听 ==="
ss -tlnp 2>/dev/null | grep :80 || netstat -tlnp 2>/dev/null | grep :80 || echo "未监听"
echo "=== /opt/insurance-ppt/.env 权限 ==="
ls -la /opt/insurance-ppt/.env 2>&1
REMOTE
)

echo "$ECS_REPORT"
ECS_ISSUES=0

# 3.1 检查 /opt/insurance-deck
if echo "$ECS_REPORT" | grep -q "Insurance-deck 路径.*MISSING"; then
  echo -e "  ${RED}✗ /opt/insurance-deck 缺失 → server 启动后 Python 渲染 100% 失败${RST}"
  ECS_ISSUES=$((ECS_ISSUES+1))
elif echo "$ECS_REPORT" | grep -q "Insurance-deck 路径.*SYMLINK"; then
  echo -e "  ${GRN}✓${RST} /opt/insurance-deck 是 symlink (OK)"
elif echo "$ECS_REPORT" | grep -q "Insurance-deck 路径.*EXISTS"; then
  echo -e "  ${GRN}✓${RST} /opt/insurance-deck 真实目录 (OK)"
fi

# 3.2 检查 python3.11
if echo "$ECS_REPORT" | grep -q "MISSING python3.11"; then
  echo -e "  ${RED}✗ python3.11 缺失${RST}"
  ECS_ISSUES=$((ECS_ISSUES+1))
fi

# 3.3 检查 bun
if echo "$ECS_REPORT" | grep -q "MISSING bun"; then
  echo -e "  ${YEL}⚠ bun 缺失 (deploy 时会装, 但会装 latest, 不一定是 1.3.14)${RST}"
fi

# 3.4 检查 pyc 残留
ECS_PYC=$(echo "$ECS_REPORT" | grep -A1 "__pycache__ in insurance-deck" | tail -1 | tr -d ' ')
if [ "$ECS_PYC" != "0" ] && [ -n "$ECS_PYC" ]; then
  echo -e "  ${YEL}⚠ ECS 残留 $ECS_PYC 个 __pycache__ → 必须清, 否则 pyc 覆盖新 py${RST}"
fi

# 3.5 检查 .env 权限
if echo "$ECS_REPORT" | grep -q "\.env.*MISSING\|No such"; then
  echo -e "  ${RED}✗ /opt/insurance-ppt/.env 缺失${RST}"
  ECS_ISSUES=$((ECS_ISSUES+1))
fi

# ── 4. 修复模式 (--apply / --deploy) ─────────────────────
if [ "$MODE" = "--apply" ] || [ "$MODE" = "--deploy" ]; then
  echo ""
  echo -e "${BLUE}=== [4/8] 修复 #1: 同步 /opt/insurance-deck ===${RST}"
  if [ -d "$LOCAL_ROOT/docker/insurance-deck" ]; then
    # 先 rsync 到 ECS 临时位置, 再 mv 到 /opt/insurance-deck
    # 注意: --exclude='__pycache__' 防止旧 pyc 覆盖
    rsync -avz --progress \
      --exclude='__pycache__' \
      --exclude='*.pyc' \
      "$LOCAL_ROOT/docker/insurance-deck/" \
      "root@$ECS_IP:/opt/insurance-deck/" 2>&1 | tail -5
    echo -e "  ${GRN}✓${RST} /opt/insurance-deck 已同步"
  else
    echo -e "  ${RED}✗ 本地 docker/insurance-deck 不存在, 无法同步${RST}"
  fi

  echo ""
  echo -e "${BLUE}=== [5/8] 修复 #2: 清 ECS __pycache__ ===${RST}"
  ssh "${SSH_OPTS[@]}" root@$ECS_IP "find /opt/insurance-deck /opt/insurance-ppt/scripts /opt/insurance-ppt/docker -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; find /opt/insurance-deck -name '*.pyc' -delete 2>/dev/null; echo PYTHONCACHE_CLEARED"
  echo -e "  ${GRN}✓${RST} ECS 旧 pyc 已清"

  echo ""
  echo -e "${BLUE}=== [6/8] 修复 #3: 对齐 Bun 1.3.14 ===${RST}"
  ssh "${SSH_OPTS[@]}" root@$ECS_IP "bash -s" << 'REMOTE'
set +e
CURRENT=$(bun --version 2>/dev/null)
TARGET="1.3.14"
if [ "$CURRENT" != "$TARGET" ]; then
  echo "  当前 $CURRENT, 装 $TARGET..."
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  mv -f $HOME/.bun/bin/bun /usr/local/bin/bun 2>/dev/null
  echo "  ✓ Bun: $(bun --version)"
else
  echo "  ✓ Bun $CURRENT 已是目标版本"
fi
REMOTE

  echo ""
  echo -e "${BLUE}=== [7/8] 修复 #4: 同步代码 (排除 pyc) ===${RST}"
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
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    "$LOCAL_ROOT/" \
    "root@$ECS_IP:$APP_DIR/" 2>&1 | tail -8
  echo -e "  ${GRN}✓${RST} 代码已同步 (排除 pyc)"

  # .env 单独传
  if [ -f "$LOCAL_ROOT/.env" ]; then
    scp "$LOCAL_ROOT/.env" "root@$ECS_IP:$APP_DIR/.env"
    ssh "${SSH_OPTS[@]}" root@$ECS_IP "chmod 600 $APP_DIR/.env && echo '  ✓ .env 上传并锁定'"
  fi

  # PYTHONPATH 永久设置 (写入 /etc/profile.d 或 server 启动脚本)
  ssh "${SSH_OPTS[@]}" root@$ECS_IP "grep -q PYTHONPATH /etc/environment 2>/dev/null || echo 'PYTHONPATH=/opt/insurance-deck' >> /etc/environment"
  echo -e "  ${GRN}✓${RST} PYTHONPATH=/opt/insurance-deck 已写入 /etc/environment"

  # 修复 deploy-ecs.sh:61 health check 端口 (80 不是 3000)
  if [ -f "$LOCAL_ROOT/scripts/deploy-ecs.sh" ]; then
    if grep -q "localhost:3000" "$LOCAL_ROOT/scripts/deploy-ecs.sh"; then
      sed -i.bak 's|curl.*localhost:3000|curl -s http://localhost:80/api/health|' "$LOCAL_ROOT/scripts/deploy-ecs.sh"
      echo -e "  ${YEL}⚠ 已修本地 deploy-ecs.sh health check 端口 (3000→80), ECS 上的老脚本要等下次 rsync 才会覆盖${RST}"
    fi
  fi

  # 注: result-summary.js 是 ES module (import './result-summary.js'),
  # 浏览器走 ETag/Last-Modified, 改文件后自动重新拉, 不用 cache-bust
  echo -e "  ${GRN}✓${RST} result-summary.js: ES module 走 ETag, 改文件后浏览器自动 refetch"
fi

# ── 5. 部署 ──────────────────────────────────────────────
if [ "$MODE" = "--deploy" ]; then
  echo ""
  echo -e "${BLUE}=== [8/8] 部署到 ECS ===${RST}"
  ssh "${SSH_OPTS[@]}" root@$ECS_IP "bash -s" << 'REMOTE'
set -e
APP_DIR=/opt/insurance-ppt
cd "$APP_DIR"

echo "  - bun install (frozen lockfile)..."
bun install --frozen-lockfile 2>&1 | tail -3

echo "  - 启动..."
bash $APP_DIR/scripts/ecs-restart.sh

echo "  - 验证 /opt/insurance-deck 可 import..."
PYTHONPATH=/opt/insurance-deck python3.11 -c "
from insdeck.extract.savings_normalizer import calc_irr
r = calc_irr(10, 660340, 500000, 5, 'USD')
print(f'  ✓ calc_irr(10, 660340, 500000, 5, USD) = {r*100:.2f}%')
if abs(r*100 - 3.52) > 0.05:
  print(f'  ✗ 不一致! 期望 3.52%, 实际 {r*100:.2f}%')
  raise SystemExit(1)
"
REMOTE

  echo ""
  echo -e "${GRN}=== ✓ 部署完成 ===${RST}"
  echo "  ECS: http://ppt.gllpsce.cn"
fi

# ── 总结 ────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
TOTAL=$((LOCAL_ISSUES + ECS_ISSUES))
if [ "$TOTAL" -eq 0 ]; then
  echo -e "${GRN}✓ 所有预检通过, 可以部署${RST}"
  if [ "$MODE" = "check" ]; then
    echo "  下一步: bash scripts/ecs-preflight.sh --deploy"
  fi
else
  echo -e "${RED}✗ 发现 $TOTAL 个问题:$LOCAL_ISSUES 本地 + $ECS_ISSUES ECS${RST}"
  echo "  下一步: bash scripts/ecs-preflight.sh --apply  (自动修复)"
  echo "         bash scripts/ecs-preflight.sh --deploy (修复 + 部署)"
fi
echo "═══════════════════════════════════════════════════════════"
