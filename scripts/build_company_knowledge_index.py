#!/usr/bin/env python3
"""Build a deterministic, deployable index for the local company knowledge base."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import fitz  # type: ignore
except ImportError:  # pragma: no cover - optional fallback for bare Python
    fitz = None


SUPPORTED_EXTENSIONS = {".pdf", ".pptx", ".docx", ".jpg", ".jpeg", ".png"}
DOCUMENT_TYPE_RULES = [
    ("annual_report", re.compile(r"年报|年度回顧|annual.?report", re.I)),
    ("financial_strength", re.compile(r"財務|财务|實力|实力|償付|偿付|rating|评级|fact.?sheet|概览|概覽|简介|簡介|一图", re.I)),
    ("investment", re.compile(r"投資|投资|market.?insight|市場|市场|index|指数", re.I)),
    ("participating_performance", re.compile(r"分紅|分红|實現率|实现率|权益表现|權益表現", re.I)),
    ("product_brochure", re.compile(r"手册|手冊|brochure|factsheet|product.?summary|产品摘要|產品摘要|產品介紹|产品介绍", re.I)),
    ("policy_contract", re.compile(r"合同|contract|provision|policy.?wording", re.I)),
    ("illustration", re.compile(r"计划书|計劃書|illustration|sample.?pi", re.I)),
    ("training", re.compile(r"培训|培訓|training|launch|pitch.?deck", re.I)),
    ("service", re.compile(r"服务|服務|养老|養老|会员|會員|礼遇|禮遇", re.I)),
]
INTERNAL_AUDIENCE_PATTERN = re.compile(
    r"\bAIA\s*[–-]\s*INTERNAL\b|\bINTERNAL\b|只供內部使用|只供内部使用|內部使用|内部使用|機密|机密|CONFIDENTIAL",
    re.I,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_text(value: str, limit: int = 1200) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit]


def read_xml_text(path: Path, prefix: str) -> str:
    texts: list[str] = []
    try:
        with zipfile.ZipFile(path) as archive:
            for name in sorted(archive.namelist()):
                if not name.startswith(prefix) or not name.endswith(".xml"):
                    continue
                raw = archive.read(name).decode("utf-8", errors="ignore")
                texts.extend(re.findall(r"<a:t>(.*?)</a:t>|<w:t[^>]*>(.*?)</w:t>", raw, re.S))
    except (OSError, zipfile.BadZipFile):
        return ""
    return normalize_text(" ".join("".join(match) for match in texts))


def ocr_pdf_pages(doc: Any, max_pages: int) -> str:
    if shutil.which("tesseract") is None:
        return ""
    texts: list[str] = []
    with tempfile.TemporaryDirectory(prefix="insurance-ppt-ocr-") as temp_dir:
        for page_index in range(min(doc.page_count, max_pages)):
            image_path = Path(temp_dir) / f"page-{page_index + 1}.png"
            pixmap = doc.load_page(page_index).get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
            pixmap.save(image_path)
            result = subprocess.run(
                ["tesseract", str(image_path), "stdout", "-l", "chi_sim+chi_tra+eng", "--psm", "6"],
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )
            if result.returncode == 0:
                texts.append(result.stdout)
    return normalize_text(" ".join(texts))


def extract_text(path: Path, ocr_empty: bool = False, ocr_max_pages: int = 2) -> tuple[str, int | None]:
    ext = path.suffix.lower()
    if ext == ".pdf" and fitz is not None:
        try:
            doc = fitz.open(path)
            text = " ".join(page.get_text("text") for page in list(doc)[:3])
            normalized = normalize_text(text)
            if ocr_empty and len(normalized) < 80:
                normalized = ocr_pdf_pages(doc, ocr_max_pages)
            return normalized, doc.page_count
        except Exception:
            return "", None
    if ext == ".pptx":
        return read_xml_text(path, "ppt/slides/"), None
    if ext == ".docx":
        return read_xml_text(path, "word/"), None
    return "", None


def classify_document(path: Path) -> str:
    name = path.name
    for document_type, pattern in DOCUMENT_TYPE_RULES:
        if pattern.search(name):
            return document_type
    if path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
        return "image"
    return "other"


def classify_audience(path: Path, text_excerpt: str) -> str:
    if INTERNAL_AUDIENCE_PATTERN.search(f"{path.name} {text_excerpt}"):
        return "internal"
    if text_excerpt:
        return "public"
    return "unknown"


def load_company_configs(config_dir: Path) -> list[dict[str, Any]]:
    return [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(config_dir.glob("*.json"))
    ]


def resolve_company_id(relative_path: Path, company_configs: list[dict[str, Any]]) -> str:
    top_directory = relative_path.parts[0] if relative_path.parts else ""
    for company in company_configs:
        if top_directory in company.get("knowledgeDirectories", []):
            return str(company["id"])
    lowered = top_directory.lower()
    for company in company_configs:
        if any(alias.lower() in lowered for alias in company.get("aliases", [])):
            return str(company["id"])
    return "unmapped"


def build_index(root: Path, config_dir: Path, ocr_empty: bool = False, ocr_max_pages: int = 2) -> dict[str, Any]:
    company_configs = load_company_configs(config_dir)
    documents: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name.startswith(".") or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        relative_path = path.relative_to(root)
        text_excerpt, page_count = extract_text(path, ocr_empty=ocr_empty, ocr_max_pages=ocr_max_pages)
        stat = path.stat()
        documents.append(
            {
                "id": sha256(path),
                "companyId": resolve_company_id(relative_path, company_configs),
                "sourceDirectory": relative_path.parts[0],
                "relativePath": relative_path.as_posix(),
                "fileName": path.name,
                "extension": path.suffix.lower().lstrip("."),
                "documentType": classify_document(path),
                "audience": classify_audience(path, text_excerpt),
                "sizeBytes": stat.st_size,
                "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                "pageCount": page_count,
                "textExcerpt": text_excerpt,
            }
        )
    mapped = sum(1 for document in documents if document["companyId"] != "unmapped")
    return {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "knowledgeRoot": str(root),
        "documentCount": len(documents),
        "mappedDocumentCount": mapped,
        "unmappedDocumentCount": len(documents) - mapped,
        "documents": documents,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/Users/soldier/Desktop/公司介绍")
    parser.add_argument("--config-dir", default="config/companies")
    parser.add_argument("--out", default="data/company-knowledge-index.json")
    parser.add_argument("--ocr-empty", action="store_true", help="OCR the first pages of image-only PDFs")
    parser.add_argument("--ocr-max-pages", type=int, default=2)
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    config_dir = Path(args.config_dir).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"Knowledge root not found: {root}")
    out.parent.mkdir(parents=True, exist_ok=True)
    index = build_index(root, config_dir, ocr_empty=args.ocr_empty, ocr_max_pages=max(1, args.ocr_max_pages))
    out.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Indexed {index['documentCount']} documents "
        f"({index['mappedDocumentCount']} mapped, {index['unmappedDocumentCount']} unmapped) -> {out}"
    )


if __name__ == "__main__":
    main()
