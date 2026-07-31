#!/usr/bin/env python3
"""Build an ink-template clone edit plan from normalized official savings data."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from clone_plan_common import build_slide_entry


def money(value: float | int) -> str:
    return f"{round(float(value)):,}"


def first(rows: list[dict[str, Any]], year: int) -> dict[str, Any]:
    return next(row for row in rows if int(row["policyYear"]) == year)


def slide(
    output: int,
    source: int,
    role: str,
    rewrites: list[tuple[str, str]],
    replacements: list[tuple[str, str]],
    deletions: list[tuple[str, str]] | None = None,
) -> tuple[dict, dict]:
    source_anchor = {
        2: "sh/nyd0z610",
        3: "sh/5o7qpg3e",
        4: "sh/o7qpg3ex",
        5: "sh/je9cvixc",
        6: "sh/ovahoza1",
    }.get(source, "sh/nyd0z610")
    extra_targets = {
        3: [("rewrite", "sh/ylc7u54z"), ("rewrite", "sh/rytsvu9k"), ("rewrite", "sh/lwval87e"), ("rewrite", "sh/w3m94fu1")],
        4: [("rewrite", "sh/vy90je9c"), ("rewrite", "sh/6hcrmhk3"), ("rewrite", "sh/6dcbulwv"), ("rewrite", "sh/vmtwra5g")],
        6: [("rewrite", "sh/6hcrmhk3"), ("rewrite", "sh/d8v6psfi"), ("rewrite", "sh/nuxc3ylc")],
    }.get(source, [])
    return build_slide_entry(
        output=output,
        source=source,
        role=role,
        source_targets=[("rewrite", source_anchor), *extra_targets],
        rewrites=rewrites,
        replacements=replacements,
        deletions=deletions,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--normalized", required=True)
    parser.add_argument("--assets-dir", required=True)
    parser.add_argument("--charts-dir", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--company-context")
    args = parser.parse_args()
    normalized = json.loads(Path(args.normalized).read_text(encoding="utf-8"))
    charts_dir = Path(args.charts_dir).resolve()
    workspace = Path(args.workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    company_context = json.loads(Path(args.company_context).read_text(encoding="utf-8")) if args.company_context else {}
    company_name = company_context.get("companyName") or "保险公司"
    benefit = normalized["benefitRows"]
    withdrawal = normalized["withdrawalRows"]
    premium = normalized["policy"]["contractualTotalPremium"]
    y20, y30 = first(benefit, 20), first(benefit, 30)
    w6, w20, w30 = [first(withdrawal, year) for year in [6, 20, 30]]
    chart = lambda suffix: str(next(charts_dir.glob(f"*_{suffix}.png")).resolve())

    output_slides, edits = [], []

    def add(*a: Any, **kw: Any) -> None:
        frame, edit = slide(*a, **kw)
        output_slides.append(frame)
        edits.append(edit)

    add(1, 2, "cover", [
        ("6", f"{normalized['insured']['name']} 家庭储蓄险定制建议书"),
        ("7", f"{company_name} · {normalized['productName']}"),
    ], [], deletions=[("shape", "5"), ("shape", "8"), ("shape", "11"), ("shape", "14")])
    add(2, 3, "outline", [
        ("2", "CONTENTS"),
        ("3", "目录"),
        ("6", "建议书封面"),
        ("9", "家族办公室介绍"),
        ("12", "产品核心亮点介绍"),
        ("15", "产品收益核心说明"),
    ], [], deletions=[("shape", "5"), ("shape", "8"), ("shape", "11"), ("shape", "14")])
    add(3, 4, "outline", [
        ("3", "CONTENTS"),
        ("4", "财富提领规划路径 / 演示表 / 结束语"),
    ], [])
    add(4, 5, "highlights", [
        ("2", "建议书基础信息"),
        ("5", "客户家族核心成员信息"),
        ("6", f"受保人年龄 {normalized['insured']['age']} 岁；总缴保费约 US${money(premium)}。"),
        ("8", "家族资产规模与构成"),
        ("9", f"不提领：20年约 {y20['totalSurrenderValue']/premium:.2f} 倍；30年约 {y30['totalSurrenderValue']/premium:.2f} 倍。"),
        ("11", "传承目标与风险偏好"),
        ("12", "目标是兼顾教育金/养老金与长期资产传承。"),
    ], [("13", chart("growth"))], deletions=[("shape", "4"), ("shape", "7"), ("shape", "10")])
    add(5, 6, "withdrawal", [
        ("3", "提领路径：第6年起年领，持续覆盖教育金/现金流场景"),
        ("4", f"第6年 US${money(w6['annualWithdrawal'])} / 第20年累计 US${money(w20['cumulativeWithdrawal'])} / 第30年累计 US${money(w30['cumulativeWithdrawal'])}"),
    ], [])
    add(6, 5, "closing", [
        ("2", "结语"),
        ("5", "关键数字全部来源于官方计划书并可追溯。"),
        ("6", "可按客户目标切换教育金或养老金叙事。"),
        ("8", "祝愿"),
        ("9", "家业长青，规划顺利落地。"),
        ("11", "正式版"),
        ("12", "仅使用官方计划书数据与实图素材。"),
    ], [("13", chart("stacked"))], deletions=[("shape", "4"), ("shape", "7"), ("shape", "10")])

    frame_map = {"outputSlides": output_slides}
    edit_plan = {"templateId": "ink", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote ink clone plan -> {workspace}")


if __name__ == "__main__":
    main()
