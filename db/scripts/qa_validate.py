#!/usr/bin/env python3
"""
QA 验证脚本: 用用户提供的参考表 (CSV) 自动对账数据库

输入: CSV 参考表 (用户每季度手动对账表)
  必填: company, code, term, investor, level, total_pct
  选填: direct_pct, indirect_pct, y1_pct, add_pct, y2_pct, y3_pct, y4_pct, y5_pct

用法:
  # 本地
  python db/scripts/qa_validate.py --csv db/reference/2026Q4.csv --db db/hx_rates.db

  # docker 内
  docker exec hx-rates-api-dev python /app/db/scripts/qa_validate.py \
    --csv /app/db/reference/2026Q4.csv

输出:
  PASS/FAIL 汇总 → 终端
  详细 diff 报告 → 终端 (按产品逐项列差异)
  Markdown 报告 → db/reference/qa_report_YYYYMMDD_HHMMSS.md

退出码:
  0 = 全部 PASS
  1 = 有 FAIL 或缺失产品

设计目标 (2026-08-16):
  - 用户每季度只需提供一份 CSV 参考表 (从 PDF 截图 + 1 次手工核对)
  - 跑完脚本立刻知道哪些产品对不上 / 缺 / 多
  - 不需要逐个 SELECT 调试
"""
import argparse
import csv
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional


# 容差: PDF 原表误差 ±0.05% (test_lookup_commission.py 已用此值)
DEFAULT_TOLERANCE = 0.05


@dataclass
class ExpectedRow:
    """CSV 一行 = 一个产品的期望值"""
    company: str
    code: str
    term: int
    investor: str
    level: str
    total_pct: float
    direct_pct: Optional[float] = None
    indirect_pct: Optional[float] = None
    y1_pct: Optional[float] = None
    add_pct: Optional[float] = None
    y2_pct: Optional[float] = None
    y3_pct: Optional[float] = None
    y4_pct: Optional[float] = None
    y5_pct: Optional[float] = None


@dataclass
class DiffItem:
    """一个字段的差异"""
    field: str
    expected: float
    actual: float
    delta: float
    status: str  # 'PASS' / 'FAIL' / 'MISS'


@dataclass
class ProductReport:
    """一个产品的对账结果"""
    key: str  # (company, code, term, investor, level)
    expected: ExpectedRow
    actual: Optional[dict] = None  # DB 行 (dict) 或 None (缺失)
    diffs: list[DiffItem] = field(default_factory=list)
    status: str = 'PENDING'  # 'PASS' / 'FAIL' / 'MISS'


# =============================================================
# CSV 读取
# =============================================================
def load_expected(csv_path: Path) -> list[ExpectedRow]:
    rows = []
    with open(csv_path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        required = {'company', 'code', 'term', 'investor', 'level', 'total_pct'}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV 缺少必填列: {missing}")
        for r in reader:
            def optf(k):
                v = r.get(k, '').strip()
                return float(v) if v else None
            def reqf(k):
                v = str(r[k]).strip()
                if not v:
                    raise ValueError(f"行 {reader.line_num}: {k} 为空")
                return v
            rows.append(ExpectedRow(
                company=reqf('company'),
                code=str(r.get('code', '')).strip(),  # 永M 可空
                term=int(reqf('term')),
                investor=reqf('investor').lower(),
                level=reqf('level').upper(),
                total_pct=float(reqf('total_pct')),
                direct_pct=optf('direct_pct'),
                indirect_pct=optf('indirect_pct'),
                y1_pct=optf('y1_pct'),
                add_pct=optf('add_pct'),
                y2_pct=optf('y2_pct'),
                y3_pct=optf('y3_pct'),
                y4_pct=optf('y4_pct'),
                y5_pct=optf('y5_pct'),
            ))
    return rows


# =============================================================
# DB 查询
# =============================================================
def fetch_db_row(conn: sqlite3.Connection, exp: ExpectedRow) -> Optional[dict]:
    """从 DB 查一条, 优先 is_activity=1 (活动版), fallback is_activity=0"""
    fee_tbl = f"{exp.investor}_fee_{exp.level.lower()}"
    sql = f"""
    SELECT * FROM {fee_tbl}
    WHERE company = ? AND code = ? AND term = ?
    ORDER BY is_activity DESC, effective_from DESC
    LIMIT 1
    """
    row = conn.execute(sql, (exp.company, exp.code, exp.term)).fetchone()
    if not row:
        return None
    r = dict(row)

    # 伯乐表 (direct 取 direct_value, indirect 取 indirect_value)
    b_tbl = exp.investor
    d = conn.execute(f"""
        SELECT direct_value FROM {b_tbl}_fee_direct
        WHERE company=? AND code=? AND term=?
          AND (is_activity=? OR is_activity=0)
        ORDER BY is_activity DESC LIMIT 1
    """, (exp.company, exp.code, exp.term, r['is_activity'])).fetchone()
    r['direct_pct'] = d['direct_value'] if d else None
    ind = conn.execute(f"""
        SELECT indirect_value FROM {b_tbl}_fee_indirect
        WHERE company=? AND code=? AND term=?
          AND (is_activity=? OR is_activity=0)
        ORDER BY is_activity DESC LIMIT 1
    """, (exp.company, exp.code, exp.term, r['is_activity'])).fetchone()
    r['indirect_pct'] = ind['indirect_value'] if ind else None

    # 算 total_pct (实际显示给用户的)
    if exp.investor == 'pi':
        if exp.level == 'L1':
            r['total_pct'] = r.get('base_total') or 0
        else:
            r['total_pct'] = r.get(f'total_{exp.level.lower()}') or 0
    else:
        # NPI: y1 + add + y2+y3+y4+y5
        y = lambda k: r.get(k) or 0
        add = r.get(f'add_{exp.level.lower()}') or 0 if exp.level != 'L1' else 0
        r['total_pct'] = y('y1') + y('y2') + y('y3') + y('y4') + y('y5') + add
    return r


# =============================================================
# 对账
# =============================================================
def compare(exp: ExpectedRow, actual: Optional[dict], tol: float) -> ProductReport:
    key = f"{exp.company} | {exp.code or '(空)'} | term={exp.term} | {exp.investor.upper()} {exp.level}"
    rep = ProductReport(key=key, expected=exp)

    if actual is None:
        rep.status = 'MISS'
        rep.diffs.append(DiffItem('row', 0, 0, 0, 'MISS'))
        return rep

    rep.actual = actual
    fail = 0

    def check(field_name: str, exp_val: Optional[float]):
        nonlocal fail
        if exp_val is None:
            return  # CSV 没填就跳过
        act_val = actual.get(field_name)
        if act_val is None:
            rep.diffs.append(DiffItem(field_name, exp_val, 0, exp_val, 'FAIL'))
            fail += 1
            return
        delta = abs(exp_val - act_val)
        if delta <= tol:
            rep.diffs.append(DiffItem(field_name, exp_val, act_val, delta, 'PASS'))
        else:
            rep.diffs.append(DiffItem(field_name, exp_val, act_val, delta, 'FAIL'))
            fail += 1

    # 必查: total_pct
    check('total_pct', exp.total_pct)
    # 选查: 各分项
    check('direct_pct', exp.direct_pct)
    check('indirect_pct', exp.indirect_pct)
    if exp.investor == 'npi':
        check('y1_pct', exp.y1_pct)
        check('add_pct', exp.add_pct)
        check('y2_pct', exp.y2_pct)
        check('y3_pct', exp.y3_pct)
        check('y4_pct', exp.y4_pct)
        check('y5_pct', exp.y5_pct)

    rep.status = 'PASS' if fail == 0 else 'FAIL'
    return rep


# =============================================================
# 报告输出
# =============================================================
def print_report(reports: list[ProductReport], db_products: set, expected_keys: set):
    n_pass = sum(1 for r in reports if r.status == 'PASS')
    n_fail = sum(1 for r in reports if r.status == 'FAIL')
    n_miss = sum(1 for r in reports if r.status == 'MISS')
    extra_in_db = db_products - expected_keys

    print()
    print('=' * 70)
    print(f'QA 验证汇总')
    print('=' * 70)
    print(f'  参考表 (CSV):     {len(reports)} 个产品')
    print(f'  PASS:             {n_pass}')
    print(f'  FAIL:             {n_fail}')
    print(f'  MISS (DB 无):     {n_miss}')
    print(f'  EXTRA (DB 有, 参考表无): {len(extra_in_db)}')

    # 详细
    if n_fail or n_miss:
        print()
        print('--- FAIL / MISS 明细 ---')
        for r in reports:
            if r.status in ('FAIL', 'MISS'):
                print(f'  ✗ [{r.status}] {r.key}')
                for d in r.diffs:
                    if d.status != 'PASS':
                        print(f'      {d.field}: 期望 {d.expected:.2f}, 实际 {d.actual:.2f}, Δ {d.delta:+.2f}')

    if extra_in_db:
        print()
        print('--- DB 有但参考表无 (可能是新增产品) ---')
        for k in sorted(extra_in_db):
            print(f'  + {k}')

    print()
    print('=' * 70)
    if n_fail == 0 and n_miss == 0:
        print('✓ 全部 PASS')
    else:
        print(f'✗ {n_fail} FAIL + {n_miss} MISS — 请检查 extract_hx_pdfs.py')
    print('=' * 70)


def write_markdown(reports: list[ProductReport], csv_path: Path, out_dir: Path) -> Path:
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    out = out_dir / f'qa_report_{ts}.md'
    n_pass = sum(1 for r in reports if r.status == 'PASS')
    n_fail = sum(1 for r in reports if r.status == 'FAIL')
    n_miss = sum(1 for r in reports if r.status == 'MISS')

    lines = [
        f'# QA 验证报告 ({ts})',
        f'',
        f'**参考表**: `{csv_path}`',
        f'',
        f'## 汇总',
        f'',
        f'| 状态 | 数量 |',
        f'|------|------|',
        f'| PASS | {n_pass} |',
        f'| FAIL | {n_fail} |',
        f'| MISS | {n_miss} |',
        f'',
    ]
    if n_fail or n_miss:
        lines.append('## FAIL / MISS 明细')
        lines.append('')
        for r in reports:
            if r.status in ('FAIL', 'MISS'):
                lines.append(f'### ✗ [{r.status}] {r.key}')
                lines.append('')
                lines.append('| 字段 | 期望 | 实际 | Δ |')
                lines.append('|------|------|------|---|')
                for d in r.diffs:
                    if d.status != 'PASS':
                        lines.append(f'| {d.field} | {d.expected:.2f} | {d.actual:.2f} | {d.delta:+.2f} |')
                lines.append('')

    out.write_text('\n'.join(lines), encoding='utf-8')
    return out


# =============================================================
# Main
# =============================================================
def main():
    ap = argparse.ArgumentParser(description='QA 验证: CSV 参考表 vs DB')
    ap.add_argument('--csv', required=True, help='用户参考表 (CSV)')
    ap.add_argument('--db', default='db/hx_rates.db', help='SQLite DB 路径')
    ap.add_argument('--tol', type=float, default=DEFAULT_TOLERANCE, help='容差 (默认 0.05%)')
    ap.add_argument('--out-dir', default='.', help='Markdown 报告输出目录')
    args = ap.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f'✗ CSV 不存在: {csv_path}')
        sys.exit(1)

    expected = load_expected(csv_path)
    expected_keys = {f"{r.company}|{r.code}|{r.term}|{r.investor}|{r.level}" for r in expected}

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    reports = []
    for exp in expected:
        actual = fetch_db_row(conn, exp)
        rep = compare(exp, actual, args.tol)
        reports.append(rep)

    # 顺便: DB 里有哪些产品但参考表没列?
    db_products = set()
    for r in conn.execute("SELECT DISTINCT company, code, term FROM pi_fee_l2"):
        db_products.add(f"{r['company']}|{r['code']}|{r['term']}|pi|L2")
    for r in conn.execute("SELECT DISTINCT company, code, term FROM npi_fee_l2"):
        db_products.add(f"{r['company']}|{r['code']}|{r['term']}|npi|L2")

    print_report(reports, db_products, expected_keys)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    md_path = write_markdown(reports, csv_path, out_dir)
    print(f'\n  Markdown 报告: {md_path}')

    conn.close()
    n_fail = sum(1 for r in reports if r.status in ('FAIL', 'MISS'))
    sys.exit(1 if n_fail else 0)


if __name__ == '__main__':
    main()