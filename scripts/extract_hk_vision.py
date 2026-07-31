#!/usr/bin/env python3
"""
HK 储蓄险 PDF 抽取 — Vision LLM (Gemini) 方案

策略:
  1. PyMuPDF 把 PDF 演示表页渲染成 PNG
  2. Gemini vision 读图 + 结构化 prompt → JSON
  3. 校验 sum(GCV+RB+TB) ≈ total, 异常行丢弃
  4. 输出到 src/data/

首次跑前先设置环境变量 GEMINI_API_KEY
"""
import base64
import json
import os
import re
import sys
import time
from pathlib import Path
import fitz

PDF_DIR = Path("/Users/soldier/Downloads/官方计划书案例")
OUT_DIR = Path("/Users/soldier/hk-savings-calculator/src/data")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Load API key from .env if not in env
def load_api_key():
    key = os.environ.get("MINIMAX_API_KEY")
    if key:
        return key
    env_file = Path("/Users/soldier/insurance-ppt-v3/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            m = re.match(r'MINIMAX_API_KEY=(.+)', line)
            if m:
                return m.group(1).strip().strip('"')
    return None

GEMINI_API_KEY = load_api_key()
VISION_MODEL = "MiniMax-M3"
VISION_URL = "https://api.minimax.chat/v1/text/chatcompletion_v2"


SYSTEM_PROMPT = """你是香港保险计划书解析专家。请从图中提取「退保发还金额」演示表的全部数据行。

要求:
1. 只看"退保发还金额"那组数据(不是"身故赔偿额"), 注意两组数据通常完全相同, 优先取第一组
2. 每行字段: year(年度或受保人年龄,如 1/2/3/4/5/10/15/... 或 65岁/70岁/.../100岁) / GCV(保证金额) / RB(复归红利或归原红利或保额增值红利) / TB(终期分红) / total(总额=GCV+RB+TB)
3. 数值原样输出, 不要四舍五入, 保留千分位逗号要去掉
4. 只输出 JSON 数组, 不要任何额外文字或 markdown 代码块

输出格式 (仅这个):
[
  {"year": 1, "GCV": 103, "RB": 0, "TB": 0, "total": 103},
  {"year": 2, "GCV": 103, "RB": 0, "TB": 0, "total": 103},
  ...
]

注意:
- 早期(1-2年)GCV 可能为小额(几百),RB/TB 为 0
- 后期 TB 通常远大于 GCV
- total 必须 = GCV + RB + TB (校验不通过说明读错了)
- 如果图中演示表跨多页(同一年值出现多次),只保留最后一次(终值)
- 受保人X岁 是关键年龄点(65/70/75/80/85/90/95/100 岁), 必含
"""


def render_page(pdf_path, page_idx, dpi=150):
    """Render PDF page as PNG bytes."""
    doc = fitz.open(pdf_path)
    if page_idx >= len(doc):
        doc.close()
        return None
    page = doc[page_idx]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    data = pix.tobytes("png")
    doc.close()
    return data


def find_demo_pages(pdf_path):
    """Find pages most likely to contain the main demo table.

    Strategy: scan pages for keywords (保单年度+退保+保证), prefer pages with many
    numeric data rows.
    """
    doc = fitz.open(pdf_path)
    candidates = []
    for pi, page in enumerate(doc):
        text = page.get_text()
        if not text:
            continue
        # Score: +1 for 保单年度, +1 for 退保, +1 for 总额
        score = sum(1 for kw in ["保单年度", "退保", "总额", "保证", "复归", "终期"]
                    if kw in text)
        # Prefer pages with many consecutive integers (data rows)
        nums = sum(1 for line in text.split("\n")
                   if re.match(r"^\s*\d+\s*$", line.strip()))
        candidates.append((pi, score, nums, text[:100].replace("\n", " ")))
    doc.close()
    # Sort by (score desc, nums desc) and return top 5
    candidates.sort(key=lambda x: (-x[1], -x[2]))
    return candidates[:8]


def call_gemini_vision(image_bytes, prompt):
    """Call MiniMax-M3 vision API with image + prompt. Returns text response."""
    import urllib.request
    import urllib.error

    image_b64 = base64.b64encode(image_bytes).decode("ascii")

    body = {
        "model": VISION_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}}
            ]
        }],
        "temperature": 0.1,
        "max_tokens": 8192,
    }

    req = urllib.request.Request(
        VISION_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GEMINI_API_KEY}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if not data.get("choices"):
                raise RuntimeError(f"Empty response: {json.dumps(data)[:300]}")
            content = data["choices"][0]["message"]["content"]
            return content
    except urllib.error.HTTPError as e:
        error_text = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Vision HTTP {e.code}: {error_text[:300]}")
    except Exception as e:
        raise RuntimeError(f"Vision call failed: {e}")


def parse_llm_response(text):
    """Parse LLM text response into list of {year, GCV, RB, TB, total}."""
    text = text.strip()
    # Strip markdown code block
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    # Try to find JSON array
    m = re.search(r"\[[\s\S]*\]", text)
    if m:
        text = m.group(0)
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    return None


def validate_row(r):
    """Validate a row dict, return cleaned row or None."""
    if not isinstance(r, dict):
        return None
    # Parse year — can be int or string like "65岁"
    raw_year = r.get("year", 0)
    label = r.get("label")
    try:
        if isinstance(raw_year, str):
            m = re.search(r"(\d+)", raw_year)
            if m:
                year = int(m.group(1))
                if "岁" in raw_year or "歲" in raw_year:
                    label = label or raw_year
            else:
                return None
        else:
            year = int(raw_year)
    except (ValueError, TypeError):
        return None
    if year < 1 or year > 200:
        return None
    gcv = int(r.get("GCV", 0) or 0)
    rb = int(r.get("RB", 0) or 0)
    tb = int(r.get("TB", 0) or 0)
    total = int(r.get("total", 0) or 0)
    # Allow small discrepancy (rounding)
    expected = gcv + rb + tb
    if total == 0 and expected > 0:
        total = expected
    elif abs(total - expected) > max(100, expected * 0.01):
        # If total deviates by more than 1% from sum, row is suspect
        # But for some early rows, TB might not be declared yet → 0 + 0 + 0
        if not (gcv == 0 and rb == 0 and tb == 0):
            return None  # Discard suspect row
    return {
        "year": year,
        "label": label,
        "GCV": gcv,
        "RB": rb,
        "TB": tb,
        "total": total,
    }


def extract_from_page(pdf_path, page_idx):
    """Render page + call Gemini + parse response. Returns list of rows."""
    img = render_page(pdf_path, page_idx, dpi=150)
    if not img:
        return None
    response = call_gemini_vision(img, SYSTEM_PROMPT)
    parsed = parse_llm_response(response)
    if not parsed:
        print(f"    ⚠ Page {page_idx+1}: parse failed")
        return None
    cleaned = []
    for r in parsed:
        c = validate_row(r)
        if c:
            cleaned.append(c)
    return cleaned


def cross_page_dedup(all_pages_rows):
    """Merge rows from multiple pages, dedup by year (keep last)."""
    seen = {}
    for page_rows in all_pages_rows:
        for r in page_rows:
            seen[r["year"]] = r
    return sorted(seen.values(), key=lambda r: r["year"])


def process_pdf(pdf_path):
    print(f"  Processing {pdf_path.name}...")
    candidates = find_demo_pages(pdf_path)
    print(f"    Candidates: {[(p[0]+1, p[1], p[2]) for p in candidates[:5]]}")

    all_rows = []
    # v2: also include pages with score==1 (繁体 + 横向多档表 strict keyword match 失败)
    filtered = [c for c in candidates if c[1] >= 1][:7]
    for pi, score, nums, _ in filtered:
        print(f"    Trying page {pi+1} (score={score}, nums={nums})...")
        try:
            rows = extract_from_page(pdf_path, pi)
            if rows:
                print(f"      ✓ Got {len(rows)} rows")
                all_rows.append(rows)
                if len(rows) >= 80:
                    break
        except Exception as e:
            print(f"      ✗ {e}")
        time.sleep(1)

    if not all_rows:
        return None

    # Merge across pages, dedup by year
    merged = cross_page_dedup(all_rows)
    print(f"    ✓ Merged: {len(merged)} unique years")
    return merged


def make_summary(pdf_path):
    doc = fitz.open(pdf_path)
    if len(doc) == 0:
        return {}
    text = doc[0].get_text()
    doc.close()

    currency = "USD"
    if re.search(r"港元|HKD|港幣", text):
        currency = "HKD"
    elif re.search(r"人民幣|CNY|人民币", text):
        currency = "CNY"
    elif re.search(r"美元|USD", text):
        currency = "USD"

    annual_prem = 100000
    for pat in [
        r"投[保][时時][每]?年[每]?年[总]?保[费費][^,\d\n]{0,20}([\d,]+\.?\d*)",
        r"每年保[费費][^,\d\n]{0,20}([\d,]+\.?\d*)",
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            v = float(re.sub(r"[,\s]", "", m.group(1)))
            v = int(v)
            if v >= 10000:
                annual_prem = v
                break

    pay_years = 5
    m = re.search(r"(\d+)\s*[年]?[\s]*(?:供[款缴]年[期]|缴费年[期]|繳付年[期期]|繳費年[期期])", text)
    if m:
        pay_years = int(m.group(1))

    return {"currency": currency, "annual_prem": annual_prem, "pay_years": pay_years}


def main():
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY not set")
        sys.exit(1)

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
        if not out:
            skipped.append(pdf.name)
            continue

        try:
            summary = make_summary(pdf)
        except Exception as e:
            print(f"    ⚠ Summary parse failed for {pdf.name}: {e}")
            summary = {"currency": "USD", "annual_prem": 100000, "pay_years": 5}

        record = {
            "product_name_from_pdf": pdf.stem,
            "currency": summary["currency"],
            "pay_years": summary["pay_years"],
            "annual_prem": summary["annual_prem"],
            "expected_lifetime": 100,
            "demo_rows": out,
            "source_pdf": str(pdf),
            "extracted_at": "2026-07-01",
            "extraction_method": "vision_llm_minimax_m3",
        }

        slug = re.sub(r"[^\w\u4e00-\u9fff]", "_", pdf.stem)
        out_path = OUT_DIR / f"{slug}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Saved to {out_path.name} ({len(out)} rows)")
        results.append(record)

    print(f"\nDone. Extracted {len(results)}, skipped {len(skipped)}")
    if skipped:
        for n in skipped:
            print(f"  - {n}")


if __name__ == "__main__":
    main()