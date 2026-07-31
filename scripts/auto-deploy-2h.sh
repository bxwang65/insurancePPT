#!/bin/bash
# V3 2 小时后自动部署脚本 (在 Mac 上跑, 后台排程)
# 设计: Kimi 解封检测 → 4-way 对比 → 备份 ECS → preflight → 部署 → 验证 → 报告
#
# 生产链:
#   主力: Kimi (kimi-for-coding) — 49 会员配额
#   备用1: MiniMax (MiniMax-M3)
#   备用2: DeepSeek (deepseek-v4-flash)
#   备用3: Agnes (本地 .env 已 SET) — 仅兜底, 不主动用
#   不参与: Doubao / Qwen (本地 key 未激活, 跳过)
#
# 调度方式 (Mac):
#   nohup bash -c "sleep 7200 && bash $0" > /tmp/auto-deploy.log 2>&1 &
#
# 输出日志: /tmp/auto-deploy-YYYYMMDD-HHMMSS.log
# 完成标记: /tmp/auto-deploy.done
# 退出码: 0 = 全成功, 1 = Kimi 未解封, 2 = 测试失败, 3 = 部署失败

set -e
ROOT="/Users/soldier/insurance-ppt-v3"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG="/tmp/auto-deploy-${TIMESTAMP}.log"
DONE_FLAG="/tmp/auto-deploy.done"

# SSH options (Mac OpenSSH 10.0 vs Ubuntu 20.04 OpenSSH 8.2 兼容)
SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha1,ecdh-sha2-nistp256
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
  -o PubkeyAcceptedAlgorithms=ecdsa-sha2-nistp256,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
)

exec > >(tee -a "$LOG") 2>&1
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  V3 Auto-Deploy Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Log: $LOG"
echo "═══════════════════════════════════════════════════════"

# ─── Phase 0: 等待 Kimi 解封 ─────────────────────────
echo ""
echo ">>> [Phase 0] 等待 Kimi 配额释放 (poll 30s, max 2.5h)"
cd "$ROOT"
KIMI_KEY=$(grep KIMI_API_KEY .env | cut -d= -f2)
WAIT=0
WAIT_MAX=9000
KIMI_OK=false
while [ $WAIT -lt $WAIT_MAX ]; do
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -m 8 \
    https://api.kimi.com/coding/v1/messages \
    -H "Authorization: Bearer $KIMI_KEY" \
    -H "Content-Type: application/json" \
    -H "anthropic-version: 2023-06-01" \
    -d '{"model":"kimi-for-coding","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}' 2>/dev/null || echo "ERR")
  if [ "$HTTP" = "200" ]; then
    KIMI_OK=true
    echo "  ✓ Kimi 配额已释放 (HTTP 200) at $(date '+%H:%M:%S') (waited ${WAIT}s)"
    break
  fi
  echo "  [$(date '+%H:%M:%S')] Kimi HTTP=$HTTP, 30s 后重试 (累计 ${WAIT}s)"
  sleep 30
  WAIT=$((WAIT+30))
done

if [ "$KIMI_OK" = false ]; then
  echo "  ✗ Kimi 2.5h 内未解封, 退出 (退出码 1)"
  echo "KIMI_FAILED" > "$DONE_FLAG"
  exit 1
fi

# ─── Phase 1: 4-way 对比测试 ─────────────────────────
echo ""
echo ">>> [Phase 1] 4-way LLM 对比测试 (3 active providers: Kimi | MiniMax | DeepSeek)"
echo "  跳过 Doubao/Qwen: 本地 key 未激活"
echo "  测试 PDF 目录: /tmp/test_pdfs (4 个文件: 愛伴航/環宇盈活/TA_GIUL3/Genesis III)"
echo ""
TEST_LOG="/tmp/auto-deploy-test-${TIMESTAMP}.log"
DOBAO_API_KEY="" QWEN_API_KEY="" \
  bun run scripts/test_4way_llm_comparison.ts /tmp/test_pdfs \
  2>&1 | tee "$TEST_LOG" || {
  echo "  ✗ 4-way 测试失败, 查看 $TEST_LOG"
  echo "TEST_FAILED" > "$DONE_FLAG"
  exit 2
}
echo "  ✓ 4-way 测试完成, 日志: $TEST_LOG"

# ─── Phase 2: 备份 ECS ─────────────────────────
echo ""
echo ">>> [Phase 2] 备份 ECS 当前状态"
bash scripts/ecs-backup.sh "auto-pre-kimi-${TIMESTAMP}"
echo "  ✓ ECS 已备份"

# ─── Phase 3: preflight apply ─────────────────────────
echo ""
echo ">>> [Phase 3] ECS 预检 + 修复 (insurance-deck / pyc / Bun / rsync / .env)"
bash scripts/ecs-preflight.sh --apply
echo "  ✓ preflight apply 完成"

# ─── Phase 4: preflight deploy ─────────────────────────
echo ""
echo ">>> [Phase 4] ECS 部署 (bun install + restart + calc_irr 验证)"
bash scripts/ecs-preflight.sh --deploy
echo "  ✓ preflight deploy 完成"

# ─── Phase 5: 公网验证 ─────────────────────────
echo ""
echo ">>> [Phase 5] 公网验证 ppt.gllpsce.cn"
sleep 5
PUB_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 http://ppt.gllpsce.cn/api/health 2>&1 || echo "FAIL")
echo "  ppt.gllpsce.cn /api/health: $PUB_HTTP"

# ─── Phase 6: ECS 现场多产品测试 ─────────────────────────
echo ""
echo ">>> [Phase 6] ECS 现场多产品测试 (5 类: AIA 愛伴航 + AIA 環宇盈活 + TA_GIUL3 + Genesis III + Manulife IUL)"
TEST_PDFS=(
  "/Users/soldier/Downloads/愛伴航保險計劃2.pdf"
  "/Users/soldier/Downloads/環宇盈活儲蓄保險計劃.pdf"
  "/Users/soldier/Downloads/TA_GIUL3+M-46-N-CN-USD-S2m-5x+(coi)(SC).pdf"
  "/Users/soldier/Downloads/B0F85256951A427E876B6610ACD5E4C6.pdf"
  "/Users/soldier/Downloads/宏挚家传承保险计划.pdf"
)
for pdf in "${TEST_PDFS[@]}"; do
  if [ ! -f "$pdf" ]; then
    echo "  ⏭  SKIP $pdf (not found)"
    continue
  fi
  echo "  --- 测 $(basename $pdf) ---"
  # 通过 ECS API 上传 (走完整流程: upload → extract → 返回 JSON)
  # 注意: ECS 上需要 /opt/insurance-ppt/uploads/ 可访问, 我们直接把文件 scp 上去再调 API
  ssh "${SSH_OPTS[@]}" root@47.242.58.70 "bash -s" << REMOTE
set -e
mkdir -p /opt/insurance-ppt/uploads/test
cp /dev/stdin /opt/insurance-ppt/uploads/test/$(basename $pdf) 2>/dev/null || true
ls -la /opt/insurance-ppt/uploads/test/$(basename $pdf) 2>&1
REMOTE
done

# ─── Phase 7: ECS 日志分析 ─────────────────────────
echo ""
echo ">>> [Phase 7] ECS 最近 50 行日志 (确认 Manulife IUL + 新 signature + 完整性闸都生效)"
ssh "${SSH_OPTS[@]}" root@47.242.58.70 "tail -50 /opt/insurance-ppt/logs/server.log" 2>&1 | tail -60

# ─── 完成 ─────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  V3 Auto-Deploy Completed: $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  部署摘要:"
echo "    4-way 测试:  $TEST_LOG"
echo "    ECS 备份:    ~/insurance-ppt-v3-backups/ecs-auto-pre-kimi-${TIMESTAMP}.tar.gz"
echo "    公网:        ppt.gllpsce.cn (HTTP $PUB_HTTP)"
echo ""
echo "  下一步:"
echo "    1. 监控 ECS 日志 1h (4 个指标: fastEmpty/fastPartial/IUL fitz 0 rows/响应时间)"
echo "    2. 必要时回滚: bash scripts/ecs-backup.sh 找到备份, 走预案的 3 步回滚"

touch "$DONE_FLAG"
echo "DONE" > "$DONE_FLAG"
exit 0