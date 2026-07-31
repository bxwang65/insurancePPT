#!/usr/bin/env python3
"""Build a business-template clone edit plan from normalized official savings data."""

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


def slide(output: int, source: int, role: str, rewrites: list[tuple[str, str]], replacements: list[tuple[str, str]]) -> tuple[dict, dict]:
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
        replacements=replacements,
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
    has_withdrawal = bool(withdrawal)
    y20, y30 = first(benefit, 20), first(benefit, 30)
    w6 = w20 = w30 = w60 = None
    if has_withdrawal:
        w6, w20, w30, w60 = [first(withdrawal, year) for year in [6, 20, 30, 60]]
    chart = lambda suffix: str(next(charts_dir.glob(f"*_{suffix}.png")).resolve())
    asset = lambda filename: str((assets_dir / filename).resolve())

    output_slides, edits = [], []

    def add(*a: Any) -> None:
        frame, edit = slide(*a)
        output_slides.append(frame)
        edits.append(edit)

    add(1, 2, "cover", [
        ("6", f"{normalized['insured']['name']} 家庭财富传承方案"),
        ("10", f"{company_name} · {normalized['productName']}"),
        ("31", date.today().isoformat()),
    ], [])
    add(2, 3, "company", [
        ("6", "关于我们"),
        ("10", "专注储蓄险定制与长期资产配置"),
        ("14", "专业团队"),
        ("15", "资深财富规划师、税务专家、法律顾问"),
        ("20", "核心方案"),
        ("21", "以官方计划书为依据，结构化输出客户沟通版计划书"),
    ], [("60", asset("company.jpg"))])
    add(3, 4, "highlights", [
        ("6", "产品核心亮点"),
        ("12", "长期稳健增值"),
        ("13", "基于官方利益演示，展示不提领与提领两种路径"),
        ("14", f"总缴保费约 US${money(premium)}"),
        ("19", f"不提领：第20年约 {y20['totalSurrenderValue']/premium:.2f} 倍"),
        ("24", f"不提领：第30年约 {y30['totalSurrenderValue']/premium:.2f} 倍"),
        ("30", "关键数字可回溯至官方保单表格与来源页码"),
    ], [])
    if has_withdrawal:
        add(4, 5, "analysis", [
            ("6", "现金价值增长曲线"),
            ("10", "第10年"),
            ("11", "现金价值增长进入可见区间"),
            ("13", "第25年"),
            ("14", "复利效应逐步体现"),
            ("18", "第60年"),
            ("19", "长期价值与现金流能力并行"),
            ("25", f"第6年起可年领 US${money(w6['annualWithdrawal'])}"),
            ("26", f"第20年累计领取 US${money(w20['cumulativeWithdrawal'])}"),
            ("30", f"第30年累计领取 US${money(w30['cumulativeWithdrawal'])}"),
            ("31", f"第60年累计领取 US${money(w60['cumulativeWithdrawal'])}"),
        ], [])
        add(5, 6, "analysis", [
            ("6", "灵活提领路径"),
            ("12", "定期定额提领"),
            ("13", "适合教育金与家庭现金流安排"),
            ("15", "日常开支"),
            ("16", f"第6年起每年领取 US${money(w6['annualWithdrawal'])}"),
            ("19", "阶段提领"),
            ("21", f"第20年累计 US${money(w20['cumulativeWithdrawal'])}，第30年累计 US${money(w30['cumulativeWithdrawal'])}"),
            ("23", "养老补充"),
            ("24", "长期领取后仍保有退保价值与灵活性"),
        ], [("63", chart("cashflow"))])
        add(6, 4, "conclusion", [
            ("6", "方案总结"),
            ("12", "储蓄险定制输出"),
            ("13", "公司资料 + 官方保单 + 双路径分析"),
            ("18", "客户沟通重点"),
            ("19", "数字可追溯、页面可解释、结构可复用"),
            ("30", "后续可按客户目标自动切换教育金/养老金叙事"),
        ], [])
    else:
        add(4, 5, "analysis", [
            ("6", "现金价值增长曲线"),
            ("10", "第20年"),
            ("11", f"退保价值约 US${money(y20['totalSurrenderValue'])}，约为本金 {y20['totalSurrenderValue']/premium:.2f} 倍"),
            ("13", "第30年"),
            ("14", f"退保价值约 US${money(y30['totalSurrenderValue'])}，约为本金 {y30['totalSurrenderValue']/premium:.2f} 倍"),
            ("18", "长期持有"),
            ("19", "本页聚焦不提领视角，展示保单现金价值随时间增长"),
        ], [])
        add(5, 6, "analysis", [
            ("6", "教育金 / 养老金规划视角"),
            ("12", "若客户目标为教育金，可围绕成长节点重排现金流"),
            ("13", "若客户目标为养老金，可围绕退休节点重排现金流"),
            ("15", "家庭用途"),
            ("16", "不提领时，重点观察20/30年复利倍数与长期现金价值"),
            ("19", "长期持有"),
            ("21", "所有数据均来自官方利益演示，不使用模拟正式数字"),
            ("23", "客户沟通"),
            ("24", "如需提领路径，可在后续拿到官方提领表后再生成正式版"),
        ], [("63", chart("growth"))])
        add(6, 4, "conclusion", [
            ("6", "方案总结"),
            ("12", "储蓄险定制输出"),
            ("13", "公司资料 + 官方保单 + 不提领视角"),
            ("18", "客户沟通重点"),
            ("19", "数字可追溯、页面可解释、结构可复用"),
            ("30", "后续可在补齐提领表后自动切换双路径叙事"),
        ], [])

    frame_map = {"outputSlides": output_slides}
    edit_plan = {"templateId": "business", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote business clone plan -> {workspace}")


if __name__ == "__main__":
    main()
