#!/usr/bin/env python3
"""IUL 签名提取桩脚本: 只返回 ok=true, 数据由 orchestrator 的 fitz 脚本填充"""
import json, sys
print(json.dumps({"ok": True, "product": sys.argv[2] if len(sys.argv) > 2 else "IUL", "summary": {}, "benefit_illustration": [], "withdrawal_illustration": [], "diagnostics": {"parser": "iul-stub"}}))
