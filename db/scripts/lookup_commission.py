#!/usr/bin/env python3
"""
HX 佣金查询脚本 (Script B)

输入: (company, code, term, level, premium) → 输出佣金明细
支持: NPI / PI, L1 / L2 / L3, 自动活动版优先, 季度版本切换

用法:
  # 单查 (CLI)
  python lookup_commission.py --company "AIA 友邦" --code "AA06805" --term 5 --level L2 --premium 10000

  # 批量 (从 CSV)
  python lookup_commission.py --csv policies.csv --db db/hx_rates.db

  # Python API
  from lookup_commission import CommissionLookup
  cl = CommissionLookup("db/hx_rates.db")
  result = cl.lookup("AIA 友邦", "AA06805", 5, "L2", 10000, investor="npi")
  print(result.total_usd, result.first_year_usd)
"""
import argparse
import csv
import json
import sqlite3
import sys
from dataclasses import dataclass, asdict, field
from datetime import datetime, date
from pathlib import Path
from typing import Optional


# =============================================================
# 数据类: 佣金明细
# =============================================================
@dataclass
class CommissionBreakdown:
    """佣金明细 (USD 单位)"""
    # 元数据
    company: str
    code: str
    plan: str
    term: int
    level: str                # 'L1' / 'L2' / 'L3'
    investor: str             # 'npi' / 'pi'
    premium: float            # 年缴保费 (USD)
    is_activity: int
    activity_deadline: Optional[str]
    currency: str

    # 费率 (%)
    y1_pct: float = 0.0
    y2_pct: float = 0.0
    y3_pct: float = 0.0
    y4_pct: float = 0.0
    y5_pct: float = 0.0
    add_pct: float = 0.0       # L2 / L3 加点 (L1=0)
    total_pct: float = 0.0     # 合计 % (L1=y1+y2*4, L2=total_l2, L3=total_l3)
    direct_pct: float = 0.0    # 直接伯乐 (%)
    indirect_pct: float = 0.0  # 间接伯乐 (%)

    # 金额 (USD)
    y1_usd: float = 0.0
    y2_usd: float = 0.0
    y3_usd: float = 0.0
    y4_usd: float = 0.0
    y5_usd: float = 0.0
    renew_usd: float = 0.0     # y2+y3+y4+y5 sum (× premium)
    add_usd: float = 0.0
    total_usd: float = 0.0     # 所有年度佣金总和
    direct_usd: float = 0.0
    indirect_usd: float = 0.0

    # 给前端用 (积分): 1 USD = 100 积分 (示例汇率)
    points: float = 0.0

    # 警告 (e.g. "找不到直接伯乐")
    warnings: list = field(default_factory=list)


# =============================================================
# 主类: CommissionLookup
# =============================================================
class CommissionLookup:
    """佣金查询器

    用法:
        cl = CommissionLookup("db/hx_rates.db")
        result = cl.lookup(company, code, term, level, premium, investor="npi")
    """

    TABLE_MAP = {
        ('npi', 'L1'): 'npi_fee_l1',
        ('npi', 'L2'): 'npi_fee_l2',
        ('npi', 'L3'): 'npi_fee_l3',
        ('pi',  'L1'): 'pi_fee_l1',
        ('pi',  'L2'): 'pi_fee_l2',
        ('pi',  'L3'): 'pi_fee_l3',
    }

    def __init__(self, db_path: str, as_of: Optional[str] = None):
        """as_of: 'YYYY-MM-DD', 默认今天"""
        self.db_path = db_path
        self.as_of = as_of or date.today().isoformat()
        # 2026-08-16: check_same_thread=False — FastAPI 在 thread pool 跑 endpoint,
        #   单 connection 跨线程会抛 ProgrammingError. SQLite 内部已经序列化访问,
        #   加 WAL 模式可进一步提升并发读性能.
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        try:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")
        except sqlite3.DatabaseError:
            pass  # 只读 DB 不允许 journal_mode, 忽略

    def close(self):
        self.conn.close()

    # ---------------------------------------------------------
    # 单条查询
    # ---------------------------------------------------------
    def lookup(self, company: str, code: str, term: int,
               level: str, premium: float,
               investor: str = 'npi',
               prefer_activity: bool = True) -> CommissionBreakdown:
        """查一条佣金明细

        Args:
            company: 'AIA 友邦' / 'AXA 安盛' / '永M' 等
            code: 产品代码, e.g. 'AA06805' (永M 可传 '')
            term: 缴费年限 1/2/3/5/...
            level: 'L1' / 'L2' / 'L3'
            premium: 年缴保费 (USD)
            investor: 'npi' (非专业投资者) / 'pi' (专业投资者)
            prefer_activity: 同 (company, code, term) 多版本时优先选活动版
        """
        level = level.upper()
        investor = investor.lower()
        if (investor, level) not in self.TABLE_MAP:
            raise ValueError(f"不支持的组合: investor={investor} level={level}")

        table = self.TABLE_MAP[(investor, level)]

        # 1) 主费率表查询
        rows = self._fetch_active_rows(
            table, company, code, term,
            prefer_activity=prefer_activity,
        )
        if not rows:
            raise LookupError(
                f"找不到费率: {company} {code} term={term} {investor.upper()} {level}"
            )

        row = rows[0]  # activity_priority 后第一条

        result = CommissionBreakdown(
            company=row['company'] or company,
            code=row['code'] or code,
            plan=row['plan'],
            term=term,
            level=level,
            investor=investor,
            premium=premium,
            is_activity=row['is_activity'],
            activity_deadline=row['activity_deadline'],
            currency=row['currency'] or 'USD',
        )

        # 2) 解析费率
        self._apply_rate(row, result, investor, level)

        # 3) 直接伯乐 + 间接伯乐 (从同 PDF 取, 但用 NPI 投资者类型)
        self._apply_berlue(result)

        # 4) 金额计算
        self._compute_amounts(result)

        return result

    # ---------------------------------------------------------
    # 批量查询 (从 CSV)
    # ---------------------------------------------------------
    def lookup_batch(self, items: list) -> list:
        """items = [{company, code, term, level, premium, investor}, ...]"""
        results = []
        errors = []
        for item in items:
            try:
                r = self.lookup(**item)
                results.append(r)
            except Exception as e:
                errors.append({'item': item, 'error': str(e)})
        return results, errors

    # ---------------------------------------------------------
    # 私有: 查活跃行 (按 effective_from/to 过滤)
    # ---------------------------------------------------------
    def _fetch_active_rows(self, table: str, company: str, code: str,
                           term: int, prefer_activity: bool = True) -> list:
        sql = f"""
        SELECT * FROM {table}
        WHERE company = ? AND code = ? AND term = ?
          AND (effective_from IS NULL OR effective_from <= ?)
          AND (effective_to IS NULL OR effective_to > ?)
        """
        rows = self.conn.execute(
            sql, (company, code, term, self.as_of, self.as_of)
        ).fetchall()

        if not rows:
            return []

        if prefer_activity:
            # 活动版优先
            activity = [r for r in rows if r['is_activity'] == 1]
            if activity:
                return activity
        return rows

    # ---------------------------------------------------------
    # 私有: 应用费率到 result
    # ---------------------------------------------------------
    def _apply_rate(self, row, result: CommissionBreakdown,
                    investor: str, level: str):
        if investor == 'npi':
            result.y1_pct = row['y1'] or 0
            result.y2_pct = row['y2'] or 0
            result.y3_pct = row['y3'] or 0
            result.y4_pct = row['y4'] or 0
            result.y5_pct = row['y5'] or 0

            if level == 'L1':
                result.total_pct = row['total'] or 0
                result.add_pct = 0.0
            elif level == 'L2':
                result.add_pct = row['add_l2'] or 0
                result.total_pct = row['total_l2'] or 0
            elif level == 'L3':
                result.add_pct = row['add_l3'] or 0
                result.total_pct = row['total_l3'] or 0
        else:  # pi
            result.total_pct = row['base_total'] or 0
            if level == 'L1':
                result.add_pct = 0.0
            elif level == 'L2':
                result.add_pct = row['add_l2'] or 0
                result.total_pct = row['total_l2'] or 0
            elif level == 'L3':
                result.add_pct = row['add_l3'] or 0
                result.total_pct = row['total_l3'] or 0
            # PI 没有 y1-y5 拆分

    # ---------------------------------------------------------
    # 私有: 查直接伯乐 + 间接伯乐
    # ---------------------------------------------------------
    def _apply_berlue(self, result: CommissionBreakdown):
        """根据 investor 路由到对应伯乐表
        - investor='npi' → npi_fee_direct/indirect
        - investor='pi'  → pi_fee_direct/indirect
        (2026-08-16 修复: 之前 bug 永远走 NPI 表, PI 用户拿到错误的伯乐值)
        """
        if result.investor == 'pi':
            tables = [
                ('pi_fee_direct',   'direct_value',   'direct_pct',   'direct_usd',  '直接'),
                ('pi_fee_indirect', 'indirect_value', 'indirect_pct', 'indirect_usd', '间接'),
            ]
        else:
            tables = [
                ('npi_fee_direct',   'direct_value',   'direct_pct',   'direct_usd',  '直接'),
                ('npi_fee_indirect', 'indirect_value', 'indirect_pct', 'indirect_usd', '间接'),
            ]
        for table, val_col, pct_attr, usd_attr, label in tables:
            sql = f"""
            SELECT * FROM {table}
            WHERE company = ? AND code = ? AND term = ?
              AND (effective_from IS NULL OR effective_from <= ?)
              AND (effective_to IS NULL OR effective_to > ?)
              AND (is_activity = ? OR is_activity = 0)
            ORDER BY is_activity DESC, effective_from DESC LIMIT 1
            """
            row = self.conn.execute(
                sql, (result.company, result.code, result.term,
                      self.as_of, self.as_of, result.is_activity)
            ).fetchone()
            if row:
                pct = row[val_col] or 0
                setattr(result, pct_attr, pct)
                setattr(result, usd_attr, pct * result.premium / 100)
            else:
                result.warnings.append(f"找不到{label}伯乐: {result.company} {result.code}")

    # ---------------------------------------------------------
    # 私有: 金额计算
    # ---------------------------------------------------------
    def _compute_amounts(self, result: CommissionBreakdown):
        p = result.premium
        if result.investor == 'npi':
            # NPI: 首期(y1) + 续期(y2..y5) + 加点 + 直接伯乐 + 间接伯乐
            result.y1_usd = result.y1_pct * p / 100
            result.y2_usd = result.y2_pct * p / 100
            result.y3_usd = result.y3_pct * p / 100
            result.y4_usd = result.y4_pct * p / 100
            result.y5_usd = result.y5_pct * p / 100
            result.renew_usd = result.y2_usd + result.y3_usd + result.y4_usd + result.y5_usd
            result.add_usd = result.add_pct * p / 100
            result.total_usd = (
                result.y1_usd + result.renew_usd + result.add_usd
                + result.direct_usd + result.indirect_usd
            )
        else:
            # PI: 一次性发放 (全在 y1, y2-y5 = 0), 但 UI 展开明细需要 y1 + add 分开
            # total_pct = base_total + add_pct (L1=base_total, L2/L3=base_total + 加点)
            # base_total 是不分等级的基础首年佣金比例, add_pct 是 L2/L3 加点
            result.add_usd = result.add_pct * p / 100
            result.y1_usd = (result.total_pct - result.add_pct) * p / 100
            # y2_usd-y5_usd 已为 0 (PI 一次性发放)
            result.renew_usd = 0.0
            result.total_usd = (
                result.total_pct * p / 100
                + result.direct_usd + result.indirect_usd
            )

        # 积分 (前端展示用)
        result.points = result.total_usd * 100

    # ---------------------------------------------------------
    # 工具: 列出所有 (company, code, plan, term)
    # ---------------------------------------------------------
    def list_products(self, investor: str = 'npi', level: str = 'L1') -> list:
        """返回所有可查的产品清单 (UI 用)

        2026-08-16: 返 is_activity + activity_deadline, 让前端能区分活动版/非活动版,
        并默认只显示活动版避免用户选错.
        """
        table = self.TABLE_MAP[(investor.lower(), level.upper())]
        sql = f"""
        SELECT DISTINCT company, code, plan, term, is_activity, activity_deadline
        FROM {table}
        WHERE (effective_from IS NULL OR effective_from <= ?)
          AND (effective_to IS NULL OR effective_to > ?)
        ORDER BY company, code, term
        """
        rows = self.conn.execute(sql, (self.as_of, self.as_of)).fetchall()
        return [dict(r) for r in rows]


# =============================================================
# CLI
# =============================================================
def fmt_money(usd: float) -> str:
    return f"${usd:,.2f}"


def fmt_pct(pct: float) -> str:
    return f"{pct:5.2f}%"


def print_result(r: CommissionBreakdown, verbose: bool = False):
    print(f"\n=== {r.company} {r.code} ({r.plan[:30]}) ===")
    print(f"  缴费年期: {r.term}年  投资者: {r.investor.upper()}  级别: {r.level}  币种: {r.currency}")
    print(f"  年缴保费: {fmt_money(r.premium)}  活动版: {'是' if r.is_activity else '否'} ({r.activity_deadline or '-'})")

    if r.investor == 'npi':
        print(f"\n  {'年度':<8} {'%':<8} {'USD':<12}")
        print(f"  {'第1年':<8} {fmt_pct(r.y1_pct):<8} {fmt_money(r.y1_usd):<12}")
        print(f"  {'第2年':<8} {fmt_pct(r.y2_pct):<8} {fmt_money(r.y2_usd):<12}")
        print(f"  {'第3年':<8} {fmt_pct(r.y3_pct):<8} {fmt_money(r.y3_usd):<12}")
        print(f"  {'第4年':<8} {fmt_pct(r.y4_pct):<8} {fmt_money(r.y4_usd):<12}")
        print(f"  {'第5年':<8} {fmt_pct(r.y5_pct):<8} {fmt_money(r.y5_usd):<12}")
        print(f"  {'续期小计':<8} {'':<8} {fmt_money(r.renew_usd):<12}")
        if r.add_pct > 0:
            print(f"  {'加点':<8} {fmt_pct(r.add_pct):<8} {fmt_money(r.add_usd):<12}")
    else:
        print(f"\n  {'项':<10} {'%':<8} {'USD':<12}")
        print(f"  {'基础合计':<10} {fmt_pct(r.total_pct):<8} {fmt_money(r.total_pct * r.premium / 100):<12}")
        if r.add_pct > 0:
            print(f"  {'加点':<10} {fmt_pct(r.add_pct):<8} {fmt_money(r.add_usd):<12}")

    if r.direct_pct > 0:
        print(f"  {'直接伯乐':<8} {fmt_pct(r.direct_pct):<8} {fmt_money(r.direct_usd):<12}")
    if r.indirect_pct > 0:
        print(f"  {'间接伯乐':<8} {fmt_pct(r.indirect_pct):<8} {fmt_money(r.indirect_usd):<12}")

    print(f"\n  >>> 总佣金: {fmt_money(r.total_usd)} (≈ {r.points:,.0f} 积分)")
    if r.warnings:
        for w in r.warnings:
            print(f"  ⚠️  {w}")


def main():
    ap = argparse.ArgumentParser(description='HX 佣金查询')
    ap.add_argument('--db', default='db/hx_rates.db')
    ap.add_argument('--company', help='公司, e.g. "AIA 友邦"')
    ap.add_argument('--code', help='产品代码, e.g. "AA06805"')
    ap.add_argument('--term', type=int, help='缴费年期')
    ap.add_argument('--level', choices=['L1', 'L2', 'L3'], default='L2')
    ap.add_argument('--premium', type=float, help='年缴保费 (USD)')
    ap.add_argument('--investor', choices=['npi', 'pi'], default='npi')
    ap.add_argument('--as-of', help='数据日期 YYYY-MM-DD (默认今天)')
    ap.add_argument('--csv', help='批量查询 CSV 文件')
    ap.add_argument('--list', action='store_true', help='列出所有产品')
    args = ap.parse_args()

    cl = CommissionLookup(args.db, args.as_of)

    if args.list:
        products = cl.list_products(args.investor, args.level)
        print(f"\n共 {len(products)} 个产品 ({args.investor.upper()} {args.level}):")
        for p in products[:30]:
            print(f"  {p['company']:<15} {p['code']:<10} {p['term']}年  {p['plan'][:40]}")
        if len(products) > 30:
            print(f"  ... 共 {len(products)} 个, 只显示前 30")
        return

    if args.csv:
        # 批量模式
        with open(args.csv) as f:
            reader = csv.DictReader(f)
            items = []
            for row in reader:
                items.append({
                    'company': row['company'],
                    'code': row['code'],
                    'term': int(row['term']),
                    'level': row.get('level', 'L2'),
                    'premium': float(row['premium']),
                    'investor': row.get('investor', 'npi'),
                })
        results, errors = cl.lookup_batch(items)
        print(f"\n 成功 {len(results)} / 失败 {len(errors)}")
        for r in results:
            print(f"  {r.company} {r.code} {r.term}年 {r.level} ${r.premium:,.0f} → {fmt_money(r.total_usd)}")
        for e in errors:
            print(f"  ✗ {e['item']}: {e['error']}")
        return

    # 单条模式
    if not all([args.company, args.code is not None, args.term, args.premium]):
        ap.error('需要 --company --code --term --premium (或 --csv / --list)')

    r = cl.lookup(
        company=args.company,
        code=args.code,
        term=args.term,
        level=args.level,
        premium=args.premium,
        investor=args.investor,
    )
    print_result(r, verbose=True)


if __name__ == '__main__':
    main()