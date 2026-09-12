"""
销售叙事 Markdown 解析器

解析 Gemini/DeepSeek 生成的叙事 Markdown，提取每一页的内容定义。
输出结构化的 slide_defs 列表，供渲染器使用。
"""
import re
from typing import Dict, List, Optional, Any


def parse_narrative_markdown(md: str) -> List[Dict[str, Any]]:
    """
    解析叙事 Markdown，返回幻灯片定义列表。

    每页结构:
    {
        "section": "cover|company|chapter1|chapter2|chapter3|combo|ending",
        "type": "savings|ci|iul|combo|cover|company|ending",
        "title": "标题",
        "subtitle": "副标题",
        "narrative": "叙事文本",
        "highlight_numbers": ["数字1", "数字2"],
        "company_name": "公司名 (如有)",
        "company_intro": "公司一句话介绍 (如有)",
        "key_number": "关键数字 (如有)",
    }
    """
    slides = []
    current_section = None
    current = {}

    for line in md.split("\n"):
        line_stripped = line.strip()

        # Detect section headers
        section_match = re.match(r"^##\s+(\S+)", line_stripped)
        if section_match:
            # Save previous section
            if current and current_section:
                slides.append(current)

            current_section = section_match.group(1)
            current = {"section": current_section}

            # Determine type from section name
            sec_lower = current_section.lower()
            if current_section == "cover":
                current["type"] = "cover"
            elif current_section == "company":
                current["type"] = "company"
            elif current_section == "combo":
                current["type"] = "combo"
            elif current_section == "ending":
                current["type"] = "ending"
            elif sec_lower in ("savings", "ci", "iul"):
                current["type"] = sec_lower
            elif current_section.startswith("chapter"):
                current["type"] = None  # Will be set by "类型:" field
            continue

        # Parse key-value fields
        kv_match = re.match(r"^(\S[^:]+?)\s*:\s*(.+)", line_stripped)
        if kv_match:
            key = kv_match.group(1).strip().lower()
            value = kv_match.group(2).strip()

            if key == "类型" or key == "type":
                current["type"] = value.lower()
            elif key == "标题" or key == "title":
                current["title"] = value
            elif key == "副标题" or key == "subtitle":
                current["subtitle"] = value
            elif key == "子标题":
                current["subtitle"] = value
            elif key == "叙事" or key == "narrative":
                current["narrative"] = value
            elif key == "关键数字" or key == "key_number":
                current["key_number"] = value
            elif key == "公司名称" or key == "company_name":
                current["company_name"] = value
            elif key == "一句话介绍" or key == "company_intro":
                current["company_intro"] = value
            elif key == "行动号召" or key == "cta":
                current["cta"] = value

        # Parse bullet-point highlights
        bullet_match = re.match(r"^\s*[-•*]\s+(.+)", line_stripped)
        if bullet_match:
            highlight = bullet_match.group(1).strip()
            if "highlight_numbers" not in current:
                current["highlight_numbers"] = []
            current["highlight_numbers"].append(highlight)

        # Accumulate multi-line narrative
        if current_section and not section_match and not kv_match and not bullet_match and line_stripped:
            if "narrative" in current and current["narrative"]:
                # Check if this is continuation text (no key: prefix)
                if not re.match(r"^\w", line_stripped):
                    pass  # skip empty lines
            elif "narrative_text" not in current:
                current["narrative_text"] = line_stripped

    # Don't forget last section
    if current and current_section:
        slides.append(current)

    return slides


def narrative_to_meta(narrative_md: str) -> Dict[str, Any]:
    """
    从叙事Markdown提取关键信息，注入到 meta 中供渲染器使用。
    """
    slides = parse_narrative_markdown(narrative_md)
    meta = {}

    for slide in slides:
        section = slide.get("section", "")

        if section == "cover":
            meta["narrative_title"] = slide.get("title", "")
            meta["narrative_subtitle"] = slide.get("subtitle", "")
            meta["narrative_key_number"] = slide.get("key_number", "")

        elif section == "company":
            meta["narrative_company_intro"] = slide.get("company_intro", "") or slide.get("narrative_text", "") or slide.get("narrative", "")

        elif section == "combo":
            meta["narrative_combo"] = slide.get("narrative", "")

        elif section == "ending":
            meta["narrative_ending"] = slide.get("title", "")
            meta["narrative_cta"] = slide.get("cta", "")

        # Store per-chapter narratives
        if section.startswith("chapter"):
            ch_type = slide.get("type", "savings")
            if slide.get("narrative"):
                meta[f"narrative_chapter_{ch_type}"] = slide["narrative"]
            if slide.get("highlight_numbers"):
                meta[f"highlights_{ch_type}"] = slide["highlight_numbers"]

    return meta
