#!/usr/bin/env python3
"""
永明新加坡 IUL 专用提取器 (fitz)
从 9 列利益表中提取: 年度/年龄/保费/账户价值/退保价值/保证价值/保障金额/身故赔偿

用法: python3 extract_sunlife_iul.py <pdf_path>
输出: JSON { benefit_illustration: [{policy_year, age, premium, account_value, surrender_value, guaranteed_value, sum_insured, death_benefit}], summary: {...} }
"""
import json, re, sys, os, io, contextlib
from pathlib import Path
import fitz

# 关键: 抑制 PyMuPDF 往 stdout 打印的 "Consider using the pymupdf_layout package..." 提示
# 否则会和我们的 JSON 输出混在一起, 破坏 orchestrator 的 JSON.parse
# 用 PYMUPDF_LOG 环境变量关掉所有 fitz 的 stdout 输出
os.environ.setdefault("PYMUPDF_LOG", "no")

@contextlib.contextmanager
def _silence_stdout():
    """临时把 stdout 重定向到 devnull, fitz 警告会丢, 我们的 print 不受影响"""
    saved = sys.stdout
    try:
        sys.stdout = io.StringIO()
        yield
    finally:
        sys.stdout = saved

def number(v):
    if v in ("", "-", None, "##"): return 0
    try: return float(str(v).replace(",", "").replace("$", "").replace(" ", ""))
    except: return 0

def extract_text_info(text):
    """从首页文本提取摘要信息"""
    info = {}
    m = re.search(r'保障金额[：:]\s*\$?([0-9,]+)', text)
    if m: info['sum_insured'] = number(m.group(1))
    m = re.search(r'初始保费[：:]\s*\$?([0-9,]+)', text)
    if m: info['annual_premium'] = number(m.group(1))
    m = re.search(r'年龄[：:]\s*(\d+)', text)
    if m: info['age'] = int(m.group(1))
    if not info.get('age'):
        # Sunlife 格式: "年龄最近的生日 | 性别 | 类别：37 | 女性"
        m = re.search(r'类别[：:]\s*(\d+)', text)
        if m: info['age'] = int(m.group(1))
    if '女' in text or 'Female' in text: info['gender'] = 'Female'
    elif '男' in text or 'Male' in text: info['gender'] = 'Male'
    return info

def extract_index_accounts(text):
    """
    从首页文本提取指数账户配置 (Sunlife IUL)
    模式: 账户名 / 分配% / (保证派息率 / 当前假设派息率)
    已知账户: 固定收益账户 / 倍数指数账户 / 优选指数账户
    """
    accounts = []
    # 固定收益账户: 0%, 4.20% (Sunlife 默认)
    if '固定收益账户' in text:
        # 当前派息率 = 固定收益账户 区块最后一个 "每年X%" (描述段中是"保证派息率每年2.5%...")
        # 模式: 在 "固定收益账户" 之后到 "倍数指数账户" 之前, 取最后一个"每年X%"
        seg = text[text.find('固定收益账户'):text.find('倍数指数账户')] if '倍数指数账户' in text else text[text.find('固定收益账户'):text.find('优选指数账户')] if '优选指数账户' in text else ""
        cur_matches = re.findall(r'每年(\d+(?:\.\d+)?)\s*%', seg)
        cur_rate = f"{cur_matches[-1]}%" if cur_matches else "4.20%"
        accounts.append({
            "name": "固定收益账户",
            "allocation": 0,
            "current_assumed_rate": cur_rate,
            "guaranteed_floor_rate": "2.5%",
            "cap_rate": None,
            "participation_rate": None,
        })
    # 倍数指数账户: 100% (默认), 5.60% (pre-mult), 7.00% (post-mult with 125% mult)
    if '倍数指数账户' in text:
        cur = re.search(r'倍数[\s\S]{0,300}?每年(\d+(?:\.\d+)?)\s*%[\s\S]{0,200}?每年(\d+(?:\.\d+)?)\s*%', text)
        if cur:
            accounts.append({
                "name": "倍数指数账户",
                "allocation": 100,
                "current_assumed_rate": f"{cur.group(1)}% / {cur.group(2)}% (含倍数)",
                "guaranteed_floor_rate": "0%",
                "cap_rate": "8.15%",
                "participation_rate": "125%",
            })
        else:
            accounts.append({
                "name": "倍数指数账户",
                "allocation": 100,
                "current_assumed_rate": "7.00%",
                "guaranteed_floor_rate": "0%",
                "cap_rate": "8.15%",
                "participation_rate": "125%",
            })
    # 优选指数账户: 0%, 7.00%
    if '优选指数账户' in text:
        cur = re.search(r'优选[\s\S]{0,300}?每年(\d+(?:\.\d+)?)\s*%', text)
        cur_rate = f"{cur.group(1)}%" if cur else "7.00%"
        accounts.append({
            "name": "优选指数账户",
            "allocation": 0,
            "current_assumed_rate": cur_rate,
            "guaranteed_floor_rate": "0%",
            "cap_rate": None,
            "participation_rate": None,
        })
    return accounts

def extract_sunlife_iul(pdf_path):
    # 屏蔽 fitz 的 stdout 提示 (PyMuPDF 启动时会打印 layout 建议, 会污染 JSON 输出)
    with _silence_stdout():
        doc = fitz.open(pdf_path)
        full_text = ""
        for i in range(len(doc)):
            full_text += doc[i].get_text()

    info = extract_text_info(full_text)
    # 关键: 提取指数账户配置 (首页有账户配置表)
    info['index_accounts'] = extract_index_accounts(full_text)

    # 遍历所有页，提取 9 列利益表 (find_tables 也会触发 fitz stdout, 一并屏蔽)
    benefit_rows = []
    with _silence_stdout():
        for i in range(len(doc)):
            page = doc[i]
            tables = page.find_tables().tables
            for table in tables:
                ex = table.extract()
                if not ex or len(ex) < 2: continue
                hdr = ' '.join([str(c)[:10] for c in ex[0]])
                if '保单年度' not in hdr and 'account' not in hdr.lower():
                    continue
                if len(ex[0]) < 7: continue

                # 第二行通常有子表头或数据
                for row_data in ex[1:]:
                    cells = [str(c).strip() for c in row_data]
                    if not cells or len(cells) < 7: continue

                    # 展开合并单元格（多个值用换行符分隔）
                    split_cells = [c.split('\n') for c in cells]
                    n_rows = max(len(sc) for sc in split_cells) if any(split_cells) else 0
                    for ri in range(n_rows):
                        vals = []
                        for sc in split_cells:
                            v = sc[ri].strip().replace(",","").replace("$","") if ri < len(sc) else ""
                            vals.append(v)

                        year_str = vals[0].replace('岁','').strip()
                        if not year_str.isdigit(): continue
                        yr = int(year_str)
                        if yr <= 0 or yr > 200: continue

                        # 关键: Sunlife IUL 表 9 列映射 (1-based)
                        # 1=保单年度 2=年龄 3=保费计划(年交,可变) 4=账户价值 5=账户价值-退保费用
                        # 6=累计保证账户价值-退保费用 7=退保价值 8=保障金额 9=身故赔偿
                        # "IUL 户口价值非保证" = 退保价值 (列7), 不是账户价值 (列4)
                        # 早年少退保费用, 后期等于账户价值
                        # 保费计划(列3)是每年计划保费, NOT 累计 - 累计得算
                        row = {
                            'policy_year': yr,
                            'age': number(vals[1]) if len(vals) > 1 else 0,
                            'planned_premium': number(vals[2]) if len(vals) > 2 else 0,
                            'account_value_gross': number(vals[3]) if len(vals) > 3 else 0,
                            'account_value_less_fee': number(vals[4]) if len(vals) > 4 else 0,
                            'guaranteed_value': number(vals[5]) if len(vals) > 5 else 0,
                            'surrender_value': number(vals[6]) if len(vals) > 6 else 0,
                            'sum_insured': number(vals[7]) if len(vals) > 7 else 0,
                            'death_benefit': number(vals[8]) if len(vals) > 8 else 0,
                            'source_page': i,
                        }
                        benefit_rows.append(row)

    page_count = len(doc)
    doc.close()

    # 去重 (按 policy_year) - 取后到的版本
    # 关键: PDF 同一保单年度会在保证页 (page 2-3) 和非保证页 (page 4-6) 重复出现
    # 经纪人对外展示的是"当前假设" (非保证, 后出现的页), 所以 last-occurrence wins
    by_year: dict[int, dict] = {}
    for r in sorted(benefit_rows, key=lambda x: x['policy_year']):
        by_year[r['policy_year']] = r  # 后到覆盖先到
    unique_rows = [by_year[y] for y in sorted(by_year.keys())]

    # 关键: 累计已缴保费 (按 planned_premium 求和)
    # 防止后期出现 "累计" = 58020 + 25700*9 = 290820 这种错值
    cumulative = 0.0
    for r in unique_rows:
        cumulative += r['planned_premium']
        r['cumulative_premium_paid'] = cumulative

    # 构建与 IUL  schema 兼容的输出
    result = {
        "benefit_illustration": unique_rows,
        "summary": {
            "insured_age": info.get('age', 0),
            "insured_gender": info.get('gender', ''),
            "annual_premium": info.get('annual_premium', 0),
            "sum_insured": info.get('sum_insured', 0),
            "index_accounts": info.get('index_accounts', []),
        },
        "diagnostics": {
            "parser": "sunlife-iul-fitz",
            "rows_found": len(unique_rows),
            "pages_scanned": page_count,
        }
    }
    return result

if __name__ == "__main__":
    pdf = sys.argv[1]
    # 关键: extract_sunlife_iul 里 fitz 操作可能往 stdout 写提示, 用 silencer 屏蔽
    # 否则我们的 JSON 会和 fitz 的 "Consider using..." 混在一起破坏 orchestrator 解析
    with _silence_stdout():
        result = extract_sunlife_iul(pdf)
    # print 必须在 silencer 外面, 否则我们的 JSON 也被吞了
    print(json.dumps(result, default=str))