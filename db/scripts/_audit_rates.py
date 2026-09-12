"""Audit all rate tables - PI/NPI, L1/L2/L3, sanity check."""
import sqlite3

c = sqlite3.connect('/Users/soldier/insurance-ppt-v3/db/hx_rates.db')
c.row_factory = sqlite3.Row
AS_OF = '2026-08-16'

# Get distinct active products
rows = c.execute(f"""
SELECT DISTINCT company, code, term
FROM npi_fee_l2
WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
ORDER BY company, code, term
""", (AS_OF, AS_OF)).fetchall()
print(f"Total active products: {len(rows)}")

# Group by company
companies = {}
for r in rows:
    companies.setdefault(r['company'], []).append((r['code'], r['term']))

# Count by company
for co, items in companies.items():
    print(f"  {co}: {len(items)} active (code,term)")

issues = []
ok_count = 0
for company, items in companies.items():
    for code, term in items:
        # PI
        pi_l1 = c.execute("SELECT base_total FROM pi_fee_l1 WHERE company=? AND code=? AND term=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)", (company, code, term, AS_OF, AS_OF)).fetchone()
        pi_l2 = c.execute("SELECT base_total, add_l2, total_l2 FROM pi_fee_l2 WHERE company=? AND code=? AND term=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)", (company, code, term, AS_OF, AS_OF)).fetchone()
        pi_l3 = c.execute("SELECT base_total, add_l3, total_l3 FROM pi_fee_l3 WHERE company=? AND code=? AND term=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)", (company, code, term, AS_OF, AS_OF)).fetchone()
        # NPI
        npi_l1 = c.execute("SELECT y1, y2, y3, y4, y5, total FROM npi_fee_l1 WHERE company=? AND code=? AND term=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)", (company, code, term, AS_OF, AS_OF)).fetchone()
        npi_l2 = c.execute("SELECT y1, add_l2, total_l2 FROM npi_fee_l2 WHERE company=? AND code=? AND term=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)", (company, code, term, AS_OF, AS_OF)).fetchone()
        npi_l3 = c.execute("SELECT y1, add_l3, total_l3 FROM npi_fee_l3 WHERE company=? AND code=? AND term=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)", (company, code, term, AS_OF, AS_OF)).fetchone()
        pi_ok = pi_l1 is not None and pi_l2 is not None and pi_l3 is not None
        npi_ok = npi_l1 is not None and npi_l2 is not None and npi_l3 is not None
        if not pi_ok or not npi_ok:
            issues.append((company, code, term, f'pi_ok={pi_ok} npi_ok={npi_ok}'))
            continue
        # Check additivity for PI: total_l2 ≈ base_total + add_l2
        if abs(pi_l2['total_l2'] - (pi_l1['base_total'] + pi_l2['add_l2'])) > 0.01:
            issues.append((company, code, term, f'PI L2 mismatch: base+add={pi_l1["base_total"]+pi_l2["add_l2"]:.2f} vs total_l2={pi_l2["total_l2"]:.2f}'))
            continue
        if abs(pi_l3['total_l3'] - (pi_l1['base_total'] + pi_l3['add_l3'])) > 0.01:
            issues.append((company, code, term, f'PI L3 mismatch: base+add={pi_l1["base_total"]+pi_l3["add_l3"]:.2f} vs total_l3={pi_l3["total_l3"]:.2f}'))
            continue
        # NPI: total_l2 = sum_y1_y5 + add_l2 (multi-year total + L2 add)
        def nz(x): return x if x is not None else 0
        sum_y = nz(npi_l1['y1']) + nz(npi_l1['y2']) + nz(npi_l1['y3']) + nz(npi_l1['y4']) + nz(npi_l1['y5'])
        npi_l2_expected = sum_y + nz(npi_l2['add_l2'])
        if abs(npi_l2['total_l2'] - npi_l2_expected) > 0.01:
            issues.append((company, code, term, f'NPI L2 mismatch: sum_y+add={npi_l2_expected:.2f} vs total_l2={npi_l2["total_l2"]:.2f}'))
            continue
        npi_l3_expected = sum_y + nz(npi_l3['add_l3'])
        if abs(npi_l3['total_l3'] - npi_l3_expected) > 0.01:
            issues.append((company, code, term, f'NPI L3 mismatch: sum_y+add={npi_l3_expected:.2f} vs total_l3={npi_l3["total_l3"]:.2f}'))
            continue
        # Verify NPI L1's first year (y1) is same across levels (so spread = add)
        npi_y1_l1 = npi_l1['y1']
        npi_y1_l2 = c.execute("SELECT y1 FROM npi_fee_l2 WHERE company=? AND code=? AND term=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)", (company, code, term, AS_OF, AS_OF)).fetchone()['y1']
        npi_y1_l3 = c.execute("SELECT y1 FROM npi_fee_l3 WHERE company=? AND code=? AND term=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)", (company, code, term, AS_OF, AS_OF)).fetchone()['y1']
        if not (npi_y1_l1 == npi_y1_l2 == npi_y1_l3):
            issues.append((company, code, term, f'NPI y1 differs: L1={npi_y1_l1} L2={npi_y1_l2} L3={npi_y1_l3}'))
            continue
        ok_count += 1

print(f"\n=== AUDIT RESULT ===")
print(f"OK products: {ok_count}")
print(f"Issues: {len(issues)}")
for i in issues:
    print(' ', i)