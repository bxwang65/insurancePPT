#!/usr/bin/env python3
"""
诊断脚本 — 只读, 不写文件
扫描指定 PDF 的每一页, 打印:
  - 表格数
  - 每个表格的扁平文本 (前 200 字)
  - 周围文本中是否含 "退保/保证/年度" 之类关键词
目的: 找出 extract_hk_pdfs.py 启发式规则为何对 25 份 PDF 全失败
"""
import sys
import pdfplumber
from pathlib import Path

PDF_DIR = Path("/Users/soldier/Downloads/官方计划书案例")

# 选 3 份不同公司的失败 PDF
TARGETS = [
    "保诚——信守明天多元貨幣計劃.pdf",
    "安盛——盛利II儲蓄保險至尊.pdf",
    "忠意人寿——啟航創富卓越版.pdf",
]

KEYWORDS_YEAR = ["保单年度", "保單年度", "保单年期", "保單年期", "年度", "年期", "Policy Year"]
KEYWORDS_SURR = ["退保", "退保发还", "退保發還", "现金价值", "現金價值", "Surrender"]
KEYWORDS_GUAR = ["保证", "保證", "Guaranteed"]
KEYWORDS_TERM = ["终期分红", "終期分紅", "Terminal", "期满", "期滿", "Maturity"]


def has_any(text: str, kws: list) -> list:
    return [k for k in kws if k in text]


def inspect_pdf(path: Path):
    print(f"\n{'='*80}")
    print(f"  {path.name}")
    print(f"{'='*80}")
    with pdfplumber.open(path) as pdf:
        for pi, page in enumerate(pdf.pages):
            text = (page.extract_text() or "")
            tables = page.extract_tables()
            print(f"\n--- Page {pi+1} ({len(tables)} tables, {len(text)} chars text) ---")
            year_hits = has_any(text, KEYWORDS_YEAR)
            surr_hits = has_any(text, KEYWORDS_SURR)
            guar_hits = has_any(text, KEYWORDS_GUAR)
            term_hits = has_any(text, KEYWORDS_TERM)
            if any([year_hits, surr_hits, guar_hits, term_hits]):
                print(f"  关键词命中: 年度={year_hits} 退保={surr_hits} 保证={guar_hits} 终期={term_hits}")

            for ti, t in enumerate(tables):
                flat = " ".join(str(c) for row in t for c in row if c)
                head = flat[:200].replace("\n", " ")
                print(f"  Table {ti+1} ({len(t)} rows): {head}...")


def main():
    pdfs = list(PDF_DIR.glob("*.pdf"))
    for name in TARGETS:
        path = PDF_DIR / name
        if path.exists():
            inspect_pdf(path)
        else:
            print(f"  找不到: {name}")


if __name__ == "__main__":
    main()