#!/usr/bin/env python3
"""Build a minimal-template clone edit plan from normalized official savings data."""

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


def slide(output: int, source: int, role: str, rewrites: list[tuple[str, str]], replacements: list[tuple[str, str]], deletions: list[tuple[str, str]] | None = None) -> tuple[dict, dict]:
    source_anchor = {
        2: "sh/cvixczed",
        3: "sh/5o7qpg3e",
        4: "sh/o7qpg3ex",
        5: "sh/qtcj6tov",
        6: "sh/5wjudg7a",
    }.get(source, "sh/cvixczed")
    extra_targets = {
        3: [("rewrite", "sh/ylc7u54z"), ("rewrite", "sh/rytsvu9k"), ("rewrite", "sh/lwval87e"), ("rewrite", "sh/w3m94fu1"), ("rewrite", "sh/3itgfmlk")],
        4: [("rewrite", "sh/vmtwra5g"), ("rewrite", "sh/6hcrmhk3"), ("rewrite", "sh/6dcbulwv"), ("rewrite", "sh/vy90je9c")],
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
    assets_dir = Path(args.assets_dir).resolve()
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
    asset = lambda filename: str((assets_dir / filename).resolve())

    output_slides, edits = [], []

    def add(*a: Any, **kw: Any) -> None:
        frame, edit = slide(*a, **kw)
        output_slides.append(frame)
        edits.append(edit)

    add(1, 2, "cover", [
        ("2", date.today().isoformat()),
        ("3", f"{normalized['insured']['name']} 家庭储蓄险定制建议书"),
        ("4", f"{company_name} · {normalized['productName']}"),
    ], [], deletions=[("shape", "5"), ("shape", "8"), ("shape", "11"), ("shape", "14"), ("shape", "17")])
    add(2, 3, "outline", [
        ("2", "CONTENTS"),
        ("3", "目录"),
        ("6", "封面"),
        ("9", "保险公司介绍"),
        ("12", "产品设计理念"),
        ("15", "产品核心亮点"),
    ], [], deletions=[("shape", "5"), ("shape", "8"), ("shape", "11"), ("shape", "14")])
    add(3, 5, "highlights", [
        ("12", "主标题：储蓄险长期资产配置方案"),
        ("15", "核心产品：官方储蓄险计划"),
        ("16", f"总缴保费约 US${money(premium)}；第20年约 {y20['totalSurrenderValue']/premium:.2f} 倍；第30年约 {y30['totalSurrenderValue']/premium:.2f} 倍。"),
        ("9", "建议书标题与产品名"),
    ], [("17", asset("cover.jpg"))])
    add(4, 6, "company", [
        ("2", "券商机构信息"),
        ("5", f"{company_name} 公司资料"),
        ("6", "公开口径资料已入库并可追溯"),
        ("9", "行业资质与服务能力"),
        ("10", "基于官方计划书与客户画像输出结构化建议"),
        ("13", "专属服务团队配置"),
        ("14", "储蓄险方案设计 + 提领节奏规划 + 风险提示"),
    ], [("15", asset("company.jpg")), ("16", chart("growth")), ("17", chart("cashflow"))], deletions=[("shape", "3"), ("shape", "7"), ("shape", "11")])
    add(5, 6, "withdrawal", [
        ("2", "提领路径摘要"),
        ("5", f"第6年起年领 US${money(w6['annualWithdrawal'])}"),
        ("6", f"第20年累计领取 US${money(w20['cumulativeWithdrawal'])}"),
        ("9", f"第30年累计领取 US${money(w30['cumulativeWithdrawal'])}"),
        ("10", "领取后仍保留退保现金价值，兼顾流动性与长期性"),
        ("13", "关键数字可回溯至官方表格"),
        ("14", "正式版禁用模拟数字与历史客户 fallback"),
    ], [("15", chart("stacked")), ("16", chart("cashflow")), ("17", asset("scenario.jpg"))], deletions=[("shape", "3"), ("shape", "7"), ("shape", "11")])
    add(6, 5, "closing", [
        ("12", "结语：让时间成为家庭资产配置的一部分"),
        ("15", "祝愿家业长青，规划顺利落地"),
        ("16", "如需改为教育金/养老金视角，可按同一模型自动重算"),
    ], [("17", asset("closing.jpg"))])

    frame_map = {"outputSlides": output_slides}
    edit_plan = {"templateId": "minimal", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote minimal clone plan -> {workspace}")


if __name__ == "__main__":
    main()
