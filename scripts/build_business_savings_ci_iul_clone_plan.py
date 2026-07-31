#!/usr/bin/env python3
"""Build a business-template clone edit plan from normalized savings + CI + IUL data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from clone_plan_common import build_slide_entry


def money(value: float | int) -> str:
    return f"{round(float(value)):,}"


def first(rows: list[dict[str, Any]], year: int) -> dict[str, Any]:
    return next(row for row in rows if int(row["policyYear"]) == year)


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
    parser.add_argument("--savings", required=True)
    parser.add_argument("--ci", required=True)
    parser.add_argument("--iul", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--company-context")
    args = parser.parse_args()

    savings = json.loads(Path(args.savings).read_text(encoding="utf-8"))
    ci = json.loads(Path(args.ci).read_text(encoding="utf-8"))
    iul = json.loads(Path(args.iul).read_text(encoding="utf-8"))
    workspace = Path(args.workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    company_context = json.loads(Path(args.company_context).read_text(encoding="utf-8")) if args.company_context else {}
    company_name = company_context.get("companyName") or "保险公司"

    benefit = savings["benefitRows"]
    premium = savings["policy"]["contractualTotalPremium"]
    y20, y30 = first(benefit, 20), first(benefit, 30)
    ci_coverage = ci.get("coverageItems", [])
    iul_accounts = iul.get("indexAccounts", [])
    iul_benefit = iul.get("benefitRows", [])
    iul_y20 = next((row for row in iul_benefit if int(row.get("policyYear", 0)) == 20), iul_benefit[-1] if iul_benefit else {})

    output_slides, edits = [], []

    def add(*a: Any) -> None:
        frame, edit = slide(*a)
        output_slides.append(frame)
        edits.append(edit)

    add(1, 2, "cover", [
        ("6", f"{savings['insured']['name']} 家庭资产保障综合方案"),
        ("10", f"{company_name} · 储蓄险 + 重疾险 + IUL"),
        ("31", "Savings + CI + IUL Bundle"),
    ])
    add(2, 3, "company", [
        ("6", "三产品协同方案结构"),
        ("10", "储蓄资产增长 + 重疾风险保障 + IUL传承杠杆"),
        ("14", "资料来源"),
        ("15", "官方计划书 + 公司公开资料 + 可追溯页码"),
        ("20", "客户目标"),
        ("21", "覆盖家庭风险底线并提升中长期资产效率"),
    ])
    add(3, 4, "savings", [
        ("6", "储蓄险资产底盘"),
        ("12", f"总缴保费约 US${money(premium)}"),
        ("13", f"20年现金价值约 {y20['totalSurrenderValue']/premium:.2f} 倍"),
        ("14", f"30年现金价值约 {y30['totalSurrenderValue']/premium:.2f} 倍"),
        ("19", "承担教育金/养老金与家庭现金流弹性"),
        ("24", "关键数字均可追溯到官方利益演示"),
        ("30", "长期复利增长作为家庭资产底仓"),
    ])
    add(4, 5, "ci", [
        ("6", "重疾险风险底线"),
        ("10", f"保额约 US${money(ci['policy']['sumInsured'])}"),
        ("11", f"年缴约 US${money(ci['policy']['annualPremium'])} / 缴费 {ci['policy']['payYears']} 年"),
        ("13", "核心保障责任"),
        ("14", ci_coverage[0]["name"] if len(ci_coverage) > 0 else "严重疾病保障"),
        ("18", ci_coverage[1]["name"] if len(ci_coverage) > 1 else "多重赔付责任"),
        ("19", "用于覆盖家庭重大健康风险冲击"),
        ("25", "保障端降低突发事件对资产计划侵蚀"),
        ("26", "与储蓄险形成风险-收益互补结构"),
        ("30", "责任条款均可回溯至官方保障页"),
    ])
    add(5, 6, "iul", [
        ("6", "IUL 传承与弹性杠杆"),
        ("12", f"基础保额约 US${money(iul['policy']['sumInsured'])}"),
        ("13", f"年缴约 US${money(iul['policy']['annualPremium'])}"),
        ("15", "第20年非保证现金值"),
        ("16", f"约 US${money(iul_y20.get('nonGuaranteedCashValue', 0))}"),
        ("19", "第20年非保证身故赔偿"),
        ("21", f"约 US${money(iul_y20.get('nonGuaranteedDeathBenefit', iul['policy']['sumInsured']))}"),
        ("23", "指数账户参数"),
        ("24", iul_accounts[0]["name"] if len(iul_accounts) > 0 else "指数账户（见条款）"),
    ])
    add(6, 4, "closing", [
        ("6", "组合执行建议"),
        ("12", "先保障底线，再放大长期复利与传承杠杆"),
        ("13", "三产品比例按家庭现金流与风险承受动态复盘"),
        ("18", "交付结论"),
        ("19", "数字可追溯、逻辑可解释、模块可规模化复用"),
        ("30", "正式版禁用模拟数字与历史客户回填"),
    ])

    frame_map = {"outputSlides": output_slides}
    edit_plan = {"templateId": "business", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote business savings+ci+iul clone plan -> {workspace}")


if __name__ == "__main__":
    main()
