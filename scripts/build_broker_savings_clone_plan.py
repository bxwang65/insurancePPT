#!/usr/bin/env python3
"""Build a broker-template clone edit plan from normalized official savings data."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont
from clone_plan_common import build_slide_entry

FONT_PATH = "/System/Library/Fonts/STHeiti Light.ttc"
BLUE = "#102c49"
INK = "#24384b"
PALE = "#f6f1e7"


def money(value: float | int) -> str:
    return f"{round(float(value)):,}"


def first(rows: list[dict[str, Any]], year: int) -> dict[str, Any]:
    return next(row for row in rows if int(row["policyYear"]) == year)


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size=size)


def table_image(rows: list[dict[str, Any]], output: Path, with_withdrawal: bool) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    width, height = 2200, 420
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    headers = ["年龄", "保单年度", "已交总保费", "本年领取", "累计领取", "退保现金价值", "单利", "复利"]
    widths = [150, 180, 310, 260, 280, 340, 210, 210]
    x_positions = [0]
    for cell_width in widths:
        x_positions.append(x_positions[-1] + cell_width)
    row_height = 42
    draw.rectangle((0, 0, width, row_height), fill=BLUE)
    for index, header in enumerate(headers):
        draw.text((x_positions[index] + 12, 8), header, fill="white", font=font(23))
    for row_index, row in enumerate(rows):
        top = row_height + row_index * row_height
        draw.rectangle((0, top, width, top + row_height), fill=PALE if row_index % 2 else "white")
        paid = float(row["totalPremiumPaid"])
        value = float(row["surrenderValueAfter"] if with_withdrawal else row["totalSurrenderValue"])
        policy_year = int(row["policyYear"])
        simple = ((value / max(paid, 1) - 1) / max(policy_year, 1)) * 100
        compound = ((value / max(paid, 1)) ** (1 / max(policy_year, 1)) - 1) * 100
        values = [
            str(row["age"]),
            str(policy_year),
            money(paid),
            money(row.get("annualWithdrawal", 0)),
            money(row.get("cumulativeWithdrawal", 0)),
            money(value),
            f"{simple:.2f}%",
            f"{compound:.2f}%",
        ]
        for index, value_text in enumerate(values):
            draw.text((x_positions[index] + 12, top + 8), value_text, fill=INK, font=font(21))
    for x in x_positions:
        draw.line((x, 0, x, height), fill="#d9e2ea", width=2)
    for row_index in range(len(rows) + 2):
        y = row_index * row_height
        draw.line((0, y, width, y), fill="#d9e2ea", width=2)
    image.save(output)


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
    table_years = [1, 10, 20, 30, 40, 50, 60, 70, 80]
    base_table_rows = [first(benefit, year) for year in table_years]
    withdrawal_table_rows = [first(withdrawal, year) for year in table_years]
    no_withdraw_table = workspace / "assets/no-withdrawal-table.png"
    withdrawal_table = workspace / "assets/withdrawal-table.png"
    table_image(base_table_rows, no_withdraw_table, False)
    table_image(withdrawal_table_rows, withdrawal_table, True)
    chart = lambda suffix: str(next(charts_dir.glob(f"*_{suffix}.png")).resolve())
    asset = lambda filename: str((assets_dir / filename).resolve())
    premium = normalized["policy"]["contractualTotalPremium"]
    y20, y30 = first(benefit, 20), first(benefit, 30)
    w6, w20, w30, w60 = [first(withdrawal, year) for year in [6, 20, 30, 60]]
    output_slides, edits = [], []

    def add(*args: Any) -> None:
        frame, edit = slide(*args)
        output_slides.append(frame)
        edits.append(edit)

    add(1, 2, "cover", [
        ("6", f"{normalized['insured']['name']} 家庭定制方案"),
        ("20", f"{company_name} · {normalized['productName']}"),
        ("35", date.today().isoformat()),
    ], [])
    add(2, 3, "company", [
        ("6", f"{company_name}公司介绍"),
        ("35", "公司资料来自内部知识库（公开口径）"),
        ("40", "以长期偿付与资产实力为核心筛选依据"),
        ("45", "本页用于销售沟通，正式数值与官方计划书分层呈现"),
    ], [("52", asset("company.jpg"))])
    add(3, 4, "highlights", [
        ("6", "产品亮点概览"),
        ("14", f"总缴保费约 US${money(premium)}"),
        ("19", f"不提领：20年约 {y20['totalSurrenderValue']/premium:.2f} 倍"),
        ("24", f"不提领：30年约 {y30['totalSurrenderValue']/premium:.2f} 倍"),
        ("39", "长期价值来源于保证底盘 + 非保证增值，图表用于结构化解释"),
    ], [("49", chart("growth"))])
    add(4, 5, "analysis", [
        ("6", "现金流与风险准备并行"),
        ("25", f"第6年起每年领取 US${money(w6['annualWithdrawal'])}"),
        ("26", f"第20年累计领取 US${money(w20['cumulativeWithdrawal'])}"),
        ("30", f"第30年累计领取 US${money(w30['cumulativeWithdrawal'])}"),
        ("31", f"第60年累计领取 US${money(w60['cumulativeWithdrawal'])}"),
    ], [("49", chart("cashflow")), ("50", chart("stacked"))])
    add(5, 6, "analysis", [
        ("6", "教育金领取路径（横向里程碑）"),
        ("19", f"第6年开始领取，每年约 US${money(w6['annualWithdrawal'])}；第20年累计约 US${money(w20['cumulativeWithdrawal'])}。"),
        ("31", f"第30年累计约 US${money(w30['cumulativeWithdrawal'])}，同时保留退保价值。"),
    ], [])
    add(6, 5, "analysis", [
        ("6", "养老金视角：领取与剩余价值"),
        ("25", f"第30年累计领取约 US${money(w30['cumulativeWithdrawal'])}"),
        ("30", f"第60年累计领取约 US${money(w60['cumulativeWithdrawal'])}"),
        ("31", "领取后仍有保单价值，便于兼顾灵活性"),
    ], [("49", asset("closing.jpg"))])
    add(7, 4, "analysis", [
        ("6", "提领方案数据表（每10年）"),
        ("39", "字段包含：年龄、保单年度、已交总保费、领取金额、累计领取、退保现金价值、单利、复利。"),
    ], [("49", str(withdrawal_table))])
    add(8, 4, "analysis", [
        ("6", "不提领方案数据表（每10年）"),
        ("39", f"第20年约 {y20['totalSurrenderValue']/premium:.2f} 倍，第30年约 {y30['totalSurrenderValue']/premium:.2f} 倍。"),
    ], [("50", str(no_withdraw_table))])
    add(9, 3, "conclusion", [
        ("6", "方案结论"),
        ("35", "通过“提领 / 不提领”双视角，兼顾教育金和长期现金流"),
        ("40", "关键数字均可回溯到官方计划书对应年度"),
    ], [("53", asset("closing.jpg"))])
    add(10, 2, "ending", [
        ("6", "感谢聆听"),
        ("20", "如需调整提领节奏，可基于同一模型自动重算"),
    ], [])

    frame_map = {"outputSlides": output_slides}
    edit_plan = {"templateId": "broker", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote broker clone plan -> {workspace}")


if __name__ == "__main__":
    main()
