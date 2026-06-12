#!/usr/bin/env python3
"""
按 PDF 签名（公司+产品）专用提取器 — 重疾险 (CI) 版

输入:
  --pdf <path>
  --signature <id>          # 例: ctf-hb4cila10-v1
  --page-summary <N>         # 投保摘要页 (1-based)
  --pages-coverage <list>    # 保障项目页
  --pages-premium-table <list>  # 保费/退保/身故表页
  --year-horizon <N>          # 演示口径年 (默认 100)

输出: JSON
{
  "ok": true,
  "summary": {
    insured_name, insured_age, insured_gender, product_name, product_code,
    currency, annual_premium, annual_premium_with_levy,
    payment_years, coverage_period, premium_total, sum_insured,
    coverage_items: [{name, sum_insured, premium_period, coverage_period}, ...]
  },
  "benefit_illustration": [   # 与 savings 同结构, 让 templates/render 兼容
    {Y, Age, Paid, Guar_CV, Rev, Term, Total, Mult, IRR, Simple}
  ],
  "diagnostics": {warnings: [], parser: "ci-signature"}
}
"""
import argparse
import json
import re
import sys
from typing import Dict, List, Optional

import pdfplumber
import fitz


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
    if not cell:
        return []
    out = []
    for x in str(cell).split("\n"):
        s = x.strip().replace("岁", "").strip()
        if s.isdigit():
            out.append(int(s))
    return out


def extract_summary(pdf_path: str, page: int) -> Dict:
    """读 P0 摘要: 受保人, 货币, 产品, 保额, 年缴, 缴期, 保障期"""
    summary = {
        "insured_name": None, "insured_age": None, "insured_gender": None,
        "product_name": None, "product_code": None, "currency": "USD",
        "annual_premium": None, "annual_premium_with_levy": None,
        "payment_years": None, "coverage_period": None, "premium_total": None,
        "sum_insured": None, "coverage_items": [],
    }
    doc = fitz.open(pdf_path)
    text = ""
    for i in range(min(page, doc.page_count)):
        text += doc[i].get_text() + "\n"
    doc.close()

    # 受保人
    m = re.search(r"受保人姓名\s*[：:]\s*(\S+)", text)
    if m: summary["insured_name"] = m.group(1).strip()
    m = re.search(r"年龄\s*[：:]\s*(\d+)", text)
    if m: summary["insured_age"] = int(m.group(1))
    m = re.search(r"性别\s*[：:]\s*(\S+)", text)
    if m: summary["insured_gender"] = m.group(1).strip()

    # 货币
    m = re.search(r"保单[货貨]币\s*[：:]\s*(\S+)", text)
    if m:
        c = m.group(1).strip()
        if c in ("美元",): summary["currency"] = "USD"
        elif c in ("港元",): summary["currency"] = "HKD"
        elif c in ("人民币",): summary["currency"] = "CNY"
        else: summary["currency"] = c

    # 产品 + code
    m = re.search(r"\(([A-Z]{1,3}\d+[A-Z0-9]*)\)", text)
    if m: summary["product_code"] = m.group(1)
    m = re.search(r"「([^」]+)」", text)
    if m: summary["product_name"] = "「" + m.group(1) + "」"

    # 年缴
    m = re.search(r"投保时每年保费\s*[\n:]?\s*(\d[\d,]*\.?\d*)", text)
    if m: summary["annual_premium"] = float(m.group(1).replace(",", ""))
    m = re.search(r"投保时每年总保费[^含\n]*[：:]?\s*(\d[\d,]*\.?\d*)", text)
    if m: summary["annual_premium_with_levy"] = float(m.group(1).replace(",", ""))
    elif summary["annual_premium"]:
        summary["annual_premium_with_levy"] = summary["annual_premium"]

    # 缴期 / 保障期
    m = re.search(r"(\d+)\s*年\s*[\^]?\s*[\n]?\s*至(\d+)\s*岁", text)
    if m:
        summary["payment_years"] = int(m.group(1))
        summary["coverage_period"] = f"至{m.group(2)}岁"
    if not summary.get("payment_years"):
        m = re.search(r"(\d+)\s*年\s*缴", text)
        if m: summary["payment_years"] = int(m.group(1))
    if not summary.get("coverage_period"):
        if "终身" in text:
            summary["coverage_period"] = "终身"
        m = re.search(r"至(\d+)\s*岁", text)
        if m: summary["coverage_period"] = f"至{m.group(1)}岁"

    # 保额 (基本计划第一项)
    m = re.search(r"基本计划[\s\S]*?(\d{2,3},\d{3})", text)
    if m: summary["sum_insured"] = float(m.group(1).replace(",", ""))

    # 总保费
    if summary["annual_premium"] and summary["payment_years"]:
        summary["premium_total"] = round(summary["annual_premium"] * summary["payment_years"], 2)

    return summary


def extract_benefit_illustration(pdf_path: str, pages: List[int]) -> List[Dict]:
    """读退保发还金额表: Y, Paid, Guar, Total

    关键: 多页 (身故表 + 退保表 + 提领表) 同 Y 会重复, dedupe 时按 max
    """
    rows: List[Dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for pg_idx in pages:
            if pg_idx >= len(pdf.pages):
                continue
            tables = pdf.pages[pg_idx].extract_tables()
            for t in tables:
                if not t or len(t) < 4:
                    continue
                # 表头: "保单年度 缴付保费 总额 终期红利 总额 ..." 之类
                header = " ".join(str(c) for c in t[0] if c) + " " + " ".join(str(c) for c in t[1] if c)
                if "保单年度" not in header and "退保" not in header:
                    continue
                # 找第一列含数字的行
                for r in t[2:]:
                    if not r:
                        continue
                    ys = _parse_y(r[0])
                    if not ys:
                        continue
                    paid = _parse_multi(r[1]) if len(r) > 1 else []
                    # 列序: [Y, Paid, Guar, ?, Term, Total]
                    guar = _parse_multi(r[2]) if len(r) > 2 else []
                    rev = _parse_multi(r[3]) if len(r) > 3 else []
                    term = _parse_multi(r[4]) if len(r) > 4 else []
                    total = _parse_multi(r[5]) if len(r) > 5 else []
                    n = min(len(ys), len(paid), len(total) or [1])
                    n = max(n, len(ys))
                    for k in range(len(ys)):
                        y = ys[k]
                        if not (1 <= y <= 120):
                            continue
                        row = {
                            "Y": y, "Age": y,
                            "Paid": paid[k] if k < len(paid) else 0,
                            "Guar_CV": guar[k] if k < len(guar) else 0,
                            "Rev": (rev[k] if k < len(rev) else 0) + (term[k] if k < len(term) else 0),
                            "Term": 0,
                            "Total": total[k] if k < len(total) else 0,
                        }
                        # CI 中 Paid 固定到缴费期末, 之后为 0
                        rows.append(row)
    # 关键: 多表 (身故/退保) 同 Y dedupe — 保留 max Total (身故表 Total = 保额, 退保表 Total = 退保价值, 取大)
    by_y: Dict[int, Dict] = {}
    for r in rows:
        y = r["Y"]
        if y not in by_y or r["Total"] > by_y[y]["Total"]:
            by_y[y] = r
    rows = sorted(by_y.values(), key=lambda r: r["Y"])
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--signature", required=True)
    ap.add_argument("--page-summary", type=int, default=1)
    ap.add_argument("--pages-coverage", type=int, nargs="*", default=[])
    ap.add_argument("--pages-premium-table", type=int, nargs="*", default=[])
    ap.add_argument("--year-horizon", type=int, default=100)
    args = ap.parse_args()

    try:
        summary = extract_summary(args.pdf, args.page_summary)
        # 1-based → 0-based for pdfplumber
        pg = sorted({p - 1 for p in args.pages_premium_table if p > 0})
        rows = extract_benefit_illustration(args.pdf, pg)
        # 算 IRR/单利/倍数
        paid_total = summary.get("premium_total") or 0
        for r in rows:
            total = r["Total"]
            r["Mult"] = round(total / paid_total, 4) if paid_total else 0
            if r["Y"] > 0 and total > paid_total and paid_total > 0:
                r["IRR"] = (total / paid_total) ** (1 / r["Y"]) - 1
            else:
                r["IRR"] = None
            r["Simple"] = ((total - paid_total) / paid_total / r["Y"]) if r["Y"] > 0 and paid_total else 0

        out = {
            "ok": True,
            "summary": summary,
            "paid_total": paid_total,
            "benefit_illustration": rows,  # 与 savings 同字段名, 让 normalize 兼容
            "no_withdraw": rows,  # 兼容 alias
            "withdraw": {},
            "diagnostics": {
                "warnings": [],
                "parser": "ci-signature",
                "noWithdrawRows": len(rows),
                "withdrawRows": 0,
            },
        }
        print(json.dumps(out, ensure_ascii=False, default=str))
    except Exception as e:
        import traceback
        out = {"ok": False, "error": str(e), "traceback": traceback.format_exc()}
        print(json.dumps(out, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
