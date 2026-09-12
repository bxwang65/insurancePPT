#!/usr/bin/env python3
"""
回归测试: lookup_commission.py 的核心佣金查询逻辑

覆盖:
  - Bug A 复发防护: PI 用户必须返回 PI 表的伯乐 (不是 NPI 表的)
  - Bug B 防护: 6 款产品 PI L1/L2/L3 必须等于用户手册值 (2026-08-16 对账)
  - Bug C 防护: 永M 伯乐必须有值 (不能 0)

用法:
  python db/scripts/test_lookup_commission.py --db db/hx_rates.db
  # 或 docker 内:
  docker exec hx-rates-api-dev python /app/db/scripts/test_lookup_commission.py
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lookup_commission import CommissionLookup


# 2026-08-16 用户手册对账表 (HK/PI, 6 款产品)
#   - 字段: (company, code, term, level, premium) → 期望 (l1, l2, l3, direct, indirect)
EXPECTED_PI = {
    # (company, code, term): (L1, L2, L3, direct, indirect)
    ('AIA 友邦', 'AA06805', 5):  (57.91, 60.91, 63.90, 2.39, 1.60),
    ('AXA 安盛', 'CC05505', 5):  (56.95, 59.90, 62.84, 2.36, 1.57),
    ('MLI 宏利', 'EE01905', 5):  (60.78, 63.93, 67.07, 2.51, 1.68),
    ('FWD 富衛', 'FF03405', 5):  (61.40, 64.58, 67.75, 2.54, 1.70),
    ('永M',       '',       5):  (59.45, 62.53, 65.60, 2.46, 1.64),
    ('CPIC太保',  'QQ01305', 5):  (55.21, 58.07, 60.92, 2.29, 1.52),
}

# 2026-08-16 用户手册对账表 (HK/NPI, 同一批产品)
#   - NPI L1/L2/L3 = PI L1/L2/L3 (base+add 算法相同)
#   - NPI 伯乐走 NPI 表 (Bug A 修复前的旧行为会返 PI 伯乐, 这是 bug)
EXPECTED_NPI = {
    # (company, code, term): (L1, L2, L3, direct, indirect)
    #   伯乐走 NPI 表 (用户未提供 NPI 伯乐, 这里用 DB 实测值, 防 Bug A 复发)
    ('AIA 友邦', 'AA06805', 5):  (57.91, 60.91, 63.90, 2.74, 1.82),
    ('MLI 宏利', 'EE01905', 5):  (60.78, 63.93, 67.07, 2.77, 1.84),
    ('FWD 富衛', 'FF03405', 5):  (61.40, 64.58, 67.75, 2.50, 1.67),
    ('永M',       '',       5):  (59.45, 62.53, 65.60, 2.73, 1.82),
    ('CPIC太保',  'QQ01305', 5):  (55.21, 58.07, 60.92, 2.43, 1.62),
    # 安S: PDF 没出 NPI 活动版 CC05505, NPI 只有 C05505 (非活动版), 略过
}


def approx_eq(a: float, b: float, tol: float = 0.05) -> bool:
    """容差比较 (0.05% 是 PDF 原表误差范围)"""
    return abs(a - b) < tol


def test_pi_table_routing(cl: CommissionLookup) -> tuple[int, int]:
    """Bug A 防护: PI 用户的伯乐必须来自 PI 表, 不能来自 NPI 表"""
    ok, fail = 0, 0
    for (company, code, term), (l1, l2, l3, exp_direct, exp_indirect) in EXPECTED_PI.items():
        r = cl.lookup(company, code, term, 'L2', 100000, investor='pi')
        if approx_eq(r.direct_pct, exp_direct) and approx_eq(r.indirect_pct, exp_indirect):
            ok += 1
            print(f"  ✓ {company:10} {code:10} PI 伯乐: {r.direct_pct:.2f}/{r.indirect_pct:.2f}")
        else:
            fail += 1
            print(f"  ✗ {company:10} {code:10} PI 伯乐: 期望 {exp_direct:.2f}/{exp_indirect:.2f}, 实际 {r.direct_pct:.2f}/{r.indirect_pct:.2f} (Bug A 复发!)")
    return ok, fail


def test_npi_table_routing(cl: CommissionLookup) -> tuple[int, int]:
    """Bug A 防护: NPI 用户的伯乐必须来自 NPI 表, 不能来自 PI 表"""
    ok, fail = 0, 0
    for (company, code, term), (l1, l2, l3, exp_direct, exp_indirect) in EXPECTED_NPI.items():
        r = cl.lookup(company, code, term, 'L2', 100000, investor='npi')
        if approx_eq(r.direct_pct, exp_direct) and approx_eq(r.indirect_pct, exp_indirect):
            ok += 1
            print(f"  ✓ {company:10} {code:10} NPI 伯乐: {r.direct_pct:.2f}/{r.indirect_pct:.2f}")
        else:
            fail += 1
            print(f"  ✗ {company:10} {code:10} NPI 伯乐: 期望 {exp_direct:.2f}/{exp_indirect:.2f}, 实际 {r.direct_pct:.2f}/{r.indirect_pct:.2f}")
    return ok, fail


def test_l1_l2_l3_values(cl: CommissionLookup) -> tuple[int, int]:
    """Bug B 防护: 6 款产品 PI L1/L2/L3 必须等于用户手册值"""
    ok, fail = 0, 0
    for (company, code, term), (exp_l1, exp_l2, exp_l3, _, _) in EXPECTED_PI.items():
        for level, expected in [('L1', exp_l1), ('L2', exp_l2), ('L3', exp_l3)]:
            r = cl.lookup(company, code, term, level, 100000, investor='pi')
            if approx_eq(r.total_pct, expected):
                ok += 1
            else:
                fail += 1
                print(f"  ✗ {company:10} {code:10} {level} total_pct: 期望 {expected:.2f}, 实际 {r.total_pct:.2f}")
    print(f"  (共 {len(EXPECTED_PI) * 3} 项 L1/L2/L3 全过)")
    return ok, fail


def test_yongming_berlue(cl: CommissionLookup) -> tuple[int, int]:
    """Bug C 防护: 永M 伯乐必须有值 (之前因 parse_simple_table 设 company='' 而全空)"""
    r = cl.lookup('永M', '', 5, 'L2', 100000, investor='pi')
    if r.direct_pct > 0 and r.indirect_pct > 0:
        print(f"  ✓ 永M PI 伯乐: {r.direct_pct:.2f}/{r.indirect_pct:.2f}")
        return 1, 0
    else:
        print(f"  ✗ 永M PI 伯乐空: {r.direct_pct:.2f}/{r.indirect_pct:.2f} (Bug C 复发!)")
        return 0, 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default='db/hx_rates.db', help='SQLite DB 路径')
    args = ap.parse_args()

    cl = CommissionLookup(args.db)
    total_ok, total_fail = 0, 0

    print("=== Test 1: PI 表路由 (Bug A 防护) ===")
    ok, fail = test_pi_table_routing(cl)
    total_ok += ok; total_fail += fail

    print("\n=== Test 2: NPI 表路由 (Bug A 防护) ===")
    ok, fail = test_npi_table_routing(cl)
    total_ok += ok; total_fail += fail

    print("\n=== Test 3: L1/L2/L3 总佣金 (Bug B 防护) ===")
    ok, fail = test_l1_l2_l3_values(cl)
    total_ok += ok; total_fail += fail

    print("\n=== Test 4: 永M 伯乐非空 (Bug C 防护) ===")
    ok, fail = test_yongming_berlue(cl)
    total_ok += ok; total_fail += fail

    cl.close()

    print(f"\n=== 总计: ✓ {total_ok} / ✗ {total_fail} ===")
    sys.exit(0 if total_fail == 0 else 1)


if __name__ == '__main__':
    main()