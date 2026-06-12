#!/usr/bin/env python3
"""Extract savings illustration tables from selectable-text insurer PDFs.

This parser deliberately extracts numbers only. LLM extraction remains useful
for semantics, but formal proposal values must come from insurer table cells.
"""
import argparse
import contextlib
import io
import json
import re
from pathlib import Path

import fitz


def values(cell):
    if not cell:
        return []
    return [line.strip().replace(",", "") for line in str(cell).splitlines() if line.strip()]


def number(value):
    if value in ("", "-", None):
        return 0
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return 0


def integer(value):
    return int(number(value))


def table_rows(table, columns):
    out = []
    for grouped in table.extract()[3:]:
        split = [values(grouped[index] if index < len(grouped) else "") for index in columns]
        size = min((len(items) for items in split), default=0)
        for offset in range(size):
            out.append([items[offset] for items in split])
    return out


def parse_merged_cells(table, n_val_cols=4, has_death=False):
    """通用合并单元格解析器: 列0=年度, 1=保费, 2~2+n_val_cols=退保价值, 最后=身故(可选)"""
    rows = []
    extracted = table.extract()
    if len(extracted[0]) < 4:
        return []
    # 把所有合并单元格展开成多行
    all_rows = []
    for row_data in extracted[3:]:
        cells = [str(c).strip() for c in row_data]
        # 按换行符分割每个单元格
        split_cells = [c.split('\n') for c in cells]
        n = max(len(sc) for sc in split_cells if any(sc)) if any(split_cells) else 0
        for i in range(n):
            row = []
            for sc in split_cells:
                val = sc[i].strip().replace(",","") if i < len(sc) else ""
                row.append(val)
            all_rows.append(row)
    # 解析展开后的行
    for vals in all_rows:
        clean = vals[0].replace("歲","").replace("岁","").strip()
        if not clean.isdigit():
            continue
        yr = int(clean)
        if yr <= 0 or yr > 200:
            continue
        paid = float(vals[1]) if len(vals) > 1 and vals[1].replace(".","").isdigit() else 0
        # 退保价值列
        sv_list = []
        for v in vals[2:2+n_val_cols]:
            try: sv_list.append(float(v))
            except: pass
        total_sv = max(sv_list) if sv_list else 0
        gua = sv_list[0] if sv_list else 0
        rows.append({
            "policy_year": yr,
            "total_premium_paid": paid,
            "guaranteed_cash_value": gua,
            "total_surrender_value": total_sv,
            "source_page": 0,
        })
    return rows


def parse_base(page, page_num):
    rows = []
    with contextlib.redirect_stdout(io.StringIO()):
        tables = page.find_tables().tables
    for table in tables:
        if len(table.extract()[0]) < 12:
            ncols = len(table.extract()[0])
            # 10列=退保价值(4列)+身故(4列), 6-8列=退保价值, 12+=退保(6)+身故(6)
            n_val = 4 if ncols >= 10 else (ncols - 2 if ncols >= 6 else 0)
            merged = parse_merged_cells(table, n_val_cols=n_val)
            for r in merged:
                r["source_page"] = page_num
                rows.append(r)
            continue
        for age, year, paid, guaranteed, bonus, dividend, total, death in table_rows(
            table, [0, 1, 2, 3, 4, 5, 6, 11]
        ):
            year_num = integer(year)
            if year_num <= 0:
                continue
            rows.append({
                "policy_year": year_num,
                "age": integer(age),
                "total_premium_paid": number(paid),
                "guaranteed_cash_value": number(guaranteed),
                "reversionary_bonus": number(bonus),
                "terminal_dividend": number(dividend),
                "total_surrender_value": number(total),
                "death_benefit": number(death),
                "source_page": page_num,
            })
    return rows


def parse_merged_withdrawal(table):
    """通用提领解析器(合并单元格): 列2=提取金额, 列7=退保价值"""
    rows = []
    extracted = table.extract()
    if len(extracted[0]) < 6:
        return rows
    # 展开合并单元格
    all_rows = []
    for row_data in extracted[3:]:
        cells = [str(c).strip() for c in row_data]
        split_cells = [c.split('\n') for c in cells]
        n = max(len(sc) for sc in split_cells if any(sc)) if any(split_cells) else 0
        for i in range(n):
            row = []
            for sc in split_cells:
                val = sc[i].strip().replace(",","") if i < len(sc) else ""
                row.append(val)
            all_rows.append(row)
    for vals in all_rows:
        yr_str = vals[0].replace("歲","").replace("岁","").strip()
        if not yr_str.isdigit():
            continue
        yr = int(yr_str)
        if yr <= 0 or yr > 200:
            continue
        prem = float(vals[1]) if len(vals) > 1 and vals[1].replace(".","").isdigit() else 0
        wd = float(vals[2]) if len(vals) > 2 and vals[2].replace(".","").isdigit() else 0
        sv = float(vals[7]) if len(vals) > 7 and vals[7].replace(".","").isdigit() else 0
        if wd > 0:
            rows.append({
                "policy_year": yr,
                "total_premium_paid": prem,
                "annual_withdrawal": wd,
                "surrender_value_after": sv,
            })
    return rows


def parse_withdrawal_amounts(page, page_num):
    rows = []
    with contextlib.redirect_stdout(io.StringIO()):
        tables = page.find_tables().tables
    for table in tables:
        if len(table.extract()[0]) != 6:
            continue
        for age, year, guaranteed, bonus, dividend, total in table_rows(table, [0, 1, 2, 3, 4, 5]):
            year_num = integer(year)
            if year_num <= 0:
                continue
            rows.append({
                "policy_year": year_num,
                "age": integer(age),
                "annual_withdrawal": number(total),
                "withdrawal_guaranteed": number(guaranteed),
                "withdrawal_reversionary_bonus": number(bonus),
                "withdrawal_terminal_dividend": number(dividend),
                "source_page": page_num,
            })
    return rows


def parse_after_withdrawal(page, page_num):
    rows = []
    with contextlib.redirect_stdout(io.StringIO()):
        tables = page.find_tables().tables
    for table in tables:
        if len(table.extract()[0]) != 9:
            continue
        for age, year, paid, withdrawal, basic, guaranteed, bonus, dividend, total in table_rows(
            table, [0, 1, 2, 3, 4, 5, 6, 7, 8]
        ):
            year_num = integer(year)
            if year_num <= 0:
                continue
            rows.append({
                "policy_year": year_num,
                "age": integer(age),
                "total_premium_paid": number(paid),
                "annual_withdrawal": number(withdrawal),
                "basic_sum_insured_after": number(basic),
                "guaranteed_value_after": number(guaranteed),
                "reversionary_bonus_after": number(bonus),
                "terminal_dividend_after": number(dividend),
                "surrender_value_after": number(total),
                "source_page": page_num,
            })
    return rows


def dedupe(rows):
    by_year = {}
    for row in rows:
        by_year[row["policy_year"]] = row
    return [by_year[year] for year in sorted(by_year)]


def parse_ctf_withdrawal_surrender_text(page, page_num, benefit_rows):
    text = page.get_text("text")
    if "现金提取" not in text or "退保发还金额及" not in text or "身故赔偿额" in text:
        return []

    marker = "退保发还金额及\n已提取金额总额"
    if marker not in text:
        marker = "退保发还金额及 已提取金额总额"
    if marker not in text:
        return []

    payload = text.split(marker, 1)[1]
    tokens = re.findall(r"\d[\d,]*", payload)
    if len(tokens) < 11:
        return []

    benefit_by_year = {row["policy_year"]: row for row in benefit_rows}
    rows = []
    row_size = 11
    for offset in range(0, len(tokens) - row_size + 1, row_size):
        chunk = tokens[offset:offset + row_size]
        age = integer(chunk[0])
        year_num = integer(chunk[1])
        if year_num <= 0 or age <= 0:
            continue
        annual_withdrawal = number(chunk[7])
        cumulative_withdrawal = number(chunk[3])
        guaranteed_value_after = number(chunk[4])
        surrender_value_after = number(chunk[9])
        total_after_plus_withdrawn = number(chunk[10])
        if abs((surrender_value_after + cumulative_withdrawal) - total_after_plus_withdrawn) > 2:
            continue
        rows.append({
            "policy_year": year_num,
            "age": age,
            "total_premium_paid": number(benefit_by_year.get(year_num, {}).get("total_premium_paid", 0)),
            "annual_withdrawal": annual_withdrawal,
            "basic_sum_insured_after": number(chunk[2]),
            "guaranteed_value_after": guaranteed_value_after,
            "reversionary_bonus_after": number(chunk[5]),
            "terminal_dividend_after": number(chunk[8]),
            "surrender_value_after": surrender_value_after,
            "source_page": page_num,
            "total_withdrawn": cumulative_withdrawal,
        })
    return rows


def parse_ctf_base_surrender_text(page, page_num):
    text = page.get_text("text")
    if "3. 基本计划" not in text or "说明摘要" not in text or "退保发还金额" not in text or "身故赔偿额" in text:
        return []

    payload = text.split("非保证金额", 1)[-1]
    tokens = re.findall(r"\d[\d,]*", payload)
    if len(tokens) < 6:
        return []

    rows = []
    row_size = 6
    last_year = 0
    for offset in range(0, len(tokens) - row_size + 1, row_size):
        chunk = tokens[offset:offset + row_size]
        year_num = integer(chunk[0])
        if year_num <= 0:
            continue
        if last_year and year_num <= last_year:
            break
        rows.append({
            "policy_year": year_num,
            "total_premium_paid": number(chunk[1]),
            "guaranteed_cash_value": number(chunk[2]),
            "reversionary_bonus": number(chunk[3]),
            "total_surrender_value": number(chunk[4]),
            "terminal_dividend": number(chunk[5]),
            "source_page": page_num,
        })
        last_year = year_num
    return rows


def parse_ctf_base_death_text(page, page_num):
    text = page.get_text("text")
    if "3. 基本计划" not in text or "说明摘要" not in text or "身故赔偿额" not in text:
        return []

    payload = text.split("(A)", 1)[-1]
    tokens = re.findall(r"\d[\d,]*", payload)
    if len(tokens) < 8:
        return []

    rows = []
    row_size = 8
    last_year = 0
    for offset in range(0, len(tokens) - row_size + 1, row_size):
        chunk = tokens[offset:offset + row_size]
        year_num = integer(chunk[0])
        if year_num <= 0:
            continue
        if last_year and year_num <= last_year:
            break
        rows.append({
            "policy_year": year_num,
            "total_premium_paid": number(chunk[1]),
            "guaranteed_cash_value": number(chunk[2]),
            "guaranteed_death_benefit": number(chunk[3]),
            "reversionary_bonus": number(chunk[4]),
            "terminal_dividend": number(chunk[5]),
            "total_surrender_value": number(chunk[6]),
            "death_benefit": number(chunk[7]),
            "source_page": page_num,
        })
        last_year = year_num
    return rows


def parse_cpic_withdrawal(page, page_num):
    """CPIC 11列提领表: 提取年份/提取金额(用table_rows解合并单元格)"""
    rows = []
    txt = page.get_text()
    if "現金提取" not in txt:
        return []
    with contextlib.redirect_stdout(io.StringIO()):
        tables = page.find_tables().tables
    for table in tables:
        extracted = table.extract()
        if not extracted or len(extracted[0]) not in (9, 11):
            continue
        hdr = " ".join(str(c) for c in extracted[0])
        if "提取" not in hdr:
            continue
        # 列: 年龄,年度,保费,提取,保证,归原,终期,总额,累计,(价值+提取),(名义金额)
        for row_data in extracted[3:]:
            vals = [values(c) for c in row_data]
            if not vals or not any(vals):
                continue
            n = min(len(v) for v in vals if v) if any(v for v in vals) else 1
            for i in range(n):
                yr = integer(vals[2][i]) if len(vals) > 2 and i < len(vals[2]) else 0
                wd = number(vals[4][i]) if len(vals) > 4 and i < len(vals[4]) else 0
                sv = number(vals[8][i]) if len(vals) > 8 and i < len(vals[8]) else 0
                prem = number(vals[3][i]) if len(vals) > 3 and i < len(vals[3]) else 0
                if yr > 0:
                    rows.append({
                        "policy_year": yr,
                        "total_premium_paid": prem,
                        "annual_withdrawal": wd if wd > 0 else 0,
                        "surrender_value_after": sv if sv > 0 else 0,
                        "total_withdrawn": 0,
                    })
    return rows


def parse_cpic_base(page, page_num):
    """CPIC 储蓄表(文本解析,竖排): 年度/总保费/保证金额/归原红利/终期红利/总额"""
    rows = []
    txt = page.get_text()
    if "保單年度終結" not in txt:
        return rows
    lines = txt.split("\n")
    # 提取所有数字行（竖排表格：每个值占一行）
    data_lines = []
    in_table = False
    for line in lines:
        s = line.strip()
        if "保單年度終結" in s:
            in_table = True
            continue
        if not in_table:
            continue
        # 跳过表头
        if any(k in s for k in ["繳付保費總額", "保證金額", "非保證金額", "歸原紅利", "終期紅利", "總額", "(A)", "(B)", "(C)", "(D)", "退保價值"]):
            continue
        # 纯数字行 或 年龄行
        clean = s.replace("歲", "").replace("岁", "").replace(",", "").strip()
        if clean and (clean.isdigit() or (clean[:-1].isdigit() if clean else False)):
            data_lines.append(s)
    # 重组: 每6行一组(标签+5个值)
    i = 0
    while i < len(data_lines):
        label = data_lines[i].replace("歲", "").replace("岁", "").strip()
        if not label.isdigit():
            i += 1
            continue
        year = int(label)
        if i + 5 >= len(data_lines):
            break
        vals = data_lines[i+1:i+6]
        rows.append({
            "policy_year": year,
            "total_premium_paid": number(vals[0]) if len(vals) > 0 else 0,
            "guaranteed_cash_value": number(vals[1]) if len(vals) > 1 else 0,
            "reversionary_bonus": number(vals[2]) if len(vals) > 2 else 0,
            "terminal_dividend": number(vals[3]) if len(vals) > 3 else 0,
            "total_surrender_value": number(vals[4]) if len(vals) > 4 else 0,
            "source_page": page_num,
        })
        i += 6
    return rows


def parse_aia_huanyu_base_text(page, page_num):
    text = page.get_text("text")
    if "详细说明" not in text or "退保发还金额" not in text or "环" not in text:
        return []
    rows = []
    with contextlib.redirect_stdout(io.StringIO()):
        tables = page.find_tables().tables
    for table in tables:
        extracted = table.extract()
        if not extracted or len(extracted[0]) < 12:
            continue
        for age, year, paid, guaranteed, bonus, dividend, total, death in table_rows(
            table, [0, 1, 2, 3, 4, 5, 6, 11]
        ):
            year_num = integer(year)
            if year_num <= 0:
                continue
            rows.append({
                "policy_year": year_num,
                "age": integer(age),
                "total_premium_paid": number(paid),
                "guaranteed_cash_value": number(guaranteed),
                "reversionary_bonus": number(bonus),
                "terminal_dividend": number(dividend),
                "total_surrender_value": number(total),
                "death_benefit": number(death),
                "source_page": page_num,
            })
    return rows


def _positional_rows(page):
    """从 page.get_text('dict') 按 y 坐标分组, 返回 [(y, [(x, text), ...]), ...]"""
    from collections import defaultdict
    groups = defaultdict(list)
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            y = round(line["bbox"][1], 0)
            text = "".join(s["text"] for s in line["spans"])
            if text.strip():
                groups[y].append((line["bbox"][0], text.strip()))
    result = []
    for y in sorted(groups.keys()):
        items = sorted(groups[y], key=lambda x: x[0])
        result.append((y, items))
    return result


def is_policy_year_cell(text):
    """判断是否为保单年度格 (纯数字 1~200 或 '@ANB')"""
    s = text.strip()
    if s.isdigit() and 1 <= int(s) <= 200:
        return True
    if s.startswith("@ANB"):
        return True
    return False


def parse_pru_base(page, page_num):
    """保诚退保表 (6列): 用 get_text('dict') 按位置解析, 无截断问题

    列映射: 年度 | 保费 | 保证(A) | 归原(B) | 终期(C) | 总额
    跳过含悲观/乐观情景的页 (scenario analysis)
    """
    rows = []
    txt = page.get_text()
    if "退保價值" not in txt:
        return rows
    if "悲觀情景" in txt or "樂觀情景" in txt:
        return rows
    # 跳过身故赔偿页面
    if "身故賠償之" in txt or "身故赔偿之" in txt or "最低身故賠償" in txt or "最低身故赔偿" in txt:
        return rows
    # 如果有"提取" + "退保價值", 走 withdrawal 解析
    if "提取" in txt:
        return rows

    pos_rows = _positional_rows(page)
    for y, items in pos_rows:
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first):
            continue
        # 忽略 @ANB 行 (因没有标准年度列)
        if first.startswith("@ANB"):
            continue
        # 取前 6 列 (按 x 排序)
        vals = [t.replace(",", "") for _, t in items[:6]]
        if len(vals) < 6:
            continue
        try:
            yr = int(vals[0])
            prem = float(vals[1])
            guar = float(vals[2])
            bonus = float(vals[3])
            term = float(vals[4])
            total = float(vals[5])
        except (ValueError, IndexError):
            continue
        rows.append({
            "policy_year": yr, "total_premium_paid": prem,
            "guaranteed_cash_value": guar, "reversionary_bonus": bonus,
            "terminal_dividend": term, "total_surrender_value": total,
            "source_page": page_num,
        })
    return rows


def parse_pru_withdrawal(page, page_num):
    """保诚提领表 (8列): 用 get_text('dict') 按位置解析

    列映射: 年度 | 保费 | 年提取 | 名义金额 | 保证(A) | 归原(B) | 终期(C) | 总额
    输出: policy_year, total_premium_paid, annual_withdrawal, surrender_value_after
    """
    rows = []
    txt = page.get_text()
    if "退保價值" not in txt or "提取" not in txt:
        return rows
    if "提取後之" not in txt:
        return rows

    pos_rows = _positional_rows(page)
    for y, items in pos_rows:
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first):
            continue
        if first.startswith("@ANB"):
            continue
        # 取前 8 列 (按 x 排序)
        vals = [t.replace(",", "") for _, t in items[:8]]
        if len(vals) < 8:
            continue
        try:
            yr = int(vals[0])
            prem = float(vals[1])
            annual_wd = float(vals[2])
            sv_after = float(vals[7])  # 总额 = 退保后价值
        except (ValueError, IndexError):
            continue
        rows.append({
            "policy_year": yr,
            "total_premium_paid": prem,
            "annual_withdrawal": annual_wd,
            "surrender_value_after": sv_after,
            "source_page": page_num,
        })
    return rows


def parse_axa_base(page, page_num):
    """安盛盛利II 退保表 (10列 -> 前6列): 用 get_text('dict') 按位置解析

    列映射: 年度 | 保费 | 保证(1) | 保额增值红利(2) | 终期红利(3) | 总额(1+2+3)
    """
    rows = []
    txt = page.get_text()
    if "退保發還金額" not in txt or "提取" in txt:
        return rows

    pos_rows = _positional_rows(page)
    for y, items in pos_rows:
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first):
            continue
        if first.startswith("@ANB"):
            continue
        vals = [t.replace(",", "") for _, t in items[:10]]
        if len(vals) < 6:
            continue
        try:
            yr = int(vals[0])
            prem = float(vals[1])
            gcv = 0.0 if vals[2] in ("-", "") else float(vals[2])
            rev = 0.0 if vals[3] in ("-", "") else float(vals[3])
            term = 0.0 if vals[4] in ("-", "") else float(vals[4])
            total = 0.0 if vals[5] in ("-", "") else float(vals[5])
        except (ValueError, IndexError):
            continue
        if total == 0 and gcv == 0 and rev == 0 and term == 0:
            continue
        rows.append({
            "policy_year": yr, "total_premium_paid": prem,
            "guaranteed_cash_value": gcv, "reversionary_bonus": rev,
            "terminal_dividend": term, "total_surrender_value": total,
            "source_page": page_num,
        })
    return rows


def parse_axa_withdrawal(page, page_num):
    """安盛盛利II 提领表 (10列 -> 取 0/1/4/9)

    列映射: 年度 | 保费 | - | - | 提取总额 | 名义金额 | ... | 退保后价值
    """
    rows = []
    txt = page.get_text()
    if "提取款項" not in txt or "退保發還金額" not in txt:
        return rows

    pos_rows = _positional_rows(page)
    for y, items in pos_rows:
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first):
            continue
        if first.startswith("@ANB"):
            continue
        vals = [t.replace(",", "") for _, t in items[:10]]
        if len(vals) < 10:
            continue
        try:
            yr = int(vals[0])
            prem = float(vals[1])
            annual_wd = float(vals[4]) if vals[4] not in ("-", "") else 0.0
            sv_after = float(vals[9]) if vals[9] not in ("-", "") else 0.0
        except (ValueError, IndexError):
            continue
        if annual_wd == 0 and sv_after == 0:
            continue
        rows.append({
            "policy_year": yr, "total_premium_paid": prem,
            "annual_withdrawal": annual_wd,
            "surrender_value_after": sv_after,
            "source_page": page_num,
        })
    return rows


def parse_xinanyi_base(page, page_num):
    """鑫安逸退保表 (4列): 年度 | 保费 | 保证退保价值 | 身故赔偿"""
    rows = []
    txt = page.get_text()
    if "保證退保價值" not in txt or "提取" in txt:
        return rows
    pos_rows = _positional_rows(page)
    for y, items in pos_rows:
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first):
            continue
        vals = [t.replace(",", "") for _, t in items[:4]]
        if len(vals) < 4:
            continue
        try:
            yr = int(vals[0]); prem = float(vals[1])
            gcv = 0.0 if vals[2] in ("-","") else float(vals[2])
        except: continue
        if gcv == 0: continue
        rows.append({
            "policy_year": yr, "total_premium_paid": prem,
            "guaranteed_cash_value": gcv, "reversionary_bonus": 0,
            "terminal_dividend": 0, "total_surrender_value": gcv,
            "source_page": page_num,
        })
    return rows


def _cfyh_yr_idx(vals):
    """判断年度列: 如果前两列都是年份值, col 1 是年度(col 0 是年龄)"""
    if len(vals) >= 2 and vals[0].isdigit() and vals[1].isdigit():
        if 1 <= int(vals[0]) <= 200 and 1 <= int(vals[1]) <= 200:
            return 1  # col 1=保单年度, col 0=年龄
    return 0


def parse_cfyh_base(page, page_num):
    """财富盈活退保表: 12列 = 年龄/年度/保费/保证/归原/终期/总额"""
    rows = []
    txt = page.get_text()
    if "退保发还金额" not in txt and "退保發還金額" not in txt:
        return rows
    if "现金提取" in txt or "提取金额" in txt or "提取款項" in txt:
        return rows
    pos_rows = _positional_rows(page)
    # 跳过列数不足的页(如乐观情景页只有8列可检测)
    data_cols = 0
    count = 0
    for y, items in pos_rows:
        first = items[0][1] if items else ""
        if is_policy_year_cell(first) and not first.startswith("@ANB"):
            n = len([t.replace(",","") for _, t in items])
            if n > data_cols:
                data_cols = n
            count += 1
            if count >= 3:  # 第3行之后看列数
                break
    if data_cols > 0 and data_cols < 9:
        return rows
    for y, items in pos_rows:
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first):
            continue
        vals = [t.replace(",", "") for _, t in items]
        yr_idx = _cfyh_yr_idx(vals)
        yr_str = vals[yr_idx] if yr_idx < len(vals) else vals[0]
        if not yr_str.isdigit(): continue
        yr = int(yr_str)
        if yr <= 0 or yr > 200: continue
        # 12列格式: 年龄/年度/保费/保证/归原/终期/总额/...
        if yr_idx == 1:
            data = vals[2:7]  # skip age col: [prem, gcv, rev, term, total]
        else:
            data = vals[1:6]  # no age col: [prem, gcv, rev, term, total]
        if len(data) < 5: continue
        try:
            prem = float(data[0]); gcv = float(data[1]) if data[1] not in ("-","") else 0
            rev = float(data[2]) if data[2] not in ("-","") else 0
            term = float(data[3]) if data[3] not in ("-","") else 0
            total = float(data[4]) if data[4] not in ("-","") else 0
        except: continue
        if total == 0 and gcv == 0: continue
        rows.append({"policy_year": yr, "total_premium_paid": prem, "guaranteed_cash_value": gcv,
            "reversionary_bonus": rev, "terminal_dividend": term, "total_surrender_value": total, "source_page": page_num})
    return rows


def parse_cfyh_withdrawal(page, page_num):
    """财富盈活提领表: 9列 = 年龄/年度/保费/提取金额/基本金额/保证/归原/终期/总额"""
    rows = []
    txt = page.get_text()
    if "现金提取" not in txt:
        return rows
    pos_rows = _positional_rows(page)
    for y, items in pos_rows:
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first):
            continue
        vals = [t.replace(",", "") for _, t in items]
        yr_idx = 0
        if len(vals) > 1 and vals[0].isdigit() and vals[1].isdigit() and 1 <= int(vals[1]) <= 200:
            yr_idx = 1
        yr_str = vals[yr_idx] if yr_idx < len(vals) else vals[0]
        if not yr_str.isdigit(): continue
        yr = int(yr_str)
        if yr <= 0 or yr > 200: continue
        # 9列格式: 年度后依次为 保费, 提取金额, ..., 退保总额(最后列)
        if len(vals) < 9: continue
        try:
            prem = float(vals[yr_idx+1]) if vals[yr_idx+1] not in ("-","") else 0
            annual_wd = float(vals[yr_idx+2]) if vals[yr_idx+2] not in ("-","") else 0
            sv_after = float(vals[-1]) if vals[-1] not in ("-","") else 0
        except: continue
        if annual_wd > 0 and sv_after > 0:
            rows.append({"policy_year": yr, "total_premium_paid": prem,
                "annual_withdrawal": annual_wd, "surrender_value_after": sv_after, "source_page": page_num})
    return rows


def _run_cfyh(page, page_num, base, after_withdrawal):
    for r in parse_cfyh_base(page, page_num) or []:
        base.append(r)
    for r in parse_cfyh_withdrawal(page, page_num) or []:
        after_withdrawal.append(r)


def _parse_generic_benefit(page, page_num, kw_include, kw_exclude=None):
    """通用位置退保表解析: 取前6列 = 年度/保费/保证/归原/终期/总额"""
    txt = page.get_text()
    if not any(k in txt for k in (kw_include if isinstance(kw_include, (list, tuple)) else [kw_include])):
        return []
    if kw_exclude:
        for k in (kw_exclude if isinstance(kw_exclude, (list, tuple)) else [kw_exclude]):
            if k in txt: return []
    if "提取" in txt:
        return []
    rows = []
    for y, items in _positional_rows(page):
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first) or first.startswith("@ANB"):
            continue
        vals = [t.replace(",", "") for _, t in items]
        yr_idx = 0
        if len(vals) > 2 and vals[0].isdigit() and vals[1].isdigit():
            if 1 <= int(vals[0]) <= 200 and 1 <= int(vals[1]) <= 200:
                yr_idx = 1
        yr_str = vals[yr_idx] if yr_idx < len(vals) else vals[0]
        if not yr_str.isdigit(): continue
        yr = int(yr_str)
        if yr <= 0 or yr > 200: continue
        data = vals[yr_idx+1:yr_idx+6]
        if len(data) < 3: continue
        try:
            prem = float(data[0]) if data[0] not in ("-","") else 0
            gcv = float(data[1]) if len(data) > 1 and data[1] not in ("-","") else 0
            rev = float(data[2]) if len(data) > 2 and data[2] not in ("-","") else 0
            term = float(data[3]) if len(data) > 3 and data[3] not in ("-","") else 0
            total = float(data[4]) if len(data) > 4 and data[4] not in ("-","") else 0
        except: continue
        if total == 0 and gcv == 0: continue
        rows.append({"policy_year": yr, "total_premium_paid": prem,
            "guaranteed_cash_value": gcv, "reversionary_bonus": rev,
            "terminal_dividend": term, "total_surrender_value": total,
            "source_page": page_num})
    return rows


def _parse_generic_withdrawal(page, page_num, kw):
    """通用提领表解析: 找年度后第3-4列的提取金额和最后列退保价值"""
    txt = page.get_text()
    if kw not in txt: return []
    rows = []
    for y, items in _positional_rows(page):
        first = items[0][1] if items else ""
        if not is_policy_year_cell(first) or first.startswith("@ANB"): continue
        vals = [t.replace(",", "") for _, t in items]
        yr_idx = 0
        if len(vals) > 2 and vals[0].isdigit() and vals[1].isdigit():
            if 1 <= int(vals[0]) <= 200 and 1 <= int(vals[1]) <= 200:
                yr_idx = 1
        yr_str = vals[yr_idx] if yr_idx < len(vals) else vals[0]
        if not yr_str.isdigit(): continue
        yr = int(yr_str)
        if yr <= 0 or yr > 200: continue
        data = vals[yr_idx+1:]
        if len(data) < 3: continue
        try:
            prem = float(data[0]) if data[0] not in ("-","") else 0
            annual_wd = 0; sv_after = 0
            for i in range(1, len(data)-1):
                v = float(data[i]) if data[i] not in ("-","") else 0
                if v > 0 and annual_wd == 0 and i < len(data) - 2:
                    annual_wd = v
            for i in range(len(data)-1, 1, -1):
                v = float(data[i]) if data[i] not in ("-","") else 0
                if v > 0 and v > annual_wd:
                    sv_after = v; break
        except: continue
        if annual_wd > 0 and sv_after > 0:
            rows.append({"policy_year": yr, "total_premium_paid": prem,
                "annual_withdrawal": annual_wd, "surrender_value_after": sv_after, "source_page": page_num})
    return rows


def _run_qihang(page, page_num, base, after_withdrawal):
    """启航创富: 8列 = 年度/保费/保证/归原/总额/身故..."""
    txt = page.get_text()
    if "退保保障" not in txt or "提取" in txt:
        pass
    else:
        for y, items in _positional_rows(page):
            first = items[0][1] if items else ""
            if not is_policy_year_cell(first) or first.startswith("@ANB"): continue
            vals = [t.replace(",", "") for _, t in items]
            yr_str = vals[0]
            if not yr_str.isdigit(): continue
            yr = int(yr_str)
            if yr <= 0 or yr > 200: continue
            if len(vals) < 5: continue
            try:
                prem = float(vals[1]); gcv = float(vals[2]) if vals[2] not in ("-","") else 0
                rev = float(vals[3]) if vals[3] not in ("-","") else 0
                total = float(vals[4]) if vals[4] not in ("-","") else 0
            except: continue
            if total == 0: continue
            base.append({"policy_year": yr, "total_premium_paid": prem,
                "guaranteed_cash_value": gcv, "reversionary_bonus": rev,
                "terminal_dividend": 0, "total_surrender_value": total, "source_page": page_num})
    for r in _parse_generic_withdrawal(page, page_num, "现金提取金额"):
        after_withdrawal.append(r)


def _run_hongzhi(page, page_num, base, after_withdrawal):
    """宏挚传承: 退保表P4-8(8列), 提领表P10-14(9列)"""
    txt = page.get_text()
    # === 不提领: P4-8, 8列 = 年度/保费/保证/归原/总额 ===
    if "退保價值" in txt and "提取" not in txt and "該年提取" not in txt and "不同投資回報" not in txt:
        for y, items in _positional_rows(page):
            first = items[0][1] if items else ""
            if not is_policy_year_cell(first) or first.startswith("@ANB"): continue
            vals = [t.replace(",", "") for _, t in items]
            yr_str = vals[0]
            if not yr_str.isdigit(): continue
            yr = int(yr_str)
            if yr <= 0 or yr > 200: continue
            if len(vals) < 5: continue
            try:
                prem = float(vals[1]); gcv = float(vals[2]) if vals[2] not in ("-","") else 0
                rev = float(vals[3]) if vals[3] not in ("-","") else 0
                total = float(vals[4]) if vals[4] not in ("-","") else 0
            except: continue
            if total == 0: continue
            base.append({"policy_year": yr, "total_premium_paid": prem,
                "guaranteed_cash_value": gcv, "reversionary_bonus": rev,
                "terminal_dividend": 0, "total_surrender_value": total, "source_page": page_num})
    # === 提领: P10-14, 9列 = 年度/保费/.../提取总额/.../退保后总额 ===
    if "該年提取款項" in txt and "退保價值" in txt and "悲觀情景" not in txt and "樂觀情景" not in txt and "不同投資回報" not in txt:
        for y, items in _positional_rows(page):
            first = items[0][1] if items else ""
            if not is_policy_year_cell(first) or first.startswith("@ANB"): continue
            vals = [t.replace(",", "") for _, t in items]
            if len(vals) < 9: continue
            yr_str = vals[0]
            if not yr_str.isdigit(): continue
            yr = int(yr_str)
            if yr <= 0 or yr > 200: continue
            try:
                prem = float(vals[1])
                # 提取金额取第5列(总额A+B), 退保后价值取第9列
                annual_wd = float(vals[4]) if vals[4] not in ("-","") else 0
                sv_after = float(vals[8]) if vals[8] not in ("-","") else 0
            except: continue
            if sv_after > 0:
                after_withdrawal.append({"policy_year": yr, "total_premium_paid": prem,
                    "annual_withdrawal": annual_wd, "surrender_value_after": sv_after, "source_page": page_num})


def _run_jiangxin(page, page_num, base, after_withdrawal):
    """匠心飞越: 退保表P26-29(7列), 提领表P34-37(12列)"""
    txt = page.get_text()
    # === 不提领 ===
    if "退保发还金额" in txt and "提取金额" not in txt:
        for y, items in _positional_rows(page):
            first = items[0][1] if items else ""
            if not is_policy_year_cell(first) or first.startswith("@ANB"): continue
            vals = [t.replace(",", "") for _, t in items]
            yr_idx = 0
            if len(vals) > 2 and vals[0].isdigit() and vals[1].isdigit():
                if 1 <= int(vals[0]) <= 200 and 1 <= int(vals[1]) <= 200:
                    yr_idx = 1
            yr_str = vals[yr_idx] if yr_idx < len(vals) else vals[0]
            if not yr_str.isdigit(): continue
            yr = int(yr_str)
            if yr <= 0 or yr > 200: continue
            needed = vals[2:7] if len(vals) >= 7 else []
            if len(needed) < 5: continue
            try:
                prem = float(needed[0]) if needed[0] not in ("-","") else 0
                gcv = float(needed[1]) if needed[1] not in ("-","") else 0
                rev = float(needed[2]) if needed[2] not in ("-","") else 0
                term = float(needed[3]) if needed[3] not in ("-","") else 0
                total = float(needed[4]) if needed[4] not in ("-","") else 0
            except: continue
            if total == 0: continue
            base.append({"policy_year": yr, "total_premium_paid": prem,
                "guaranteed_cash_value": gcv, "reversionary_bonus": rev,
                "terminal_dividend": term, "total_surrender_value": total, "source_page": page_num})
    # === 提领: P34-37, 12列 = 年龄/年度/保费/提取金额/已提取总额/.../退保总额 ===
    if "提取金额" in txt and "退保发还金额" in txt:
        for y, items in _positional_rows(page):
            first = items[0][1] if items else ""
            if not is_policy_year_cell(first) or first.startswith("@ANB"): continue
            vals = [t.replace(",", "") for _, t in items]
            if len(vals) < 10: continue
            # 第1列=年龄, 第2列=保单年度
            yr_str = vals[1] if vals[1].isdigit() and 1 <= int(vals[1]) <= 200 else vals[0]
            if not yr_str.isdigit(): continue
            yr = int(yr_str)
            if yr <= 0 or yr > 200: continue
            try:
                prem = float(vals[2]) if vals[2] not in ("-","") else 0
                annual_wd = float(vals[3]) if vals[3] not in ("-","") else 0  # 第4列=提取金额
                sv_after = float(vals[9]) if vals[9] not in ("-","") else 0  # 第10列=退保总额
            except: continue
            if annual_wd > 0 and sv_after > 0:
                after_withdrawal.append({"policy_year": yr, "total_premium_paid": prem,
                    "annual_withdrawal": annual_wd, "surrender_value_after": sv_after, "source_page": page_num})


def parse_chinalife_base(page, page_num):
    """中国人寿退保表: 每年6行(年份+保费+保证+归原+终期+总额)"""
    rows = []
    txt = page.get_text()
    if "退保發還金額" not in txt:
        return rows
    lines = txt.split("\n")
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        if s.isdigit() and 1 <= int(s) <= 200:
            yr = int(s)
            vals = []
            for j in range(6):
                if i+j < len(lines):
                    v = lines[i+j].strip().replace(",","")
                    vals.append(v)
                else:
                    break
            if len(vals) >= 6:
                try:
                    paid = float(vals[1])
                    guar = float(vals[2])
                    bonus = float(vals[3])
                    div = float(vals[4])
                    total = float(vals[5])
                except (ValueError, IndexError):
                    i += 1; continue
                rows.append({
                    "policy_year": yr, "total_premium_paid": paid,
                    "guaranteed_cash_value": guar, "reversionary_bonus": bonus,
                    "terminal_dividend": div, "total_surrender_value": total,
                    "source_page": page_num,
                })
            i += 6
        else:
            i += 1
    return rows


def parse_taiping_withdrawal(page, page_num):
    """太平保险9列提领表: 列2=提取金额, 列8=退保后价值"""
    rows = []
    with contextlib.redirect_stdout(io.StringIO()):
        tables = page.find_tables().tables
    for table in tables:
        extracted = table.extract()
        if len(extracted[0]) not in (9,):
            continue
        hdr = " ".join(str(c) for c in extracted[0])
        if "提取" not in hdr:
            continue
        for row_data in extracted[3:]:
            vals = [str(c).strip().replace(",","") for c in row_data]
            if not vals or not vals[0].isdigit():
                continue
            yr = int(vals[0])
            if yr <= 0 or yr > 200:
                continue
            try:
                prem = float(vals[1]) if vals[1] else 0
                wd = float(vals[2]) if vals[2] else 0
                sv = float(vals[8]) if len(vals) > 8 and vals[8] else 0
            except (ValueError, IndexError):
                continue
            if wd > 0 or sv > 0:
                rows.append({
                    "policy_year": yr,
                    "total_premium_paid": prem,
                    "annual_withdrawal": wd,
                    "surrender_value_after": sv,
                })
    return rows


def parse_chinalife_withdrawal(page, page_num):
    """中国人寿提领表(竖排): 年龄/年份行+7个值"""
    rows = []
    txt = page.get_text()
    if "現金提取後之退保發還金額" not in txt:
        return rows
    lines = [l.strip() for l in txt.split("\n")]
    i = 0
    while i < len(lines):
        s = lines[i]
        if "/" in s and ("歲" in s or "岁" in s):
            yr_str = s.split("/")[0].strip()
            if not yr_str.isdigit():
                i += 1; continue
            yr = int(yr_str)
            if yr <= 0 or yr > 200:
                i += 1; continue
            vals = []
            for j in range(1, 8):
                if i+j < len(lines):
                    v = lines[i+j].replace(",","").strip()
                    vals.append(v)
                else:
                    break
            if len(vals) >= 7:
                try:
                    prem = float(vals[0])  # premium
                    wd = float(vals[2])    # withdrawal amount at index 2
                    sv = float(vals[6])    # surrender after at index 6
                except (ValueError, IndexError):
                    i += 1; continue
                rows.append({
                    "policy_year": yr,
                    "total_premium_paid": prem,
                    "annual_withdrawal": wd,
                    "surrender_value_after": sv,
                })
            i += 8
        else:
            i += 1
    return rows


def parse_taiping_base(page, page_num):
    """太平保险7列表格: 年度/保费/保证/归原/终期/额外终期/总额"""
    rows = []
    with contextlib.redirect_stdout(io.StringIO()):
        tables = page.find_tables().tables
    for table in tables:
        extracted = table.extract()
        if len(extracted[0]) not in (7,):
            continue
        # Check header for 退保权益
        hdr = " ".join(str(c) for c in extracted[0])
        if "退保" not in hdr:
            continue
        for row_data in extracted[3:]:
            vals = [str(c).strip().replace(",","") for c in row_data]
            if not vals or not vals[0]:
                continue
            yr_str = vals[0].replace("歲","").replace("岁","")
            if not yr_str.isdigit():
                continue
            yr = int(yr_str)
            if yr <= 0 or yr > 200:
                continue
            try:
                prem = float(vals[1]) if vals[1] else 0
                guar = float(vals[2]) if vals[2] else 0
                bonus = float(vals[3]) if vals[3] else 0
                div = float(vals[4]) if vals[4] else 0
                extra = float(vals[5]) if vals[5] else 0
                total = float(vals[6]) if vals[6] else 0
            except (ValueError, IndexError):
                continue
            rows.append({
                "policy_year": yr,
                "total_premium_paid": prem,
                "guaranteed_cash_value": guar,
                "reversionary_bonus": bonus,
                "terminal_dividend": div + extra,
                "total_surrender_value": total,
                "source_page": page_num,
            })
    return rows


def parse_ci_benefit(page, page_num):
    """提取重疾险利益演示表: 9列表格, 第8列=身故赔偿总额"""
    rows = []
    with contextlib.redirect_stdout(io.StringIO()):
        tables = page.find_tables().tables
    for table in tables:
        extracted = table.extract()
        if not extracted or len(extracted[0]) < 9:
            continue
        # 检测表头含"退保发还金额"和"身故赔偿额"
        header_text = "".join(str(c) for c in extracted[0] if c)
        if "退保发还金额" not in header_text or "身故赔偿额" not in header_text:
            continue
        # CI 表: [年龄, 保单年度, 缴付保费, 保证, 终期, 退保总额, 身故保证, 身故终期, 身故总额]
        for age, year, paid, gcv, term, sv, db_g, db_t, db_total in table_rows(
            table, [0, 1, 2, 3, 4, 5, 6, 7, 8]
        ):
            year_num = integer(year)
            if year_num <= 0:
                continue
            rows.append({
                "policy_year": year_num,
                "age": integer(age),
                "total_premium_paid": number(paid),
                "death_benefit": number(db_total),
                "source_page": page_num,
            })
    return rows


# ── 产品类型识别 ──────────────────────────────────
PRODUCT_KEYWORDS: list[tuple[str, str]] = [
    ("pru", "明天多元貨幣"),
    ("ctf", "匠心"),
    ("aia-huanyu", "環宇盈活"),
    ("cpic", "世代悅享3"),
    ("chinalife", "傲瓏"),
    ("china-taiping", "頤年樂享"),
    ("axa", "WEB05"),
    ("xinanyi", "AAXNA1U"),
    ("cfyh", "盈活储蓄"),
    ("qihang", "WPD"),
    ("hongzhi", "2606171"),
    ("hongzhi", "家傳承保險計劃"),
    ("jiangxin", "MW3U"),
]


def _identify_doc_type(full_text: str) -> str | None:
    """扫描全文识别产品类型, 返回 doc_type 或 None"""
    for doc_type, kw in PRODUCT_KEYWORDS:
        if kw in full_text:
            return doc_type
    return None


# ── 产品专用解析路由器 ──────────────────────────────

def _run_pru(page, page_num, base, after_withdrawal):
    for r in parse_pru_base(page, page_num) or []:
        base.append(r)
    for r in parse_pru_withdrawal(page, page_num) or []:
        after_withdrawal.append(r)


def _run_ctf(page, page_num, text, base, after_withdrawal):
    for r in parse_ctf_base_surrender_text(page, page_num) or []:
        base.append(r)
    for r in parse_ctf_base_death_text(page, page_num) or []:
        base.append(r)
    for r in parse_ctf_withdrawal_surrender_text(page, page_num, base) or []:
        after_withdrawal.append(r)


def _run_cpic(page, page_num, base, after_withdrawal):
    for r in parse_cpic_base(page, page_num) or []:
        base.append(r)
    for r in parse_cpic_withdrawal(page, page_num) or []:
        after_withdrawal.append(r)


def _run_aia_huanyu(page, page_num, base, after_withdrawal):
    for r in parse_aia_huanyu_base_text(page, page_num) or []:
        base.append(r)
    # AIA 环宇盈活无专用提领解析器, 提领数据由通用解析器处理


def _run_chinalife(page, page_num, base, after_withdrawal):
    for r in parse_chinalife_base(page, page_num) or []:
        base.append(r)
    for r in parse_chinalife_withdrawal(page, page_num) or []:
        after_withdrawal.append(r)


def _run_axa(page, page_num, base, after_withdrawal):
    for r in parse_axa_base(page, page_num) or []:
        base.append(r)
    for r in parse_axa_withdrawal(page, page_num) or []:
        after_withdrawal.append(r)


def _run_xinanyi(page, page_num, base, after_withdrawal):
    for r in parse_xinanyi_base(page, page_num) or []:
        base.append(r)


def _run_cfyh(page, page_num, base, after_withdrawal):
    for r in parse_cfyh_base(page, page_num) or []:
        base.append(r)
    for r in parse_cfyh_withdrawal(page, page_num) or []:
        after_withdrawal.append(r)


def _run_taiping(page, page_num, base, after_withdrawal):
    for r in parse_taiping_base(page, page_num) or []:
        base.append(r)
    for r in parse_taiping_withdrawal(page, page_num) or []:
        after_withdrawal.append(r)


def _run_fallback_all(page, page_num, text, base, after_withdrawal, withdrawal_amounts):
    """未识别产品/无专用解析器的兜底路径: 跑所有解析器 + 通用解析"""
    # 永远不用悲观/乐观情景数据
    if "悲觀情景" in text or "樂觀情景" in text or "悲观情景" in text or "乐观情景" in text or "不同投資回報" in text:
        return
    matched_specific = False

    # 专用解析器 (按产品)
    for fn, args in [
        (parse_ctf_base_surrender_text, (page, page_num)),
        (parse_ctf_base_death_text, (page, page_num)),
        (parse_cpic_base, (page, page_num)),
        (parse_pru_base, (page, page_num)),
        (parse_aia_huanyu_base_text, (page, page_num)),
        (parse_chinalife_base, (page, page_num)),
        (parse_taiping_base, (page, page_num)),
    ]:
        rows = fn(*args)
        if rows:
            base.extend(rows)
            matched_specific = True

    # 专用提领解析器
    for fn, args in [
        (parse_taiping_withdrawal, (page, page_num)),
        (parse_chinalife_withdrawal, (page, page_num)),
        (parse_cpic_withdrawal, (page, page_num)),
        (parse_pru_withdrawal, (page, page_num)),
    ]:
        rows = fn(*args)
        if rows:
            after_withdrawal.extend(rows)
            matched_specific = True

    # CTF 提领 (需要 base 引用)
    for r in parse_ctf_withdrawal_surrender_text(page, page_num, base) or []:
        after_withdrawal.append(r)
        if r:
            matched_specific = True

    # 通用解析: 仅当该页无专用解析器命中时才跑
    if not matched_specific:
        # 跳过含"提取"的页(该页数据已由提领解析器处理)
        if "提取" not in text:
            if ("退保" in text or "现金价值" in text or "現金價值" in text) and ("说明摘要" in text or "說明摘要" in text or "保单年度" in text):
                base.extend(parse_base(page, page_num))
        if "现金提取举例" in text and "细分之保证及非保证现金提取金额" in text:
            withdrawal_amounts.extend(parse_withdrawal_amounts(page, page_num))
        # 通用提领表检测
        if not any(row["policy_year"] >= 99 for row in after_withdrawal):
            for t in page.find_tables().tables:
                hdr_text = " ".join(str(c) for c in t.extract()[0])
                if "提取" in hdr_text and "保单年度" in hdr_text:
                    wd_rows = parse_merged_withdrawal(t)
                    if wd_rows:
                        after_withdrawal.extend(wd_rows)
                        break
        if "现金提取后之退保发还金额" in text and not any(row["policy_year"] >= 99 for row in after_withdrawal):
            after_withdrawal.extend(parse_after_withdrawal(page, page_num))


# ── 主函数 ──────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    args = parser.parse_args()

    pdf = Path(args.pdf).resolve()
    doc = fitz.open(pdf)
    base = []
    ci_base = []
    withdrawal_amounts = []
    after_withdrawal = []

    doc_type = _identify_doc_type("".join(p.get_text() for p in doc))
    if doc_type:
        print(f"[fitz] 识别产品类型: {doc_type}", file=__import__("sys").stderr)

    for index, page in enumerate(doc):
        page_num = index + 1
        text = page.get_text()

        # 永远不用悲观/乐观情景数据
        if "悲觀情景" in text or "樂觀情景" in text or "悲观情景" in text or "乐观情景" in text or "不同投資回報" in text:
            continue

        # CI 解析 (对所有文档都跑, 独立的 ci_base)
        ci_base.extend(parse_ci_benefit(page, page_num))

        # 按产品类型路由
        if doc_type == "pru":
            _run_pru(page, page_num, base, after_withdrawal)
        elif doc_type == "ctf":
            _run_ctf(page, page_num, text, base, after_withdrawal)
        elif doc_type == "cpic":
            _run_cpic(page, page_num, base, after_withdrawal)
        elif doc_type == "aia-huanyu":
            _run_aia_huanyu(page, page_num, base, after_withdrawal)
        elif doc_type == "chinalife":
            _run_chinalife(page, page_num, base, after_withdrawal)
        elif doc_type == "china-taiping":
            _run_taiping(page, page_num, base, after_withdrawal)
        elif doc_type == "axa":
            _run_axa(page, page_num, base, after_withdrawal)
        elif doc_type == "xinanyi":
            _run_xinanyi(page, page_num, base, after_withdrawal)
        elif doc_type == "cfyh":
            _run_cfyh(page, page_num, base, after_withdrawal)
        elif doc_type == "qihang":
            _run_qihang(page, page_num, base, after_withdrawal)
        elif doc_type == "hongzhi":
            _run_hongzhi(page, page_num, base, after_withdrawal)
        elif doc_type == "jiangxin":
            _run_jiangxin(page, page_num, base, after_withdrawal)
        else:
            _run_fallback_all(page, page_num, text, base, after_withdrawal, withdrawal_amounts)

    base = dedupe(base)
    withdrawal_amounts = dedupe(withdrawal_amounts)
    after_withdrawal = dedupe(after_withdrawal)
    # 计算累计提领（跨页面统一计算）
    after_withdrawal.sort(key=lambda x: x["policy_year"])
    running_cum = 0
    for r in after_withdrawal:
        running_cum += r.get("annual_withdrawal", 0)
        r["total_withdrawn"] = running_cum

    amount_by_year = {row["policy_year"]: row for row in withdrawal_amounts}

    withdrawal = []
    for row in after_withdrawal:
        annual = row["annual_withdrawal"] or amount_by_year.get(row["policy_year"], {}).get("annual_withdrawal", 0)
        cumulative = row.get("total_withdrawn", 0) or amount_by_year.get(row["policy_year"], {}).get("total_withdrawn", 0)
        withdrawal.append({
            **row,
            "annual_withdrawal": annual,
            "total_withdrawn": cumulative,
        })

    print(json.dumps({
        "parser": "fitz-table-v1",
        "pdf": str(pdf),
        "total_pages": len(doc),
        "benefit_illustration": base,
        "ci_benefit_illustration": dedupe(ci_base),
        "withdrawal_illustration": withdrawal,
        "withdrawal_amounts": withdrawal_amounts,
    }, ensure_ascii=False))


# ── 自动解析器学习系统 ──────────────────────────────
# 当新产品无专用解析器时, 自动分析PDF结构并生成解析器


def _detect_table_type(extracted):
    """根据表格表头检测类型: 'benefit', 'withdrawal', 或 None"""
    if not extracted:
        return None
    hdr = " ".join(str(c) for c in extracted[0])
    if "提取" in hdr:
        return "withdrawal"
    if "退保" in hdr or "退保價值" in hdr or "退保发还金额" in hdr or "現金價值" in hdr:
        return "benefit"
    return None


def _detect_column_mapping(extracted):
    """自动检测列映射: 返回 {col_index: field_name}"""
    n_cols = len(extracted[0])
    hdr_str = " ".join(str(c) for c in extracted[0])
    mapping = {}

    if n_cols >= 6:
        mapping[0] = "policy_year"  # 年度
        mapping[1] = "total_premium_paid"  # 保费
        # 前6列: 年度/保费 + 4个退保值
        if n_cols <= 9:
            mapping[2] = "guaranteed_cash_value"
            mapping[3] = "reversionary_bonus"
            mapping[4] = "total_surrender_value"
        else:  # ≥10列(含终期红利)
            mapping[2] = "guaranteed_cash_value"
            mapping[3] = "reversionary_bonus"
            mapping[4] = "terminal_dividend"
            mapping[5] = "total_surrender_value"
    return mapping


def _detect_yr_idx(page):
    """检测是否有年龄列(返回1)或直接年度列(返回0)"""
    pos = _positional_rows(page)
    for y, items in pos:
        first = items[0][1] if items else ""
        if is_policy_year_cell(first):
            vals = [t.replace(",", "") for _, t in items]
            if len(vals) >= 2 and vals[0].isdigit() and vals[1].isdigit():
                a, b = int(vals[0]), int(vals[1])
                if 1 <= a <= 200 and 1 <= b <= 200:
                    return 1  # 年龄+年度双列
            return 0
    return 0


def auto_learn_parser(pdf_path):
    """自动分析PDF, 生成解析器规格和代码

    Returns:
        dict: {doc_type, keyword, benefit_cols, withdrawal_cols, code}
    """
    import fitz
    doc = fitz.open(pdf_path)
    full_text = "".join(p.get_text() for p in doc)

    # 1. 找产品标识关键词(取首页短的产品名)
    keywords = []
    for line in doc[0].get_text().split("\n"):
        line = line.strip()
        if 4 <= len(line) <= 30 and any(ord(c) > 127 for c in line):
            if any(k in line for k in ["計劃", "计划", "保障", "储蓄", "儲蓄", "保险", "保險"]):
                keywords.append(line)
    # 按长度排序, 取最短的(通常是产品名)
    keywords.sort(key=len)
    best_keyword = keywords[0] if keywords else ""

    # 2. 扫描所有页分析表结构
    benefit_pages = []
    withdrawal_pages = []
    benefit_cols = 0
    withdrawal_cols = 0

    for idx, page in enumerate(doc):
        page_num = idx + 1
        tables = page.find_tables().tables
        if not tables:
            continue

        extracted = tables[0].extract()
        ttype = _detect_table_type(extracted)
        n_cols = len(extracted[0])

        if ttype == "benefit" and n_cols > benefit_cols:
            benefit_pages.append(page_num)
            benefit_cols = n_cols
        elif ttype == "withdrawal" and n_cols > withdrawal_cols:
            withdrawal_pages.append(page_num)
            withdrawal_cols = n_cols

    # 3. 生成列映射
    benefit_mapping = {}
    if benefit_cols >= 6:
        benefit_mapping = {0: "year", 1: "premium"}
        if benefit_cols <= 9:
            benefit_mapping.update({2: "gcv", 3: "rev", 4: "total"})
        else:
            benefit_mapping.update({2: "gcv", 3: "rev", 4: "term", 5: "total"})

    withdrawal_mapping = {}
    if withdrawal_cols >= 9:
        withdrawal_mapping = {0: "year", 1: "premium", 4: "wd", "last": "sv"}
    elif withdrawal_cols >= 6:
        withdrawal_mapping = {0: "year", 1: "premium", "wd_pos": 3, "sv_pos": "last"}

    # 4. 生成产品标识符
    doc_type = "auto_" + best_keyword.replace(" ", "_").replace("（", "").replace("）", "")[:20]
    # 5. 检测年龄列(在close之前)
    yr_idx = _detect_yr_idx(doc[benefit_pages[0]-1]) if benefit_pages else 0
    doc.close()
    return {
        "doc_type": doc_type,
        "keyword": best_keyword[:30] if best_keyword else "",
        "benefit_cols": benefit_cols,
        "withdrawal_cols": withdrawal_cols,
        "benefit_pages": benefit_pages[:5],
        "withdrawal_pages": withdrawal_pages[:5],
        "has_age_col": yr_idx,
        "parser_verified": False,
        "auto_generated": True,
    }


def auto_generate_parser_code(spec):
    """根据解析器规格生成Python代码"""
    doc_type = spec["doc_type"]
    keyword = spec["keyword"]
    bcols = spec["benefit_cols"]
    wcols = spec["withdrawal_cols"]
    has_age = spec["has_age_col"]

    lines = []
    lines.append(f"\n# ⚠️ 自动生成的解析器 - 未经校核 - 请管理员核实数据准确性")
    lines.append(f"# 产品关键词: {keyword}")
    lines.append(f"# 检测时间: 系统自动")
    lines.append(f"def parse_{doc_type}_base(page, page_num):")
    lines.append(f'    """⚠️ 自动生成(cols={bcols}) - 解析器未经校核，请管理员校核"""')
    lines.append(f'    rows = []')
    lines.append(f'    txt = page.get_text()')
    if keyword:
        lines.append(f'    if "{keyword}" not in txt: return rows')
    lines.append(f'    if "提取" in txt: return rows')
    lines.append('    for y, items in _positional_rows(page):')
    lines.append('        first = items[0][1] if items else ""')
    lines.append('        if not is_policy_year_cell(first) or first.startswith("@ANB"): continue')
    lines.append('        vals = [t.replace(",", "") for _, t in items]')

    if has_age:
        lines.append('        yr_idx = 1 if len(vals) > 1 and vals[1].isdigit() and 1 <= int(vals[1]) <= 200 else 0')
        lines.append('        yr_str = vals[yr_idx]')
        lines.append('        if not yr_str.isdigit(): continue')
        lines.append('        yr = int(yr_str)')
        lines.append('        if yr <= 0 or yr > 200: continue')
        lines.append(f'        data = vals[yr_idx+1:yr_idx+{bcols-1}]')
    else:
        lines.append('        yr_str = vals[0]')
        lines.append('        if not yr_str.isdigit(): continue')
        lines.append('        yr = int(yr_str)')
        lines.append(f'        data = vals[1:{bcols}]')

    if bcols <= 9:
        lines.append('        if len(data) < 4: continue')
        lines.append('        try:')
        lines.append('            prem = float(data[0]) if data[0] not in ("-","") else 0')
        lines.append('            gcv = float(data[1]) if data[1] not in ("-","") else 0')
        lines.append('            rev = float(data[2]) if data[2] not in ("-","") else 0')
        lines.append('            total = float(data[3]) if data[3] not in ("-","") else 0')
        lines.append('        except: continue')
        lines.append('        if total == 0: continue')
        lines.append('        rows.append({"policy_year": yr, "total_premium_paid": prem,')
        lines.append('            "guaranteed_cash_value": gcv, "reversionary_bonus": rev,')
        lines.append('            "terminal_dividend": 0, "total_surrender_value": total,')
        lines.append('            "source_page": page_num})')
    else:
        lines.append('        if len(data) < 5: continue')
        lines.append('        try:')
        lines.append('            prem = float(data[0]) if data[0] not in ("-","") else 0')
        lines.append('            gcv = float(data[1]) if data[1] not in ("-","") else 0')
        lines.append('            rev = float(data[2]) if data[2] not in ("-","") else 0')
        lines.append('            term = float(data[3]) if data[3] not in ("-","") else 0')
        lines.append('            total = float(data[4]) if data[4] not in ("-","") else 0')
        lines.append('        except: continue')
        lines.append('        if total == 0: continue')
        lines.append('        rows.append({"policy_year": yr, "total_premium_paid": prem,')
        lines.append('            "guaranteed_cash_value": gcv, "reversionary_bonus": rev,')
        lines.append('            "terminal_dividend": term, "total_surrender_value": total,')
        lines.append('            "source_page": page_num})')

    lines.append('    return rows')
    lines.append('')

    if wcols >= 9:
        pfx = doc_type
        lines.append(f'\ndef parse_{pfx}_withdrawal(page, page_num):')
        lines.append(f'    """自动生成: 提领"""')
        lines.append('    rows = []; txt = page.get_text()')
        lines.append('    if "提取" not in txt: return rows')
        lines.append('    for y, items in _positional_rows(page):')
        lines.append('        first = items[0][1] if items else ""')
        lines.append('        if not is_policy_year_cell(first) or first.startswith("@ANB"): continue')
        lines.append('        vals = [t.replace(",", "") for _, t in items]')
        if has_age:
            lines.append('        yr_idx = 1 if len(vals) > 1 and vals[1].isdigit() and 1 <= int(vals[1]) <= 200 else 0')
        lines.append('        yr_str = vals[1] if len(vals) > 1 and vals[1].isdigit() and 1 <= int(vals[1]) <= 200 else vals[0]')
        lines.append('        if not yr_str.isdigit(): continue')
        lines.append('        yr = int(yr_str)')
        lines.append('        if yr <= 0 or yr > 200: continue')
        lines.append('        if len(vals) < 9: continue')
        lines.append('        try:')
        lines.append('            prem = float(vals[1]) if vals[1] not in ("-","") else 0')
        lines.append('            annual_wd = float(vals[4]) if vals[4] not in ("-","") else 0')
        lines.append('            sv_after = float(vals[-1]) if vals[-1] not in ("-","") else 0')
        lines.append('        except: continue')
        lines.append('        if annual_wd > 0 and sv_after > 0:')
        lines.append('            rows.append({"policy_year": yr, "total_premium_paid": prem,')
        lines.append('                "annual_withdrawal": annual_wd, "surrender_value_after": sv_after,')
        lines.append('                "source_page": page_num})')
        lines.append('    return rows')

    return "\n".join(lines)


if __name__ == "__main__":
    main()
