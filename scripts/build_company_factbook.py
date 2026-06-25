#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import fitz


ROOT = Path("/Users/soldier/free-code/packages/insurance-ppt")
COMPANIES_DIR = ROOT / "config" / "companies"
KNOWLEDGE_ROOT = Path("/Users/soldier/Desktop/公司介绍")
OUT_JSON = ROOT / "data" / "company-facts.generated.json"
MANUAL_JSON = ROOT / "data" / "company-facts.manual.json"
OUT_MD = ROOT / "outputs" / "company_factbook.md"

PREFERRED_NAME = re.compile(r"(简介|簡介|概览|概覽|fact|factsheet|company|strength|overview|一图|企业信息图|業務簡介|业务简介)", re.I)
PDF_EXT = {".pdf"}


def read_pdf_text(path: Path, max_pages: int = 4) -> str:
    doc = fitz.open(path)
    pages = []
    for i in range(min(doc.page_count, max_pages)):
        pages.append(doc[i].get_text())
    doc.close()
    return "\n".join(pages)


def first_match(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            value = match.group(1).strip()
            value = re.sub(r"\s+", " ", value)
            return value
    return None


def choose_evidence_files(company: dict[str, Any]) -> list[Path]:
    files: list[Path] = []
    for directory in company.get("knowledgeDirectories", []):
        root = KNOWLEDGE_ROOT / directory
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.suffix.lower() in PDF_EXT:
                files.append(path)
    ranked = sorted(
        files,
        key=lambda path: (
            0 if PREFERRED_NAME.search(path.name) else 1,
            len(path.name),
        ),
    )
    return ranked[:3]


def build_facts(company: dict[str, Any], text: str) -> list[dict[str, str]]:
    facts: list[dict[str, str]] = []

    def clean_rating(value: str | None, family: str) -> str | None:
        if not value:
            return None
        value = value.strip()
        if family in {"sp", "fitch"}:
            if re.fullmatch(r"(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|C|D)", value):
                return value
            return None
        if family == "moodys":
            if re.fullmatch(r"(Aaa|Aa[1-3]|A[1-3]|Baa[1-3]|Ba[1-3]|B[1-3]|Caa[1-3]|Ca|C)", value):
                return value
            return None
        if family == "ambest":
            if re.fullmatch(r"(A\+\+|A\+|A|A-|B\+\+|B\+|B)", value):
                return value
            return None
        return None

    def add(label: str, value: str | None) -> None:
        if not value:
            return
        value = value.strip().strip("：: ")
        if not value:
            return
        if any(existing["label"] == label for existing in facts):
            return
        facts.append({"label": label, "value": value})

    add("成立时间", first_match([
        r"(?:成立于|成立於|创立于|創立於)\s*(\d{4}\s*年?)",
        r"(\d{4}\s*年成立)",
    ], text))
    add("所属集团", first_match([
        r"(?:母公司|所属集团|隶属于|屬於)\s*[:：]?\s*([^\n。；]{4,50}(?:集团|集團|Group|Holdings|Financial))",
        r"([^\n。；]{4,50}(?:集团|集團|Group|Holdings|Financial))(?:旗下|附属机构|附屬機構)",
    ], text))
    add("业务范围", first_match([
        r"(业务遍及[^\n。]{6,80})",
        r"(業務遍及[^\n。]{6,80})",
        r"(覆盖[^\n。]{6,80}市场)",
        r"(覆蓋[^\n。]{6,80}市場)",
    ], text))
    add("标普评级", clean_rating(first_match([
        r"(?:标普|標普|S&P)[^A-Z0-9]{0,10}([A-Z]{1,3}[+-]?)",
    ], text), "sp"))
    add("穆迪评级", clean_rating(first_match([
        r"(?:穆迪|Moody'?s)[^A-Za-z0-9]{0,10}([A-Za-z]{1,3}[0-3]?)",
    ], text), "moodys"))
    add("惠誉评级", clean_rating(first_match([
        r"(?:惠誉|惠譽|Fitch)[^A-Z0-9]{0,10}([A-Z]{1,3}[+-]?)",
    ], text), "fitch"))
    add("贝氏评级", clean_rating(first_match([
        r"(?:AM Best|A\.M\. Best)[^A-Z0-9]{0,10}([A-Z][+-]?)",
    ], text), "ambest"))
    add("管理资产规模", first_match([
        r"(?:管理资产|管理資產|AUM|Assets under management)[^0-9]{0,20}([\d,.]+\s*(?:亿|億|十亿|百亿|万亿|billion|trillion)[^\n。；]{0,20})",
    ], text))
    add("客户规模", first_match([
        r"(?:服务|服務)[^\n。]{0,12}([\d,.]+\s*(?:万|萬|million)[^\n。]{0,20}客户)",
        r"([\d,.]+\s*(?:万|萬|million)[^\n。]{0,20}客户)",
    ], text))

    if not facts and company.get("companyHighlights"):
        highlight = company["companyHighlights"][0]["text"]
        facts.append({"label": "核心概况", "value": highlight})
    return facts[:6]


def main() -> None:
    companies = []
    for path in sorted(COMPANIES_DIR.glob("*.json")):
        company = json.loads(path.read_text(encoding="utf-8"))
        evidence_files = choose_evidence_files(company)
        merged_text = "\n".join(read_pdf_text(file) for file in evidence_files[:2]) if evidence_files else ""
        facts = build_facts(company, merged_text)
        companies.append({
            "companyId": company["id"],
            "displayName": company["displayName"],
            "companyIntro": company.get("companyIntro", ""),
            "facts": facts,
            "evidenceFiles": [str(file) for file in evidence_files],
        })

    generated = {"companies": companies}
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(generated, ensure_ascii=False, indent=2), encoding="utf-8")

    manual_map = {}
    if MANUAL_JSON.exists():
      manual = json.loads(MANUAL_JSON.read_text(encoding="utf-8"))
      manual_map = {entry["companyId"]: entry for entry in manual.get("companies", [])}

    merged = []
    for entry in companies:
      override = manual_map.get(entry["companyId"])
      if override:
        merged.append({
          **entry,
          **override,
          "facts": override.get("facts") or entry.get("facts", []),
          "evidenceFiles": entry.get("evidenceFiles", []),
        })
      else:
        merged.append(entry)
    for company_id, override in manual_map.items():
      if not any(item["companyId"] == company_id for item in merged):
        merged.append(override)

    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Company Factbook", ""]
    for entry in merged:
        lines.append(f"## {entry['displayName']} ({entry['companyId']})")
        lines.append("")
        lines.append(entry["companyIntro"] or "暂无概览")
        lines.append("")
        if entry["facts"]:
            for fact in entry["facts"]:
                lines.append(f"- {fact['label']}：{fact['value']}")
        else:
            lines.append("- 暂无可结构化事实，需补充简介类 PDF")
        if entry["evidenceFiles"]:
            lines.append(f"- 证据文件：{', '.join(Path(f).name for f in entry['evidenceFiles'])}")
        lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(OUT_JSON)
    print(OUT_MD)


if __name__ == "__main__":
    main()
