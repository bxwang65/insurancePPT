#!/bin/bash
# 2026-09-01: 清理 30 天前的陈旧 PPTX + 对应 preview 目录
#   - 删除 /opt/insurance-ppt/public/downloads/local/ 下 mtime > 30 天的 UUID PPTX
#   - 同时清对应 *_preview_preview/ 目录 (slide_NN.png + .pdf)
#   - 保留: mtime <= 30 天的全部文件 (近一个月用户可能还要回看)
#   - log 输出到 /opt/insurance-ppt/logs/cleanup_old_pptx_YYYYMMDD.log
#
# Usage:
#   ./cleanup_old_pptx.sh           # 真删
#   ./cleanup_old_pptx.sh --dry-run # 只列出不删

set -e

DOWNLOAD_DIR="/opt/insurance-ppt/public/downloads/local"
LOG_DIR="/opt/insurance-ppt/logs"
DAYS=30
DATE=$(date +%Y%m%d)
LOG_FILE="$LOG_DIR/cleanup_old_pptx_${DATE}.log"
DRY_RUN=0

if [ "${1}" = "--dry-run" ]; then
  DRY_RUN=1
fi

mkdir -p "$LOG_DIR"
echo "=== cleanup_old_pptx started at $(date) [DRY_RUN=${DRY_RUN}] DAYS=${DAYS} ===" >> "$LOG_FILE"

# 找 mtime > DAYS 天的 UUID 命名的 .pptx (顶层)
OLD_FILES=$(find "$DOWNLOAD_DIR" -maxdepth 1 -type f -mtime +${DAYS} \
    -regextype posix-extended \
    -regex '.*/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}_综合方案\.pptx$' \
    2>/dev/null || true)

if [ -z "$OLD_FILES" ]; then
  echo "No old PPTX found (mtime > ${DAYS} days). Nothing to do." >> "$LOG_FILE"
  echo "[$(date)] Exit. No old PPTX."
  exit 0
fi

TOTAL_FILES=$(echo "$OLD_FILES" | wc -l | tr -d ' ')
TOTAL_BYTES=0
DELETED_FILES=0
DELETED_DIRS=0

while IFS= read -r fpath; do
  if [ ! -f "$fpath" ]; then
    continue
  fi
  size=$(stat -c%s "$fpath")
  TOTAL_BYTES=$((TOTAL_BYTES + size))
  fname=$(basename "$fpath")
  # 推算 preview 目录: 去掉 _综合方案.pptx 后缀, 加 _preview_preview
  uuid_prefix="${fname%_综合方案.pptx}"
  preview_dir="${DOWNLOAD_DIR}/${uuid_prefix}_preview_preview"

  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY-RUN] would delete: $fname ($((size / 1024 / 1024))MB)" >> "$LOG_FILE"
    if [ -d "$preview_dir" ]; then
      d_size=$(du -sb "$preview_dir" 2>/dev/null | awk '{print $1}')
      echo "[DRY-RUN] would delete: ${uuid_prefix}_preview_preview/ ($((d_size / 1024 / 1024))MB)" >> "$LOG_FILE"
    fi
  else
    rm -f "$fpath"
    DELETED_FILES=$((DELETED_FILES + 1))
    if [ -d "$preview_dir" ]; then
      rm -rf "$preview_dir"
      DELETED_DIRS=$((DELETED_DIRS + 1))
    fi
    echo "deleted: $fname ($((size / 1024 / 1024))MB)" >> "$LOG_FILE"
  fi
done <<< "$OLD_FILES"

echo "" >> "$LOG_FILE"
echo "=== summary ===" >> "$LOG_FILE"
echo "matched old PPTX (mtime > ${DAYS} days): $TOTAL_FILES" >> "$LOG_FILE"
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