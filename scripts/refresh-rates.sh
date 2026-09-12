#!/usr/bin/env bash
#
# HK 佣金费率季度刷新一键脚本
#
# 用法:
#   ./scripts/refresh-rates.sh                          # 跑完整流程 (假设 CSV 已在 db/reference/)
#   ./scripts/refresh-rates.sh --csv <path>             # 指定参考 CSV
#   ./scripts/refresh-rates.sh --dry-run                # 只 extract 不归档老数据
#   ./scripts/refresh-rates.sh --skip-extract           # 跳过 extract, 只跑 qa (CSV 已存在, DB 已更新)
#
# 流程:
#   1. 验证 10 个 PDF 存在 (db/source_pdfs/)
#   2. (可选) extract_hx_pdfs.py 抽取 (--dry-run 时不归档)
#   3. qa_validate.py 对账 (CSV vs DB)
#   4. 输出汇总, exit code: 0=PASS, 1=FAIL
#
# 设计目标 (2026-08-16): 用户只需要:
#   1. 放 10 个 PDF 到 db/source_pdfs/
#   2. 放 CSV 参考表到 db/reference/2026Q4.csv
#   3. 跑 ./scripts/refresh-rates.sh --csv db/reference/2026Q4.csv
#   4. 看屏幕输出, 全 ✓ 就 commit; 有 ✗ 看报告

set -e  # 任何一步失败立即退出

# =============================================================
# 配置
# =============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DB_PATH="db/hx_rates.db"
# 2026-08-16: 允许环境变量覆盖, 让 admin-web 校准端点 (Phase 4 #23) 用 inbox/<quarter>/ 跑
PDF_DIR="${PDF_DIR:-db/source_pdfs}"
DEFAULT_CSV="${CSV_PATH:-db/reference/2026Q3.csv}"  # 默认用上一季度的, Q4 时用户传新 CSV

CONTAINER="hx-rates-api-dev"
CONTAINER_DB="/app/db/hx_rates.db"

# =============================================================
# 参数
# =============================================================
CSV_PATH="$DEFAULT_CSV"
DRY_RUN=0
SKIP_EXTRACT=0
SKIP_QA=0
EFFECTIVE_FROM=""  # 2026-08-16: admin-web 校准端点传, 不传默认今天

while [[ $# -gt 0 ]]; do
  case "$1" in
    --csv)       CSV_PATH="$2"; shift 2 ;;
    --pdf-dir)   PDF_DIR="$2"; shift 2 ;;  # 2026-08-16: 让 admin-web 校准端点用 inbox/<quarter>/
    --effective-from) EFFECTIVE_FROM="$2"; shift 2 ;;  # 2026-08-16: 同上, 替代 extract_hx_pdfs.py 默认今天
    --dry-run)   DRY_RUN=1; shift ;;
    --skip-extract) SKIP_EXTRACT=1; shift ;;
    --skip-qa)   SKIP_QA=1; shift ;;
    --help|-h)
      sed -n '3,25p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1"; exit 2 ;;
  esac
done

# =============================================================
# 辅助函数
# =============================================================
log() { echo -e "\033[1;36m▶\033[0m $*"; }
warn() { echo -e "\033[1;33m⚠\033[0m $*"; }
err()  { echo -e "\033[1;31m✗\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }

# =============================================================
# Step 1: 检查 PDF
# =============================================================
log "Step 1: 检查 10 个 PDF 是否就位"
EXPECTED_PDFS=(
  "7月HXNPI费率表L1.pdf"
  "7月HXNPI费率表L2.pdf"
  "7月HXNPI费率表L3.pdf"
  "7月HXNPI费率表直接伯乐.pdf"
  "7月HXNPI费率表间接伯乐.pdf"
  "7月HXPI费率表L1.pdf"
  "7月HXPI费率表L2.pdf"
  "7月HXPI费率表L3.pdf"
  "7月HXPI费率表直接伯乐.pdf"
  "7月HXPI费率表间接伯乐.pdf"
)
MISSING=0
for pdf in "${EXPECTED_PDFS[@]}"; do
  if [[ ! -f "$PDF_DIR/$pdf" ]]; then
    warn "缺失: $PDF_DIR/$pdf"
    MISSING=$((MISSING + 1))
  fi
done
if [[ $MISSING -gt 0 ]]; then
  err "$MISSING 个 PDF 缺失. 请把新 PDF 放到 $PDF_DIR/"
  exit 1
fi
ok "10 个 PDF 都在"

# =============================================================
# Step 2: 检查 CSV
# =============================================================
log "Step 2: 检查 CSV 参考表"
if [[ ! -f "$CSV_PATH" ]]; then
  err "CSV 不存在: $CSV_PATH"
  echo "    用法: $0 --csv db/reference/2026Q4.csv"
  exit 1
fi
CSV_LINES=$(wc -l < "$CSV_PATH")
ok "CSV 找到: $CSV_PATH ($((CSV_LINES - 1)) 个产品)"

# =============================================================
# Step 3: 检查容器
# =============================================================
log "Step 3: 检查容器 $CONTAINER"
if ! docker ps --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  err "容器 $CONTAINER 没跑. 启动: docker compose up -d hx-rates-api"
  exit 1
fi
ok "容器在线"

# =============================================================
# Step 4: extract (可选)
# =============================================================
if [[ $SKIP_EXTRACT -eq 0 ]]; then
  log "Step 4: 抽取 PDF → SQLite"
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY-RUN: 跳过归档, 只输出报告"
    EXTRACT_ARGS="--skip-archive"
    REPORT_PATH="db/reference/extract_dryrun_$(date +%Y%m%d_%H%M%S).md"
  else
    EXTRACT_ARGS=""
    REPORT_PATH="db/reference/extract_$(date +%Y%m%d_%H%M%S).md"
  fi
  # 2026-08-16: 把 EFFECTIVE_FROM 传给 extract (admin-web 校准端点会传)
  EFFECTIVE_FROM_ARGS=""
  if [[ -n "$EFFECTIVE_FROM" ]]; then
    EFFECTIVE_FROM_ARGS="--effective-from $EFFECTIVE_FROM"
  fi
  python3 db/scripts/extract_hx_pdfs.py \
    --pdf-dir "$PDF_DIR" \
    --db "$DB_PATH" \
    --report "$REPORT_PATH" \
    $EXTRACT_ARGS \
    $EFFECTIVE_FROM_ARGS
  ok "抽取完成, 报告: $REPORT_PATH"

  # 重 build 容器 (app.py 是 baked)
  if [[ $DRY_RUN -eq 0 ]]; then
    log "  重 build hx-rates-api 容器 (让 app.py 最新版生效)"
    docker compose build hx-rates-api >/dev/null
    docker compose up -d hx-rates-api >/dev/null
    ok "  容器已重启"
  fi
else
  log "Step 4: 跳过 extract (--skip-extract)"
fi

# =============================================================
# Step 5: 同步脚本到容器
# =============================================================
log "Step 5: 同步 qa_validate.py + CSV 到容器"
docker cp db/scripts/qa_validate.py "$CONTAINER:/app/db/scripts/" 2>/dev/null
CONTAINER_CSV="/app/db/reference/$(basename "$CSV_PATH")"
docker mkdir -p "$CONTAINER:/app/db/reference" 2>/dev/null || true  # 可能 mkdir 不支持, fallback 到 exec
docker exec "$CONTAINER" mkdir -p /app/db/reference 2>/dev/null
docker cp "$CSV_PATH" "$CONTAINER:$CONTAINER_CSV"
ok "已同步"

# =============================================================
# Step 6: qa_validate
# =============================================================
if [[ $SKIP_QA -eq 0 ]]; then
  log "Step 6: qa_validate 对账"
  set +e  # 让 qa 的 exit 1 不中断后续
  docker exec "$CONTAINER" python3 /app/db/scripts/qa_validate.py \
    --csv "$CONTAINER_CSV" \
    --db "$CONTAINER_DB" \
    --out-dir /app/db/reference
  QA_EXIT=$?
  set -e
  if [[ $QA_EXIT -eq 0 ]]; then
    ok "qa_validate 全部 PASS"
    FINAL_EXIT=0
  else
    err "qa_validate 有 FAIL 或 MISS — 看上面 ✗ 的产品"
    FINAL_EXIT=1
  fi
else
  log "Step 6: 跳过 qa (--skip-qa)"
  FINAL_EXIT=0
fi

# =============================================================
# 汇总
# =============================================================
echo ""
echo "================================================================"
echo "  季度刷新汇总"
echo "================================================================"
echo "  PDF 目录:   $PDF_DIR"
echo "  CSV:        $CSV_PATH"
echo "  DB:         $DB_PATH"
echo "  容器:       $CONTAINER"
[[ $SKIP_EXTRACT -eq 0 ]] && echo "  Extract:    $([[ $DRY_RUN -eq 1 ]] && echo 'DRY-RUN' || echo '已执行')"
[[ $SKIP_EXTRACT -eq 0 ]] && echo "  报告:       $REPORT_PATH"
[[ $SKIP_QA -eq 0 ]] && echo "  QA 验证:    $([[ $FINAL_EXIT -eq 0 ]] && echo 'PASS' || echo 'FAIL')"
echo "================================================================"

if [[ $FINAL_EXIT -eq 0 ]]; then
  ok "全部完成. commit: db/source_pdfs/, db/reference/2026Q*.csv, db/hx_rates.db"
  echo ""
  echo "下一步:"
  echo "  1. git add db/source_pdfs/ db/reference/ db/hx_rates.db db/scripts/"
  echo "  2. git commit -m 'Q4 季度佣金率刷新'"
  echo "  3. (可选) 同步 ECS: rsync db/hx_rates.db hk-ecs:/opt/insurance-deck/db/"
else
  err "有 FAIL, 不要 commit. 先看 db/reference/qa_report_*.md"
fi

exit $FINAL_EXIT