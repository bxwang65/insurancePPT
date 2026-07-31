"""
pdfplumber 直接表格提取器
绕过AI, 直接从PDF提取保险利益演示表数据
"""
import pdfplumber
from typing import Dict, List, Optional, Tuple


def extract_savings_table(pdf_path: str) -> Tuple[Dict[int, Dict], Dict[int, Dict]]:
    """
    从储蓄险PDF提取不提领表和提领表

    返回: (no_withdraw, withdraw)
    no_withdraw: {Y: {Paid, Guar_CV, Rev, Term, Total}}
    withdraw: {Y: {Paid, Annual_WD, Cum_WD, Total}}
    """
    no_withdraw = {}
    withdraw = {}

    with pdfplumber.open(pdf_path) as pdf:
        for page_idx in range(min(len(pdf.pages), 30)):
            tables = pdf.pages[page_idx].extract_tables()
            for t in tables:
                if len(t) < 4:
                    continue

                # Detect table type from header
                header_text = ''
                for r in t[:3]:
                    for c in r:
                        if c: header_text += c

                is_surrender = '退保' in header_text or '退保价值' in header_text or '现金价值' in header_text
                is_withdraw = '提款' in header_text or '提取' in header_text or '款項提取' in header_text

                if not is_surrender and not is_withdraw:
                    continue

                # Parse rows
                for ri, r in enumerate(t):
                    if ri < 3:
                        continue  # skip header

                    # Handle multi-value cells (compressed table)
                    cells = []
                    for c in r:
                        if c and '\n' in c:
                            cells.append([v.strip() for v in c.split('\n') if v.strip()])
                        elif c and c.strip():
                            cells.append([c.strip()])
                        else:
                            cells.append([])

                    max_rows = max(len(v) for v in cells) if cells else 0
                    if max_rows == 0:
                        continue

                    # 校验: 所有列的值数量必须一致, 否则只取第一行
                    value_counts = [len(v) for v in cells if v]
                    aligned = len(set(value_counts)) == 1 if value_counts else True

                    for row_idx in range(max_rows if aligned else 1):
                        try:
                            y_str = cells[0][row_idx] if row_idx < len(cells[0]) else ''
                            y_clean = y_str.replace('岁', '').strip().replace(',', '')
                            if not y_clean.isdigit():
                                continue
                            y = int(y_clean)
                            if y < 1 or y > 150:
                                continue
                        except (ValueError, IndexError):
                            continue

                        try:
                            paid_str = cells[1][row_idx] if row_idx < len(cells[1]) else '0'
                            paid = int(paid_str.replace(',', ''))
                        except:
                            paid = 0

                        if is_surrender and not is_withdraw:
                            # Surrender table: 保证(A), 复归(B), 终期(C), 总额(A+B+C)
                            try:
                                guar = int(cells[2][row_idx].replace(',','')) if row_idx < len(cells[2]) else 0
                            except: guar = 0
                            try:
                                rev = int(cells[3][row_idx].replace(',','')) if row_idx < len(cells[3]) else 0
                            except: rev = 0
                            try:
                                term = int(cells[4][row_idx].replace(',','')) if row_idx < len(cells[4]) else 0
                            except: term = 0
                            try:
                                total = int(cells[5][row_idx].replace(',','')) if row_idx < len(cells[5]) else 0
                            except: total = 0

                            if y not in no_withdraw:
                                no_withdraw[y] = {
                                    'Y': y, 'Paid': paid, 'Guar_CV': guar,
                                    'Rev': rev, 'Term': term, 'Total': total if total > 0 else guar + rev + term
                                }

                        elif is_withdraw:
                            # Withdraw table format varies
                            # Try to extract annual withdrawal and surrender value after
                            try:
                                annual_wd = int(cells[2][row_idx].replace(',','')) if row_idx < len(cells[2]) else 0
                            except: annual_wd = 0
                            try:
                                sv_after = int(cells[3][row_idx].replace(',','')) if row_idx < len(cells[3]) else 0
                            except: sv_after = 0

                            if y not in withdraw and annual_wd >= 0:
                                withdraw[y] = {
                                    'Y': y, 'Age': y, 'Paid': paid, 'Annual_WD': annual_wd,
                                    'Cum_WD': 0, 'Total': sv_after
                                }

    # Calculate cumulative withdrawal
    sorted_y = sorted(withdraw.keys())
    cum = 0
    for y in sorted_y:
        cum += withdraw[y]['Annual_WD']
        withdraw[y]['Cum_WD'] = cum

    return no_withdraw, withdraw
