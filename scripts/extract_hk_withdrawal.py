#!/usr/bin/env python3
"""
HK 储蓄险: 提取后 demo 表抽取 (vision LLM, MiniMax-M3)

策略:
  1. 找含「现金提取后之退保发还金额 / 现金提取金额 / cash withdrawal」等关键字的页
  2. Vision LLM 读图 → 提取每行 (year, withdrawal_amount, GCV_after, RB_after, TB_after, total_after)
  3. 输出到 src/data/<product>_withdrawal.json

与 Phase 1 的区别:
  - 表头可能是「现金提取金额 + 退保权益」而不是简单的 GCV/RB/TB
  - 提取后 CV 表 (after withdrawal) 才与 engine 567 投影对齐
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

SYSTEM_PROMPT = """你是香港保险计划书解析专家。请从图中提取「现金提取后」演示表（也叫「现金提取后之退保发还金额」或「退保价值 - 现金提取说明」）。

注意：这张表是**提取后**的剩余 CV, 不是无提取的 CV。
每行字段:
  year (年度, 如 1/2/3/4/5/10/15/...)
  withdrawal (本年提取的金额, 可能是负数或单独列出)
  GCV_after (提取后的保证现金价值, 或简称保证金额/Guaranteed)
  RB_after (提取后的复归红利/归原红利/累积归原红利/保额增值红利)
  TB_after (提取后的终期红利/终期分红)
  total_after (提取后的总额 = GCV_after + RB_after + TB_after)

要求:
  1. 提取表的标题必须包含 "现金提取" 或 "Cash Withdrawal" 或 "款项提取" 或 "退保保障"
  2. 必须是「提取后」表的剩余价值, 忽略 "身故赔偿 / Death Benefit" 那组
  3. 数值原样输出 (去掉千分位逗号, 不要四舍五入)
  4. 只输出 JSON 数组

输出格式:
[
  {"year": 1, "withdrawal": 0, "GCV_after": 100, "RB_after": 0, "TB_after": 0, "total_after": 100},
  {"year": 6, "withdrawal": 35000, "GCV_after": 28000, "RB_after": 0, "TB_after": 100000, "total_after": 128000},
  ...
]

如果图中没有提取后演示表 (仅无提取演示表), 输出空数组 []
"""


def render_page(pdf_path, page_idx, dpi=180):
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


def find_withdrawal_pages(pdf_path):
    """Find pages with 现金提取 + demo header."""
    doc = fitz.open(pdf_path)
    candidates = []
    KW_WD = re.compile(r"現金提取|现金提取|款项提取|退保保障|部份退保|提取")
    KW_DEMO = re.compile(r"保[证證]金[额額]?|保[证證]现[金]?[价值價值]|累积?[归歸]原[红紅]利|归原|復歸|保[额額]增[值值]红[利]|退保[价價值發还發還]|終期|终期|复归|復歸")
    for pi, page in enumerate(doc):
        text = page.get_text() or ""
        # AIA PDFs have base64 text — skip those
        if len(text) > 0 and not any(ord(c) > 0x4E00 for c in text[:200]):
            # No Chinese chars in first 200 chars — likely base64 or image-only
            continue
        if KW_WD.search(text) and KW_DEMO.search(text):
            nums = sum(1 for l in text.split("\n") if re.match(r"^\s*\d+\s*$", l.strip()))
            if nums >= 10:
                candidates.append((pi, nums, text[:80].replace("\n", " ")))
    doc.close()
    candidates.sort(key=lambda x: -x[1])
    return candidates[:7]


def call_vision(image_bytes):
    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    body = {
        "model": VISION_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": SYSTEM_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}}
            ]
        }],
        "temperature": 0.1,
        "max_tokens": 8192,
    }
    import urllib.request
    req = urllib.request.Request(
        VISION_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GEMINI_API_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]


def parse_response(text):
    text = text.strip()
    if text == "[]" or text.startswith("[]"):
        return []
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
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


def validate(r):
    if not isinstance(r, dict):
        return None
    raw = r.get("year", 0)
    if isinstance(raw, str):
        m = re.search(r"(\d+)", raw)
        if not m: return None
        year = int(m.group(1))
    else:
        year = int(raw)
    if year < 1 or year > 200: return None
    def n(k):
        v = r.get(k, 0) or 0
        try:
            return int(v)
        except (ValueError, TypeError):
            return 0
    return {
        "year": year,
        "withdrawal": n("withdrawal"),
        "GCV_after": n("GCV_after"),
        "RB_after": n("RB_after"),
        "TB_after": n("TB_after"),
        "total_after": n("total_after"),
    }


def cross_dedup(per_page):
    seen = {}
    for rows in per_page:
        for r in rows:
            seen[r["year"]] = r
    return sorted(seen.values(), key=lambda r: r["year"])


def extract_pdf(pdf_path):
    print(f"  Processing {pdf_path.name}...")
    cands = find_withdrawal_pages(pdf_path)
    print(f"    Found {len(cands)} candidate pages")
    if not cands:
        return None
    all_rows = []
    for pi, nums, _ in cands:
        print(f"    Trying P{pi+1} ({nums} numeric rows)...")
        try:
            img = render_page(pdf_path, pi)
            if not img:
                continue
            resp = call_vision(img)
            parsed = parse_response(resp)
            if parsed:
                cleaned = [validate(r) for r in parsed]
                cleaned = [c for c in cleaned if c]
                if cleaned:
                    print(f"      ✓ Got {len(cleaned)} rows")
                    all_rows.append(cleaned)
                    if len(cleaned) >= 80:
                        break
        except Exception as e:
            print(f"      ✗ {e}")
        time.sleep(1)
    if not all_rows:
        return None
    return cross_dedup(all_rows)


def slugify(stem):
    return re.sub(r"[^\w\u4e00-\u9fff]", "_", stem)


def main():
    if not GEMINI_API_KEY:
        print("ERROR: API key not set")
        sys.exit(1)
    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    targets = sys.argv[1:] if len(sys.argv) > 1 else None
    if targets:
        pdfs = [p for p in pdfs if any(t in p.name for t in targets)]
    print(f"Processing {len(pdfs)} PDFs")

    results = []
    for pdf in pdfs:
        try:
            rows = extract_pdf(pdf)
        except Exception as e:
            print(f"  ⚠ {pdf.name}: {e}")
            continue
        if not rows:
            print(f"  ⊘ No withdrawal demo table in {pdf.name}")
            continue
        record = {
            "product_name_from_pdf": pdf.stem,
            "currency": "USD",
            "pay_years": 5,
            "annual_prem": 100000,
            "expected_lifetime": 100,
            "demo_rows_after": rows,
            "source_pdf": str(pdf),
            "extracted_at": "2026-07-01",
            "extraction_method": "vision_llm_withdrawal",
        }
        slug = slugify(pdf.stem) + "_withdrawal"
        out = OUT_DIR / f"{slug}.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Saved {out.name} ({len(rows)} rows)")
        results.append(pdf.name)

    print(f"\nDone: {len(results)} extracted")
    for n in results:
        print(f"  - {n}")


if __name__ == "__main__":
    main()
