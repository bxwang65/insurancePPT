#!/usr/bin/env python3
"""Build a business-template clone edit plan from normalized IUL data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from clone_plan_common import build_slide_entry


def money(value: float | int) -> str:
    return f"{round(float(value)):,}"


def slide(output: int, source: int, role: str, rewrites: list[tuple[str, str]]) -> tuple[dict, dict]:
    source_anchor = {
        2: "sh/cvixczed",
        3: "sh/9cvixcze",
        4: "sh/oj2t83it",
        5: "sh/q1orytsv",
        6: "sh/onyd0z61",
    }.get(source, "sh/cvixczed")
    return build_slide_entry(
        output=output,
        source=source,
        role=role,
        source_targets=[("rewrite", source_anchor)],
        rewrites=rewrites,
        replacements=[],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--normalized", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--company-context")
    args = parser.parse_args()
    normalized = json.loads(Path(args.normalized).read_text(encoding="utf-8"))
    workspace = Path(args.workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    company_context = json.loads(Path(args.company_context).read_text(encoding="utf-8")) if args.company_context else {}
    company_name = company_context.get("companyName") or "保险公司"

    accounts = normalized.get("indexAccounts", [])
    benefit = normalized.get("benefitRows", [])
    y20 = next((row for row in benefit if int(row.get("policyYear", 0)) == 20), benefit[-1] if benefit else {})

    output_slides, edits = [], []

    def add(*a: Any) -> None:
        frame, edit = slide(*a)
        output_slides.append(frame)
        edits.append(edit)

    add(1, 2, "cover", [
        ("6", f"{normalized['insured']['name']} 家庭 IUL 定制方案"),
        ("10", f"{company_name} · {normalized['productName']}"),
        ("31", "Index Universal Life"),
    ])
    add(2, 3, "company", [
        ("6", "公司与IUL服务"),
        ("10", f"{company_name} 公开资料与产品设计理念"),
        ("14", "正式资料来源"),
        ("15", "公司资料库 + 官方计划书 + 源页码"),
        ("20", "方案定位"),
        ("21", "保障底盘 + 指数账户增值弹性 + 传承杠杆"),
    ])
    add(3, 4, "policy", [
        ("6", "保单基础信息"),
        ("12", "基础保额"),
        ("13", f"约 US${money(normalized['policy']['sumInsured'])}"),
        ("14", "年缴保费"),
        ("19", f"约 US${money(normalized['policy']['annualPremium'])} / 年"),
        ("24", f"缴费期：{normalized['policy']['paymentPeriod']}"),
        ("30", f"指数账户配置 {len(accounts)} 项（可追溯）"),
    ])
    add(4, 5, "accounts", [
        ("6", "指数账户参数"),
        ("10", "账户一"),
        ("11", accounts[0]["name"] if len(accounts) > 0 else "S&P 指数账户"),
        ("13", "假设利率"),
        ("14", accounts[0]["assumedRate"] if len(accounts) > 0 else "5.00%"),
        ("18", "保底利率"),
        ("19", accounts[0]["floorRate"] if len(accounts) > 0 else "0.00%"),
        ("25", "封顶/参与率"),
        ("26", (accounts[0]["capRate"] if len(accounts) > 0 else "10.00%") + " / " + (accounts[0]["participationRate"] if len(accounts) > 0 else "100%")),
        ("30", "参数用于解释收益区间，不替代正式条款"),
        ("31", "全部来源于官方计划书"),
    ])
    add(5, 6, "benefit", [
        ("6", "长期利益与传承杠杆"),
        ("12", "第20年总缴"),
        ("13", f"约 US${money(y20.get('totalPremiumPaid', 0))}"),
        ("15", "第20年非保证现金值"),
        ("16", f"约 US${money(y20.get('nonGuaranteedCashValue', 0))}"),
        ("19", "第20年非保证身故赔偿"),
        ("21", f"约 US${money(y20.get('nonGuaranteedDeathBenefit', normalized['policy']['sumInsured']))}"),
        ("23", "家庭应用"),
        ("24", "兼顾退休现金流弹性与代际传承杠杆"),
    ])
    add(6, 4, "closing", [
        ("6", "方案总结"),
        ("12", "IUL 定制输出"),
        ("13", "账户参数、利益演示、风险提示均可追溯"),
        ("18", "客户沟通重点"),
        ("19", "先确认风险承受，再讨论收益区间与长期目标"),
        ("30", "后续可叠加储蓄险或重疾险形成组合方案"),
    ])

    frame_map = {"outputSlides": output_slides}
    edit_plan = {"templateId": "business", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote business IUL clone plan -> {workspace}")


if __name__ == "__main__":
    main()

