#!/usr/bin/env python3
"""Classify insurer PDF pages before structured extraction."""
import fitz
import sys
import json
import re

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
