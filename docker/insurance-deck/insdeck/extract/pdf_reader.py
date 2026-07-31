"""
PDF 数据提取 (按列对齐, 复用刚才验证的pdfplumber逻辑)

关键发现:
- PDF文本按行扫描 (PyMuPDF.get_text) 会错位 → 用pdfplumber.extract_tables()按列
- cell可能含多个值用 \n 分隔 (pdfplumber自动合并)
- 5个值/行的标准表 vs 11列的提领表 → 不同列序
"""
import re
from pathlib import Path
from typing import Dict, List, Optional

import fitz  # for first-page text
import pdfplumber


def get_first_n_pages_text(pdf_path: str, n: int = 2) -> str:
    """取PDF前N页纯文本 (用于公司-产品识别)"""
    doc = fitz.open(pdf_path)
    text = ""
    for i in range(min(n, doc.page_count)):
        text += doc[i].get_text()
    doc.close()
    return text


def _parse_multi_values(cell) -> List[int]:
    """Cell可能含多个值用\\n分隔 - 拆分并转int"""
    if not cell:
        return []
    result = []
    for x in str(cell).split('\n'):
        s = x.strip().replace(',', '').replace('-', '')
        if s and s.isdigit():
            result.append(int(s))
    return result


def extract_no_withdraw(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """
    不提领表提取 (第3部分)
    pdfplumber返回6列: [Y, Paid, Guar_CV, Rev, Term, Total]
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg_idx in page_indices:
            if pg_idx >= len(pdf.pages):
                continue
            tables = pdf.pages[pg_idx].extract_tables()
            for t in tables:
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 6:
                        continue
                    ys = _parse_multi_values(r[0])
                    if not ys or not (1 <= ys[0] <= 80):
                        continue
                    paid = _parse_multi_values(r[1])
                    guar = _parse_multi_values(r[2])
                    rev = _parse_multi_values(r[3])
                    term = _parse_multi_values(r[4])
                    total = _parse_multi_values(r[5])
                    n = min(len(ys), len(paid), len(guar), len(rev), len(term), len(total))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 80 and y not in rows:
                            rows[y] = {
                                'Y': y,
                                'Age': y,  # 受保人1岁起, Y=Age
                                'Paid': paid[k],
                                'Guar_CV': guar[k],
                                'Rev': rev[k],
                                'Term': term[k],
                                'Total': total[k],
                            }
    return rows


def extract_withdraw(pdf_path: str, page_indices: List[int]) -> Dict[int, Dict]:
    """
    提领表提取 (第5部分)
    pdfplumber列序: [Age, Y, Paid, Annual_WD, Cum_WD, Guar_CV, _, Rev, Term, Total, Total+WD, Remain_Units]
    """
    rows = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pg_idx in page_indices:
            if pg_idx >= len(pdf.pages):
                continue
            tables = pdf.pages[pg_idx].extract_tables()
            for t in tables:
                if not t or len(t) < 4:
                    continue
                for r in t:
                    if not r or len(r) < 11:
                        continue
                    ages = _parse_multi_values(r[0])
                    ys = _parse_multi_values(r[1])
                    if not ages or not ys:
                        continue
                    if not (1 <= ys[0] <= 80):
                        continue
                    paid = _parse_multi_values(r[2])
                    annual = _parse_multi_values(r[3])
                    cum = _parse_multi_values(r[4])
                    guar = _parse_multi_values(r[5]) if len(r) > 5 else []
                    rev = _parse_multi_values(r[7]) if len(r) > 7 else []
                    term = _parse_multi_values(r[8]) if len(r) > 8 else []
                    total = _parse_multi_values(r[9]) if len(r) > 9 else []
                    total_wd = _parse_multi_values(r[10]) if len(r) > 10 else []
                    remain = _parse_multi_values(r[11]) if len(r) > 11 else []
                    n = min(len(ys), len(paid), len(annual), len(cum))
                    for k in range(n):
                        y = ys[k]
                        if 1 <= y <= 80 and y not in rows:
                            rows[y] = {
                                'Y': y,
                                'Age': ages[k] if k < len(ages) else y,
                                'Paid': paid[k],
                                'Annual_WD': annual[k],
                                'Cum_WD': cum[k],
                                'Guar_CV': guar[k] if k < len(guar) else 0,
                                'Rev': rev[k] if k < len(rev) else 0,
                                'Term': term[k] if k < len(term) else 0,
                                'Total': total[k] if k < len(total) else 0,
                                'Total_WD': total_wd[k] if k < len(total_wd) else 0,
                                'Remain_Units': remain[k] if k < len(remain) else 0,
                            }
    return rows


def extract_summary(pdf_path: str) -> Dict:
    """提取投保摘要 (PDF p1)"""
    doc = fitz.open(pdf_path)
    text = doc[0].get_text()
    doc.close()

    summary = {
        'insured_name': None,
        'insured_age': None,
        'insured_gender': None,
        'product_name': None,
        'product_code': None,
        'currency': None,
        'annual_premium': None,
        'payment_years': None,
        'coverage_period': None,
        'premium_total': None,
    }

    # 受保人
    # AIA/CTF 多变: 优先 "受保人姓名：XXX" 这种明确格式
    m = re.search(r'受保人姓名\s*[：:]\s*([^\n性别]+?)(?=\s*\n|$)', text)
    if m and m.group(1).strip():
        summary['insured_name'] = m.group(1).strip()
    # AIA 格式: "年龄：\nVIP 先生 \n1" - VIP先生 在年龄前
    if not summary.get('insured_name') or summary['insured_name'] == '性别：男':
        m = re.search(r'年龄\s*[：:]?\s*\n?\s*(VIP[^\d\n]+?)\s*\n\s*(\d+)\s*\n', text)
        if m:
            summary['insured_name'] = m.group(1).strip()
            summary['insured_age'] = int(m.group(2))
    # 清理: 如果姓名含"性别"等, 重置
    if summary.get('insured_name') and ('性别' in summary['insured_name'] or '男' == summary['insured_name'].strip() or '女' == summary['insured_name'].strip()):
        summary.pop('insured_name', None)
    m = re.search(r'年龄\s*[：:]?\s*(\d+)', text)
    if m: summary['insured_age'] = int(m.group(1))
    m = re.search(r'性别\s*[：:]?\s*(\S+)', text)
    if m: summary['insured_gender'] = m.group(1)

    # 产品 (可能跨行)
    m = re.search(r'「([^」]+)」\s*储蓄寿险计划\d', text)
    if m: summary['product_name'] = '「' + m.group(1) + '」'
    # AIA 格式: "环\n盈活储蓄保险计划" - 用 "储蓄保险计划" 作锚
    if not summary.get('product_name'):
        m = re.search(r'([^\s\n]+)\s*储蓄保险计划', text)
        if m: summary['product_name'] = m.group(1).replace('\n', '')
    m = re.search(r'\((MW\d+[A-Z]+)\)', text)
    if m: summary['product_code'] = m.group(1)

    # 缴费年期
    m = re.search(r'(\d+)\s*年\s*\n?\s*至(\d+)\s*岁', text)
    if m:
        summary['payment_years'] = int(m.group(1))
        summary['coverage_period'] = f'至{m.group(2)}岁'
    # AIA 格式: "5年缴费" 是缴费年期 (出现在产品名后)
    if not summary.get('payment_years'):
        m = re.search(r'(\d+)\s*年\s*缴费', text)
        if m:
            val = int(m.group(1))
            if 1 <= val <= 30:
                summary['payment_years'] = val
    # AIA: "终身" 是保障年期
    if '终身' in text and not summary.get('coverage_period'):
        summary['coverage_period'] = '终身'

    # 货币 (AIA/CTF 都用 "保单货币：美元" / "保单貨幣：美元" 格式)
    m = re.search(r'保单[货貨]币\s*[：:]\s*(\S+)', text)
    if m:
        c = m.group(1).strip()
        if c in ('美元', 'USD', 'usd'):
            summary['currency'] = 'USD'
        elif c in ('港元', 'HKD', 'hkd'):
            summary['currency'] = 'HKD'
        elif c in ('人民币', 'CNY', 'cny', 'RMB', 'rmb'):
            summary['currency'] = 'CNY'
        else:
            summary['currency'] = c

    # 年保费
    # AIA P1 产品行结构 (修复 525K bug):
    #  1,027,750  105,000  100,000.08  5  终身
    #  基本金额    保额     年缴保费    年期
    # 抓 100,000.08 这种"5位整数.2位小数"的数字 (年保费独有特征)
    # 排除 100,012.93 (含征费的总保费, 出现在另一行)
    annual = None
    # 策略: 在产品行 (5,10,15,20) 附近找 100,000.XX
    # 用 pdfplumber 表格解析, 第一行通常就是产品行
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as _pdf:
            t = _pdf.pages[0].extract_text() or ''
        # 找包含 "100,000." 模式的数字, 优先选 < 110,000 的
        cands = re.findall(r'(\d{2,3},\d{3}\.\d{2})', t)
        for c in cands:
            v = float(c.replace(',', ''))
            if 90000 < v < 110000 and '总保费' not in t[max(0,t.find(c)-30):t.find(c)+10]:
                annual = v
                break
    except: pass
    if not annual:
        for m in re.finditer(r'([\d]{2,3},[\d]{3}\.\d{2})', text):
            try:
                val = float(m.group(1).replace(',', ''))
                if 90000 < val < 110000:
                    annual = val
                    break
            except: pass
    if annual:
        summary['annual_premium'] = annual
        pay_years = summary.get('payment_years') or 5
        summary['premium_total'] = round(annual * pay_years, 2)

    return summary
