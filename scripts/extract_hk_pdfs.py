#!/usr/bin/env python3
"""
HK 储蓄险 PDF 自动抽取 v4 — PyMuPDF 坐标化文字提取

策略:
  - 用 PyMuPDF 的 get_text('words') 拿 (x, y, text) 列表
  - 按 y 分组成行 (tolerance 5px)
  - 行内按 x 排序
  - 找含"年度+退保/现金+保证"的页 → demo 表
  - 在 demo 表里:
    * 找 header 行 (含字段标签)
    * 找数据行 (以整数 1..N 或受保人X岁开头)
    * 按 x 对齐字段列

对比 pdfplumber extract_tables:
  + 列对齐更准 (基于 x 坐标, 不是 pdfplumber 启发式)
  + 不依赖表格线检测 (很多 PDF 无表格线)
  + 可处理旋转页/无框表格
"""
import json
import re
import sys
from pathlib import Path
import fitz  # PyMuPDF

PDF_DIR = Path("/Users/soldier/Downloads/官方计划书案例")
OUT_DIR = Path("/Users/soldier/hk-savings-calculator/src/data")
OUT_DIR.mkdir(parents=True, exist_ok=True)

Y_TOLERANCE = 4  # words within 4px vertically are same row
X_TOLERANCE = 3  # words within 3px horizontally are same cell

# 繁简体关键词
KW_YEAR = re.compile(r"保[单單]年[度期][终结終結]|保[单單]年[度期]|年[度期]终结|年[度期]終結|年[度期]|受保人")
KW_SURR = re.compile(r"退保[发發]还|退保[发發]還|退保价[值值]|退保價值|现金价[值值]|現金價值|退保金")
KW_GUAR = re.compile(r"保[证證]金[额額]?|保[证證]现[金]?价[值值]|保[证證]现[金]價值|保[证證]")
KW_TERM = re.compile(r"终[期][期]?红[利]|終[期][期]?紅[利]")
KW_RB = re.compile(r"复[归歸]红[利]|復歸紅利|归原红[利]|歸原紅利|累[积積][归歸]原红[利]|累[积積][归歸]原紅利|保[额額]增[值值]红[利]")

PREMIUM_TIERS = [50000, 100000, 200000, 300000, 400000, 500000]


def num(s):
    if s is None:
        return 0
    s = re.sub(r"[,\s]", "", str(s))
    if not s or s in ("-", "—", "N/A"):
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def cluster_rows(words, y_tol=Y_TOLERANCE):
    """Cluster words by y coordinate. Returns list of rows, each row is list of (x, text)."""
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: (round(w[1] / y_tol) * y_tol, w[0]))
    rows = []
    current_row = []
    current_y = None
    for w in sorted_words:
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
        if current_y is None or abs(y0 - current_y) <= y_tol:
            current_row.append((x0, text))
            current_y = y0 if current_y is None else (current_y + y0) / 2
        else:
            if current_row:
                rows.append(sorted(current_row, key=lambda x: x[0]))
            current_row = [(x0, text)]
            current_y = y0
    if current_row:
        rows.append(sorted(current_row, key=lambda x: x[0]))
    return rows


def row_text(row):
    return " ".join(t for _, t in row)


def is_demo_page_text(rows):
    """Check if page text contains demo table keywords."""
    flat = " ".join(row_text(r) for r in rows)
    has_year = bool(KW_YEAR.search(flat))
    has_surr = bool(KW_SURR.search(flat)) or bool(KW_TERM.search(flat))
    has_guar = bool(KW_GUAR.search(flat)) or bool(KW_RB.search(flat))
    return has_year and has_surr and has_guar


def cluster_columns(rows, x_tol=X_TOLERANCE):
    """Find column x-positions across all rows (by clustering x values)."""
    xs = []
    for row in rows:
        for x, _ in row:
            xs.append(x)
    if not xs:
        return []
    xs = sorted(set(xs))
    cols = [xs[0]]
    for x in xs[1:]:
        if x - cols[-1] > x_tol:
            cols.append(x)
    return cols


def get_value_at_x(row, target_x, x_tol=X_TOLERANCE):
    """Get text at given x position in row."""
    for x, t in row:
        if abs(x - target_x) <= x_tol:
            return t
    return None


def find_premium_tier_x(rows):
    """Find x-position of each premium tier (50k/100k/200k/...) in any row."""
    tier_x = {}
    for row in rows[:8]:  # check first 8 rows
        for x, t in row:
            s = t.replace(",", "").replace(" ", "")
            for tier in PREMIUM_TIERS:
                if tier in tier_x:
                    continue
                if s == str(tier) or s == str(tier) + ".00":
                    tier_x[tier] = x
    return tier_x


def find_field_columns(rows):
    """Identify x-position for each field by scanning header rows.

    Returns {field_name: x_position}. Uses the x of the WORD that matches the field label.
    """
    field_x = {}
    field_keywords = {
        "premium": re.compile(r"已[缴繳][保费費][总额總額]?|繳付保費[总额總額]?|缴付保费[总额總額]?|已[缴繳]?[总總]保[费費]|已[缴繳]保[费費]"),
        "total": re.compile(r"退保价[值值]|退保價值|现金价[值值]|現金價值|退保金|退保[发發]还|退保[发發]還|总[额額]|總額|总[赔偿賠償]金[额額]|總賠償金額|應付金額"),
        "GCV": re.compile(r"保[证證]金[额額]?|保[证證]现[金]?价[值值]|保[证證]现[金]價值"),
        "RB": re.compile(r"复[归歸]红[利]|復歸紅利|归原红[利]|歸原紅利|累[积積][归歸]原红[利]|累[积積][归歸]原紅利|保[额額]增[值值]红[利]|非保[证證][总總][额額]?|复归|歸原"),
        "TB": KW_TERM,
    }
    # For each row, for each word, check if word matches a field → record that word's x
    for row in rows:
        for x, text in row:
            for field, pat in field_keywords.items():
                if field in field_x:
                    continue
                if pat.search(text):
                    field_x[field] = x
                    break
    return field_x


def parse_demo_page(rows, target_premium=100000):
    """Parse demo data from a page's rows."""
    if not rows:
        return []

    # Find premium tier positions
    tier_x = find_premium_tier_x(rows)
    has_multi_tier = bool(tier_x)

    # Find field column positions (for header)
    field_x = find_field_columns(rows)
    if not field_x:
        return []

    # Determine target premium column
    if has_multi_tier:
        if target_premium in tier_x:
            target_tier_x = tier_x[target_premium]
        else:
            target_tier_x = tier_x[min(tier_x.keys())]
        # In multi-tier tables, each field has multiple x positions (one per tier)
        # The first field_x value is the "label x", tier_x values are the data positions
        # So for field F at tier T: data_x = field_x[F] + (tier_x[T] - first_tier_x)
        # But this assumes linear alignment — let's try a simpler approach:
        # For each field, collect ALL x positions where that field's data might be
        # then take the one nearest target_tier_x
        pass
    else:
        target_tier_x = None

    # For each data row (starts with year int or age label)
    demo_rows = []
    for row in rows:
        if not row:
            continue
        first_x, first_text = row[0]
        # Year match
        year_match = re.match(r"^(\d+)$", first_text)
        age_match = re.match(r"^(\d+)\s*[岁歲]", first_text)
        if year_match:
            year = int(year_match.group(1))
            label = None
        elif age_match:
            year = int(age_match.group(1))
            label = first_text
        else:
            continue
        if year < 1 or year > 200:
            continue

        # For each field, find the value
        result = {"year": year, "label": label}
        for field, fx in field_x.items():
            if has_multi_tier:
                # Multi-tier: field's data is at fx + (target_tier_x - first_tier_x)
                # Find the first tier column (smallest x)
                first_tier_x = min(tier_x.values())
                target_x = fx + (target_tier_x - first_tier_x)
                # But this might overshoot if there are gaps
                # Better: find the closest x to target_tier_x that has a numeric value
                target_x = find_nearest_x_with_number(row, target_tier_x, field_x)
            else:
                target_x = fx
            value = get_value_at_x(row, target_x, x_tol=30)
            if value is not None:
                result[field] = num(value)
        if "GCV" in result or "total" in result:
            demo_rows.append(result)

    return demo_rows


def find_nearest_x_with_number(row, target_x, field_x):
    """Find the x position nearest to target_x that has a numeric value and is a data cell."""
    best_x = None
    best_dist = float("inf")
    for x, t in row:
        # Skip field label positions
        if any(abs(x - fx) < 5 for fx in field_x.values()):
            continue
        try:
            n = num(t)
            if n > 0:
                dist = abs(x - target_x)
                if dist < best_dist:
                    best_dist = dist
                    best_x = x
        except Exception:
            continue
    return best_x if best_x is not None else target_x


def cross_page_merge(page_rows_list):
    """Merge demo rows from multiple pages, dedup by year."""
    seen = {}
    for rows in page_rows_list:
        for r in rows:
            y = r["year"]
            if y not in seen:
                seen[y] = r
            else:
                # Merge fields
                for k, v in r.items():
                    if k not in seen[y] or seen[y][k] == 0:
                        seen[y][k] = v
    return sorted(seen.values(), key=lambda r: r["year"])


def extract_demo(pdf_path):
    """Extract demo data from PDF using PyMuPDF coordinate extraction."""
    doc = fitz.open(pdf_path)

    # Find pages with demo table
    demo_page_rows = []
    for pi, page in enumerate(doc):
        words = page.get_text("words")
        if not words:
            continue
        rows = cluster_rows(words)
        if is_demo_page_text(rows):
            parsed = parse_demo_page(rows)
            if parsed:
                demo_page_rows.append(parsed)

    if not demo_page_rows:
        return None

    # Merge across pages
    return cross_page_merge(demo_page_rows)


def make_summary(pdf_path):
    """Extract metadata (currency, annual_prem, pay_years) from HK insurance PDF.

    Bug fix history:
      - Currency: previously matched disclaimer "港元" before header "美元",
        mislabeling 6 USD products as HKD. Now scans ALL pages, prefers header
        field pattern "保单货币: 美元/HKD/人民幣", falls back to keyword count.
      - annual_prem: previously fell back to 100000 default when header regex
        missed. Now reads Y5 cumulative premium from demo table and divides
        by pay_years to get per-year premium.
    """
    doc = fitz.open(pdf_path)
    if len(doc) == 0:
        return {}

    # --- Currency detection ---
    # Scan ALL pages (header often not on page 1)
    full_text = " ".join(p.get_text() for p in doc)

    # Priority 1: explicit header field "保单货币: USD/HKD/人民幣"
    header_currency = None
    m = re.search(
        r"保[单單]货[币幣]\s*[:：]\s*(美元|港元|港幣|人民幣|人民币|USD|HKD|CNY)",
        full_text,
    )
    if m:
        sym = m.group(1)
        if sym in ("美元", "USD"):
            header_currency = "USD"
        elif sym in ("港元", "港幣", "HKD"):
            header_currency = "HKD"
        elif sym in ("人民幣", "人民币", "CNY"):
            header_currency = "CNY"

    # Priority 2: count occurrences with page-1 weighting (disclaimers on later pages
    # shouldn't override the page-1 currency banner)
    text_p1 = doc[0].get_text() if len(doc) > 0 else ""
    counts = {
        "USD": len(re.findall(r"美元|USD", text_p1)) * 10 + len(re.findall(r"美元|USD", full_text)),
        "HKD": len(re.findall(r"港元|港幣|HKD", text_p1)) * 10 + len(re.findall(r"港元|港幣|HKD", full_text)),
        "CNY": len(re.findall(r"人民幣|人民币|CNY", text_p1)) * 10 + len(re.findall(r"人民幣|人民币|CNY", full_text)),
    }
    # If header says one thing, that wins (disclaimers shouldn't override)
    if header_currency:
        currency = header_currency
    else:
        # No header found, use weighted keyword count
        currency = max(counts, key=counts.get) if max(counts.values()) > 0 else "USD"

    # --- Pay years (needed before annual_prem) ---
    pay_years = 5
    m = re.search(
        r"(\d+)\s*[年]?[\s]*(?:供[款缴]年[期]|缴费年[期]|繳付年[期期]|繳費年[期期])",
        full_text,
    )
    if m:
        pay_years = int(m.group(1))

    # --- annual_prem ---
    # Priority 1: explicit header regex on page 1
    annual_prem = 0
    for pat in [
        r"投[保][时時][每]?年[每]?年[总]?保[费費][^,\d\n]{0,20}([\d,]+\.?\d*)",
        r"每年保[费費][^,\d\n]{0,20}([\d,]+\.?\d*)",
        r"年[缴繳]保[费費][^,\d\n]{0,20}([\d,]+\.?\d*)",
    ]:
        m = re.search(pat, text_p1, re.IGNORECASE)
        if m:
            v = num(m.group(1))
            if v >= 10000:
                annual_prem = v
                break

    # Priority 2: derive from cumulative premium in demo table
    # (avoid 100K hardcoded default; planbooks may use 50K/100K/200K/400K/500K)
    if annual_prem == 0:
        demo_rows = extract_demo(pdf_path)
        if demo_rows:
            # Probe multiple years — some PDFs have column misalignment for Y1-Y5
            # (premium column reads year number instead of cumulative value)
            # but Y6+ is correctly aligned. Pick the most consistent value.
            vals = []
            for probe_year in range(pay_years, min(pay_years + 6, len(demo_rows) + 1)):
                y = next((r for r in demo_rows if r.get("year") == probe_year), None)
                if not y:
                    continue
                # Only use rows where premium column reads a sensible large number
                # (avoids year-number false match like premium=5 at Y5)
                p_val = y.get("premium") or 0
                if p_val >= 50000:  # genuine cumulative premium
                    # cumulative premium / pay_years = annual premium
                    # (NOT probe_year — at Y6, cumulative is still 5×annual for 5-pay)
                    derived = p_val // pay_years
                    if 30000 <= derived <= 800000:
                        vals.append(derived)

            if vals:
                # Pick the most common value (mode) — handles outlier from misaligned rows
                from collections import Counter
                annual_prem = Counter(vals).most_common(1)[0][0]
                # Snap to nearest standard tier (50K/100K/200K/300K/400K/500K)
                if annual_prem not in PREMIUM_TIERS:
                    nearest = min(PREMIUM_TIERS, key=lambda t: abs(t - annual_prem))
                    # Only snap if within 10% of a tier (avoid bad rounding)
                    if abs(nearest - annual_prem) / nearest < 0.10:
                        annual_prem = nearest

    # Final fallback (only if all else failed - rare edge case)
    if annual_prem == 0:
        annual_prem = 100000

    return {"currency": currency, "annual_prem": annual_prem, "pay_years": pay_years}


def process_pdf(pdf_path):
    print(f"  Processing {pdf_path.name}...")
    summary = make_summary(pdf_path)
    demo_rows = extract_demo(pdf_path)

    if not demo_rows:
        print(f"    ⚠ Could not extract demo table from {pdf_path.name}")
        return None
    if not summary:
        print(f"    ⚠ Could not extract summary from {pdf_path.name}")
        return None

    print(f"    ✓ {len(demo_rows)} demo rows, premium={summary['annual_prem']}, currency={summary['currency']}")
    if demo_rows:
        first3 = demo_rows[:3]
        last3 = demo_rows[-3:]
        print(f"      first 3: {first3}")
        print(f"      last 3: {last3}")

    return {
        "product_name_from_pdf": pdf_path.stem,
        "currency": summary["currency"],
        "pay_years": summary["pay_years"],
        "annual_prem": summary["annual_prem"],
        "expected_lifetime": 100,
        "demo_rows": demo_rows,
        "source_pdf": str(pdf_path),
        "extracted_at": "2026-07-01",
    }


def main():
    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    print(f"Found {len(pdfs)} PDFs in {PDF_DIR}")

    results = []
    skipped = []
    for pdf in pdfs:
        if "财富盈活储蓄保险计划" in pdf.name:
            slug = "aia_cfh_demo"
            out_path = OUT_DIR / f"{slug}.json"
            if out_path.exists():
                print(f"  ⏭  Skip {pdf.name} (manually crafted)")
                continue

        out = process_pdf(pdf)
        if out is None:
            skipped.append(pdf.name)
            continue

        slug = re.sub(r"[^\w\u4e00-\u9fff]", "_", pdf.stem)
        out_path = OUT_DIR / f"{slug}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Saved to {out_path.name}")
        results.append(out)

    print(f"\nDone. Extracted {len(results)}, skipped {len(skipped)}")
    if skipped:
        for n in skipped:
            print(f"  - {n}")


if __name__ == "__main__":
    main()