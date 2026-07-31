#!/usr/bin/env python3
"""Build a business-template clone edit plan from normalized CI data."""

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
    company_intro = company_context.get("companyIntro") or "公司资料来自内部知识库。"
    company_facts = company_context.get("companyFacts") or []

    coverage = normalized.get("coverageItems", [])
    coverage_summary = normalized.get("coverageSummary", {})
    benefit = normalized.get("benefitRows", [])
    first_year = benefit[0] if benefit else {}
    y20 = next((row for row in benefit if int(row.get("policyYear", 0)) == 20), benefit[-1] if benefit else {})
    fact_line = "；".join(
        f"{item.get('label', '').strip()}：{item.get('value', '').strip()}"
        for item in company_facts[:4]
        if item.get("label") and item.get("value")
    )
    sum_insured = normalized["policy"]["sumInsured"]
    base_sum_insured = normalized["policy"].get("baseSumInsured", sum_insured)
    upgrade_benefit = normalized["policy"].get("upgradeBenefitAmount", 0)
    upgrade_years = normalized["policy"].get("upgradeBenefitYears", 0)
    total_premium = normalized["policy"].get("totalPremium", normalized["policy"]["annualPremium"] * normalized["policy"]["payYears"])
    major_ci_count = coverage_summary.get("majorCiCount", 0)
    early_ci_count = coverage_summary.get("earlyCiCount", 0)
    rider_names = "、".join(item["name"] for item in normalized.get("premiumWaiverRiders", [])[:2]) or "免付保费附加契约"
    multi_claim = normalized.get("multiClaimRules", [])
    multi_claim_text = "；".join(
        f"{item['condition']}最多{item['claimCount']}次"
        for item in multi_claim[:3]
        if item.get("condition") and item.get("claimCount")
    ) or "多重赔付责任以条款为准"

    output_slides, edits = [], []

    def add(*a: Any) -> None:
        frame, edit = slide(*a)
        output_slides.append(frame)
        edits.append(edit)

    add(1, 2, "cover", [
        ("6", f"{normalized['insured']['name']} 家庭重疾保障方案"),
        ("10", f"{company_name} · {normalized['productName']}"),
        ("31", "CI Protection Plan"),
    ])
    add(2, 3, "company", [
        ("6", "公司与服务"),
        ("10", f"{company_name} 概览"),
        ("14", "公司概览"),
        ("15", company_intro[:60]),
        ("20", "核心数据"),
        ("21", (fact_line or "评级、集团背景与业务范围以正式资料为准")[:110]),
    ])
    add(3, 4, "coverage", [
        ("6", "核心保障概览"),
        ("12", "基础保额"),
        ("13", f"约 US${money(base_sum_insured)}"),
        ("14", "年缴保费"),
        ("19", f"约 US${money(normalized['policy']['annualPremium'])} / 年"),
        ("24", f"缴费期约 {normalized['policy']['payYears']} 年，总保费约 US${money(total_premium)}"),
        ("30", f"重疾 {major_ci_count} 项 / 早期危疾 {early_ci_count} 项"),
    ])
    add(4, 5, "timeline", [
        ("6", "保障与现金价值路径"),
        ("10", "第1年"),
        ("11", f"累计保费约 US${money(first_year.get('totalPremiumPaid', 0))}"),
        ("13", "第20年"),
        ("14", f"累计保费约 US${money(y20.get('totalPremiumPaid', 0))}"),
        ("18", "重疾保障"),
        ("19", f"重疾赔付约 US${money(y20.get('ciBenefit', sum_insured))}；前 {upgrade_years} 年升级保障约 US${money(upgrade_benefit)}"),
        ("25", "退保价值与保障责任并行"),
        ("26", "用于家庭重大风险事件的现金与责任缓冲"),
        ("30", "关键数字均可回溯官方页码"),
        ("31", "不使用历史客户数字替代本单"),
    ])
    add(5, 6, "coverage-detail", [
        ("6", "保障责任重点"),
        ("12", "责任一"),
        ("13", coverage[0]["name"] if len(coverage) > 0 else "58 种危疾保障"),
        ("15", "责任二"),
        ("16", coverage[1]["name"] if len(coverage) > 1 else "44 种早期危疾保障"),
        ("19", "责任三"),
        ("21", coverage[2]["name"] if len(coverage) > 2 else "首 10 年升级保障"),
        ("23", "适用场景"),
        ("24", f"{multi_claim_text}；附加责任：{rider_names}"[:78]),
    ])
    add(6, 4, "closing", [
        ("6", "方案总结"),
        ("12", "重疾险定制输出"),
        ("13", "保额、保费、责任、现金价值四维可追溯"),
        ("18", "客户沟通重点"),
        ("19", "把复杂条款转成可执行的家庭保障策略"),
        ("30", "后续可叠加储蓄险与 IUL 形成组合方案"),
    ])

    frame_map = {"outputSlides": output_slides}
    edit_plan = {"templateId": "business", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote business CI clone plan -> {workspace}")


if __name__ == "__main__":
    main()
