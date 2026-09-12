#!/bin/bash
# 14 款储蓄险 E2E: 上传 PDF → 解析 → 下载 PNG 长图到 ~/Downloads/long-poster/
# 完全走 /api/upload → /api/parse → /api/session/{id}.posterUrl → /downloads/...
set -e

SRC_DIR="/Users/soldier/Downloads/官方计划书案例"
OUT_DIR="$HOME/Downloads/long-poster"
API="http://localhost:3000"

mkdir -p "$OUT_DIR"

# 14 款 (格式: PDF文件名|公司slug|输出slug)
PRODUCTS=(
  "宏利——宏挚传承保障计划.pdf|manulife|hongzhichuancheng"
  "宏利——宏挚家传承保险计划.pdf|manulife|hongzhijia"
  "太平洋保险——鑫安逸储蓄保险计划.pdf|cpic|xinanyi"
  "保诚——信守明天多元貨幣計劃.pdf|pru|xinshouting"
  "万通——富饒萬家儲蓄保險計劃.pdf|yflife|furaowanjia"
  "友邦——财富盈活储蓄保险计划.pdf|aia|caifuyinghuo"
  "友邦——環宇盈活儲蓄保險計劃.pdf|aia|huanyuyinghuo"
  "周大福——匠心飛越儲蓄保險計劃.pdf|ctf|jiangxinfeiyue"
  "周大福——匠心傳承儲蓄計劃2尊尚版.pdf|ctf|jiangxinchuancheng2"
  "忠意人寿——啟航創富卓越版.pdf|generali|qihangchuangfu"
  "太平保险——頤年樂享儲蓄保險計劃尊享版.pdf|china-taiping|yinianlexiang"
  "中国人寿——傲瓏盛世儲蓄保險計劃.pdf|chinalife|aolongshengshi"
  "富卫——盈聚天下II保險計劃.pdf|fwd|yingjutianxia2"
  "安盛——盛利II儲蓄保險至尊.pdf|axa|shengli2"
)

TOTAL=${#PRODUCTS[@]}
SUCCESS=0
FAILED=0
SKIPPED=0

echo "================================================"
echo " 14 款储蓄险 E2E (upload→parse→download PNG)"
echo " API:  $API"
echo " 输出: $OUT_DIR"
echo "================================================"
echo ""

for entry in "${PRODUCTS[@]}"; do
  IFS='|' read -r filename company slug <<< "$entry"
  pdf="$SRC_DIR/$filename"
  out="$OUT_DIR/${company}_${slug}.png"

  if [ ! -f "$pdf" ]; then
    echo "  [MISS] $filename (PDF 不存在, 跳过)"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  echo "----------------------------------------"
  echo "  [GO]   $filename"
  echo "        公司: $company / slug: $slug"

  # Step 1: 上传
  UP_JSON=$(curl -s -X POST "$API/api/upload" \
    -F "files=@$pdf" -F "types=savings" 2>&1)
  SID=$(echo "$UP_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['sessionId'])" 2>/dev/null || echo "")
  if [ -z "$SID" ]; then
    echo "  [FAIL] 上传失败: $UP_JSON"
    FAILED=$((FAILED+1))
    continue
  fi

  # Step 2: 触发解析
  curl -s -X POST "$API/api/parse/$SID" -H "Content-Type: application/json" -d '{}' > /dev/null

  # Step 3: 轮询 session 拿到 posterUrl (最多 60 秒)
  POSTER_URL=""
  for i in $(seq 1 60); do
    sleep 1
    SESSION=$(curl -s "$API/api/session/$SID" 2>&1)
    STATUS=$(echo "$SESSION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
    POSTER_URL=$(echo "$SESSION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('posterUrl','') or '')" 2>/dev/null || echo "")
    if [ "$STATUS" = "parsed" ] || [ "$STATUS" = "done" ] || [ "$STATUS" = "error" ]; then
      break
    fi
  done

  if [ -z "$POSTER_URL" ]; then
    echo "  [FAIL] 解析超时或未生成海报 (status=$STATUS)"
    FAILED=$((FAILED+1))
    continue
  fi

  # Step 4: 下载 PNG (strip ?v= cache buster)
  CLEAN_URL=$(echo "$POSTER_URL" | sed 's/?v=.*//')
  curl -s -o "$out" "$API$CLEAN_URL" 2>&1
  if [ -s "$out" ]; then
    SIZE=$(du -h "$out" | cut -f1)
    echo "  [OK]   → $out ($SIZE)"
    SUCCESS=$((SUCCESS+1))
  else
    echo "  [FAIL] 下载失败"
    FAILED=$((FAILED+1))
  fi
done

echo ""
echo "================================================"
echo " 完成统计"
echo "   总数:   $TOTAL"
echo "   成功:   $SUCCESS"
echo "   失败:   $FAILED"
echo "   跳过:   $SKIPPED"
echo ""
echo " 输出目录:"
ls -la "$OUT_DIR/" | head -25
echo "================================================"
