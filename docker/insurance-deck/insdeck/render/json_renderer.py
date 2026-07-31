"""
JSON 渲染器 (结构化数据导出, 用于RAG/数据库/二次分析)
"""
import json
import os
from typing import Dict


def render_json(data: Dict, output_path: str) -> str:
    """
    主入口: 输出 normalized JSON (添加 schema/version 便于溯源)
    """
    out = {
        "schema_version": "1.0",
        "tool": "insdeck",
        "tool_version": "0.1.0",
        **data,
    }
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return output_path
