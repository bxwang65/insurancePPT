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
    m = re.search(r'年缴保费[：:]\s*([0-9,]+)', text)
    if m: info['annual_premium'] = number(m.group(1))
    m = re.search(r'年龄[：:]\s*(\d+)', text)
    if m: info['age'] = int(m.group(1))
    m = re.search(r'投保时保额[^0-9]*([0-9,]+)', text)
    if m: info['sum_insured'] = number(m.group(1))
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
            hdr = ' '.join([str(c)[:10] for c in ex[0]])
            if '退保' not in hdr and '保单年度' not in hdr: continue
            if len(ex[0]) < 7: continue

            # AIA CI 表的合并单元格展开
            for row_data in ex[2:]:
                cells = [str(c).strip() for c in row_data]
                split_cells = [c.split('\n') for c in cells]
                n = max(len(sc) for sc in split_cells if any(sc)) if any(split_cells) else 0
                for ri in range(n):
                    vals = []
                    for sc in split_cells:
                        v = sc[ri].strip().replace(",","") if ri < len(sc) else ""
                        vals.append(v)

                    if not vals: continue
                    yr_str = vals[0].replace('岁','').strip()
                    age_str = vals[1].strip() if len(vals) > 1 else ""
                    # 尝试识别年份
                    year_val = 0
                    if yr_str.isdigit(): year_val = int(yr_str)
                    elif age_str.isdigit(): year_val = int(age_str)
                    if year_val <= 0 or year_val > 200: continue

                    # 9列布局: 年龄, 年度, 保费, 保证(A), 非保证(B), 总额(A+B), 保证(C), 非保证(D), 总额(C+D)
                    # 或: 年度, 保费, 保证, 非保证, 总额, 保证, 非保证, 总额
                    col_offset = 0
                    if yr_str.isdigit() and not age_str.isdigit():
                        col_offset = 1  # 有年龄列
                        try: age_from_table = number(vals[0])
                        except: age_from_table = 0

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
