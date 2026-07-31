#!/usr/bin/env python3
"""全美新加坡 IUL 专用提取器 (pdfplumber text parsing)
从文字表中提取: 年度/年龄/保费/现金价值/账户价值/身故赔偿

用法: python3 extract_transamerica_iul.py <pdf_path>
"""
import json, re, sys
import pdfplumber

def number(v):
    if v in ("", "-", None, "None"): return 0
    try: return float(str(v).replace(",", "").replace("$", ""))
    except: return 0

def extract_text_info(text):
    info = {}
    m = re.search(r'投保金額[：:]\s*\$?([0-9,]+)', text)
    if m: info['sum_insured'] = number(m.group(1))
    m = re.search(r'首年預設定期保費[：:]\s*\$?([0-9,]+)', text)
    if m: info['annual_premium'] = number(m.group(1))
    m = re.search(r'年齡[：:]\s*(\d+)', text)
    if m: info['age'] = int(m.group(1))
    if '女' in text: info['gender'] = '女'
    elif '男' in text: info['gender'] = '男'
    return info

def extract_ta_iul(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        full_text = ""
        for page in pdf.pages:
            full_text += page.extract_text() or ""

    info = extract_text_info(full_text)

    # 解析表格行: 每行格式为 "年度/年龄 总保费 现金价值 账户价值 身故"
    rows = []
    # Pattern: optional #, digits/digits, amount, amount, amount, amount
    # 保证基础和非保证基础各一组
    pattern = re.finditer(
        r'(?:#)?(\d+)\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)',
        full_text
    )
    for m in pattern:
        yr = int(m.group(1))
        age = int(m.group(2))
        premium = number(m.group(3))
        guar_cv = number(m.group(4))
        guar_account = number(m.group(5))
        guar_db = number(m.group(6))
        non_cv = number(m.group(7))
        non_account = number(m.group(8))
        non_db = number(m.group(9))

        if yr <= 0 or yr > 200: continue
        rows.append({
            "policy_year": yr,
            "total_premium_paid": premium,
            "guaranteed_cash_value": guar_cv,
            "non_guaranteed_cash_value": non_cv,
            "non_guaranteed_account_value": non_account,
            "death_benefit": non_db or guar_db,
            "source_page": 0,
        })

    # 去重
    seen = set()
    unique = []
    for r in sorted(rows, key=lambda x: x['policy_year']):
        if r['policy_year'] not in seen:
            seen.add(r['policy_year'])
            unique.append(r)

    result = {
        "benefit_illustration": unique,
        "summary": {
            "insured_age": info.get('age', 0),
            "insured_gender": info.get('gender', ''),
            "annual_premium": info.get('annual_premium', 0),
            "sum_insured": info.get('sum_insured', 0),
        },
        "diagnostics": {"parser": "ta-iul-text", "rows_found": len(unique)},
    }
    return result

if __name__ == "__main__":
    pdf = sys.argv[1]
    result = extract_ta_iul(pdf)
    print(json.dumps(result, default=str))
