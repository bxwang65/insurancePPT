#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import fitz


def money_to_number(raw: str | None) -> float:
    if raw is None:
        return 0.0
    text = str(raw).replace("$", "").replace(",", "").replace(" ", "").strip()
    if text in {"", "##", "N/A"}:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def split_column(raw: str | None) -> list[str]:
    if raw is None:
        return []
    return [item.strip() for item in str(raw).splitlines() if item.strip()]


def find_value(text: str, label: str, fallback: str = "") -> str:
    pattern = re.escape(label) + r"[:：]\s*([^\n]+)"
    m = re.search(pattern, text)
    return m.group(1).strip() if m else fallback


def extract_summary(doc: fitz.Document) -> dict:
    page1 = doc[0].get_text("text")
    page5 = doc[4].get_text("text") if len(doc) >= 5 else page1

    insured_name = find_value(page1, "受保人", "客户")
    sum_insured = money_to_number(find_value(page1, "保障金额"))
    initial_premium = money_to_number(find_value(page1, "初始保费"))
    country = find_value(page1, "居住国家", "")
    currency = find_value(page1, "货币", "美元")

    age_gender_smoker = re.search(r"年龄最近的生日\s*\|\s*性别\s*\|\s*类别[:：]\s*(\d+)\s*\|\s*([^\|]+)\|\s*([^\n]+)", page1)
    age = int(age_gender_smoker.group(1)) if age_gender_smoker else 0
    gender = age_gender_smoker.group(2).strip() if age_gender_smoker else ""
    smoker = age_gender_smoker.group(3).strip() if age_gender_smoker else ""

    pay_count = re.search(r"估算年度保费支付次数[:：]?\s*(\d+)", page5)
    pay_end = re.search(r"估算年度保费支付末年[:：]?\s*(\d+)", page5)
    day1_cash = re.search(r"签发日期的第1天保证现金价值\s*\$([\d,]+)", page5)

    return {
        "insured_name": insured_name,
        "sum_insured": sum_insured,
        "initial_premium": initial_premium,
        "country": country,
        "currency": currency,
        "age": age,
        "gender": gender,
        "smoker": smoker,
        "pay_count": int(pay_count.group(1)) if pay_count else 0,
        "pay_end": int(pay_end.group(1)) if pay_end else 0,
        "day1_cash_value": money_to_number(day1_cash.group(1) if day1_cash else "0"),
    }


def parse_benefit_tables(doc: fitz.Document) -> tuple[list[dict], float]:
    guarantee_rows: dict[int, dict] = {}
    current_rows: dict[int, dict] = {}
    recurring_premium = 0.0

    # Guarantee page.
    guarantee_table = doc[1].find_tables().tables[1].extract()[1]
    g_years = split_column(guarantee_table[0])
    g_ages = split_column(guarantee_table[1])
    g_premiums = split_column(guarantee_table[2])
    g_cash = split_column(guarantee_table[6])
    g_death = split_column(guarantee_table[8])
    for idx, year_raw in enumerate(g_years):
      year = int(year_raw) if year_raw.isdigit() else 0
      if year == 0:
        continue
      premium = money_to_number(g_premiums[idx]) if idx < len(g_premiums) else 0
      if year >= 2 and premium > 0 and recurring_premium == 0:
        recurring_premium = premium
      guarantee_rows[year] = {
        "age": int(g_ages[idx]) if idx < len(g_ages) and g_ages[idx].isdigit() else 0,
        "total_premium_paid": 0,
        "guaranteed_cash_value": money_to_number(g_cash[idx]) if idx < len(g_cash) else 0,
        "guaranteed_death_benefit": money_to_number(g_death[idx]) if idx < len(g_death) else 0,
        "source_page": 2,
      }

    # Current assumption pages.
    for page_no in [3, 4]:
      row = doc[page_no - 1].find_tables().tables[1].extract()[1]
      years = split_column(row[0])
      ages = split_column(row[1])
      premiums = split_column(row[2])
      non_g_cash = split_column(row[6])
      non_g_death = split_column(row[8])
      for idx, year_raw in enumerate(years):
        year = int(year_raw) if year_raw.isdigit() else 0
        if year == 0:
          continue
        current_rows[year] = {
          "age": int(ages[idx]) if idx < len(ages) and ages[idx].isdigit() else 0,
          "total_premium_paid": money_to_number(premiums[idx]) if idx < len(premiums) else 0,
          "non_guaranteed_cash_value": money_to_number(non_g_cash[idx]) if idx < len(non_g_cash) else 0,
          "non_guaranteed_death_benefit": money_to_number(non_g_death[idx]) if idx < len(non_g_death) else 0,
          "source_page": page_no,
        }

    all_years = sorted(current_rows.keys())
    benefit_rows: list[dict] = []
    cumulative_paid = 0.0
    for year in all_years:
      current = current_rows[year]
      annual = current["total_premium_paid"]
      if year == 1:
        cumulative_paid = annual
      elif annual > 0:
        cumulative_paid += annual
      benefit_rows.append({
        "policy_year": year,
        "age": current["age"] or guarantee_rows.get(year, {}).get("age", 0),
        "total_premium_paid": cumulative_paid,
        "guaranteed_account_value": 0,
        "guaranteed_cash_value": guarantee_rows.get(year, {}).get("guaranteed_cash_value", 0),
        "guaranteed_death_benefit": guarantee_rows.get(year, {}).get("guaranteed_death_benefit", 3000000),
        "non_guaranteed_account_value": 0,
        "non_guaranteed_cash_value": current["non_guaranteed_cash_value"],
        "non_guaranteed_death_benefit": current["non_guaranteed_death_benefit"],
        "source_page": current["source_page"],
      })
    return benefit_rows, recurring_premium


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    pdf_path = Path(args.pdf).resolve()
    doc = fitz.open(str(pdf_path))

    summary = extract_summary(doc)
    benefit_rows, recurring_premium = parse_benefit_tables(doc)
    total_planned_premium = summary["initial_premium"] + recurring_premium * max(summary["pay_count"] - 1, 0)

    payload = {
        "product_name": "SunBrilliance Indexed Universal Life II（推断自官方结构）",
        "product_type": "iul",
        "insured": {
            "name": summary["insured_name"],
            "age": summary["age"],
            "gender": summary["gender"],
            "smoker": summary["smoker"],
        },
        "policy": {
            "currency": "USD" if "美" in summary["currency"] else summary["currency"],
            "sum_insured": summary["sum_insured"],
            "initial_premium": summary["initial_premium"],
            "annual_premium": recurring_premium,
            "premium_payment_period": f"{summary['pay_end']}年（首年 {round(summary['initial_premium']):,}，其后每年 {round(recurring_premium):,}）",
            "coverage_period": f"至{benefit_rows[-1]['age']}岁（官方演示）",
            "payment_mode": "年缴",
            "risk_class": summary["smoker"],
            "day_1_cash_value": summary["day1_cash_value"],
            "total_premium_target": total_planned_premium,
        },
        "index_accounts": [
            {
                "name": "倍数指数账户",
                "allocation": 100,
                "current_assumed_rate": "7.00%",
                "guaranteed_floor_rate": "0.00%",
                "cap_rate": "8.15%",
                "participation_rate": "125%",
                "multiplier": "125%",
            },
            {
                "name": "优选指数账户",
                "allocation": 0,
                "current_assumed_rate": "7.00%",
                "guaranteed_floor_rate": "0.00%",
                "cap_rate": "10.80%",
                "participation_rate": "100%",
                "multiplier": "100%",
            },
            {
                "name": "固定收益账户",
                "allocation": 0,
                "current_assumed_rate": "4.20%",
                "guaranteed_floor_rate": "保单年度1-20年2.50%，随后阶梯降至1.00%",
                "cap_rate": "",
                "participation_rate": "",
                "multiplier": "",
            },
        ],
        "rates": {
            "fixed_account_current_rate": "4.20%",
            "long_term_bonus_rate": "0.50%（第11个保单年度起）",
            "guaranteed_floor": "0.00%",
            "coi_charges": "当前费用 / 最高费用两套演示已提供",
        },
        "benefit_illustration": benefit_rows,
        "sales_insights": {
            "target_customer": "高净值家庭、晚年传承规划、希望用美元保单放大身故杠杆并兼顾现金价值弹性的客户。",
            "key_selling_points": [
                "首年投入后即建立 300 万美元身故保障底盘。",
                "第2至第10年保费下降到 11.88 万美元，后续无需继续缴费。",
                "固定收益账户 + 指数账户双结构，兼顾保底与增长弹性。",
                "现金价值与身故赔偿可同步服务退休与传承规划。",
            ],
            "unique_advantages": "首年较高保费换取更高的早期保障杠杆，并通过 100% 倍数指数账户参与长期市场增长。",
            "suggested_narrative": "这不是纯收益型产品，而是一张兼顾身故杠杆、现金价值和跨代传承效率的家族资产保单。",
            "key_metrics": [
                {"label": "首年保费", "value": f"US${round(summary['initial_premium']):,}"},
                {"label": "后续年缴", "value": f"US${round(recurring_premium):,}"},
                {"label": "基础保额", "value": f"US${round(summary['sum_insured']):,}"},
                {"label": "总计划保费", "value": f"US${round(total_planned_premium):,}"},
            ],
            "positioning": "高杠杆身故保障 + 现金价值增长弹性，适合家庭财富传承与长期资金安排。",
            "risk_notes": [
                "指数账户演示收益不保证，当前假设派息率仅用于说明。",
                "首年保费显著高于后续年度保费，需按现金流承受能力判断。",
            ],
        },
    }
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
