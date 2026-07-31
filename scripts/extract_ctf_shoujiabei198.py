#!/usr/bin/env python3
"""
CTF 守護家倍198 (HB4CILA10) 重疾险专用 Fitz 提取器

输入: 一个或多个 PDF (不同年龄样本)
输出: data/products/ctf-shoujiabei198.json — 每产品一个 JSON, 含多年龄样本

字段: age / annual_premium / payment_years / sum_insured / coverage_items /
      benefit_illustration (按年龄分段)
"""
import sys
import json
import re
from pathlib import Path
from typing import List, Dict, Optional

import fitz

OUTPUT_DIR = Path(__file__).parent.parent / "data" / "products"
try:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
except PermissionError:
    OUTPUT_DIR = Path("/tmp/insurance-ppt-products")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def num(v) -> float:
    if v in ("", "-", None, "None"):
        return 0.0
    try:
        return float(str(v).replace(",", "").replace("$", "").replace(" ", ""))
    except Exception:
        return 0.0


def extract_summary_from_pdf(pdf_path: str) -> Dict:
    """读首页摘要: 受保人/年龄/性别/货币/产品/保额/年缴/缴期/保障期 + 保障项目列表"""
    summary = {
        "insured_name": None,
        "insured_age": None,
        "insured_gender": None,
        "smoker": None,
        "product_name": "「守護家倍198」危疾保障计划",
        "product_code": "HB4CILA10",
        "currency": "USD",
        "annual_premium": None,
        "annual_premium_with_levy": None,
        "payment_years": None,
        "coverage_period": None,
        "premium_total": None,
        "sum_insured": None,
        "coverage_items": [],
        "key_clauses": [],
    }
    doc = fitz.open(pdf_path)
    text = ""
    for i in range(min(2, len(doc))):
        text += doc[i].get_text() + "\n"
    doc.close()

    # 受保人姓名
    m = re.search(r"受保人姓名\s*[:：]\s*(\S+)", text)
    if m:
        summary["insured_name"] = m.group(1).strip()
    # 年龄
    m = re.search(r"年龄\s*[:：]\s*(\d+)", text)
    if m:
        summary["insured_age"] = int(m.group(1))
    # 性别
    if "性别: 女" in text or "性别：女" in text:
        summary["insured_gender"] = "女"
    elif "性别: 男" in text or "性别：男" in text:
        summary["insured_gender"] = "男"
    # 吸烟
    if "非吸烟者" in text or "非吸煙者" in text:
        summary["smoker"] = "非吸烟者"
    elif "吸烟者" in text:
        summary["smoker"] = "吸烟者"

    # 货币
    m = re.search(r"保单货[币幣]\s*[:：]\s*(\S+)", text)
    if m:
        c = m.group(1).strip()
        if c in ("美元",):
            summary["currency"] = "USD"
        elif c in ("港元", "港幣"):
            summary["currency"] = "HKD"
        elif c in ("人民币",):
            summary["currency"] = "CNY"
        else:
            summary["currency"] = c

    # 年缴保费 (CTF CI 表头格式: "投保时每年保费 | 4,949.00 | 10 年^ | 至100岁")
    # 关键修复: 中间会经过 "「守\n家倍198」" 含数字, 必须只匹配 NN,NNN.NN 格式
    m = re.search(r"投保时每年保费[\s\S]{0,200}?(\d{1,3}(?:,\d{3})*\.\d{2})", text)
    if m:
        summary["annual_premium"] = num(m.group(1))
    # 含征费 (取 NN,NNN.NN 格式)
    m = re.search(r"投保时每年总保费\(包含保费征费\)[\s\S]{0,30}?(\d{1,3}(?:,\d{3})*\.\d{2})", text)
    if m:
        summary["annual_premium_with_levy"] = num(m.group(1))
    elif m := re.search(r"投保时每年总保费[\s\S]{0,100}?(\d{1,3}(?:,\d{3})*\.\d{2})", text):
        summary["annual_premium_with_levy"] = num(m.group(1))
    if summary["annual_premium"] and not summary["annual_premium_with_levy"]:
        summary["annual_premium_with_levy"] = summary["annual_premium"]

    # 缴期 (CTF CI 表头格式: "10 年^" 紧跟 "至100岁")
    m = re.search(r"(\d+)\s*年\s*\^", text)
    if m:
        summary["payment_years"] = int(m.group(1))
    if not summary.get("payment_years"):
        m = re.search(r"(\d+)\s*年\s*缴", text)
        if m:
            summary["payment_years"] = int(m.group(1))
    # 保障期
    m = re.search(r"至(\d+)\s*岁", text)
    if m:
        summary["coverage_period"] = f"至{m.group(1)}岁"
    if not summary.get("coverage_period") and "终身" in text:
        summary["coverage_period"] = "终身"

    # 保额 (基本计划) - 必须 NN,NNN 格式, 避免抓到 年份 / 期数
    m = re.search(r"基本计划[\s\S]{0,200}?(\d{2,3}(?:,\d{3}){1,2})", text)
    if m:
        summary["sum_insured"] = num(m.group(1))

    # 保障项目 (从首页保障摘要表)
    # 格式: "- 额外生存赔偿或 | 额外身故赔偿# | 60,000 | - | - | 10年 | 160,000"
    # 简化: 用关键字匹配, 找产品线下的 N 项
    known_items = [
        ("额外生存赔偿或额外身故赔偿", "额外身故赔偿"),
        ("保障还原利益", "保障还原利益"),
        ("严重都市疾病额外保障", "严重都市疾病额外保障"),
        ("严重都市疾病无限次增值保障", "严重都市疾病无限次增值保障"),
        ("首十年升级保障", "首十年升级保障"),
        ("癌症多重保障", "癌症多重保障"),
        ("心脏病和中风多重保障", "心脏病和中风多重保障"),
    ]
    # 抓取每个项目后的金额
    for kw, label in known_items:
        if kw in text:
            # 在 kw 后面 50 个字符内找 NN,NNN 格式
            idx = text.find(kw)
            chunk = text[idx:idx + 200]
            amounts = re.findall(r"(\d{2,3}(?:,\d{3}){1,2})", chunk)
            amount_val = None
            for a in amounts:
                v = num(a)
                if v >= 10000:
                    amount_val = v
                    break
            # 抓期限
            period = None
            pm = re.search(r"(至\d+岁|终身|\d+年)", chunk)
            if pm:
                period = pm.group(0)
            summary["coverage_items"].append({
                "name": label,
                "amount": amount_val,
                "period": period,
            })

    # 核心条款 (从首页段落提取)
    clause_keywords = [
        "保障还原利益",
        "严重都市疾病额外保障",
        "严重都市疾病无限次增值保障",
        "首十年升级保障",
        "额外生存赔偿或额外身故赔偿",
        "癌症多重保障",
        "心脏病和中风多重保障",
    ]
    for kw in clause_keywords:
        if kw in text:
            summary["key_clauses"].append(kw)

    # 总保费
    if summary["annual_premium"] and summary["payment_years"]:
        summary["premium_total"] = round(summary["annual_premium"] * summary["payment_years"], 2)

    return summary


def extract_benefit_illustration(pdf_path: str) -> List[Dict]:
    """读退保总额演示表: 8列布局
    Cols: 保单年度, 已缴保费, 退保-保证, 退保-非保证, 退保-总额, 身故-保证, 身故-非保证, 身故-总额

    CTF CI 表头实际是:
      Row 0: 保单年度 | 已缴保费 | 退保发还金额 | (空) | (空) | 身故赔偿额 | (空) | (空)
      Row 1: (空)    | (空)    | 保证金额    | 非保证金额 | 总额 | 保证金额 | 非保证金额 | 总额
    数据: 第 3 行起每行的 cell 含 `N | N+1 | N+2 | ...` (合并单元格)
    """
    doc = fitz.open(pdf_path)
    rows: List[Dict] = []
    seen_years = set()

    for page_i in range(len(doc)):
        page = doc[page_i]
        tables = page.find_tables().tables
        for table in tables:
            try:
                ex = table.extract()
            except Exception:
                continue
            if not ex or len(ex) < 3:
                continue
            # 必须是 8 列 (保单年度+已缴+退保×3+身故×3)
            if len(ex[0]) != 8:
                continue
            hdr = " ".join([str(c) for c in ex[0]] + [str(c) for c in ex[1]])
            if "保单年度" not in hdr or "退保" not in hdr or "身故" not in hdr:
                continue

            # 从第 3 行 (数据) 开始, 每个 cell 可能含 `N | N+1 | ...`
            for row_data in ex[2:]:
                cells = [str(c).strip() for c in row_data]
                split_cells = [c.split("\n") for c in cells]
                n = max((len(sc) for sc in split_cells if any(sc)), default=0)
                if n == 0:
                    continue
                for ri in range(n):
                    vals = []
                    for sc in split_cells:
                        v = sc[ri].strip().replace(",", "") if ri < len(sc) else ""
                        vals.append(v)
                    if not vals:
                        continue
                    yr_str = vals[0].replace("岁", "").strip()
                    if not yr_str.isdigit():
                        continue
                    year_val = int(yr_str)
                    if year_val <= 0 or year_val > 200:
                        continue
                    if year_val in seen_years:
                        continue

                    if len(vals) < 8:
                        continue

                    # 8 列布局 (col_offset=0):
                    # vals[0]=年度, vals[1]=已缴保费, vals[2]=退保-保证, vals[3]=退保-非保证,
                    # vals[4]=退保-总额, vals[5]=身故-保证, vals[6]=身故-非保证, vals[7]=身故-总额
                    premium = num(vals[1])
                    sv_guar = num(vals[2])
                    sv_non = num(vals[3])
                    sv_total = num(vals[4])
                    db_guar = num(vals[5])
                    db_non = num(vals[6])
                    db_total = num(vals[7])

                    # 退保总额兜底: 总额为 0 时用 保证+非保证
                    total_surrender = sv_total if sv_total > 0 else (sv_guar + sv_non if (sv_guar > 0 or sv_non > 0) else 0)
                    total_death = db_total if db_total > 0 else (db_guar + db_non if (db_guar > 0 or db_non > 0) else 0)

                    rows.append({
                        "policy_year": year_val,
                        "total_premium_paid": premium,
                        "guaranteed_cash_value": sv_guar,
                        "reversionary_bonus": sv_non,
                        "total_surrender_value": total_surrender,
                        "guaranteed_death_benefit": db_guar,
                        "non_guaranteed_death_benefit": db_non,
                        "death_benefit": total_death,
                        "source_page": page_i,
                    })
                    seen_years.add(year_val)

    doc.close()
    rows = sorted(rows, key=lambda x: x["policy_year"])
    return rows


def extract_single_pdf(pdf_path: str) -> Dict:
    """从单个 PDF 提取完整数据 (summary + benefit_illustration)"""
    summary = extract_summary_from_pdf(pdf_path)
    bi = extract_benefit_illustration(pdf_path)
    return {
        "summary": summary,
        "benefit_illustration": bi,
    }


def build_product_json(pdf_paths: List[str]) -> Dict:
    """构建产品级 JSON: 包含所有年龄样本"""
    samples = []
    for p in pdf_paths:
        try:
            data = extract_single_pdf(p)
            sample = {
                "source_pdf": Path(p).name,
                "insured_age": data["summary"].get("insured_age"),
                "insured_gender": data["summary"].get("insured_gender"),
                "annual_premium": data["summary"].get("annual_premium"),
                "sum_insured": data["summary"].get("sum_insured"),
                "payment_years": data["summary"].get("payment_years"),
                "coverage_period": data["summary"].get("coverage_period"),
                "benefit_illustration_rows": len(data["benefit_illustration"]),
                "data": data,
            }
            samples.append(sample)
            print(f"  ✓ {Path(p).name}: age={sample['insured_age']}, premium={sample['annual_premium']}, rows={sample['benefit_illustration_rows']}")
        except Exception as e:
            print(f"  ✗ {Path(p).name}: ERROR {e}")
            raise

    # canonical (选年龄中等的样本)
    canonical = sorted(samples, key=lambda s: s["insured_age"] or 0)[len(samples) // 2]

    product = {
        "product_id": "ctf-shoujiabei198",
        "product_name": "「守護家倍198」危疾保障计划",
        "product_code": "HB4CILA10",
        "company": "ctf",
        "plan_type": "ci",
        "currency": "USD",
        "extracted_at": "2026-07-07T00:00:00Z",
        "samples": samples,
        "canonical_sample": canonical["source_pdf"],
        "coverage_items": canonical["data"]["summary"]["coverage_items"],
        "key_clauses": canonical["data"]["summary"]["key_clauses"],
        "fitz_version": "pymupdf-1.24",
    }
    return product


if __name__ == "__main__":
    pdfs = [
        "/Users/soldier/Downloads/官方计划书案例/守護家倍198.pdf",
        "/Users/soldier/Downloads/官方计划书案例/守護家倍198(1).pdf",
        "/Users/soldier/Downloads/官方计划书案例/守護家倍198(2).pdf",
    ]
    print(f"Extracting {len(pdfs)} CTF 守護家倍198 PDFs...")
    product = build_product_json(pdfs)

    output_path = OUTPUT_DIR / "ctf-shoujiabei198.json"
    output_path.write_text(json.dumps(product, ensure_ascii=False, indent=2))
    print(f"\n✓ Output: {output_path}")
    print(f"  Samples: {len(product['samples'])}")
    print(f"  Canonical: {product['canonical_sample']}")