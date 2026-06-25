#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import pdfplumber

def to_num(s):
    if s is None:
        return None
    s = str(s).replace(",", "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except Exception:
        return None

def split_lines(cell):
    if cell is None:
        return []
    return [x.strip() for x in str(cell).split("\n") if x.strip()]

def parse_withdrawal_rows(pdf_path, pages=(42,43,44,45)):
    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for pnum in pages:
            page = pdf.pages[pnum-1]
            tables = page.extract_tables()
            if not tables:
                continue
            table = tables[-1]
            for ridx in range(5, len(table)):
                r = table[ridx]
                if not r or not r[0]:
                    continue
                ages = split_lines(r[0])
                years = split_lines(r[1])      # policy year
                paid = split_lines(r[2])       # total premium paid
                wd = split_lines(r[3])         # annual withdrawal
                cum = split_lines(r[4])        # cumulative withdrawal
                gcv = split_lines(r[5])        # guaranteed cash value
                rev = split_lines(r[7])        # reversionary bonus
                term = split_lines(r[8])       # terminal dividend
                total = split_lines(r[9])      # surrender total after withdrawal
                total_plus = split_lines(r[10])# surrender total + cumulative withdrawal
                n = min(len(ages), len(years), len(paid), len(wd), len(cum), len(gcv), len(rev), len(term), len(total), len(total_plus))
                for i in range(n):
                    rows.append({
                        "age": int(to_num(ages[i]) or 0),
                        "policy_year": int(to_num(years[i]) or 0),
                        "total_premium_paid": to_num(paid[i]) or 0,
                        "annual_withdrawal": to_num(wd[i]) or 0,
                        "cumulative_withdrawal": to_num(cum[i]) or 0,
                        "guaranteed_cash_value_after": to_num(gcv[i]) or 0,
                        "reversionary_bonus_after": to_num(rev[i]) or 0,
                        "terminal_dividend_after": to_num(term[i]) or 0,
                        "surrender_value_after": to_num(total[i]) or 0,
                        "surrender_plus_withdrawal": to_num(total_plus[i]) or 0
                    })
    # dedupe by policy year
    uniq = {}
    for r in rows:
        if r["policy_year"] and r["policy_year"] not in uniq:
            uniq[r["policy_year"]] = r
    return [uniq[k] for k in sorted(uniq.keys())]

def charts(withdraw_rows, base_rows, no_withdraw_map, out_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    matplotlib.rcParams["font.sans-serif"] = ["PingFang SC", "Microsoft YaHei", "SimHei", "Arial Unicode MS", "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False

    yrs = [r["policy_year"] for r in withdraw_rows]
    after = [r["surrender_value_after"] for r in withdraw_rows]
    base = [no_withdraw_map.get(y, 0) for y in yrs]
    cum = [r["cumulative_withdrawal"] for r in withdraw_rows]

    # chart 1: with/without withdrawal
    fig, ax = plt.subplots(figsize=(8.2,4.6))
    fig.patch.set_facecolor("#ffffff"); ax.set_facecolor("#f8fbff")
    ax.plot(yrs, base, color="#2f6fb2", label="不提领退保价值", linewidth=2.8)
    ax.plot(yrs, after, color="#b8893c", label="提领后退保价值", linewidth=2.8)
    ax.set_title("提领前后退保价值对比", color="#17324d", fontsize=14, fontweight="bold")
    ax.tick_params(colors="#35506a"); ax.grid(color="#d7e3ef", alpha=0.9)
    for s in ax.spines.values(): s.set_color("#d2dfec")
    ax.legend(facecolor="#ffffff", edgecolor="#d2dfec", labelcolor="#23415f")
    p1 = str(Path(out_dir) / "withdraw_vs_base.png")
    fig.tight_layout(); fig.savefig(p1, dpi=180); plt.close(fig)

    # chart 2: cumulative withdrawal
    fig, ax = plt.subplots(figsize=(8.2,4.6))
    fig.patch.set_facecolor("#ffffff"); ax.set_facecolor("#f8fbff")
    ax.plot(yrs, cum, color="#2f9f8d", marker="o", linewidth=2.5, label="累计提领金额")
    ax.set_title("累计提领现金流", color="#17324d", fontsize=14, fontweight="bold")
    ax.tick_params(colors="#35506a"); ax.grid(color="#d7e3ef", alpha=0.9)
    for s in ax.spines.values(): s.set_color("#d2dfec")
    ax.legend(facecolor="#ffffff", edgecolor="#d2dfec", labelcolor="#23415f")
    p2 = str(Path(out_dir) / "cumulative_withdrawal.png")
    fig.tight_layout(); fig.savefig(p2, dpi=180); plt.close(fig)

    # chart 3: guaranteed vs non-guaranteed (no-withdraw baseline)
    by_year = [r for r in base_rows if r.get("policy_year")]
    x = [int(r.get("policy_year", 0)) for r in by_year]
    g = [float(r.get("guaranteed_cash_value") or 0) for r in by_year]
    ng = [float((r.get("reversionary_bonus") or 0) + (r.get("terminal_dividend") or 0)) for r in by_year]
    fig, ax = plt.subplots(figsize=(8.2,4.6))
    fig.patch.set_facecolor("#ffffff"); ax.set_facecolor("#f8fbff")
    ax.stackplot(x, g, ng, colors=["#2f6fb2", "#d3a35b"], labels=["保证现金价值", "非保证红利价值"])
    ax.set_title("保证与非保证价值构成", color="#17324d", fontsize=14, fontweight="bold")
    ax.tick_params(colors="#35506a"); ax.grid(color="#d7e3ef", alpha=0.5)
    for s in ax.spines.values(): s.set_color("#d2dfec")
    ax.legend(facecolor="#ffffff", edgecolor="#d2dfec", labelcolor="#23415f")
    p3 = str(Path(out_dir) / "guarantee_stack.png")
    fig.tight_layout(); fig.savefig(p3, dpi=180); plt.close(fig)

    # chart 4: annual withdrawal pattern
    annual = [r["annual_withdrawal"] for r in withdraw_rows]
    fig, ax = plt.subplots(figsize=(8.2,4.6))
    fig.patch.set_facecolor("#ffffff"); ax.set_facecolor("#f8fbff")
    ax.bar(yrs, annual, color="#6ba7c8", alpha=0.95, width=0.85, label="每年提领金额")
    ax.set_title("年度提领节奏", color="#17324d", fontsize=14, fontweight="bold")
    ax.tick_params(colors="#35506a"); ax.grid(axis="y", color="#d7e3ef", alpha=0.7)
    for s in ax.spines.values(): s.set_color("#d2dfec")
    ax.legend(facecolor="#ffffff", edgecolor="#d2dfec", labelcolor="#23415f")
    p4 = str(Path(out_dir) / "annual_withdrawal.png")
    fig.tight_layout(); fig.savefig(p4, dpi=180); plt.close(fig)
    return p1, p2, p3, p4

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--base-json", required=True)
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    out_dir = Path(args.out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    base = json.loads(Path(args.base_json).read_text())
    rows = parse_withdrawal_rows(args.pdf)

    no_withdraw_map = {}
    for r in base.get("benefit_illustration", []):
        y = int(r.get("policy_year", 0))
        v = r.get("total_surrender_value")
        if y and v is not None:
            no_withdraw_map[y] = float(v)

    p1, p2, p3, p4 = charts(rows, base.get("benefit_illustration", []), no_withdraw_map, out_dir)

    # key ages mapping
    def by_age(a):
        for r in rows:
            if r["age"] == a:
                return r
        return None
    key = {
      "age_18": by_age(18),
      "age_21": by_age(21),
      "age_32": by_age(32),
      "age_45": by_age(45),
      "age_60": by_age(60),
      "age_65": by_age(65)
    }
    Path(out_dir / "withdrawal_analysis.json").write_text(json.dumps({
      "withdrawal_rows": rows,
      "key_ages": key,
      "charts": {
        "withdraw_vs_base": p1,
        "cumulative_withdrawal": p2,
        "guarantee_stack": p3,
        "annual_withdrawal": p4
      }
    }, ensure_ascii=False, indent=2))
    print(json.dumps({"status":"ok","rows":len(rows),"json":str(out_dir/'withdrawal_analysis.json')}))

if __name__ == "__main__":
    main()
