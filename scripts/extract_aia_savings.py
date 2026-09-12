#!/usr/bin/env python3
"""
AIA 储蓄险专用 Fitz 提取器 — 财富盈活 / 環宇盈活

输入: 一个或多个 PDF (不同年龄样本)
输出: data/products/aia-caifuyinghuo.json 或 data/products/aia-huanyuyinghuo.json
      — 每产品一个 JSON, 含多年龄样本

字段: age / annual_premium / payment_years / sum_insured / coverage_items /
      benefit_illustration (按年龄分段)

PDF 结构 (11 列):
  Col 0: 保单年度终结 (保单年度 或 X岁, 每行用 \\n 分隔)
  Col 1: 缴付保费总额
  Col 2: 退保-保证现金价值 (A)
  Col 3: 退保-复归红利 (B, 非保证)
  Col 4: 退保-终期分红 (C, 非保证)
  Col 5: 退保-总额 (A+B+C)
  Col 6: 身故-保证金额 (D)
  Col 7: 身故-复归红利 (E, 非保证)
  Col 8: 身故-终期分红 (F, 非保证)
  Col 9: 身故-总额 (D+E+F)
  Col 10: 总赔偿金额 (D 或 G 较高者)
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


def extract_summary_from_pdf(pdf_path: str, product_name: str, product_code: str) -> Dict:
    """读首页摘要: 受保人/年龄/性别/货币/产品/保额/年缴/缴期/保障期 + 保障项目列表"""
    summary = {
        "insured_name": None,
        "insured_age": None,
        "insured_gender": None,
        "smoker": None,
        "product_name": product_name,
        "product_code": product_code,
        "currency": "USD",
        "annual_premium": None,
        "annual_premium_with_levy": None,
        "payment_years": None,
        "coverage_period": None,
        "premium_total": None,
        "sum_insured": None,
        "basic_amount": None,  # 投保时基本金额 (1)
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
    # 年龄 (AIA 格式: "年龄: VIP 先生 1" 或 "年龄: 36 VIP 先生" 或 "年龄: 36")
    # 关键: 中间有 "VIP 先生" + 换行 + 数字, 用 [\s\S]{0,80}? 容许
    m = re.search(r"年龄\s*[:：][\s\S]{0,80}?(\d{1,3})\s*(?:岁|岁\s*$)", text, re.MULTILINE)
    if not m:
        m = re.search(r"年龄\s*[:：]\s*(?:VIP\s*先?\s*生?\s*)?(\d{1,3})", text)
    if not m:
        # 兜底: 找 "VIP 先生 N" 或 "VIP 小姐 N" 紧跟数字
        m = re.search(r"VIP\s*先?\s*[生女]\s*[\s\S]{0,20}?(\d{1,3})", text)
    if m:
        v = int(m.group(1))
        # 排除不合理 (如 100+ 应该是岁数, 不是年龄)
        if 0 <= v <= 99:
            summary["insured_age"] = v
    # 性别
    if "性别: 女" in text or "性别：女" in text or "VIP 女生" in text or "VIP 小姐" in text:
        summary["insured_gender"] = "女"
    elif "性别: 男" in text or "性别：男" in text or "VIP 先生" in text or "VIP 男生" in text:
        summary["insured_gender"] = "男"

    # 货币
    m = re.search(r"保单货[币幣]\s*[:：]\s*(\S+)", text)
    if m:
        c = m.group(1).strip()
        if c in ("美元",):
            summary["currency"] = "USD"
        elif c in ("港元", "港幣"):
            summary["currency"] = "HKD"

    # 投保时保额 (NN,NNN 格式, 紧跟 "投保时保额")
    # 关键修复: AIA 表格行 "100,000" 在 "投保时保额(2)" 标记后
    m = re.search(r"投保时保额\s*\(\d+\)\s*[\s\S]{0,50}?(\d{1,3}(?:,\d{3}){1,2})", text)
    if m:
        summary["sum_insured"] = num(m.group(1))
    # 兜底: 找表格里的最大 NN,NNN
    if not summary["sum_insured"]:
        all_amounts = re.findall(r"(\d{1,3}(?:,\d{3}){1,2})", text)
        candidates = [num(a) for a in all_amounts if num(a) >= 50000]
        if candidates:
            summary["sum_insured"] = max(candidates)

    # 投保时基本金额
    m = re.search(r"投保时基本金额\s*\(\d+\)\s*[\s\S]{0,50}?(\d{1,3}(?:,\d{3}){1,2})", text)
    if m:
        summary["basic_amount"] = num(m.group(1))

    # 年缴保费 (投保时年缴保费 | NN,NNN.NN)
    # AIA 储蓄险: "投保时\n年缴保费" 后接金额
    m = re.search(r"投保时\s*年缴保费[\s\S]{0,80}?(\d{1,3}(?:,\d{3})*\.\d{2})", text)
    if m:
        summary["annual_premium"] = num(m.group(1))
    # 兜底: 找 NN,NNN.NN 范围 (通常年缴保费 = 100K 左右, 排除 12.85 levy)
    if not summary["annual_premium"]:
        candidates = re.findall(r"(\d{1,3}(?:,\d{3})*\.\d{2})", text)
        for c in candidates:
            v = num(c)
            if 1000 <= v <= 500000:
                summary["annual_premium"] = v
                break

    # 含征费 (投保时年缴总保费)
    m = re.search(r"投保时年缴总保费\s*[:：]?\s*(\d{1,3}(?:,\d{3})*\.\d{2})", text)
    if m:
        summary["annual_premium_with_levy"] = num(m.group(1))
    elif summary["annual_premium"]:
        summary["annual_premium_with_levy"] = summary["annual_premium"]

    # 保费供款年期 (NN 年格式, 后面是数字, 不带"至X岁")
    # AIA 储蓄险: "保费供款年期 | 5" (在表格里)
    m = re.search(r"保费供款年期[\s\S]{0,50}?(\d+)\s*年", text)
    if m:
        summary["payment_years"] = int(m.group(1))
    # 兜底: "5 年缴费" 在标题里
    if not summary["payment_years"]:
        m = re.search(r"(\d+)\s*年\s*缴费", text)
        if m:
            summary["payment_years"] = int(m.group(1))

    # 保障年期 (终身 或 至XX岁)
    if "终身" in text:
        summary["coverage_period"] = "终身"
    else:
        m = re.search(r"至(\d+)\s*岁", text)
        if m:
            summary["coverage_period"] = f"至{m.group(1)}岁"

    # 总保费
    if summary["annual_premium"] and summary["payment_years"]:
        summary["premium_total"] = round(summary["annual_premium"] * summary["payment_years"], 2)

    # 保障项目 (从首页"保障项目" 表)
    known_items = [
        ("首 12 个月意外身故赔偿", "首12个月意外身故赔偿"),
        ("首12个月意外身故赔偿", "首12个月意外身故赔偿"),
        ("保单货币", "保单货币"),
        ("投保时保额", "投保时保额"),
        ("投保时年缴保费", "投保时年缴保费"),
    ]
    for kw, label in known_items:
        if kw in text:
            # 找金额
            idx = text.find(kw)
            chunk = text[idx:idx + 200]
            amounts = re.findall(r"(\d{1,3}(?:,\d{3}){1,2})", chunk)
            amount_val = None
            for a in amounts:
                v = num(a)
                if v >= 100:
                    amount_val = v
                    break
            period = None
            if "终身" in chunk:
                period = "终身"
            else:
                pm = re.search(r"(至\d+岁|\d+年|终身)", chunk)
                if pm:
                    period = pm.group(0)
            summary["coverage_items"].append({
                "name": label,
                "amount": amount_val,
                "period": period,
            })

    # 核心条款 (从首页段落 + 通用储蓄险条款)
    clause_keywords = [
        "保证现金价值",
        "复归红利",
        "终期分红",
        "身故赔偿",
        "退保发还金额",
        "保单贷款",
        "保费征费",
    ]
    for kw in clause_keywords:
        if kw in text:
            summary["key_clauses"].append(kw)

    return summary


def extract_benefit_illustration(pdf_path: str, insured_age: int) -> List[Dict]:
    """读 11 列布局的退保/身故演示表

    Cols:
      0: 保单年度终结 (保单年度 或 X岁, 每行 cell 用 \\n 分隔多个值)
      1: 缴付保费总额
      2: 退保-保证现金价值 (A)
      3: 退保-复归红利 (B, 非保证)
      4: 退保-终期分红 (C, 非保证)
      5: 退保-总额 (A+B+C)
      6: 身故-保证金额 (D)
      7: 身故-复归红利 (E, 非保证)
      8: 身故-终期分红 (F, 非保证)
      9: 身故-总额 (D+E+F)
      10: 总赔偿金额 (D 或 G 较高者)
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
            if not ex or len(ex) < 4:
                continue
            # 必须是 11 列
            if len(ex[0]) != 11:
                continue
            hdr = " ".join([str(c) for c in ex[0]] + [str(c) for c in ex[1]] + [str(c) for c in ex[2]])
            if "保单" not in hdr or "退保" not in hdr or "身故" not in hdr:
                continue

            # 数据从第 4 行起 (3 行 header: 主, 子, 子-子)
            for row_data in ex[3:]:
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

                    # Col 0: "保单年度终结" — 可能是 "1\n2\n3" 纯数字 或 "65岁\n70岁" 带岁
                    yr_raw = vals[0].strip()
                    # 去掉 "岁"
                    yr_str = yr_raw.replace("岁", "").strip()
                    if not yr_str:
                        continue

                    # 如果是纯数字, 直接用; 如果是 "VIP 客户" 等文字, 跳过
                    if not yr_str.isdigit():
                        # 跳过非数字行 (如 "保单生效日" 等)
                        continue

                    year_val = int(yr_str)
                    if year_val <= 0 or year_val > 200:
                        continue
                    if year_val in seen_years:
                        continue

                    if len(vals) < 11:
                        continue

                    # 11 列布局 (col_offset=0):
                    # vals[0]=年度, vals[1]=已缴保费,
                    # vals[2]=退保-保证A, vals[3]=退保-复归B, vals[4]=退保-终期C,
                    # vals[5]=退保-总额,
                    # vals[6]=身故-保证D, vals[7]=身故-复归E, vals[8]=身故-终期F,
                    # vals[9]=身故-总额G,
                    # vals[10]=总赔偿金额 (D 或 G 较高者)
                    premium = num(vals[1])
                    sv_guar = num(vals[2])
                    sv_reversion = num(vals[3])  # 复归红利
                    sv_terminal = num(vals[4])   # 终期分红
                    sv_total = num(vals[5])
                    db_guar = num(vals[6])
                    db_reversion = num(vals[7])
                    db_terminal = num(vals[8])
                    db_total = num(vals[9])
                    db_max = num(vals[10])

                    # 退保总额兜底
                    total_surrender = sv_total if sv_total > 0 else (sv_guar + sv_reversion + sv_terminal)
                    # 身故赔偿总额 (取 D 或 G 较高者, 即 vals[10])
                    death_benefit = db_max if db_max > 0 else db_total if db_total > 0 else (db_guar + db_reversion + db_terminal)
                    non_guar_surrender = sv_reversion + sv_terminal
                    non_guar_death = db_reversion + db_terminal

                    rows.append({
                        "policy_year": year_val,
                        "total_premium_paid": premium,
                        "guaranteed_cash_value": sv_guar,
                        "reversionary_bonus": non_guar_surrender,
                        "total_surrender_value": total_surrender,
                        "guaranteed_death_benefit": db_guar,
                        "non_guaranteed_death_benefit": non_guar_death,
                        "death_benefit": death_benefit,
                        "source_page": page_i,
                    })
                    seen_years.add(year_val)

    doc.close()
    rows = sorted(rows, key=lambda x: x["policy_year"])
    return rows


def extract_single_pdf(pdf_path: str, product_name: str, product_code: str) -> Dict:
    """从单个 PDF 提取完整数据 (summary + benefit_illustration)"""
    summary = extract_summary_from_pdf(pdf_path, product_name, product_code)
    bi = extract_benefit_illustration(pdf_path, summary.get("insured_age") or 0)
    return {
        "summary": summary,
        "benefit_illustration": bi,
    }


def build_product_json(pdf_paths: List[str], product_id: str, product_name: str,
                       product_code: str, plan_type: str, company: str = "aia") -> Dict:
    """构建产品级 JSON: 包含所有年龄样本"""
    samples = []
    for p in pdf_paths:
        try:
            data = extract_single_pdf(p, product_name, product_code)
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
            print(f"  ✓ {Path(p).name}: age={sample['insured_age']}, premium={sample['annual_premium']}, "
                  f"sum_insured={sample['sum_insured']}, rows={sample['benefit_illustration_rows']}")
        except Exception as e:
            print(f"  ✗ {Path(p).name}: ERROR {e}")
            raise

    # canonical (选年龄中等的样本)
    canonical = sorted(samples, key=lambda s: s["insured_age"] or 0)[len(samples) // 2]

    product = {
        "product_id": product_id,
        "product_name": product_name,
        "product_code": product_code,
        "company": company,
        "plan_type": plan_type,
        "currency": "USD",
        "extracted_at": "2026-07-07T00:00:00Z",
        "samples": samples,
        "canonical_sample": canonical["source_pdf"],
        "coverage_items": canonical["data"]["summary"]["coverage_items"],
        "key_clauses": canonical["data"]["summary"]["key_clauses"],
        "fitz_version": "pymupdf-1.24",
    }
    return product


# ============================================================================
# 产品配置
# ============================================================================

PRODUCTS = {
    "aia-caifuyinghuo": {
        "name": "「财富盈活」储蓄保险计划",
        "code": "CFYH",
        "plan_type": "savings",
        "pdfs": [
            "/Users/soldier/Downloads/官方计划书案例/友邦——财富盈活储蓄保险计划.pdf",
        ],
    },
    "aia-huanyuyinghuo": {
        "name": "「環宇盈活」儲蓄保險計劃",
        "code": "HYYH",
        "plan_type": "savings",
        "pdfs": [
            "/Users/soldier/Downloads/官方计划书案例/友邦——環宇盈活儲蓄保險計劃.pdf",
            "/Users/soldier/Downloads/官方计划书案例/友邦——環宇盈活儲蓄保險計劃(1).pdf",
        ],
    },
}


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else None
    for product_id, cfg in PRODUCTS.items():
        if target and product_id != target:
            continue
        print(f"\n=== {product_id} ===")
        print(f"Extracting {len(cfg['pdfs'])} {cfg['name']} PDFs...")
        product = build_product_json(
            cfg["pdfs"], product_id, cfg["name"], cfg["code"], cfg["plan_type"]
        )
        output_path = OUTPUT_DIR / f"{product_id}.json"
        output_path.write_text(json.dumps(product, ensure_ascii=False, indent=2))
        print(f"\n✓ Output: {output_path}")
        print(f"  Samples: {len(product['samples'])}")
        print(f"  Canonical: {product['canonical_sample']}")