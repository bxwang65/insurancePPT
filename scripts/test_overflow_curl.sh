#!/bin/bash
# 并发测试: 用 curl 同时发 8 个请求
PDF="/tmp/test_manulife.pdf"
BASE="http://localhost:3000"

if [ ! -f "$PDF" ]; then
  echo "PDF not found: $PDF"
  exit 1
fi

# 准备 8 个 session (并发 upload)
echo "=== Step 1: Upload 8 PDFs in parallel ==="
SESSIONS=()
for i in 1 2 3 4 5 6 7 8; do
  RESP=$(curl -s -X POST -F "files=@${PDF};filename=test_${i}.pdf" -F "types=iul" -F "companies=manulife" "${BASE}/api/upload")
  SID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('sessionId',''))")
  SESSIONS+=("$SID")
  echo "  Upload $i: session=$SID"
done

echo ""
echo "=== Step 2: Parse 8 sessions in parallel ==="
START=$(date +%s%N)
for i in "${!SESSIONS[@]}"; do
  IDX=$((i+1))
  SID="${SESSIONS[$i]}"
  if [ -z "$SID" ]; then continue; fi
  curl -s -X POST "${BASE}/api/parse/${SID}" > /tmp/parse_${IDX}.json &
done
wait
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
echo "Total parallel parse time: ${ELAPSED}ms"
echo ""

echo "=== Per-session results ==="
for i in 1 2 3 4 5 6 7 8; do
  STATUS=$(cat /tmp/parse_${i}.json 2>/dev/null | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "err")
  echo "  #${i}: status=${STATUS}"
done