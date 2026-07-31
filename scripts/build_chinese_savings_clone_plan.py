#!/usr/bin/env python3
"""Build a Chinese-template exact-clone edit plan from normalized official savings data."""

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
GOLD = "#b89246"
INK = "#24384b"
PALE = "#f6f1e7"
STRUCTURAL_MARKER = "\u2060"


def money(value: float | int) -> str:
    return f"{round(float(value)):,}"


def first(rows: list[dict[str, Any]], year: int) -> dict[str, Any] | None:
    for row in rows:
        if int(row["policyYear"]) == year:
            return row
    return None


def first_withdrawal(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    for row in rows:
        if float(row.get("annualWithdrawal") or row.get("annual_withdrawal") or 0) > 0:
            return row
    return None


def safe_w(rows_map: dict[int, dict[str, Any] | None], year: int, key: str, default: Any = 0) -> Any:
    row = rows_map.get(year)
    if row is None:
        return default
    return row.get(key, default)


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
    source_targets = [("rewrite", element_id) for element_id, _ in rewrites]
    source_targets += [("replace", element_id) for element_id, _ in replacements]
    return build_slide_entry(
        output=output,
        source=source,
        role=role,
        source_targets=source_targets,
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
    product_name = normalized["productName"].replace("环X盈活储蓄保险计划(5年缴费)", "环球盈活储蓄保险计划")
    company_context = json.loads(Path(args.company_context).read_text(encoding="utf-8")) if args.company_context else {}
    company_name = company_context.get("companyName") or "保险公司"
    company_intro = company_context.get("companyIntro") or "公司资料来自内部知识库。"
    company_highlights = company_context.get("companyHighlights") or []
    company_facts = company_context.get("companyFacts") or []
    evidence_titles = company_context.get("evidenceTitles") or []
    fact_line = "；".join(
        f"{item.get('label', '').strip()}：{item.get('value', '').strip()}"
        for item in company_facts[:4]
        if item.get("label") and item.get("value")
    )
    if not fact_line and company_highlights:
        fact_line = "；".join(item["text"] for item in company_highlights[:2] if item.get("text"))
    if not fact_line:
        fact_line = "；".join(title.replace(".pdf", "") for title in evidence_titles[:2]) if evidence_titles else "公司概况待补充"
    benefit = normalized["benefitRows"]
    withdrawal = normalized["withdrawalRows"]
    insured = normalized["insured"]
    insured_age = int(insured.get("age", 0) or 0)
    retirement_story = insured_age >= 45
    withdrawal_first = first_withdrawal(withdrawal)
    # 动态选择表中年份: 1, 5, 10, 20, 30, 40, 50, 60, 80 (存在就取, 不存在跳过)
    target_years = [1, 5, 10, 20, 30, 40, 50, 60, 80]
    available_benefit_years = {int(r["policyYear"]) for r in benefit}
    available_withdraw_years = {int(r["policyYear"]) for r in withdrawal}
    base_table_years = [y for y in target_years if y in available_benefit_years]
    withdrawal_table_years = [y for y in target_years if y in available_withdraw_years]
    if not base_table_years:
        # Fallback: 取所有 benefit 年份的步进
        sorted_y = sorted(available_benefit_years)
        step = max(1, len(sorted_y) // 8)
        base_table_years = sorted_y[::step][:8]
    if not withdrawal_table_years:
        sorted_y = sorted(available_withdraw_years) if available_withdraw_years else [6, 20, 30]
        step = max(1, len(sorted_y) // 8)
        withdrawal_table_years = sorted_y[::step][:8]
    base_table_rows = [r for r in (first(benefit, y) for y in base_table_years) if r is not None]
    withdrawal_table_rows = [r for r in (first(withdrawal, y) for y in withdrawal_table_years) if r is not None]
    no_withdraw_table = workspace / "assets/no-withdrawal-table.png"
    withdrawal_table = workspace / "assets/withdrawal-table.png"
    table_image(base_table_rows, no_withdraw_table, False)
    table_image(withdrawal_table_rows, withdrawal_table, True)
    chart = lambda suffix: str(next(charts_dir.glob(f"*_{suffix}.png")).resolve())
    asset = lambda filename: str((assets_dir / filename).resolve())
    premium = normalized["policy"]["contractualTotalPremium"]
    annual_premium = normalized["policy"]["annualPremium"]
    y20, y30 = first(benefit, 20) or first(benefit, 30), first(benefit, 30) or first(benefit, 20)
    withdrawal_lookup = {int(r["policyYear"]): r for r in withdrawal}
    # 兜底: 取关键年份；若不存在则从现有行中找近似值
    w20 = withdrawal_lookup.get(20)
    w30 = withdrawal_lookup.get(30)
    w60 = withdrawal_lookup.get(60)
    w80 = withdrawal_lookup.get(80)
    if not w20 and withdrawal:
        w20 = withdrawal[min(1, len(withdrawal) - 1)]
    if not w30 and withdrawal:
        w30 = withdrawal[min(2, len(withdrawal) - 1)]
    output_slides, edits = [], []

    def add(*args: Any) -> None:
        try:
            frame, edit = slide(*args)
            output_slides.append(frame)
            edits.append(edit)
        except Exception as e:
            import traceback
            print(f"add() exception: {e}", flush=True)
            traceback.print_exc()
            raise

    print("about to call add(1, 1, ...)", flush=True)
    add(1, 1, "opening thesis", [
        ("5", f"{normalized['insured']['name']} 家庭资产配置建议书"),
        ("7", date.today().isoformat()),
    ], [])
    add(2, 7, "company evidence", [
        ("2", f"{company_name}：长期财富管理"),
        ("4", STRUCTURAL_MARKER),
        ("5", "公司概览"),
        ("6", company_intro),
        ("7", STRUCTURAL_MARKER),
        ("8", "核心数据"),
        ("9", f"{fact_line}。产品：{product_name}。首年保费 US${money(annual_premium)}，缴费期 {normalized['policy']['payYears']} 年。"),
    ], [("10", asset("company.jpg"))])
    add(3, 11, "product highlights", [
        ("2", "一份保单，兼顾退休现金流与家族传承" if retirement_story else "一份保单，兼顾教育金与长期储备"),
        ("3", STRUCTURAL_MARKER),
        ("5", "本金投入清晰"),
        ("6", f"合同总缴保费约 US${money(premium)}，缴费期为 {normalized['policy']['payYears']} 年。"),
        ("7", STRUCTURAL_MARKER),
        ("9", "长期价值可验证"),
        ("10", f"不提领情景：第20年退保价值约 US${money(y20['totalSurrenderValue'])}；第30年约 US${money(y30['totalSurrenderValue'])}。"),
        ("11", STRUCTURAL_MARKER),
        ("13", "提领后仍保留账户价值"),
        ("14", f"现时假设下，自保单第{int(withdrawal_first.get('policyYear', 0)) if withdrawal_first else 11}年起每年领取 US${money(safe_w(withdrawal_lookup, int(withdrawal_first.get('policyYear', 11)) if withdrawal_first else 11, 'annualWithdrawal'))}，第20年累计领取 US${money(safe_w(withdrawal_lookup, 20, 'cumulativeWithdrawal'))}。"),
    ], [("15", asset("cover.jpg")), ("16", asset("scenario.jpg")), ("17", chart("cashflow"))])
    add(4, 16, "growth proof", [
        ("2", "不提领情景：现金价值增长"),
        ("3", STRUCTURAL_MARKER),
        ("5", "20年价值"),
        ("6", f"第20年退保现金价值约 US${money(y20['totalSurrenderValue'])}，约为本金 {y20['totalSurrenderValue']/premium:.2f} 倍。"),
        ("7", STRUCTURAL_MARKER),
        ("9", "30年价值"),
        ("10", f"第30年退保现金价值约 US${money(y30['totalSurrenderValue'])}，约为本金 {y30['totalSurrenderValue']/premium:.2f} 倍。"),
        ("11", STRUCTURAL_MARKER),
        ("13", "保证与非保证拆分"),
        ("14", "图表分别展示保证底盘、非保证弹性和总退保价值，便于解释长期价值来源。"),
    ], [("15", chart("growth")), ("16", chart("stacked")), ("17", chart("cashflow"))])
    start_year = int(withdrawal_first.get('policyYear', 11)) if withdrawal_first else 11
    start_age = int(withdrawal_first.get('age', insured.get('age', 1) + start_year)) if withdrawal_first else int(insured.get('age', 1)) + start_year
    annual_draw = int(withdrawal_first.get('annualWithdrawal', 200000)) if withdrawal_first else 200000
    add(5, 18, "withdrawal timeline retirement", [
        ("10", "现时假设下的提领路径：退休现金流与家族传承" if retirement_story else "现时假设下的提领路径：教育金与成长现金流"),
        ("15", "起领节点"),
        ("16", f"现时假设优先：保单第{start_year}年（约{start_age}岁）起，每年提取 US${money(annual_draw)}。该金额为当年提取总额，即保证现金价值(A) + 非保证终期红利(B) 的合计。"),
        ("20", "20年关键点"),
        ("21", f"第20保单年度累计提取 US${money(safe_w(withdrawal_lookup, 20, 'cumulativeWithdrawal'))}，提取后退保价值 US${money(safe_w(withdrawal_lookup, 20, 'surrenderValueAfter'))}。"),
        ("25", "30年关键点"),
        ("26", f"第30保单年度累计提取 US${money(safe_w(withdrawal_lookup, 30, 'cumulativeWithdrawal'))}，提取后退保价值 US${money(safe_w(withdrawal_lookup, 30, 'surrenderValueAfter'))}。"),
    ], [("27", asset("scenario.jpg"))])
    add(6, 21, "official withdrawal table", [
        ("2", "在现时假设情景下款项提取说明（每10年）"),
        ("4", STRUCTURAL_MARKER),
        ("5", "现时假设优先"),
        ("6", f"提取金额 US${money(annual_draw)} 为该年提取总额，即保证现金价值(A) + 非保证终期红利(B) 的合计。"),
        ("7", STRUCTURAL_MARKER),
        ("8", "读表重点"),
        ("9", "同时观察累计领取、剩余价值、单利和复利，不用单一收益率替代现金流判断。"),
        ("10", STRUCTURAL_MARKER),
        ("11", "数据来源"),
        ("12", "本页数字均来自官方计划书“在现时假设情景下”提领利益演示表，未使用模拟正式数字。"),
    ], [("13", str(withdrawal_table))])
    add(7, 26, "official no withdrawal table", [
        ("2", "不提领方案数据表（每10年）"),
        ("4", STRUCTURAL_MARKER),
        ("5", "复利增长路径"),
        ("6", f"总缴保费约 US${money(premium)}；第20年约 {y20['totalSurrenderValue']/premium:.2f} 倍，第30年约 {y30['totalSurrenderValue']/premium:.2f} 倍。"),
        ("7", STRUCTURAL_MARKER),
        ("8", "读表重点"),
        ("9", "本页用于理解长期积累能力；保证价值与非保证价值需结合官方利益演示阅读。"),
        ("10", STRUCTURAL_MARKER),
        ("11", "数据来源"),
        ("12", "本页数字均来自官方计划书不提领利益演示表，未使用模拟正式数字。"),
    ], [("13", str(no_withdraw_table))])
    add(8, 24, "closing wish", [
        ("2", "让时间成为家庭资产配置的一部分"),
        ("4", "退休现金流有安排" if retirement_story else "教育金有安排"),
        ("5", "在退休阶段保留可持续支取的现金流，让资产安排更从容。" if retirement_story else "在成长阶段保留可使用的教育资金，让家庭选择更从容。"),
        ("6", "长期现金流有来源"),
        ("7", "领取节奏与剩余价值并行展示，便于持续复盘。"),
    ], [("8", asset("closing.jpg"))])
    add(9, 27, "thank you", [("3", "THE END"), ("4", "谢谢")], [])
    used_source_slides = {item["sourceSlide"] for item in output_slides}
    frame_map = {
        "outputSlides": output_slides,
        "omittedSourceSlides": [
            {"sourceSlide": source_slide, "reason": "not selected for savings formal narrative"}
            for source_slide in range(1, 28)
            if source_slide not in used_source_slides
        ],
    }
    edit_plan = {"templateId": "chinese", "slides": edits}
    (workspace / "template-frame-map.json").write_text(json.dumps(frame_map, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "edit-plan.json").write_text(json.dumps(edit_plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote clone plan -> {workspace}", flush=True)


if __name__ == "__main__":
    print("main starting", flush=True)
    main()
    print("main ended", flush=True)
