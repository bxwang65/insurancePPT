#!/bin/bash
# HK 储蓄险长图海报批量生成 (使用 array of "pdf|company|slug" 避免 bash 关联数组中文坑)
set -e

SRC_DIR="/Users/soldier/Downloads/官方计划书案例"
OUT_DIR="$HOME/Downloads/long-poster"
TMP_DIR="/tmp/long_poster_batch"
PROJECT="/Users/soldier/insurance-ppt-v3"
# 2026-09-12: 移除硬编码密钥 (bxwang65/insurancePPT 是公开仓库, 禁止明文入库)
#   优先取环境变量, 否则回退读项目 .env
DEEPSEEK_KEY="${DEEPSEEK_API_KEY:-$(grep -E '^DEEPSEEK_API_KEY=' "$PROJECT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'')}"
if [ -z "$DEEPSEEK_KEY" ]; then
  echo "ERROR: 未找到 DEEPSEEK_API_KEY (环境变量与 $PROJECT/.env 都没有)" >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$TMP_DIR"

# 14 款储蓄险清单 (格式: "PDF完整路径|公司slug|输出slug")
# 优先使用真实客户年龄 (18-65 岁) 的 PDF, 避免 VIP 年龄=1 占位
PRODUCTS=(
  "/Users/soldier/Downloads/官方计划书案例/宏利——宏挚传承保障计划.pdf|manulife|hongzhichuancheng"
  "/Users/soldier/Downloads/官方计划书案例/宏利——宏挚家传承保险计划.pdf|manulife|hongzhijia"
  "/Users/soldier/Downloads/官方计划书案例/太平洋保险——鑫安逸储蓄保险计划.pdf|cpic|xinanyi"
  "/Users/soldier/Downloads/官方计划书案例/保诚——信守明天多元貨幣計劃.pdf|pru|xinshouting"
  "/Users/soldier/Downloads/官方计划书案例/万通——富饒萬家儲蓄保險計劃.pdf|yflife|furaowanjia"
  "/Users/soldier/Downloads/官方计划书案例/友邦——财富盈活储蓄保险计划.pdf|aia|caifuyinghuo"
  "/Users/soldier/Downloads/官方计划书案例/友邦——環宇盈活儲蓄保險計劃.pdf|aia|huanyuyinghuo"
  "/Users/soldier/Downloads/官方计划书案例/周大福——匠心飛越儲蓄保險計劃.pdf|ctf|jiangxinfeiyue"
  "/Users/soldier/Downloads/官方计划书案例/周大福——匠心傳承儲蓄計劃2尊尚版.pdf|ctf|jiangxinchuancheng2"
  "/Users/soldier/Downloads/官方计划书案例/忠意人寿——啟航創富卓越版.pdf|generali|qihangchuangfu"
  "/Users/soldier/Downloads/官方计划书案例/太平保险——頤年樂享儲蓄保險計劃尊享版.pdf|china-taiping|yinianlexiang"
  "/Users/soldier/Desktop/4in1V5/source/opt/insurance-ppt/uploads/local/19b87659-c684-4e14-b765-f72fb6da4763_傲瓏盛世儲蓄保險計劃.pdf|chinalife|aolongshengshi"
  "/Users/soldier/Downloads/官方计划书案例/富卫——盈聚天下II保險計劃.pdf|fwd|yingjutianxia2"
  "/Users/soldier/Downloads/官方计划书案例/安盛——盛利II儲蓄保險至尊.pdf|axa|shengli2"
)

TOTAL=${#PRODUCTS[@]}
SUCCESS=0
FAILED=0
SKIPPED=0
FAILED_LIST=()

echo "================================================"
echo " HK 储蓄险长图海报批量生成"
echo " 源: $SRC_DIR"
echo " 出: $OUT_DIR"
echo " 数量: $TOTAL 款"
echo "================================================"
echo ""

cd "$PROJECT"

for entry in "${PRODUCTS[@]}"; do
  IFS='|' read -r filename company slug <<< "$entry"
  # filename 现在是绝对路径 (优先真实客户 PDF)
  pdf="$filename"
  filename="$(basename "$pdf")"
  json="$TMP_DIR/${company}_${slug}.json"
  out="$OUT_DIR/${company}_${slug}.png"

  if [ -f "$out" ]; then
    echo "  [SKIP] $filename → $out (已存在)"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  if [ ! -f "$pdf" ]; then
    echo "  [MISS] $filename (PDF 不存在, 跳过)"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  echo "----------------------------------------"
  echo "  [GO]   $filename"
  echo "        公司: $company / slug: $slug"

  # Step 1: 提取 PDF → JSON
  if [ ! -f "$json" ]; then
    echo "  [1/2] 提取 PDF → $json"
    set +e
    DEEPSEEK_API_KEY="$DEEPSEEK_KEY" LLM_PROVIDER=deepseek bun /tmp/extract_one.ts "$pdf" "$json" > /tmp/extract_$$.log 2>&1
    extract_status=$?
    set -e
    if [ $extract_status -ne 0 ]; then
      echo "  [FAIL] 提取失败 (exit=$extract_status):"
      tail -5 /tmp/extract_$$.log | sed 's/^/        /'
      FAILED=$((FAILED+1))
      FAILED_LIST+=("$filename (提取)")
      continue
    fi
  else
    echo "  [1/2] 提取已存在, 跳过"
  fi

  # Step 2: 渲染 JSON → PNG
  echo "  [2/2] 渲染 → $out"
  set +e
  cd "$PROJECT/tools/long-poster"
  python3 render_poster.py "$json" "$out" "$company" > /tmp/render_$$.log 2>&1
  render_status=$?
  cd "$PROJECT"
  set -e
  if [ $render_status -ne 0 ]; then
    echo "  [FAIL] 渲染失败 (exit=$render_status):"
    tail -5 /tmp/render_$$.log | sed 's/^/        /'
    FAILED=$((FAILED+1))
    FAILED_LIST+=("$filename (渲染)")
    continue
  fi
  SUCCESS=$((SUCCESS+1))
done

echo ""
echo "================================================"
echo " 完成统计"
echo "   总数:   $TOTAL"
echo "   成功:   $SUCCESS"
echo "   失败:   $FAILED"
echo "   跳过:   $SKIPPED"
if [ ${#FAILED_LIST[@]} -gt 0 ]; then
  echo ""
  echo " 失败列表:"
  for f in "${FAILED_LIST[@]}"; do
    echo "   - $f"
  done
fi
echo ""
echo " 输出目录: $OUT_DIR"
ls -la "$OUT_DIR/" 2>/dev/null
echo "================================================"
