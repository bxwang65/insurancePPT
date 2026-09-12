#!/usr/bin/env python3
"""检查 保诚/中国人寿/安盛 页面结构"""
import fitz
import re
from pathlib import Path

PDF_DIR = Path("/Users/soldier/Downloads/官方计划书案例")
KW_YEAR = re.compile(r"保[单單]年[度期][终结終結]|保[单單]年[度期]")
KW_SURR = re.compile(r"退保[发發]还|退保[发發]還|退保价[值值]|退保價值|现金价[值值]|現金價值|退保金")
KW_GUAR = re.compile(r"保[证證]金[额額]?|保[证證]")
KW_TERM = re.compile(r"终[期][期]?红[利]|終[期][期]?紅[利]")

targets = [
    "保诚——信守明天多元貨幣計劃.pdf",
    "中国人寿——傲瓏盛世儲蓄保險計劃.pdf",
    "安盛——盛利II儲蓄保險至尊.pdf",
    "太平保险——頤年樂享儲蓄保險計劃尊享版.pdf",
    "宏利——宏挚传承保障计划.pdf",
]

for name in targets:
    pdf = PDF_DIR / name
    if not pdf.exists():
        continue
    print(f"\n{'='*80}\n{name}")
    doc = fitz.open(pdf)
    for pi, page in enumerate(doc):
        text = page.get_text()
        if not text:
            continue
        has_year = bool(KW_YEAR.search(text))
        has_surr = bool(KW_SURR.search(text))
        has_guar = bool(KW_GUAR.search(text)) or bool(KW_TERM.search(text))
        if has_year and (has_surr or has_guar):
            print(f"  P{pi+1} ({'SURR' if has_surr else ''}{'/GUAR' if has_guar else ''})")
            # Print first 30 lines as preview
            lines = [l for l in text.split("\n") if l.strip()][:40]
            for l in lines:
                if any(kw in l for kw in ["保單年度", "保单年度", "年度終結", "年度终结", "退保", "現金", "现金", "保證", "保证", "終期", "终期", "复归", "復歸", "歸原", "归原"]):
                    print(f"    HEAD: {l}")
            # Also count numeric rows
            num_rows = sum(1 for l in text.split("\n") if re.match(r"^\s*\d+\s*$", l.strip()))
            print(f"    numeric rows: {num_rows}")
            if pi > 25: break
    doc.close()
