#!/bin/bash
# Scan all uploaded PDFs for stdout-pollution preprocessor issue
# Tests: run pdf_extract.py on each PDF, check if stdout has non-JSON prefix
set -e
UPLOADS=/opt/insurance-ppt/uploads/local
REPORT=/tmp/pdf_scan_report.txt
> $REPORT
echo "PDF scan starting..."
COUNT=0
WARN=0
ERR=0
for pdf in $UPLOADS/*.pdf; do
    COUNT=$((COUNT+1))
    name=$(basename "$pdf" | head -c 60)
    # Run preprocessor, capture stdout, check if first non-empty char is {
    out=$(python3.11 /opt/insurance-ppt/scripts/pdf_extract.py "$pdf" 2>/dev/null)
    first_char=$(echo "$out" | head -c 1 | tr -d '[:space:]')
    if [ "$first_char" != "{" ]; then
        # Count warning/error lines
        warns=$(echo "$out" | grep -c "^warning:\|MuPDF error\|cannot find" || true)
        echo "POLLUTED [$warns warn lines] $name" >> $REPORT
        WARN=$((WARN+1))
        # First 200 chars of stdout
        echo "  HEAD: $(echo "$out" | head -c 200 | tr -d '\n')" >> $REPORT
    fi
done
echo ""
echo "===== Scan Result ====="
echo "Total PDFs scanned: $COUNT"
echo "Polluted (non-JSON prefix): $WARN"
echo ""
echo "First 30 polluted PDFs:"
head -60 $REPORT
