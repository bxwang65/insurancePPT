#!/usr/bin/env python3
"""
按 PDF 签名（公司+产品）专用提取器

输入:
  --pdf <path>
  --signature <id>          # 例: ctf-mw2iua-v1
  --page-summary <N>         # 投保摘要页 (1-based)
  --pages-no-withdraw <list>  # 不提领表页
  --pages-withdraw <list>     # 提领表页
  --pages-withdraw-remainder <list>  # 提领后剩余价值表 (AIA专用)
  --year-horizon <N>          # 演示口径年 (默认 80)

输出: JSON
{
  "ok": true,
  "summary": {...},
  "no_withdraw": {Y: {Paid, Rev, Term, Total, Guar_CV, IRR, Simple, Mult}},
  "withdraw": {Y: {Paid, Annual_WD, Cum_WD, Total, ...}},
  "diagnostics": {warnings: [], parser: "..."}
}
"""
import argparse
import contextlib
import io
import json
import re
import sys
from typing import Dict, List, Optional, Tuple

import pdfplumber
import fitz  # for summary page text


def _parse_multi(cell) -> List[int]:
    """Cell可能含多值用\\n分隔"""
    if not cell:
        return []
    out = []
    for x in str(cell).split("\n"):
        s = x.strip().replace(",", "").replace("-", "").replace(" ", "")
        if s and (s.replace(".", "").isdigit()):
            try:
                v = int(float(s))
                out.append(v)
            except ValueError:
                pass
    return out


def _parse_y(cell) -> List[int]:
    """解析Y值, 处理 '65岁' 格式"""
    if not cell:
        return []
    out = []
    for x in str(cell).split("\n"):
        s = x.strip().replace("岁", "").strip()
        if s.isdigit():
            out.append(int(s))
    return out


def _header_contains(page, keywords: List[str]) -> bool:
    text = page.extract_text() or ""
    return all(kw in text for kw in keywords)


def extract_summary(pdf_path: str, page_idx: int) -> Dict:
    """提取投保摘要 (兼容港陆两式, 1-based → 0-based)"""
    doc = fitz.open(pdf_path)
    if page_idx < 1 or page_idx > doc.page_count:
        page_idx = 1
    text = doc[page_idx - 1].get_text()
    doc.close()
    summary = {
        "insured_name": None, "insured_age": None, "insured_gender": None,
        "product_name": None, "product_code": None, "currency": None,
        "annual_premium": None, "annual_premium_with_levy": None,
        "payment_years": None, "coverage_period": None,
        "premium_total": None,
    }

    # 受保人 (港: 擬受保人 / 陆: 受保人姓名)
    # 关键: 用 \S+ (非空白) 限制, 避免抓多行
    m = re.search(r"擬受保人\s*[：:]?\s*(\S+)", text)
    if not m: m = re.search(r"受保人姓名\s*[：:]\s*(\S+)", text)
    if m and m.group(1).strip():
        nm = m.group(1).strip()
        if "性别" not in nm and "性別" not in nm and len(nm) < 30:
            summary["insured_name"] = nm
    # AIA 风格: "受保人姓名：\n性别：男" → 没有 name, 跳到 "VIP 先生 1" 单独
    if not summary.get("insured_name"):
        # 找 "VIP 女士/先生" 风格 (中文全名)
        m = re.search(r"(VIP\s*(?:先生|女士))", text)
        if m: summary["insured_name"] = m.group(1).strip()
    if not summary.get("insured_name"):
        m = re.search(r"姓名\s*[：:]?\s*([^\n:]+?)(?=\s*\n)", text)
        if m and m.group(1).strip() and len(m.group(1).strip()) < 30:
            summary["insured_name"] = m.group(1).strip()

    # 性别 + 年龄 (港: 性別 / 年齡 / 收費標準: 男 / 58 / 非吸煙)
    m = re.search(r"性別\s*/\s*年齡\s*/\s*收費標準\s*[：:]\s*(\S+)\s*/\s*(\d+)\s*/", text)
    if m:
        summary["insured_gender"] = m.group(1)
        summary["insured_age"] = int(m.group(2))
    if not summary.get("insured_age"):
        # 关键: \s 默认不匹配 \n, 用 [\s\S] 兼容多行
        m = re.search(r"年龄\s*[：:]?[\s\S]*?(\d+)", text)
        if m: summary["insured_age"] = int(m.group(1))
    if not summary.get("insured_gender"):
        m = re.search(r"性別\s*[：:]\s*(\S+)", text)
        if not m: m = re.search(r"性别\s*[：:]\s*(\S+)", text)
        if m: summary["insured_gender"] = m.group(1)

    # 产品名 (锚定保險計劃向前抓取)
    m = re.search(r"「([^」]+)」\s*(?:儲蓄|储蓄)(?:壽險|寿险)計劃?", text)
    if m:
        summary["product_name"] = "「" + m.group(1).replace(chr(10), "").strip() + "」"
    if not summary.get("product_name"):
        m = re.search(r"「([^」]+)」\s*保險計劃?", text)
        if m:
            summary["product_name"] = "「" + m.group(1).replace(chr(10), "").strip() + "」"
    if not summary.get("product_name"):
        m = re.search(r"「([^」]+)」\s*储蓄寿险计划\d", text)
        if m:
            summary["product_name"] = "「" + m.group(1).replace(chr(10), "").strip() + "」"
    if not summary.get("product_name"):
        # 通用: 找"保險計劃"前的最后中文片段
        m = re.search(r"([一-龥][一-龥\s\n]{1,15})保險計劃", text)
        if m:
            raw = m.group(1)
            # 取最后 2-8 个连续中文 (排除 "基本計劃 (a)" 之类)
            cleaned = re.sub(r"[\s\n()（）a-zA-Z0-9]+", "", raw)
            # 取 cleaned 末尾最长 6 字
            summary["product_name"] = "「" + cleaned[-6:] + "保險計劃」" if len(cleaned) >= 4 else "「" + cleaned + "」"

    # 货币
    m = re.search(r"(?:貨幣|保单货币|保單貨幣)\s*[：:]\s*(\S+)", text)
    if m:
        c = m.group(1)
        if "美元" in c: summary["currency"] = "USD"
        elif "港幣" in c or "港元" in c: summary["currency"] = "HKD"
        elif "人民币" in c or "人民幣" in c: summary["currency"] = "RMB"
        else: summary["currency"] = c

    # 缴费年期
    m = re.search(r"保費繳付期\s*[：:]\s*(\d+)\s*年", text)
    if not m: m = re.search(r"保費繳付年期", text)  # CTF 独有格式
    if not m: m = re.search(r"保费供款年期\s*[：:]?\s*(\d+)\s*年", text)
    if not m: m = re.search(r"保費供款年期\s*[：:]?\s*(\d+)\s*年", text)
    if not m: m = re.search(r"缴费年期\s*[：:]\s*(\d+)\s*年", text)
    if not m: m = re.search(r"(\d+)\s*年\s*缴(?:费|付)", text)
    if not m: m = re.search(r"(\d+)\s*年\s*供", text)
    if not m: m = re.search(r"(\d+)\s*年\s*\n\s*至\d+\s*岁", text)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 30:
            summary["payment_years"] = v

    # 保障年期
    m = re.search(r"保障至年齡\s*[：:]\s*(\S+)", text)
    if m: summary["coverage_period"] = m.group(1)
    if not summary.get("coverage_period"):
        m = re.search(r"(\d+)\s*年\s*\n?\s*至(\d+)\s*岁", text)
        if m: summary["coverage_period"] = f"至{m.group(2)}岁"
    if not summary.get("coverage_period") and ("終身" in text or "终身" in text):
        summary["coverage_period"] = "终身"

    # 年保费 - 策略: 找出现两次的 6位USD整数 (400,000.00 重复 = 名义金额 = 每年保费)
    m = re.search(r"年繳保費\s*[：:]\s*([\d,]+\.?\d*)", text)
    if not m: m = re.search(r"年缴保费\s*[：:]\s*([\d,]+\.?\d*)", text)
    if m:
        summary["annual_premium"] = float(m.group(1).replace(",", ""))
    if not summary.get("annual_premium"):
        # 找页面里 重复出现 2+ 次的 5位整数.00 (港式: 名义金额 = 每年保费)
        cands = re.findall(r"(\d{2,3},\d{3}\.00)", text)
        from collections import Counter
        cnt = Counter(cands)
        for v, n in cnt.most_common(3):
            if n >= 2:
                summary["annual_premium"] = float(v.replace(",", ""))
                break
    if not summary.get("annual_premium"):
        # CTF/AIA 旧格式: 单一 5位整数.2位小数
        cands = re.findall(r"(\d{2,3},\d{3}\.\d{2})", text)
        for c in cands:
            v = float(c.replace(",", ""))
            if 90000 < v < 110000:
                summary["annual_premium"] = v
                break

    # 首年实缴总保费（含折扣/征费）优先从明确字段读取
    m = re.search(r"總額（包括投保時每年保費之保費徵費）\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"投保時每年總保費\s*\(.*?\)\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"投保時每年總保費\s*[：:]?\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"总额\s*\(1\)\s*\+\s*\(2\)\s*[：:]\s*([\d,]+\.?\d*)", text)
    if not m:
        m = re.search(r"总额（包括投保时每年保费之保费征费）\s*([\d,]+\.?\d*)", text)
    if m:
        summary["annual_premium_with_levy"] = float(m.group(1).replace(",", ""))

    if summary.get("annual_premium") and summary.get("payment_years"):
        summary["premium_total"] = round(summary["annual_premium"] * summary["payment_years"], 2)
    return summary


def extract_no_withdraw_ctf(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """CTF 不提领表 (6列: Y, Paid, Guar_CV, Rev, Term, Total)
    官方页头: '3. 基本计划 – 说明摘要' + '退保发还金额' + '缴付保费'
    列序: [Y, Paid, Guar, Rev, Term, Total]
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            text = page.extract_text() or ""
            # 双签名: 3.基本计划 + 退保发还金额 + 缴付保费, 排除提领页
            if "3. 基本计划" not in text or "退保发还金额" not in text or "缴付保费" not in text:
                continue
            if "现金提取" in text:  # 排除提领页
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_multi(r[0])
                    if not ys or not (1 <= ys[0] <= 128):
                        continue
                    paid = _parse_multi(r[1])
                    guar = _parse_multi(r[2])
                    rev = _parse_multi(r[3])
                    term = _parse_multi(r[4])
                    total = _parse_multi(r[5])
                    n = min(len(ys), len(paid), len(guar), len(rev), len(term), len(total))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 128 and y not in rows:
                            rows[y] = {
                                "Y": y, "Age": y, "Paid": paid[k],
                                "Guar_CV": guar[k], "Rev": rev[k],
                                "Term": term[k], "Total": total[k],
                                "SourcePage": pg,
                            }
    return rows


def extract_withdraw_ctf(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """CTF 提领表 (11列: Age, Y, Paid, Annual_WD, Cum_WD, Guar_CV, _, Rev, Term, Total, Total+WD)"""
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            if not _header_contains(page, ["现金提取", "退保发还"]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 10:
                        continue
                    ages = _parse_multi(r[0])
                    ys = _parse_multi(r[1])
                    if not ys or not (1 <= ys[0] <= 128):
                        continue
                    paid = _parse_multi(r[2])
                    annual = _parse_multi(r[3])
                    cum = _parse_multi(r[4])
                    guar = _parse_multi(r[5]) if len(r) > 5 else []
                    rev = _parse_multi(r[7]) if len(r) > 7 else []
                    term = _parse_multi(r[8]) if len(r) > 8 else []
                    total = _parse_multi(r[9]) if len(r) > 9 else []
                    n = min(len(ys), len(paid), len(annual), len(cum))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 128 and y not in rows:
                            rows[y] = {
                                "Y": y, "Age": ages[k] if k < len(ages) else y,
                                "Paid": paid[k], "Annual_WD": annual[k], "Cum_WD": cum[k],
                                "Guar_CV": guar[k] if k < len(guar) else 0,
                                "Rev": rev[k] if k < len(rev) else 0,
                                "Term": term[k] if k < len(term) else 0,
                                "Total": total[k] if k < len(total) else 0,
                                "SourcePage": pg,
                            }
    return rows


def extract_no_withdraw_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """AIA 多页 (P12-15): 详细说明 (退保/身故) + 现金价值 (可套现)

    Header 匹配: "保单年度 终结" (身故) / "保单年度 现金价值" / "保单年度 可套现"
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            # 宽松匹配: 任何含 "保单年度" + "身故/退保/现金价值/可套现/总额" 的页
            txt = page.extract_text() or ""
            if "保单年度" not in txt:
                continue
            if not any(kw in txt for kw in ["退保", "现金价值", "可套现", "身故", "总额"]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t[3:]:  # 跳表头
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_y(r[0])
                    if not ys:
                        continue
                    paid = _parse_multi(r[1])
                    guar = _parse_multi(r[2]) if len(r) > 2 else []
                    rev_term = (_parse_multi(r[3]) if len(r) > 3 else []) + (_parse_multi(r[4]) if len(r) > 4 else [])
                    total = _parse_multi(r[5]) if len(r) > 5 else []
                    n = min(len(ys), len(paid), len(total))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            rows[y] = {
                                "Y": y, "Age": y, "Paid": paid[k],
                                "Guar_CV": guar[k] if k < len(guar) else 0,
                                "Rev": rev_term[0] if rev_term else 0,
                                "Term": rev_term[1] if len(rev_term) > 1 else 0,
                                "Total": total[k],
                            }
    return rows


def extract_no_withdraw_aia_huanyu(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    rows = {}
    doc = fitz.open(pdf_path)
    for pg in page_indices:
        if pg < 1 or pg > doc.page_count:
            continue
        page = doc[pg - 1]
        text = page.get_text()
        if "详细说明" not in text or "退保发还金额" not in text:
            continue
        with contextlib.redirect_stdout(io.StringIO()):
            tables = page.find_tables().tables
        for table in tables:
            extracted = table.extract()
            if not extracted or len(extracted[0]) < 12:
                continue
            for age, year, paid, guaranteed, bonus, dividend, total, death in table_rows(
                table, [0, 1, 2, 3, 4, 5, 6, 11]
            ):
                year_num = integer(year)
                if year_num <= 0:
                    continue
                rows[year_num] = {
                    "Y": year_num,
                    "Age": integer(age),
                    "Paid": number(paid),
                    "Guar_CV": number(guaranteed),
                    "Rev": number(bonus),
                    "Term": number(dividend),
                    "Total": number(total),
                    "Death": number(death),
                    "SourcePage": pg,
                }
    doc.close()
    return rows


def extract_withdraw_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """AIA 6列 (P16-18): Age, Y, Wd_Guar, Wd_Rev, Wd_Term, Wd_Total"""
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            if not _header_contains(page, ["现金提取"]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t[3:]:
                    if not r or len(r) < 6:
                        continue
                    ages = _parse_multi(r[0])
                    ys = _parse_multi(r[1])
                    if not ys:
                        continue
                    a = _parse_multi(r[2])
                    b = _parse_multi(r[3]) if len(r) > 3 else []
                    c = _parse_multi(r[4]) if len(r) > 4 else []
                    tot = _parse_multi(r[5]) if len(r) > 5 else []
                    n = min(len(ys), len(tot))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            annual_total = tot[k]
                            rows[y] = {
                                "Y": y, "Age": ages[k] if k < len(ages) else y,
                                "Paid": 0, "Annual_WD": annual_total, "Cum_WD": 0,
                                "Guar_CV": a[k] if k < len(a) else 0,
                                "Rev": (b[k] if k < len(b) else 0) + (c[k] if k < len(c) else 0),
                                "Term": 0, "Total": 0, "Total_WD": 0,
                            }
    # 累计 = sum 累加
    cum = 0
    for y in sorted(rows.keys()):
        cum += rows[y]["Annual_WD"]
        rows[y]["Cum_WD"] = cum
    return rows


def extract_withdraw_remainder_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """AIA 9列 (P19-21): Age, Y, Paid, Wd_Amount, _, _, _, _, Remain_Total"""
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            if not _header_contains(page, ["退保发还"]):
                continue
            if _header_contains(page, ["身故"]):
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t[3:]:
                    if not r or len(r) < 9:
                        continue
                    ages = _parse_multi(r[0])
                    ys = _parse_multi(r[1])
                    if not ys:
                        continue
                    paid = _parse_multi(r[2])
                    remain_total = _parse_multi(r[8]) if len(r) > 8 else []
                    n = min(len(ys), len(remain_total))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            rows[y] = {
                                "Y": y, "Age": ages[k] if k < len(ages) else y,
                                "Paid": paid[k] if k < len(paid) else 0,
                                "Total": remain_total[k],
                            }
    return rows


def extract_no_withdraw_manulife(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """Manulife 宏挚家 不提领表 (8列: Y, Paid, Guar_CV, Term, Total, Death_Guar, Death_Term, Death_Total)
    官方页头: '宏X家傳承保險計劃' + '說明 – 退保價值及身故賠償' + '保證現金價值' + '終期紅利'
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            text = page.extract_text() or ""
            if "保證現金價值" not in text or "終期紅利" not in text:
                continue
            if "現金提取" in text or "款項提取" in text:
                continue  # 排除提领页
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_multi(r[0])
                    if not ys or not (1 <= ys[0] <= 128):
                        continue
                    paid = _parse_multi(r[1])
                    guar = _parse_multi(r[2])  # 保證現金價值
                    term = _parse_multi(r[3])  # 終期紅利
                    total = _parse_multi(r[4])  # 退保總額 (A+B)
                    n = min(len(ys), len(paid), len(total))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 128 and y not in rows:
                            rows[y] = {
                                "Y": y, "Age": y, "Paid": paid[k],
                                "Guar_CV": guar[k] if k < len(guar) else 0,
                                "Rev": 0,  # 宏挚家无复归红利
                                "Term": term[k] if k < len(term) else 0,
                                "Total": total[k],
                                "SourcePage": pg,
                            }
    return rows


def extract_withdraw_manulife(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """Manulife 宏挚家 提领表 (9列: Y, Paid, Annual_WD, _, _, _, _, _, Remain_Total)
    页头: '款項提取說明 – 退保價值' + '該年提取款項' + '款項提取后的退保價值'
    列序: [Y, Paid, Annual_WD, _, Sum_Guar, Sum_Term, Sum_Total, Remain_Guar, Remain_Term, Remain_Total]
    实际为 10 列, 取关键列
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg in page_indices:
            if pg < 1 or pg > len(pdf.pages):
                continue
            page = pdf.pages[pg - 1]
            text = page.extract_text() or ""
            if "款項提取" not in text or "退保價值" not in text:
                continue
            for t in page.extract_tables():
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_multi(r[0])
                    if not ys or not (1 <= ys[0] <= 128):
                        continue
                    paid = _parse_multi(r[1])
                    annual = _parse_multi(r[2]) if len(r) > 2 else []
                    # 剩余退保总额在最后一列或倒数第二列
                    remain_total = _parse_multi(r[-1]) if len(r) > 1 else []
                    n = min(len(ys), len(paid), len(remain_total))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 128 and y not in rows:
                            annual_wd = annual[k] if k < len(annual) else 0
                            rows[y] = {
                                "Y": y, "Age": y, "Paid": paid[k],
                                "Annual_WD": annual_wd, "Cum_WD": 0,
                                "Guar_CV": 0, "Rev": 0, "Term": 0,
                                "Total": remain_total[k],
                                "SourcePage": pg,
                            }
    # 累计 = 累加
    cum = 0
    for y in sorted(rows.keys()):
        cum += rows[y]["Annual_WD"]
        rows[y]["Cum_WD"] = cum
    return rows


def enrich(rows: Dict[int, Dict], paid_total: float) -> Dict[int, Dict]:
    """加 IRR/单利/倍数"""
    for y, r in rows.items():
        total = r.get("Total", 0) or 0
        if "Cum_WD" in r:
            received = (r.get("Cum_WD", 0) or 0) + total
            r["Total_Received"] = received
            r["Mult"] = received / paid_total if paid_total else 0
            if received > paid_total and y > 0:
                r["IRR"] = (received / paid_total) ** (1 / y) - 1
                r["Simple"] = (received - paid_total) / paid_total / y
        else:
            r["Mult"] = total / paid_total if paid_total else 0
            if total > paid_total and y > 0:
                r["IRR"] = (total / paid_total) ** (1 / y) - 1
                r["Simple"] = (total - paid_total) / paid_total / y
    return rows


def _numeric_tokens_from_page(pdf_path: str, page_indices: List[int], header_marker: str) -> Dict[int, List[str]]:
    doc = fitz.open(pdf_path)
    pages: Dict[int, List[str]] = {}
    for pg in page_indices:
        if pg < 1 or pg > doc.page_count:
            continue
        text = doc[pg - 1].get_text()
        if header_marker not in text:
            continue
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        try:
            start = next(i for i, ln in enumerate(lines) if ln == header_marker) + 1
        except StopIteration:
            continue
        tokens: List[str] = []
        for ln in lines[start:]:
            if re.fullmatch(r"\d{1,3}(?:,\d{3})*(?:\.\d+)?", ln):
                tokens.append(ln)
        pages[pg] = tokens
    doc.close()
    return pages


def extract_no_withdraw_fwd(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    rows: Dict[int, Dict] = {}
    pages = _numeric_tokens_from_page(pdf_path, page_indices, "(A)+(B)+(C)")
    for pg, tokens in pages.items():
        width = 7
        for i in range(0, len(tokens) - width + 1, width):
            chunk = tokens[i:i + width]
            year = int(chunk[0].replace(",", ""))
            age = int(chunk[1].replace(",", ""))
            if not (1 <= year <= 200 and 0 <= age <= 150):
                continue
            paid, guar, rev, term, total = [int(float(x.replace(",", ""))) for x in chunk[2:7]]
            if year not in rows:
                rows[year] = {
                    "Y": year,
                    "Age": age,
                    "Paid": paid,
                    "Guar_CV": guar,
                    "Rev": rev,
                    "Term": term,
                    "Total": total,
                    "SourcePage": pg,
                }
    return rows


def extract_withdraw_fwd(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    rows: Dict[int, Dict] = {}
    pages = _numeric_tokens_from_page(pdf_path, page_indices, "(A)+(B)+(C)+(D)")
    for pg, tokens in pages.items():
        width = 10
        for i in range(0, len(tokens) - width + 1, width):
            chunk = tokens[i:i + width]
            year = int(chunk[0].replace(",", ""))
            age = int(chunk[1].replace(",", ""))
            if not (1 <= year <= 200 and 0 <= age <= 150):
                continue
            paid = int(float(chunk[2].replace(",", "")))
            annual = int(float(chunk[3].replace(",", "")))
            nominal = int(float(chunk[4].replace(",", "")))
            guar = int(float(chunk[5].replace(",", "")))
            rev = int(float(chunk[6].replace(",", "")))
            term = int(float(chunk[7].replace(",", "")))
            locked = int(float(chunk[8].replace(",", "")))
            total = int(float(chunk[9].replace(",", "")))
            if year not in rows:
                rows[year] = {
                    "Y": year,
                    "Age": age,
                    "Paid": paid,
                    "Annual_WD": annual,
                    "Cum_WD": 0,
                    "Guar_CV": guar,
                    "Rev": rev,
                    "Term": term,
                    "Locked": locked,
                    "Nominal": nominal,
                    "Total": total,
                    "SourcePage": pg,
                }
    cum = 0
    for year in sorted(rows.keys()):
        cum += rows[year]["Annual_WD"]
        rows[year]["Cum_WD"] = cum
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--signature", required=True, help="例: ctf-mw2iua-v1")
    ap.add_argument("--company", required=True, help="ctf/aia/pru/manulife/fwd")
    ap.add_argument("--page-summary", type=int, default=1)
    ap.add_argument("--pages-no-withdraw", default="")
    ap.add_argument("--pages-withdraw", default="")
    ap.add_argument("--pages-withdraw-remainder", default="")
    args = ap.parse_args()

    def parse_pages(s: str) -> List[int]:
        return [int(x) for x in s.split(",") if x.strip().isdigit()]

    pages_nw = parse_pages(args.pages_no_withdraw)
    pages_wd = parse_pages(args.pages_withdraw)
    pages_wd_rem = parse_pages(args.pages_withdraw_remainder)

    try:
        summary = extract_summary(args.pdf, args.page_summary)
        if args.company == "ctf":
            no_wd = extract_no_withdraw_ctf(args.pdf, pages_nw)
            wd = extract_withdraw_ctf(args.pdf, pages_wd) if pages_wd else {}
        elif args.company == "aia":
            # 临时回退: aia-huanyu5-v1 之前调 aia_huanyu (有 bug), 改用通用 aia extractor
            no_wd = extract_no_withdraw_aia(args.pdf, pages_nw)
            wd = extract_withdraw_aia(args.pdf, pages_wd) if pages_wd else {}
            if pages_wd_rem and wd:
                rem = extract_withdraw_remainder_aia(args.pdf, pages_wd_rem)
                for y, r in rem.items():
                    if y in wd and r.get("Total"):
                        wd[y]["Total"] = r["Total"]
                        if r.get("Paid"):
                            wd[y]["Paid"] = r["Paid"]
        elif args.company == "manulife":
            no_wd = extract_no_withdraw_manulife(args.pdf, pages_nw)
            wd = extract_withdraw_manulife(args.pdf, pages_wd) if pages_wd else {}
        elif args.company == "fwd":
            no_wd = extract_no_withdraw_fwd(args.pdf, pages_nw)
            wd = extract_withdraw_fwd(args.pdf, pages_wd) if pages_wd else {}
        else:
            # 通用 fallback: 复用 CTF 提取器（部分产品格式相同）
            no_wd = extract_no_withdraw_ctf(args.pdf, pages_nw)
            wd = extract_withdraw_ctf(args.pdf, pages_wd) if pages_wd else {}

        paid_total = int(summary.get("premium_total") or 500000)
        enrich(no_wd, paid_total)
        enrich(wd, paid_total)

        diagnostics = {
            "warnings": [],
            "parser": f"signature-extractor/{args.signature}",
            "noWithdrawRows": len(no_wd),
            "withdrawRows": len(wd),
        }
        if len(no_wd) < 20:
            diagnostics["warnings"].append(f"不提领表仅 {len(no_wd)} 行，预期 ≥20")
        print(json.dumps({
            "ok": True,
            "summary": summary,
            "paid_total": paid_total,
            "no_withdraw": {str(k): v for k, v in no_wd.items()},
            "withdraw": {str(k): v for k, v in wd.items()},
            "diagnostics": diagnostics,
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "signature": args.signature}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
