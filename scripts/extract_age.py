#!/usr/bin/env python3
"""从PDF首页提取受保人年龄"""
import fitz, re, sys

d = fitz.open(sys.argv[1])

def find_age(text: str):
    # 格式1: "翌年歲（ANB）：1歲" → 1
    m = re.search(r'[：:]\s*(\d+)\s*[岁歲]', text)
    if m: return m
    lines = text.split('\n')
    for i, line in enumerate(lines):
        if '年龄' in line or '年齡' in line:
            # 检查同一行: "年龄: 1"
            m2 = re.search(r'[：:]\s*(\d+)', line)
            if m2: return m2
            # 检查下面3行
            for j in range(i+1, min(i+4, len(lines))):
                m3 = re.search(r'[：:]\s*(?:男|女|[MF])\s*/\s*(\d+)', lines[j])
                if m3: return m3
                m4 = re.search(r'^\s*(\d+)\s*$', lines[j])
                if m4 and 0 < int(m4.group(1)) < 120: return m4
    # 格式: "年龄：1"
    m = re.search(r'[年龄年齡]\s*[：:]\s*(\d+)', text)
    if m: return m
    # 格式: "ANB: 1"
    m = re.search(r'ANB[：:()）\s]*(\d+)', text)
    if m: return m
    # 格式: "男性/46歲" 或 "Female/35歲" 或 "男/46歲" (无冒号前缀)
    m = re.search(r'(?:男性?|女性?|[MF])\s*/\s*(\d+)\s*[岁歲]', text)
    return m

# 先搜第1页
t = d[0].get_text()
m = find_age(t)

# 未找到则搜后续各页 (最多5页)
if not m:
    for i in range(1, min(len(d), 5)):
        t = d[i].get_text()
        m = find_age(t)
        if m: break

d.close()

print(m.group(1) if m else '0')
