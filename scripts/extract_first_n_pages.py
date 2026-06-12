#!/usr/bin/env python3
"""提取 PDF 前 N 页纯文本（用于公司-产品签名预检）

用法: python3.11 extract_first_n_pages.py <pdf_path> [--pages N]
输出: JSON { totalPages, firstPagesText, fullTextLength }
"""
import argparse
import fitz
import json
import sys


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
    doc.close()
    print(json.dumps({
        "totalPages": total,
        "firstPagesText": "\n".join(chunks),
        "sampledPages": n,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
