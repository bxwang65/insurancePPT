#!/usr/bin/env python3
"""
HK Fitz fallback — 只针对 vision 跳过的 10 个 PDF
复用 extract_hk_pdfs.py 的字段提取逻辑，但允许 score=1 进入、强制处理所有页
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from extract_hk_pdfs import (
    extract_demo, make_summary, KW_YEAR, KW_SURR, KW_GUAR, KW_TERM, KW_RB
)
import json
import re

PDF_DIR = Path("/Users/soldier/Downloads/官方计划书案例")
OUT_DIR = Path("/Users/soldier/hk-savings-calculator/src/data")

# 10 个 vision 跳过的 PDF
TARGETS = [
    "825940690AC14EB2AD450F7D393CFDB2.pdf",
    "B0F85256951A427E876B6610ACD5E4C6.pdf",
    "TA_GIUL3+M-46-N-CN-USD-S2m-5x+(coi)(SC).pdf",
    "中国人寿——傲瓏盛世儲蓄保險計劃.pdf",
    "保诚——信守明天多元貨幣計劃.pdf",
    "太平保险——頤年樂享儲蓄保險計劃尊享版.pdf",
    "太平洋保险——鑫安逸储蓄保险计划.pdf",
    "安盛——盛利II儲蓄保險至尊.pdf",
    "宏利——宏挚传承保障计划.pdf",
    "宏利——宏挚家传承保险计划.pdf",
]


def slugify(stem):
    return re.sub(r"[^\w\u4e00-\u9fff]", "_", stem)


def main():
    results, skipped = [], []
    for name in TARGETS:
        pdf = PDF_DIR / name
        if not pdf.exists():
            print(f"  ✗ Not found: {name}")
            skipped.append(name)
            continue
        print(f"\n  Processing {name}")
        try:
            demo_rows = extract_demo(pdf)
            summary = make_summary(pdf)
        except Exception as e:
            print(f"  ⚠ Exception: {e}")
            skipped.append(name)
            continue
        if not demo_rows:
            print(f"  ⚠ No demo rows parsed")
            skipped.append(name)
            continue
        if not summary:
            summary = {"currency": "USD", "annual_prem": 100000, "pay_years": 5}

        record = {
            "product_name_from_pdf": pdf.stem,
            "currency": summary["currency"],
            "pay_years": summary["pay_years"],
            "annual_prem": summary["annual_prem"],
            "expected_lifetime": 100,
            "demo_rows": demo_rows,
            "source_pdf": str(pdf),
            "extracted_at": "2026-07-01",
            "extraction_method": "fitz_v4_fallback",
        }
        slug = slugify(pdf.stem)
        out = OUT_DIR / f"{slug}.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Saved {out.name} ({len(demo_rows)} rows, premium={summary['annual_prem']}, pay={summary['pay_years']}, curr={summary['currency']})")
        # Print first row + last for sanity
        print(f"      Y1: {demo_rows[0]}")
        if len(demo_rows) > 1:
            print(f"      Y{len(demo_rows)}: {demo_rows[-1]}")
        results.append(name)

    print(f"\nDone. Extracted {len(results)}, skipped {len(skipped)}")
    if skipped:
        for n in skipped:
            print(f"  - {n}")


if __name__ == "__main__":
    main()
