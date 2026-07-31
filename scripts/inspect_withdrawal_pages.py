#!/usr/bin/env python3
"""
检测哪些 PDF 含「提取后」demo 表 (退保价值 of 现金提取後之)
保诚 P18-20 已经看到例子
"""
import re
import fitz
from pathlib import Path

PDF_DIR = Path("/Users/soldier/Downloads/官方计划书案例")
KW_WITHDRAWAL = re.compile(r"現金提取[后後]?[之的]?|现金提取[后後]?[之的]?|提取后|提取後|after.*withdrawal|after.*surrender")
KW_DEMO_HEADER = re.compile(r"保[证證]金[额額]?|保[证證]现[金]?[价值價值]|累积?[归歸]原[红紅]利|保[额額]增[值值]红[利]|终[期][期]?红[利]|退保[价價值]|退保[发發]还")

for pdf in sorted(PDF_DIR.glob("*.pdf")):
    try:
        doc = fitz.open(pdf)
    except Exception:
        continue
    withdrawal_pages = []
    for pi, page in enumerate(doc):
        text = page.get_text() or ""
        if KW_WITHDRAWAL.search(text) and KW_DEMO_HEADER.search(text):
            # Check it has numeric rows
            nums = sum(1 for l in text.split("\n") if re.match(r"^\s*\d+\s*$", l.strip()))
            if nums >= 10:
                withdrawal_pages.append((pi + 1, nums, text[:80].replace("\n", " ")))
    doc.close()
    if withdrawal_pages:
        print(f"\n{pdf.name}:")
        for p, n, snip in withdrawal_pages[:5]:
            print(f"  P{p} ({n} numeric rows) :: {snip[:60]}")
