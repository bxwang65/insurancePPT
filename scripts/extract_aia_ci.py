#!/usr/bin/env python3
"""AIA 愛伴航保险计划2 CI 专用提取器 (fitz)
从第17-19页的9列利益表中提取数据

用法: python3 extract_aia_ci.py <pdf_path>
输出: JSON { benefit_illustration: [...], summary: {...} }
"""
import json, re, sys
import fitz

def number(v):
    if v in ("", "-", None, "None"): return 0
    try: return float(str(v).replace(",", "").replace("$", "").replace(" ", ""))
    except: return 0

def extract_text_info(text):
    info = {}
    # 年龄: "年龄：VIP 先生 36" — 容许 | 与中文在中间
    m = re.search(r'年龄[：:][^\d]{0,30}?(\d+)', text)
    if m: info['age'] = int(m.group(1))
    # 投保时保额: 表格行 "| 投保时保额 | 投保时 | 年缴保费 | <plan> | <num> | <premium> |"
    # 关键修复: 旧版 [^0-9]* 贪心捕获到 "保险计划 2" 的 "2", 改为取 >= 10000 的最大值
    si_matches = re.findall(r'投保时保额[^\d]{0,80}?([0-9,]+)', text)
    for candidate in si_matches:
        v = number(candidate)
        if v >= 10000:
            info['sum_insured'] = v
            break
    # 年缴保费: 表格行 "<plan> | <sum> | <premium> |" — 抓 NN,NNN.NN 形式
    # 关键修复: 中间含 "10 年缴费" 带数字中文 + PDF 换行符 (re.DOTALL 让 . 匹配 \n)
    ap_matches = re.findall(r'年缴保费[\s\S]{0,100}?([0-9,]+\.\d{2})', text)
    for candidate in ap_matches:
        v = number(candidate)
        if v >= 100:  # 真实保费 >= 100, 排除附加契约的 0.00
            info['annual_premium'] = v
            break
    if '女' in text: info['gender'] = '女'
    elif '男' in text: info['gender'] = '男'
    return info

def extract_aia_ci(pdf_path):
    doc = fitz.open(pdf_path)
    full_text = ""
    for i in range(len(doc)):
        full_text += doc[i].get_text()
    info = extract_text_info(full_text)

    rows = []
    for page_i in range(len(doc)):
        page = doc[page_i]
        tables = page.find_tables().tables
        for table in tables:
            ex = table.extract()
            if not ex or len(ex) < 3: continue
            hdr = ' '.join([str(c)[:10] for c in ex[0]] + [str(c)[:10] for c in ex[1]] if len(ex) > 1 else [])
            if '退保' not in hdr and '保单年度' not in hdr: continue
            if len(ex[0]) < 7: continue

            # 关键: 关键修复 Y41 跨页污染 — 检测"年龄"列是否在 header
            # Page 3-4/20 (AIA aibanhang): cols[0] = 保单年度, col_offset=0
            # Page 18-19 (aibanhang): cols[0] = 年龄, cols[1] = 保单年度, col_offset=1
            # 关键: 必须看 EX[0] header row (不是 hdr 第一行), 而是要看 ex[1] 和 ex[2] 是不是 子 header
            # AIA aibanhang 9-col table 格式:
            #   ex[0] (主 header): 保单年度终结 | 缴付保费总额 | 退保发还金额 | None | None | 严重疾病/身故 | None | None | 收支比对 (9-col with age)
            #   ex[1] (子 header): None | None | 保证金额 | 非保证 | 总额 | ...
            #   ex[2] (sub-sub):   None | None | 保证现金价值 | 复归红利 | 终期分红 | ... | 复归红利 | 终期分红 | ...
            #   ex[3+]: 数据
            # 而 8-col table:
            #   ex[0]: 保单年度终结 | 缴付保费总额 | 退保发还金额 | None | None | None | 严重/身故 | None | None
            #   ex[1]: None | None | 保证金额 | 非保证 | 总额
            #   ex[2]: None | None | 保证现金价值 | 复归 | 终期
            #   ex[3+]: 数据
            # 9-col with 年龄 vs without 年龄 区别:
            #   - 年龄列存在: rows 头一行有"年龄"标题
            # 检测方法: 搜 header 任意 row 包含"年龄"
            has_age_col = ('年龄' in hdr) and (len(ex[0]) >= 9)
            # 解 9-col without 年龄 (Page 20 收支比对): col_offset=0 保单年度也是 col 0

            # AIA CI 表的合并单元格展开
            for row_data in ex[2:]:
                cells = [str(c).strip() for c in row_data]
                split_cells = [c.split('\n') for c in cells]
                n = max(len(sc) for sc in split_cells if any(sc)) if any(split_cells) else 0
                if n == 0:
                    continue
                for ri in range(n):
                    vals = []
                    for sc in split_cells:
                        v = sc[ri].strip().replace(",", "") if ri < len(sc) else ""
                        vals.append(v)
                    if not vals:
                        continue

                    yr_str = vals[0].replace('岁', '').strip() if len(vals) > 0 else ""
                    # 关键修复: 跳过 "X岁" 年龄行 — 8-col 表 (page 3) 把 insured age 65 写成 "65岁",
                    # 与 9-col 表 page 18 的实际 Y29 (insured 36) 数据完全一样, 会被 dedup 当成 Y65 = Y29.
                    # 实际年数数据在 page 18/19 的 9-col 表里, 这里直接 skip 避免图表在 Y65+ 突然跌回
                    if '岁' in vals[0]:
                        continue
                    age_str = vals[1].strip() if len(vals) > 1 else ""

                    year_val = 0
                    if has_age_col and len(vals) > 1 and age_str.isdigit():
                        # vals[0] = 年龄, vals[1] = 保单年度
                        year_val = int(age_str)
                        col_offset = 1
                    elif yr_str.isdigit():
                        # vals[0] = 保单年度 (无年龄列)
                        year_val = int(yr_str)
                        col_offset = 0
                    elif age_str.isdigit():
                        # 兜底: vals[1] 是数字
                        year_val = int(age_str)
                        col_offset = 1
                    else:
                        continue

                    if year_val <= 0 or year_val > 200: continue

                    if len(vals) < 5 + col_offset: continue

                    premium = number(vals[1 + col_offset]) if len(vals) > 1 + col_offset else 0
                    guar = number(vals[2 + col_offset]) if len(vals) > 2 + col_offset else 0
                    non_guar = number(vals[3 + col_offset]) if len(vals) > 3 + col_offset else 0
                    total = number(vals[4 + col_offset]) if len(vals) > 4 + col_offset else 0

                    death_guar = number(vals[5 + col_offset]) if len(vals) > 5 + col_offset else 0
                    death_non = number(vals[6 + col_offset]) if len(vals) > 6 + col_offset else 0
                    death_total = number(vals[7 + col_offset]) if len(vals) > 7 + col_offset else 0

                    rows.append({
                        "policy_year": year_val,
                        "total_premium_paid": premium,
                        "guaranteed_cash_value": guar,
                        "reversionary_bonus": non_guar,
                        "total_surrender_value": total if total > 0 else guar + non_guar,
                        "death_benefit": death_total if death_total > 0 else death_guar + death_non,
                        "source_page": page_i,
                    })

    doc.close()

    # 去重
    seen = set()
    unique = []
    for r in sorted(rows, key=lambda x: x['policy_year']):
        if r['policy_year'] not in seen:
            seen.add(r['policy_year'])
            unique.append(r)

    result = {
        "benefit_illustration": unique,
        "summary": {
            "insured_age": info.get('age', 0),
            "insured_gender": info.get('gender', ''),
            "annual_premium": info.get('annual_premium', 0),
            "sum_insured": info.get('sum_insured', 0),
        },
        "diagnostics": {"parser": "aia-ci-fitz", "rows_found": len(unique)},
    }
    return result

if __name__ == "__main__":
    pdf = sys.argv[1]
    result = extract_aia_ci(pdf)
    print(json.dumps(result, default=str))
