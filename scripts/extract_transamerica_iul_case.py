#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import fitz


def number(raw: str | None) -> float:
    if raw is None:
        return 0.0
    text = str(raw).replace("$", "").replace(",", "").replace("美元", "").strip()
    if text in {"", "0", "##", "N/A"}:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def find(pattern: str, text: str, default: str = "") -> str:
    m = re.search(pattern, text, re.S)
    return m.group(1).strip() if m else default


ROW_RE = re.compile(
    r"#?(\d+)\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)"
)


def parse_rows(text: str, source_page: int) -> list[dict]:
    rows = []
    for m in ROW_RE.finditer(text):
        rows.append({
            "policy_year": int(m.group(1)),
            "age": int(m.group(2)),
            "total_premium_paid": number(m.group(3)),
            "guaranteed_cash_value": number(m.group(4)),
            "guaranteed_account_value": number(m.group(5)),
            "guaranteed_death_benefit": number(m.group(6)),
            "non_guaranteed_cash_value": number(m.group(7)),
            "non_guaranteed_account_value": number(m.group(8)),
            "non_guaranteed_death_benefit": number(m.group(9)),
            "source_page": source_page,
        })
    return rows


def dedupe_rows(rows: list[dict]) -> list[dict]:
    merged = {}
    for row in rows:
        merged[row["policy_year"]] = row
    return [merged[year] for year in sorted(merged.keys())]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    pdf_path = Path(args.pdf).resolve()
    doc = fitz.open(str(pdf_path))
    pages = [doc[i].get_text("text") for i in range(len(doc))]
    full_text = "\n".join(pages)

    product_name = "Genesis III Indexed Universal Life" if "Genesis III Indexed Universal Life" in full_text else "GIUL III Indexed Universal Life"
    insured_name = find(r"(?:擬定受保人：|客戶名稱：)\s*([^\n]+)", full_text, "Client")
    gender_age = find(r"性別／年齡：\s*([^\n]+)", full_text)
    gender = ""
    age = 0
    if "/" in gender_age:
        g, a = gender_age.split("/", 1)
        gender = g.strip()
        age = int(re.sub(r"[^\d]", "", a) or "0")
    sum_insured = number(find(r"投保金額：\s*\$?([\d,]+)", full_text))
    payment_period = find(r"預設保費繳付年期：\s*([^\n]+)", full_text)
    first_premium = number(find(r"首年預設定期保費：\s*\$?([\d,]+)", full_text))
    day1_cash = number(find(r"首日現金價值：\s*\$?([\d,]+)", full_text))
    payment_mode = find(r"付款模式：\s*([^\n]+)", full_text, "年繳")
    risk_class = find(r"風險類別：\s*([^\n]+)", full_text)
    currency = "USD" if "貨幣：\n美元" in full_text or "貨幣： 美元" in full_text or "貨幣：\r\n美元" in full_text else "美元"
    country = find(r"受保人居住地：\s*([^\n]+)", full_text)
    total_distribution_fee = number(find(r"總分銷費用為([\d,]+)美元", full_text))
    illustrated_irr = find(r"總收益率為每年([\d.]+%)", full_text)
    issuer = "全美人壽（百慕達）有限公司"

    summary_pages = [idx + 1 for idx, text in enumerate(pages) if "擬定受保人：" in text and "投保金額：" in text]
    all_rows: list[dict] = []
    for page_no in summary_pages:
        page_text = pages[page_no - 1]
        if "迄今已付保費" in page_text or "迄今扣款" in page_text or "迄今扣\n款" in page_text or "迄今已\n付保費" in page_text:
            continue
        all_rows.extend(parse_rows(page_text, page_no))
    benefit_rows = dedupe_rows(all_rows)

    annual_premium = 0.0
    if benefit_rows:
        first_row = benefit_rows[0]
        if len(benefit_rows) > 1:
            annual_premium = benefit_rows[1]["total_premium_paid"] - first_row["total_premium_paid"]
        if annual_premium <= 0:
            annual_premium = first_premium

    payload = {
        "product_name": product_name,
        "product_type": "iul",
        "insured": {
            "name": insured_name,
            "age": age,
            "gender": gender,
            "smoker": risk_class,
        },
        "policy": {
            "currency": currency,
            "sum_insured": sum_insured,
            "initial_premium": first_premium,
            "annual_premium": annual_premium,
            "premium_payment_period": payment_period,
            "coverage_period": "終身",
            "payment_mode": payment_mode,
            "risk_class": risk_class,
            "day_1_cash_value": day1_cash,
            "total_premium_target": benefit_rows[-1]["total_premium_paid"] if benefit_rows else 0,
        },
        "index_accounts": [
            {
                "name": "標普500指數戶口",
                "allocation": 100,
                "current_assumed_rate": "7.25%",
                "guaranteed_floor_rate": "0.00%",
                "cap_rate": "11.20%",
                "participation_rate": "100%",
                "multiplier": "",
            },
            {
                "name": "環球指數戶口",
                "allocation": 0,
                "current_assumed_rate": "5.70%",
                "guaranteed_floor_rate": "0.00%",
                "cap_rate": "8.20%-10.40%",
                "participation_rate": "100%",
                "multiplier": "",
            },
            {
                "name": "VC無上限指數戶口",
                "allocation": 0,
                "current_assumed_rate": "7.50%",
                "guaranteed_floor_rate": "0.00%",
                "cap_rate": "無上限",
                "participation_rate": "100%",
                "multiplier": "",
            },
        ],
        "rates": {
            "fixed_account_current_rate": "4.10%",
            "long_term_bonus_rate": "1.00%",
            "guaranteed_floor": "0.00%",
            "coi_charges": "当前收费与最高收费双轨演示",
        },
        "benefit_illustration": benefit_rows,
        "sales_insights": {
            "target_customer": "需要高杠杆身故保障、长期美元现金值积累、并兼顾跨境传承安排的家庭客户。",
            "key_selling_points": [
                "用相对有限的计划保费建立更高的身故保障杠杆。",
                "同时提供保证基础与当前假设基础两套演示，便于沟通下限与弹性空间。",
                "固定户口、标普500指数户口及长期红利共同构成长期现金值路径。",
                "适合作为家庭资产结构中的传承层，而不是单纯现金流产品。",
            ],
            "unique_advantages": f"同一份官方演示同时展示最高收费/当前收费与保证/非保证两套路径，便于明确下限风险。总分销费用约 US${round(total_distribution_fee):,}。",
            "suggested_narrative": "先解释这张 IUL 如何用身故杠杆守住家庭资产，再解释长期现金价值和传承效率。",
            "highlight_numbers": [
                {"year": 1, "label": "首年保费", "value": first_premium},
                {"year": 1, "label": "基础保额", "value": sum_insured},
                {"year": 20, "label": "第20年非保证现金值", "value": next((row["non_guaranteed_cash_value"] for row in benefit_rows if row["policy_year"] == 20), 0)},
                {"year": 106, "label": "演示退保总收益率", "value": float(re.sub(r"[^\d.]", "", illustrated_irr) or "0"), "description": f"官方封面页披露：{illustrated_irr}"},
            ],
        },
        "_meta": {
            "issuer": issuer,
            "country": country,
            "illustrated_irr": illustrated_irr,
            "summary_pages": summary_pages,
        },
    }

    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
