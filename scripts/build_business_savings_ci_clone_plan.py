#!/usr/bin/env python3
"""Build a business-template clone edit plan from normalized savings + CI data."""

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
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--company-context")
    args = parser.parse_args()
    savings = json.loads(Path(args.savings).read_text(encoding="utf-8"))
    ci = json.loads(Path(args.ci).read_text(encoding="utf-8"))
    workspace = Path(args.workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    company_context = json.loads(Path(args.company_context).read_text(encoding="utf-8")) if args.company_context else {}
    company_name = company_context.get("companyName") or "保险公司"

    benefit = savings["benefitRows"]
    premium = savings["policy"]["contractualTotalPremium"]
    y20, y30 = first(benefit, 20), first(benefit, 30)
    ci_coverage = ci.get("coverageItems", [])

    output_slides, edits = [], []

    def add(*a: Any) -> None:
        frame, edit = slide(*a)
        output_slides.append(frame)
        edits.append(edit)

    add(1, 2, "cover", [
        ("6", f"{savings['insured']['name']} 家庭资产保障综合方案"),
        ("10", f"{company_name} · 储蓄险 + 重疾险"),
        ("31", "Savings + CI Bundle"),
    ])
    add(2, 3, "company", [
        ("6", "方案结构"),
        ("10", "储蓄资产增长 + 重疾风险保障双轮驱动"),
        ("14", "资料来源"),
        ("15", "官方计划书 + 公司公开资料 + 可追溯页码"),
        ("20", "客户目标"),
        ("21", "在保障突发风险基础上，实现长期稳健增值"),
    ])
    add(3, 4, "savings", [
        ("6", "储蓄险核心价值"),
        ("12", f"总缴保费约 US${money(premium)}"),
        ("13", f"20年现金价值约 {y20['totalSurrenderValue']/premium:.2f} 倍"),
        ("14", f"30年现金价值约 {y30['totalSurrenderValue']/premium:.2f} 倍"),
        ("19", "兼顾教育金/养老金与家庭现金流弹性"),
        ("24", "关键数字均可追溯到官方利益演示"),
        ("30", "长期资产端提供复利增长底盘"),
    ])
    add(4, 5, "ci", [
        ("6", "重疾险核心价值"),
        ("10", f"保额约 US${money(ci['policy']['sumInsured'])}"),
        ("11", f"年缴约 US${money(ci['policy']['annualPremium'])} / 缴费 {ci['policy']['payYears']} 年"),
        ("13", "核心保障责任"),
        ("14", ci_coverage[0]["name"] if len(ci_coverage) > 0 else "严重疾病保障"),
        ("18", ci_coverage[1]["name"] if len(ci_coverage) > 1 else "多重赔付责任"),
        ("19", "用于覆盖家庭重大健康风险冲击"),
        ("25", "保障端降低突发事件对资产计划的侵蚀"),
        ("26", "与储蓄险形成风险-收益互补结构"),
        ("30", "责任条款均可回溯至官方保障页"),
        ("31", "正式版禁用模拟数字与历史客户回填"),
    ])
    add(5, 6, "allocation", [
        ("6", "组合配置建议"),
        ("12", "资产端"),
        ("13", "储蓄险承担长期增值与现金流规划"),
        ("15", "保障端"),
        ("16", "重疾险覆盖突发风险与医疗财务冲击"),
        ("19", "协同策略"),
        ("21", "先保障家庭底线，再放大长期复利效率"),
        ("23", "执行建议"),
        ("24", "按年度复盘保额、保费与现金价值进度"),
    ])
    add(6, 4, "closing", [
        ("6", "方案总结"),
        ("12", "储蓄 + 重疾双产品定制输出"),
        ("13", "数字可追溯、逻辑可解释、组合可执行"),
        ("18", "下一步"),
        ("19", "可在此基础上叠加 IUL 构建传承杠杆"),
        ("30", "祝愿家庭资产稳健增长、保障长期有效"),
    ])

    frame_map = {"outputSlides": output_slides}
    edit_plan = {"templateId": "business", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote business savings+ci clone plan -> {workspace}")


if __name__ == "__main__":
    main()

