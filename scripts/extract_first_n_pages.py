#!/usr/bin/env python3
"""提取 PDF 前 N 页纯文本（用于公司-产品签名预检）

用法: python3.11 extract_first_n_pages.py <pdf_path> [--pages N]
输出: JSON { totalPages, firstPagesText, fullTextLength }

关键: Manulife 等图片型 PDF 走 fitz.get_text() 返回空字符串, 自动降级到 tesseract OCR
"""
import argparse
import fitz
import json
import os
import subprocess
import sys
import tempfile


def _ocr_first_page(doc, page_idx, tmp_dir):
    """对单页做 OCR (用包内 .tess_tmp/, 因为 /tmp 在某些 macOS 环境下不可读)"""
    page = doc[page_idx]
    mat = fitz.Matrix(2.0, 2.0)  # 2x DPI 即可, 签名预检不需要 2.5x
    pix = page.get_pixmap(matrix=mat, alpha=False)
    png_path = os.path.join(tmp_dir, f"page_{page_idx}.png")
    pix.save(png_path)
    try:
        result = subprocess.run(
            ['tesseract', png_path, 'stdout', '-l', 'eng+chi_tra'],
            capture_output=True, timeout=30, cwd=tmp_dir,
        )
        return result.stdout.decode('utf-8', errors='replace')
    finally:
        try:
            os.unlink(png_path)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", help="PDF 路径")
    ap.add_argument("--pages", type=int, default=2, help="取前 N 页（默认 2）")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    total = doc.page_count
    n = min(args.pages, total)
    chunks = []
    for i in range(n):
        chunks.append(doc[i].get_text())

    # 关键: fitz 返回空 (图片型 PDF), 降级到 OCR
    # Manulife 这类 CJS 字体子集化 PDF 会返回非空但乱码, 也需要 OCR
    text_combined = "\n".join(chunks)
    has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in text_combined)
    needs_ocr = not text_combined.strip() or not has_cjk
    if needs_ocr:
        # 用脚本所在目录下的 .tess_tmp/ (避开 /tmp 沙盒限制)
        tmp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".tess_tmp")
        tmp_dir = os.path.realpath(tmp_dir)
        os.makedirs(tmp_dir, exist_ok=True)
        chunks = []
        for i in range(n):
            try:
                chunks.append(_ocr_first_page(doc, i, tmp_dir))
            except Exception as e:
                chunks.append(f"[OCR_ERROR page {i+1}: {type(e).__name__}]")
        # 关键: OCR 在中文字符间加空格, 归一化让签名匹配可命中
        # 例: "保 單 摘 要" → "保單摘要"; "附屬 說 明" → "附屬說明"
        # 策略: 用贪婪正则一次性吃掉 "CJK + (空白 + CJK)+" 整段, 避免单次替换的连锁问题
        # 不动 ASCII 周围的空格 (避免破坏 "S&P 500" 等)
        import re
        cjk_run_re = re.compile(r'[\u4e00-\u9fff](?:\s+[\u4e00-\u9fff])+')
        chunks = [cjk_run_re.sub(lambda m: m.group(0).replace(' ', ''), c) for c in chunks]

    doc.close()
    print(json.dumps({
        "totalPages": total,
        "firstPagesText": "\n".join(chunks),
        "sampledPages": n,
        "ocrUsed": needs_ocr,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
