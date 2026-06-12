#!/usr/bin/env python3
"""从PDF首页提取受保人年龄"""
import fitz, re, sys

d = fitz.open(sys.argv[1])
t = d[0].get_text()
d.close()

# 格式1: "翌年歲（ANB）：1歲" → 1
m = re.search(r'[：:]\s*(\d+)\s*[岁歲]', t)
# 格式2: "年龄：\nVIP 先生\n1" (年龄在行首, 数字在下面)
if not m:
    lines = t.split('\n')
    for i, line in enumerate(lines):
        if '年龄' in line or '年齡' in line:
            # 检查同一行: "年龄: 1"
            m2 = re.search(r'[：:]\s*(\d+)', line)
            if m2:
                m = m2; break
            # 检查下面3行
            for j in range(i+1, min(i+4, len(lines))):
                m3 = re.search(r'[：:]\s*(?:男|女|[MF])\s*/\s*(\d+)', lines[j])
                if m3:
                    m = m3; break
                m4 = re.search(r'^\s*(\d+)\s*$', lines[j])
                if m4 and 0 < int(m4.group(1)) < 120:
                    m = m4; break
# 格式3: "年龄：1"
if not m:
    m = re.search(r'[年龄年齡]\s*[：:]\s*(\d+)', t)
# 格式4: "ANB: 1"
if not m:
    m = re.search(r'ANB[：:()）\s]*(\d+)', t)

print(m.group(1) if m else '0')
