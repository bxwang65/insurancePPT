#!/bin/bash
# 2026-08-27: 每月清 downloads/local/ 下的测试 PPTX
#   - 测试 PPTX 判定: 非 UUID 命名 (不匹配 ^[a-f0-9]{8}-[a-f0-9]{4}-)
#   - 保留 871 个 UUID 真实用户产品 PPT
#   - 同时清对应 preview 子目录 (slide_NN.png + .pdf)
#   - log 输出到 /opt/insurance-ppt/logs/cleanup_test_pptx_YYYYMMDD.log
#
# Usage:
#   ./cleanup_test_pptx.sh           # 真删
#   ./cleanup_test_pptx.sh --dry-run # 只列出不删

set -e

DOWNLOAD_DIR="/opt/insurance-ppt/public/downloads/local"
LOG_DIR="/opt/insurance-ppt/logs"
DATE=$(date +%Y%m%d)
LOG_FILE="$LOG_DIR/cleanup_test_pptx_${DATE}.log"
DRY_RUN=0

if [ "${1}" = "--dry-run" ]; then
    DRY_RUN=1
fi

mkdir -p "$LOG_DIR"
echo "=== cleanup_test_pptx started at $(date) [DRY_RUN=${DRY_RUN}] ===" >> "$LOG_FILE"

# 找非 UUID 命名的 .pptx 文件 (顶层)
NON_UUID=$(cd "$DOWNLOAD_DIR" && ls 2>/dev/null \
    | grep -ivE "^[a-f0-9]{8}-[a-f0-9]{4}" \
    | grep -vE "^\." \
    | grep -E "_综合方案\.pptx$" || true)

if [ -z "$NON_UUID" ]; then
    echo "No test PPTX found. Nothing to do." >> "$LOG_FILE"
    echo "[$(date)] No test PPTX. Exit."
    exit 0
fi

TOTAL_FILES=$(printf '%s\n' "$NON_UUID" | wc -l | tr -d ' ')
TOTAL_BYTES=0
DELETED_FILES=0
DELETED_DIRS=0

for f in $NON_UUID; do
    fpath="$DOWNLOAD_DIR/$f"
    if [ ! -f "$fpath" ]; then
        continue
    fi
    size=$(stat -c %s "$fpath")
    TOTAL_BYTES=$((TOTAL_BYTES + size))
    preview_dir="${fpath%_综合方案.pptx}_preview_preview"

    if [ "$DRY_RUN" = "1" ]; then
        echo "[DRY-RUN] would delete: $f ($((size / 1024 / 1024))MB)" >> "$LOG_FILE"
        if [ -d "$preview_dir" ]; then
            echo "[DRY-RUN] would delete: $(basename "$preview_dir")/" >> "$LOG_FILE"
        fi
    else
        rm -f "$fpath"
        DELETED_FILES=$((DELETED_FILES + 1))
        if [ -d "$preview_dir" ]; then
            rm -rf "$preview_dir"
            DELETED_DIRS=$((DELETED_DIRS + 1))
        fi
        echo "deleted: $f ($((size / 1024 / 1024))MB)" >> "$LOG_FILE"
    fi
done

echo "" >> "$LOG_FILE"
echo "=== summary ===" >> "$LOG_FILE"
echo "matched test PPTX: $TOTAL_FILES" >> "$LOG_FILE"
echo "total size: $((TOTAL_BYTES / 1024 / 1024))MB" >> "$LOG_FILE"
if [ "$DRY_RUN" = "1" ]; then
    echo "DRY-RUN: no actual deletion" >> "$LOG_FILE"
else
    echo "deleted files: $DELETED_FILES" >> "$LOG_FILE"
    echo "deleted preview dirs: $DELETED_DIRS" >> "$LOG_FILE"
fi
echo "=== finished at $(date) ===" >> "$LOG_FILE"

if [ "$DRY_RUN" = "1" ]; then
    echo "[$(date)] DRY-RUN complete. See $LOG_FILE"
else
    echo "[$(date)] Cleanup complete. ${DELETED_FILES} files + ${DELETED_DIRS} preview dirs deleted. See $LOG_FILE"
fi
