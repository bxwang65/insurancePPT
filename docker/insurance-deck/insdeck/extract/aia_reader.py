"""
AIA 专用提取器 (环宇盈活格式)

与CTF不同:
- 不退保表 P2: Y值不连续 (1,2,3,4,5, 10,15,20,25,30, 65岁/70岁/...)
- 提领演示 P16-18: Y连续 (1-100), 6列 (年龄,Y, 提取保证/复归/终期/总额)
- 11列不退保表 = CTF 11列类似, 但Y=1-30+65岁-100岁

P2 列序 (11列):
[0] Y (含 "岁" 后缀, 如 65岁)
[1] 缴付保费总额
[2] 退保-保证现金价值 (A)
[3] 退保-复归红利 (B)
[4] 退保-终期分红 (C)
[5] 退保总额 (A+B+C)
[6] 身故-保证金额 (D)
[7] 身故-复归红利 (E)
[8] 身故-终期分红 (F)
[9] 身故总额 (A+E+F) = G
[10] 总赔偿 (D或G之较高者)

P16 提领表 (6列):
[0] 年龄
[1] Y
[2] 提取-由保证现金价值 (A)
[3] 提取-由复归红利 (B)
[4] 提取-由终期分红 (C)
[5] 提取总额 (A+B+C) ≈ 35,000
"""
import re
from typing import Dict, List

import pdfplumber


def _parse_multi_aia(cell) -> List:
    """AIA PDF 同一cell可能含多个值用\\n分隔 (与CTF相同)"""
    if not cell:
        return []
    result = []
    for x in str(cell).split('\n'):
        s = x.strip().replace(',', '').replace('-', '')
        if s and s.lstrip('.').isdigit():
            result.append(int(float(s)))
    return result


def _parse_y(cell) -> List[int]:
    """
    解析Y值, 处理 "65岁"/"70岁" 格式
    65岁 → 65 (受保人1岁起, Y=年龄)
    """
    if not cell:
        return []
    out = []
    for x in str(cell).split('\n'):
        s = x.strip()
        # 移除 "岁" 后缀
        s = s.replace('岁', '').strip()
        if s.isdigit():
            out.append(int(s))
    return out


def extract_no_withdraw_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """
    AIA 环宇盈活 不退保表 (P2, 11列)
    返回 {Y: {Paid, Guar_CV, Rev, Term, Total, Age}}
    注: Y=1..30 + Y=65..100
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg_idx in page_indices:
            if pg_idx >= len(pdf.pages):
                continue
            tables = pdf.pages[pg_idx].extract_tables()
            for t in tables:
                if not t or len(t) < 4:
                    continue
                # 表头必须含 "保单" 和 "退保"
                header = ' '.join(str(c) for c in t[0] if c) + ' '.join(str(c) for c in t[1] if c)
                if '退保' not in header and '保证现金' not in header:
                    continue
                for r in t[3:]:  # 跳过3行表头
                    if not r or len(r) < 11:
                        continue
                    ys = _parse_y(r[0])
                    if not ys:
                        continue
                    paid = _parse_multi_aia(r[1])
                    guar = _parse_multi_aia(r[2])  # 退保-保证现金
                    rev = _parse_multi_aia(r[3]) + _parse_multi_aia(r[4])  # 复归+终期
                    total = _parse_multi_aia(r[5])  # 退保总额
                    n = min(len(ys), len(paid), len(total))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            rows[y] = {
                                'Y': y,
                                'Age': y,
                                'Paid': paid[k],
                                'Guar_CV': guar[k] if k < len(guar) else 0,
                                'Rev': rev[k] if k < len(rev) else 0,
                                'Term': 0,
                                'Total': total[k],
                            }
    return rows


def extract_withdraw_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """
    AIA 环宇盈活 提领演示表 (P16-18, 6列)
    列序: [年龄, Y, 提取保证(A), 提取复归(B), 提取终期(C), 提取总额(A+B+C)]

    已知 PDF 实际: 提取总额≈35,000 稳定
    Annual_WD = 提取总额(每年)
    Cum_WD = Y * 提取总额 (因为每年固定35K)
    Total = 退保发还总额 (在 P19-24 表中, 这里先填0, 由后续关联)
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg_idx in page_indices:
            if pg_idx >= len(pdf.pages):
                continue
            tables = pdf.pages[pg_idx].extract_tables()
            for t in tables:
                if not t or len(t) < 4:
                    continue
                # 表头必须含 "现金提取"
                header = ' '.join(str(c) for c in t[0] if c)
                if '现金提取' not in header and '提取金额' not in header:
                    continue
                for r in t[3:]:
                    if not r or len(r) < 6:
                        continue
                    ages = _parse_multi_aia(r[0])
                    ys = _parse_multi_aia(r[1])
                    if not ys:
                        continue
                    annual_a = _parse_multi_aia(r[2])  # 提取-保证
                    annual_b = _parse_multi_aia(r[3])  # 提取-复归
                    annual_c = _parse_multi_aia(r[4])  # 提取-终期
                    total = _parse_multi_aia(r[5])    # 提取总额
                    n = min(len(ys), len(total))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            a_total = total[k]  # 该年提取总额(年提取)
                            # 累计 = sum of (each year's total up to y)
                            rows[y] = {
                                'Y': y,
                                'Age': ages[k] if k < len(ages) else y,
                                'Paid': 0,  # 在P19-24补
                                'Annual_WD': a_total,
                                'Cum_WD': 0,  # 后算
                                'Guar_CV': annual_a[k] if k < len(annual_a) else 0,
                                'Rev': (annual_b[k] if k < len(annual_b) else 0) + (annual_c[k] if k < len(annual_c) else 0),
                                'Term': 0,
                                'Total': 0,  # P19-24里 "现金提取后之退保发还金额"
                                'Total_WD': 0,
                                'Remain_Units': 0,
                            }
    # 计算累计提取 (基于 Annual_WD 单调递增累加)
    sorted_ys = sorted(rows.keys())
    cum = 0
    for y in sorted_ys:
        cum += rows[y]['Annual_WD']
        rows[y]['Cum_WD'] = cum
    return rows


def extract_withdraw_remainder_aia(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """
    AIA 环宇盈活 提领后剩余保单现价表 (P19-21, 9列)
    列序:
      [0] 年龄
      [1] Y
      [2] 缴付保费总额
      [3] 现金提取金额
      [4] 提取后基本金额
      [5] 提取后-保证(A)
      [6] 提取后-复归(B)
      [7] 提取后-终期(C)
      [8] 提取后退保总额 (A+B+C) ← 关键
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg_idx in page_indices:
            if pg_idx >= len(pdf.pages):
                continue
            tables = pdf.pages[pg_idx].extract_tables()
            for t in tables:
                if not t or len(t) < 4:
                    continue
                # 表头必须含 "退保发还" 且不含 "身故" (P22-24是身故)
                header = ' '.join(str(c) for c in t[0] if c)
                if '退保发还' not in header:
                    continue
                if '身故' in header:
                    continue
                for r in t[3:]:
                    if not r or len(r) < 9:
                        continue
                    ages = _parse_multi_aia(r[0])
                    ys = _parse_multi_aia(r[1])
                    if not ys:
                        continue
                    paid = _parse_multi_aia(r[2])
                    remain_total = _parse_multi_aia(r[8])
                    n = min(len(ys), len(remain_total))
                    for k in range(n):
                        y = ys[k]
                        if y not in rows:
                            rows[y] = {
                                'Y': y,
                                'Age': ages[k] if k < len(ages) else y,
                                'Paid': paid[k] if k < len(paid) else 0,
                                'Total': remain_total[k],
                            }
    return rows
