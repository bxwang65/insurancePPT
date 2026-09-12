#!/usr/bin/env python3
"""只跑 vision 在 6 个剩余 PDF 上 (vision 之前跳过的)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from extract_hk_vision import process_pdf, make_summary
import json
import re

PDF_DIR = Path("/Users/soldier/Downloads/官方计划书案例")
OUT_DIR = Path("/Users/soldier/hk-savings-calculator/src/data")

TARGETS = [
    "中国人寿——傲瓏盛世儲蓄保險計劃.pdf",
    "保诚——信守明天多元貨幣計劃.pdf",
    "太平保险——頤年樂享儲蓄保險計劃尊享版.pdf",
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
            skipped.append(name)
            continue
        print(f"\n  Processing {name}")
        try:
            out = process_pdf(pdf)
            summary = make_summary(pdf)
        except Exception as e:
            print(f"  ⚠ Exception: {e}")
            skipped.append(name)
            continue
        if not out:
            skipped.append(name)
            continue

        record = {
            "product_name_from_pdf": pdf.stem,
            "currency": summary["currency"],
            "pay_years": summary["pay_years"],
            "annual_prem": summary["annual_prem"],
            "expected_lifetime": 100,
            "demo_rows": out,
            "source_pdf": str(pdf),
            "extracted_at": "2026-07-01",
            "extraction_method": "vision_llm_minimax_m3_relaxed",
        }
        slug = slugify(pdf.stem)
        out_path = OUT_DIR / f"{slug}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Saved {out_path.name} ({len(out)} rows)")
        results.append(name)

    print(f"\nDone. Extracted {len(results)}, skipped {len(skipped)}")
    for n in skipped:
        print(f"  - {n}")


if __name__ == "__main__":
    main()
