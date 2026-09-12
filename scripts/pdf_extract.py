#!/usr/bin/env python3
"""Classify insurer PDF pages before structured extraction."""
# ⚠️ 关键: MuPDF 环境变量必须在 import fitz 之前设置, 否则对已加载的 fitz 无效
# (PyMuPDF 在 import 时读取 MUPDF_LOG_LEVEL, 之后改 .env 不生效)
import os
os.environ.setdefault("MUPDF_LOG_LEVEL", "0")

import warnings
import sys
import json
import re

# 双保险: 静音所有 Python warning (fitz deprecation 等) + 强制 warning 走 stderr
# 防止 stdout 污染让 TS 端 JSON.parse 失败
warnings.filterwarnings("ignore")
warnings.filterwarnings("ignore", category=DeprecationWarning)

# 现在才 import fitz (MUPDF_LOG_LEVEL 已生效)
try:
    import fitz
except ImportError:
    # 退回到 pymupdf
    import pymupdf as fitz  # type: ignore

pdf_path = sys.argv[1]
doc = fitz.open(pdf_path)
result = {
    "totalPages": len(doc),
    "pages": [],
    "hasWithdrawalScenario": False,
    "withdrawalPages": [],
    "baseTablePages": [],
    "detectedWithdrawalYear": None,
    "detectedWithdrawalAmount": None,
    "tableSnippet": "",
}

base_headers = ["详细说明", "退保发还金额", "缴付保费"]
withdrawal_headers = ["现金提取举例", "现金提取金额"]
after_withdrawal_headers = ["现金提取后之退保发还金额"]
texts = []

for index, page in enumerate(doc):
    text = page.get_text()
    texts.append(text)
    has_base = all(header in text for header in base_headers)
    has_withdrawal = (
        all(header in text for header in withdrawal_headers)
        or any(header in text for header in after_withdrawal_headers)
    )
    page_info = {
        "pageNum": index + 1,
        "text": text,
        "hasWithdrawalColumns": has_withdrawal,
        "hasTableHeaders": has_base,
    }
    result["pages"].append(page_info)
    if has_base:
        result["baseTablePages"].append(index + 1)
    if has_withdrawal:
        result["withdrawalPages"].append(index + 1)

result["hasWithdrawalScenario"] = bool(result["withdrawalPages"])
full_text = "\n".join(texts)

for pattern in [r"第\s*(\d+)\s*年\s*(?:起|后|开始).*?提取", r"由\s*第\s*(\d+)\s*年.*?提取"]:
    match = re.search(pattern, full_text)
    if match:
        result["detectedWithdrawalYear"] = int(match.group(1))
        break

for page_num in result["withdrawalPages"]:
    page_text = texts[page_num - 1]
    amounts = [int(value.replace(",", "")) for value in re.findall(r"\b(\d{1,3}(?:,\d{3})+)\b", page_text)]
    repeated = [amount for amount in amounts if amount >= 1000 and amounts.count(amount) >= 3]
    if repeated:
        result["detectedWithdrawalAmount"] = repeated[0]
        break

lines = [line.strip() for line in full_text.splitlines() if line.strip()]
table_like = [line for line in lines if len(re.findall(r"\d", line)) >= 2][:40]
result["tableSnippet"] = "\n".join(table_like)

print(json.dumps(result, ensure_ascii=False))
doc.close()
