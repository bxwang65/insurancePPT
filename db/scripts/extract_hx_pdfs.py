#!/usr/bin/env python3
# 2026-08-17: PEP 604 兼容 (ECS host python3=3.8.10, 跑 extract 会 SyntaxError)
from __future__ import annotations
"""
HX 佣金费率表提取脚本 (Script A)

读 10 个 PDF → 解析 → 推断隐式变量 → 应用过滤 → 写入 10 张 SQLite 表 → LLM 抽样复核

用法:
  python extract_hx_pdfs.py --pdf-dir ~/Downloads --db db/hx_rates.db --effective-from 2026-07-01
  python extract_hx_pdfs.py --verify-only --run-id <uuid>   # 只跑 LLM 复核

依赖:
  pip install pymupdf
"""
import argparse
import json
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: 需要安装 pymupdf: pip install pymupdf", file=sys.stderr)
    sys.exit(1)

# =============================================================
# 公司列表（PDF 里出现的所有公司前缀）
# =============================================================
COMPANY_PATTERNS = [
    'AIA 友邦', 'AXA 安盛', 'BOC中銀', '永M', '保誠', 'Prudential', 'PRU 保誠',
    '宏利', 'FWD 富衛', '中銀人壽', 'BOC Life', 'GEN 忠意',
    '中國太平', '太B', 'Manulife', '永明', 'MLI 宏利',
    '中銀集團保險', '永明金融', 'CTP中國太平', 'CPIC太保', 'CTF 周大福',
    'ZU蘇黎世', 'YFL 萬通保險', 'YF Life', 'AIA', 'HT 香港人壽',
    # 2026-08-17: 修复 PDF 用 "PRU 保誠" 前缀而 COMPANY_PATTERNS 只有 "保誠"/"Prudential" → 漏 24x/页
    # 同样漏: BLU微藍 (Blue 微藍, NO space) / CLI 中國人壽 / WELL立橋 (Well Link, NO space)
    'PRU 保誠', 'BLU微藍', 'CLI 中國人壽', 'WELL立橋',
]
COMPANY_RE = r'^(活動)?(' + '|'.join(re.escape(c) for c in COMPANY_PATTERNS) + r')\s*$'

# =============================================================
# 5 个隐式变量推断规则
# =============================================================
CURRENCY_PATTERNS = [
    (r'人民幣', 'RMB'),
    (r'港幣', 'HKD'),
    (r'英鎊', 'GBP'),
    (r'加拿大元', 'CAD'),
    (r'澳元', 'AUD'),
    (r'歐元', 'EUR'),
    (r'新加坡元', 'SGD'),
    (r'美元', 'USD'),
]

CATEGORY_PATTERNS = [
    (r'儲蓄|儲蓄保險計劃', 'savings'),
    (r'延期年金|年金計劃', 'annuity'),
    (r'危疾|重疾', 'ci'),
    (r'終身壽險|人壽系列|壽險系列', 'whole_life'),
    (r'多元貨幣|貨幣保障', 'savings'),  # 多元貨幣計劃 = 储蓄险
    (r'壽險計劃|保險計劃|保障計劃', 'savings'),  # 默认「X壽險計劃/保險計劃/保障計劃」= 储蓄险
]


def infer_currency(plan_text: str) -> str:
    """从计划名推断币种。多种币种则返回 'multi'。"""
    found = []
    for pat, code in CURRENCY_PATTERNS:
        if re.search(pat, plan_text):
            found.append(code)
    if not found:
        return 'USD'  # 默认美元（HK 保险以 USD 为主）
    if len(found) == 1:
        return found[0]
    return 'multi'


def infer_category(plan_text: str) -> str:
    """从计划名推断类别。"""
    for pat, cat in CATEGORY_PATTERNS:
        if re.search(pat, plan_text):
            return cat
    return 'whole_life'  # 默认终身寿险


def infer_prepayment(plan_text: str, code: str) -> str | None:
    """从计划名 + code 推断是否预缴。BOC 产品 S00702PU 是预缴。"""
    if 'PU' in code or '預繳' in plan_text or '预缴' in plan_text:
        return 'Y'
    if 'U' in code and 'P' not in code:
        return 'N'
    return None


def infer_premium_min(plan_text: str) -> float | None:
    """从计划名推断保費門檻 (USD)。"""
    m = re.search(r'(?:年繳保費|年繳保费|annual premium)\s*[≥>=]\s*USD\s*([\d,]+)', plan_text)
    if m:
        return float(m.group(1).replace(',', ''))
    return None


def infer_age_range(plan_text: str) -> tuple[int | None, int | None]:
    """从计划名推断年龄范围。支持多种写法。"""
    # 15天-65歲 / 0-65歲 / 1-60歲
    m = re.search(r'(\d+)\s*(?:天|岁)?\s*[-~]\s*(\d+)\s*[歲岁]', plan_text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def infer_activity_deadline(plan_text: str) -> str | None:
    """从活动版描述推断截止日期。"""
    m = re.search(r'於\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日前[簽签]署', plan_text)
    if m:
        return f"{m.group(1)}/{int(m.group(2))}/{int(m.group(3))}"
    return None


# =============================================================
# 核心解析器 (修复 3 个 bug)
# =============================================================
def parse_pdf(pdf_path: Path, table_kind: str):
    """
    table_kind: 'npi_l1' / 'npi_l2' / 'npi_l3' / 'pi_l1' / 'pi_l2' / 'pi_l3'
    返回: list of dict
    """
    doc = fitz.open(pdf_path)
    rows = []
    is_npi = table_kind.startswith('npi')
    level = table_kind.split('_')[1]  # l1 / l2 / l3

    for p in range(len(doc)):
        text = doc[p].get_text()
        lines = text.split('\n')
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            m = re.match(COMPANY_RE, line)
            if not m:
                i += 1
                continue

            # 活動 可能在同一行 (NPI L1/L3 格式: "活動AIA 友邦")
            # 也可能在单独一行 (NPI L2/PI 格式: 上一行是 "活動")
            is_activity = m.group(1) == '活動'
            if not is_activity:
                # Bug 修复 #1: 活動可能在单独一行（前一两行）
                for back in range(i - 1, max(-1, i - 3), -1):
                    if lines[back].strip() == '活動':
                        is_activity = True
                        break
                    if lines[back].strip() != '':
                        break

            company = m.group(2)

            # Bug 修复 #2: 永M 没有 Code 字段
            # 永M 的格式: company | 儲蓄/終身壽險 | 计划名 | term | nums
            if company == '永M' and i + 1 < len(lines):
                cat_line = lines[i + 1].strip()
                if cat_line in ('儲蓄', '終身壽險'):
                    j = i + 2
                    if j < len(lines):
                        plan_name = lines[j].strip()
                        # 跳过 plan_name 找 term
                        k = j + 1
                        while k < len(lines) and not re.match(r'^\d+\s*$', lines[k].strip()):
                            k += 1
                        if k < len(lines):
                            term_line = lines[k].strip()
                            if re.match(r'^\d+\s*$', term_line):
                                term = int(term_line)
                                # 收集数字
                                nums = []
                                m_idx = k + 1
                                while m_idx < len(lines) and len(nums) < 8:
                                    l = lines[m_idx].strip()
                                    if re.match(r'^-?\d+\.\d+%$|^—$', l):
                                        nums.append(l)
                                        m_idx += 1
                                    elif l == '':
                                        m_idx += 1
                                    else:
                                        break
                                if nums:
                                    # 永M 的 category 由 cat_line 直接给出 (儲蓄 / 終身壽險)
                                    ym_cat = 'savings' if cat_line == '儲蓄' else 'whole_life'
                                    rows.append(_build_row_ym(
                                        plan=plan_name, category=ym_cat,
                                        term=term, is_activity=is_activity,
                                        nums=nums, table_kind=table_kind,
                                        source_pdf=pdf_path.name,
                                    ))
                                i = m_idx
                                continue

            # 正常情况: Code 字段
            if i + 1 < len(lines):
                code_line = lines[i + 1].strip()
                if re.match(r'^[A-Z]+\d', code_line):
                    code = code_line
                    plan_lines = []
                    j = i + 2
                    while j < len(lines) and not re.match(r'^\d+\s*$', lines[j].strip()):
                        ll = lines[j].strip()
                        if not ll:
                            j += 1
                            continue
                        if re.match(COMPANY_RE, ll):
                            break
                        plan_lines.append(ll)
                        j += 1
                    if j < len(lines):
                        term_line = lines[j].strip()
                        if re.match(r'^\d+\s*$', term_line):
                            term = int(term_line)
                            nums = []
                            k = j + 1
                            while k < len(lines) and len(nums) < 8:
                                l = lines[k].strip()
                                if re.match(r'^-?\d+\.\d+%$|^—$', l):
                                    nums.append(l)
                                    k += 1
                                elif l == '':
                                    k += 1
                                else:
                                    break
                            if nums:
                                rows.append(_build_row(
                                    company=company, code=code,
                                    plan=' '.join(plan_lines),
                                    term=term, is_activity=is_activity,
                                    nums=nums, table_kind=table_kind,
                                    source_pdf=pdf_path.name,
                                ))
                            i = k
                            continue
            i += 1
    return rows


def _build_row(company, code, plan, term, is_activity, nums, table_kind, source_pdf):
    """从解析后的数字构造标准 row dict"""
    # 5 个隐式变量
    currency = infer_currency(plan)
    category = infer_category(plan)
    prepayment = infer_prepayment(plan, code)
    premium_min = infer_premium_min(plan)
    age_min, age_max = infer_age_range(plan)
    activity_deadline = infer_activity_deadline(plan)

    # Bug 修复 #4: 即使 is_activity=False，如果 plan 名含 "於...日前簽署"，也算活动版
    # (NPI L1 PDF 对 EE01905 不写 活動 标记，但 plan 名里有 9/30 前簽署)
    if not is_activity and activity_deadline:
        is_activity = True

    # Bug 修复 #3: 永M 短列 (4 数字) — 5 年交不会有，2 年交会有
    # 短列格式: [y1, y2, add, total]
    is_short = len(nums) == 4

    row = {
        'company': company,
        'code': code,
        'plan': plan,
        'category': category,
        'currency': currency,
        'prepayment': prepayment,
        'premium_min': premium_min,
        'age_min': age_min,
        'age_max': age_max,
        'term': term,
        'is_activity': 1 if is_activity else 0,
        'activity_deadline': activity_deadline,
        'source_pdf': source_pdf,
        'nums': nums,
        'is_short': is_short,
        'table_kind': table_kind,
    }
    return row


def _build_row_ym(plan, category, term, is_activity, nums, table_kind, source_pdf):
    """永M 专用: category 由 cat_line 直接给出（不靠 plan 名推断）"""
    currency = infer_currency(plan)
    prepayment = None
    premium_min = None
    age_min, age_max = infer_age_range(plan)
    activity_deadline = infer_activity_deadline(plan)
    is_short = len(nums) == 4

    return {
        'company': '永M',
        'code': '',
        'plan': plan,
        'category': category,
        'currency': currency,
        'prepayment': prepayment,
        'premium_min': premium_min,
        'age_min': age_min,
        'age_max': age_max,
        'term': term,
        'is_activity': 1 if is_activity else 0,
        'activity_deadline': activity_deadline,
        'source_pdf': source_pdf,
        'nums': nums,
        'is_short': is_short,
        'table_kind': table_kind,
    }


def split_to_columns(row):
    """把 nums 拆成具体列。处理永M 短列的所有变体。"""
    nums = row['nums']
    is_npi = row['table_kind'].startswith('npi')
    level = row['table_kind'].split('_')[1]
    term = row['term']

    cols = {}
    if is_npi:
        if len(nums) == 2:
            # 永M 1年 终身寿险: [y1, total] (L1) 或 [y1, add_or_total] (L2/L3)
            cols['y1'] = float(nums[0].rstrip('%'))
            cols['y2'] = cols['y3'] = cols['y4'] = cols['y5'] = None
            if level == 'l1':
                cols['total'] = float(nums[1].rstrip('%'))
            else:
                # 1年 L2/L3 也只 2 个数 [y1, total] (无加点)
                cols[f'total_{level}'] = float(nums[1].rstrip('%'))
                cols[f'add_{level}'] = 0.0
        elif len(nums) == 3:
            # 永M 2年 L1: [y1, y2, total] 或 1年 L2/L3 终身寿险: [y1, add, total]
            cols['y1'] = float(nums[0].rstrip('%'))
            if level == 'l1' and term == 2:
                cols['y2'] = float(nums[1].rstrip('%'))
                cols['y3'] = cols['y4'] = cols['y5'] = None
                cols['total'] = float(nums[2].rstrip('%'))
            elif level == 'l1' and term == 1:
                cols['y2'] = cols['y3'] = cols['y4'] = cols['y5'] = None
                cols['total'] = float(nums[1].rstrip('%'))
                # Skip last value
            else:
                # L2/L3 1年 终身寿险: [y1, add, total]
                cols['y2'] = cols['y3'] = cols['y4'] = cols['y5'] = None
                cols[f'add_{level}'] = float(nums[1].rstrip('%'))
                cols[f'total_{level}'] = float(nums[2].rstrip('%'))
        elif len(nums) == 4:
            # 永M 2年 L2/L3: [y1, y2, add, total]
            cols['y1'] = float(nums[0].rstrip('%'))
            cols['y2'] = float(nums[1].rstrip('%'))
            cols['y3'] = cols['y4'] = cols['y5'] = None
            cols[f'add_{level}'] = float(nums[2].rstrip('%'))
            cols[f'total_{level}'] = float(nums[3].rstrip('%'))
        else:
            # 标准 NPI: [y1, y2, y3, y4, y5, add_or_total, ...]
            cols['y1'] = float(nums[0].rstrip('%'))
            cols['y2'] = float(nums[1].rstrip('%')) if nums[1] != '—' else None
            cols['y3'] = float(nums[2].rstrip('%')) if nums[2] != '—' else None
            cols['y4'] = float(nums[3].rstrip('%')) if nums[3] != '—' else None
            cols['y5'] = float(nums[4].rstrip('%')) if nums[4] != '—' else None
            if level == 'l1':
                cols['total'] = float(nums[5].rstrip('%'))
            else:
                cols[f'add_{level}'] = float(nums[5].rstrip('%'))
                cols[f'total_{level}'] = float(nums[6].rstrip('%'))
    else:
        # PI: [base_total, add?, total?]
        cols['base_total'] = float(nums[0].rstrip('%'))
        if level == 'l1':
            pass  # base_total 已存
        elif len(nums) >= 3:
            cols[f'add_{level}'] = float(nums[1].rstrip('%'))
            cols[f'total_{level}'] = float(nums[2].rstrip('%'))
        elif len(nums) == 2:
            # PI 1 年 only has [base_total, total]? Shouldn't happen but handle
            cols[f'total_{level}'] = float(nums[1].rstrip('%'))
            cols[f'add_{level}'] = 0.0
    return cols


# =============================================================
# 简单 PDF 表 (直接伯乐 / 间接伯乐)
# =============================================================
def parse_simple_table(pdf_path: Path, value_label: str):
    """直接伯乐 / 间接伯乐 PDF: 单值列"""
    doc = fitz.open(pdf_path)
    rows = []
    for p in range(len(doc)):
        text = doc[p].get_text()
        lines = text.split('\n')
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            m = re.match(COMPANY_RE, line)
            if not m:
                i += 1
                continue
            is_activity = False
            for back in range(i - 1, max(-1, i - 3), -1):
                if lines[back].strip() == '活動':
                    is_activity = True
                    break
                if lines[back].strip() != '':
                    break
            company = m.group(2)
            if i + 1 < len(lines):
                code_line = lines[i + 1].strip()
                if re.match(r'^[A-Z]+\d', code_line):
                    code = code_line
                    plan_lines = []
                    j = i + 2
                    while j < len(lines) and not re.match(r'^\d+\s*$', lines[j].strip()):
                        ll = lines[j].strip()
                        if not ll:
                            j += 1
                            continue
                        if re.match(COMPANY_RE, ll):
                            break
                        plan_lines.append(ll)
                        j += 1
                    if j < len(lines):
                        term_line = lines[j].strip()
                        if re.match(r'^\d+\s*$', term_line):
                            term = int(term_line)
                            k = j + 1
                            while k < len(lines):
                                l = lines[k].strip()
                                if re.match(r'^-?\d+\.\d+%$|^—$', l):
                                    plan_text = ' '.join(plan_lines)
                                    rows.append({
                                        'company': company,
                                        'code': code,
                                        'plan': plan_text,
                                        'category': infer_category(plan_text),
                                        'currency': infer_currency(plan_text),
                                        'prepayment': infer_prepayment(plan_text, code),
                                        'premium_min': infer_premium_min(plan_text),
                                        'age_min': infer_age_range(plan_text)[0],
                                        'age_max': infer_age_range(plan_text)[1],
                                        'activity_deadline': infer_activity_deadline(plan_text),
                                        'term': term,
                                        'is_activity': 1 if is_activity else 0,
                                        'nums': [l],
                                        'is_short': False,
                                        'table_kind': value_label,
                                        'source_pdf': pdf_path.name,
                                    })
                                    i = k + 1
                                    break
                                k += 1
                            continue
            i += 1
    # 永M no-code 简单表
    for p in range(len(doc)):
        text = doc[p].get_text()
        lines = text.split('\n')
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line != '永M':
                i += 1
                continue
            if i + 1 < len(lines):
                cat_line = lines[i + 1].strip()
                if cat_line in ('儲蓄', '終身壽險'):
                    is_activity = False
                    for back in range(i - 1, max(-1, i - 3), -1):
                        if lines[back].strip() == '活動':
                            is_activity = True
                            break
                        if lines[back].strip() != '':
                            break
                    j = i + 2
                    if j < len(lines):
                        plan_name = lines[j].strip()
                        k = j + 1
                        while k < len(lines) and not re.match(r'^\d+\s*$', lines[k].strip()):
                            k += 1
                        if k < len(lines):
                            term_line = lines[k].strip()
                            if re.match(r'^\d+\s*$', term_line):
                                term = int(term_line)
                                m_idx = k + 1
                                while m_idx < len(lines):
                                    l = lines[m_idx].strip()
                                    if re.match(r'^-?\d+\.\d+%$|^—$', l):
                                        # 2026-08-16 Bug C 修复: 永M 伯乐行 company 之前被设为 ''
                                        #   导致 DB 里 company='' 无法按 '永M' 过滤; 同时 category
                                        #   走 infer_category(plan_name) 会把 "萬年青星河傳承計劃 II"
                                        #   误判为 whole_life (默认), 但 cat_line ('儲蓄') 是准确的
                                        cat_map = {'儲蓄': 'savings', '終身壽險': 'whole_life'}
                                        rows.append({
                                            'company': '永M', 'code': '',
                                            'plan': plan_name,
                                            'category': cat_map.get(cat_line, infer_category(plan_name)),
                                            'currency': infer_currency(plan_name),
                                            'prepayment': None,
                                            'premium_min': None,
                                            'age_min': None,
                                            'age_max': None,
                                            'activity_deadline': infer_activity_deadline(plan_name),
                                            'term': term,
                                            'is_activity': 1 if is_activity else 0,
                                            'nums': [l],
                                            'is_short': False,
                                            'table_kind': value_label,
                                            'source_pdf': pdf_path.name,
                                        })
                                        i = m_idx + 1
                                        break
                                    m_idx += 1
                                continue
            i += 1
    return rows


# =============================================================
# 过滤规则: 储蓄险 + USD + ≤5 年 + 活动优先
# =============================================================
def apply_filters(rows, category='savings', currency='USD', max_term=5):
    """应用 4 条过滤规则"""
    filtered = []
    for r in rows:
        if category and r['category'] != category:
            continue
        if currency and r['currency'] != currency:
            continue
        if max_term and r['term'] > max_term:
            continue
        filtered.append(r)
    return filtered


def activity_priority(rows):
    """同 (company, code, plan, term) 优先选活动版，无活动版 fallback 基础版"""
    by_key = {}
    for r in rows:
        key = (r['company'], r['code'], r['plan'], r['term'])
        if key not in by_key:
            by_key[key] = []
        by_key[key].append(r)
    result = []
    for key, recs in by_key.items():
        activity = [r for r in recs if r['is_activity'] == 1]
        if activity:
            result.append(activity[0])
        else:
            result.append(recs[0])
    return result


# =============================================================
# 数据库写入 (with 版本化)
# =============================================================
TABLE_COLUMNS = {
    'npi_fee_l1': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                   'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                   'activity_deadline', 'y1', 'y2', 'y3', 'y4', 'y5', 'total',
                   'source_pdf', 'effective_from'],
    'npi_fee_l2': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                   'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                   'activity_deadline', 'y1', 'y2', 'y3', 'y4', 'y5',
                   'add_l2', 'total_l2', 'source_pdf', 'effective_from'],
    'npi_fee_l3': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                   'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                   'activity_deadline', 'y1', 'y2', 'y3', 'y4', 'y5',
                   'add_l3', 'total_l3', 'source_pdf', 'effective_from'],
    'npi_fee_direct': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                       'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                       'activity_deadline', 'direct_value', 'source_pdf', 'effective_from'],
    'npi_fee_indirect': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                         'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                         'activity_deadline', 'indirect_value', 'source_pdf', 'effective_from'],
    'pi_fee_l1': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                  'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                  'activity_deadline', 'base_total', 'source_pdf', 'effective_from'],
    'pi_fee_l2': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                  'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                  'activity_deadline', 'base_total', 'add_l2', 'total_l2',
                  'source_pdf', 'effective_from'],
    'pi_fee_l3': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                  'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                  'activity_deadline', 'base_total', 'add_l3', 'total_l3',
                  'source_pdf', 'effective_from'],
    'pi_fee_direct': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                      'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                      'activity_deadline', 'direct_value', 'source_pdf', 'effective_from'],
    'pi_fee_indirect': ['company', 'code', 'plan', 'category', 'currency', 'prepayment',
                        'premium_min', 'age_min', 'age_max', 'term', 'is_activity',
                        'activity_deadline', 'indirect_value', 'source_pdf', 'effective_from'],
}

TABLE_NAME_MAP = {
    'npi_l1': 'npi_fee_l1', 'npi_l2': 'npi_fee_l2', 'npi_l3': 'npi_fee_l3',
    'pi_l1': 'pi_fee_l1', 'pi_l2': 'pi_fee_l2', 'pi_l3': 'pi_fee_l3',
    'npi_direct': 'npi_fee_direct', 'npi_indirect': 'npi_fee_indirect',
    'pi_direct': 'pi_fee_direct', 'pi_indirect': 'pi_fee_indirect',
}


def insert_row(conn, table_name, row, effective_from):
    cols = TABLE_COLUMNS[table_name]
    values = []
    for c in cols:
        if c in row:
            values.append(row[c])
        elif c == 'effective_from':
            values.append(effective_from)
        else:
            values.append(None)
    placeholders = ','.join(['?'] * len(cols))
    col_list = ','.join(cols)
    sql = f"INSERT OR REPLACE INTO {table_name} ({col_list}) VALUES ({placeholders})"
    conn.execute(sql, values)


def archive_old_rows(conn, effective_from):
    """把现有 active 行的 effective_to 设为新日期前一日"""
    prev_date = (datetime.strptime(effective_from, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d')
    for table_name in TABLE_NAME_MAP.values():
        conn.execute(
            f"UPDATE {table_name} SET effective_to = ? WHERE effective_to IS NULL",
            (prev_date,)
        )
    conn.commit()


# =============================================================
# 主流程
# =============================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf-dir', default='/Users/soldier/Downloads', help='PDF 所在目录')
    ap.add_argument('--db', default='db/hx_rates.db', help='SQLite DB 路径')
    ap.add_argument('--effective-from', default=datetime.now().strftime('%Y-%m-%d'),
                    help='本次数据的生效起始日期 (默认今天)')
    ap.add_argument('--filter-category', default='savings', help='类别过滤 (默认 savings)')
    ap.add_argument('--filter-currency', default='USD', help='币种过滤 (默认 USD)')
    ap.add_argument('--filter-max-term', type=int, default=5, help='年期上限 (默认 5)')
    ap.add_argument('--skip-archive', action='store_true', help='跳过老数据归档 (调试用)')
    ap.add_argument('--report', help='提取后生成 Markdown 报告 (路径, e.g. db/reference/extract_2026Q4.md)')
    args = ap.parse_args()

    pdf_dir = Path(args.pdf_dir).expanduser()
    db_path = Path(args.db).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")

    if not args.skip_archive:
        archive_old_rows(conn, args.effective_from)

    # 10 个 PDF 对应 10 张表
    pdf_table_map = [
        ('7月HXNPI费率表L1.pdf', 'npi_l1'),
        ('7月HXNPI费率表L2.pdf', 'npi_l2'),
        ('7月HXNPI费率表L3.pdf', 'npi_l3'),
        ('7月HXNPI费率表直接伯乐.pdf', 'npi_direct'),
        ('7月HXNPI费率表间接伯乐.pdf', 'npi_indirect'),
        ('7月HXPI费率表L1.pdf', 'pi_l1'),
        ('7月HXPI费率表L2.pdf', 'pi_l2'),
        ('7月HXPI费率表L3.pdf', 'pi_l3'),
        ('7月HXPI费率表直接伯乐.pdf', 'pi_direct'),
        ('7月HXPI费率表间接伯乐.pdf', 'pi_indirect'),
    ]

    total_inserted = 0
    for pdf_name, table_kind in pdf_table_map:
        pdf_path = pdf_dir / pdf_name
        if not pdf_path.exists():
            print(f"WARNING: {pdf_path} 不存在，跳过", file=sys.stderr)
            continue

        # 解析
        if table_kind.endswith('direct') or table_kind.endswith('indirect'):
            rows = parse_simple_table(pdf_path, table_kind)
        else:
            rows = parse_pdf(pdf_path, table_kind)

        # 过滤
        filtered = apply_filters(
            rows,
            category=args.filter_category if args.filter_category != 'all' else None,
            currency=args.filter_currency if args.filter_currency != 'all' else None,
            max_term=args.filter_max_term if args.filter_max_term > 0 else None,
        )

        # 活动优先
        deduped = activity_priority(filtered)

        # 写入
        table_name = TABLE_NAME_MAP[table_kind]
        inserted = 0
        for row in deduped:
            if table_kind == 'npi_direct' or table_kind == 'pi_direct':
                cols = {'direct_value': float(row['nums'][0].rstrip('%'))}
            elif table_kind == 'npi_indirect' or table_kind == 'pi_indirect':
                cols = {'indirect_value': float(row['nums'][0].rstrip('%'))}
            else:
                cols = split_to_columns(row)
            data_row = {
                'company': row['company'],
                'code': row['code'],
                'plan': row['plan'],
                'category': row['category'],
                'currency': row['currency'],
                'prepayment': row['prepayment'],
                'premium_min': row['premium_min'],
                'age_min': row['age_min'],
                'age_max': row['age_max'],
                'term': row['term'],
                'is_activity': row['is_activity'],
                'activity_deadline': row['activity_deadline'],
                'source_pdf': row['source_pdf'],
            }
            data_row.update(cols)
            insert_row(conn, table_name, data_row, args.effective_from)
            inserted += 1

        conn.commit()
        total_inserted += inserted
        print(f"  {pdf_name} → {table_name}: parsed={len(rows)} filtered={len(filtered)} inserted={inserted}")

    conn.close()
    print(f"\nDone. Total rows inserted: {total_inserted}")
    print(f"DB: {db_path}")

    # 2026-08-16: 自动生成结构化报告 (per-PDF stats + per-company 产品数 + activity 计数)
    if args.report:
        generate_report(args.db, args.report, args.effective_from)


def generate_report(db_path: str, report_path: str, effective_from: str):
    """生成提取报告 (Markdown 格式), 方便用户/qa_validate 对账"""
    import sqlite3 as _sq
    from datetime import datetime as _dt
    conn = _sq.connect(db_path)
    conn.row_factory = _sq.Row

    lines = [
        f'# Extract 报告 ({_dt.now().strftime("%Y-%m-%d %H:%M:%S")})',
        '',
        f'**生效日期 (effective_from)**: {effective_from}',
        f'**DB**: `{db_path}`',
        '',
        '## 各表产品数',
        '',
        '| 表 | 总数 | 活动版 | 非活动版 |',
        '|----|------|--------|----------|',
    ]
    table_labels = {
        'npi_fee_l1': 'NPI L1', 'npi_fee_l2': 'NPI L2', 'npi_fee_l3': 'NPI L3',
        'pi_fee_l1':  'PI L1',  'pi_fee_l2':  'PI L2',  'pi_fee_l3':  'PI L3',
        'npi_fee_direct':  'NPI 直接伯乐', 'npi_fee_indirect':  'NPI 间接伯乐',
        'pi_fee_direct':   'PI 直接伯乐',  'pi_fee_indirect':   'PI 间接伯乐',
    }
    for tbl, label in table_labels.items():
        total = conn.execute(f'SELECT COUNT(*) FROM {tbl} WHERE effective_from = ?', (effective_from,)).fetchone()[0]
        active = conn.execute(f'SELECT COUNT(*) FROM {tbl} WHERE effective_from = ? AND is_activity = 1', (effective_from,)).fetchone()[0]
        lines.append(f'| {label} | {total} | {active} | {total - active} |')

    lines += ['', '## 各公司产品数 (PI L2, 主战场)', '']
    lines += ['| 公司 | 产品数 |', '|------|--------|']
    for r in conn.execute("""
        SELECT company, COUNT(DISTINCT code || term) AS n
        FROM pi_fee_l2 WHERE effective_from = ?
        GROUP BY company ORDER BY n DESC
    """, (effective_from,)):
        lines.append(f'| {r["company"]} | {r["n"]} |')

    lines += ['', '## 0 数据产品 (潜在问题)', '']
    lines += ['| 表 | 公司 | code | term |', '|----|------|------|------|']
    issues = 0
    # 每张表的"费率列"不同: NPI L1 用 total, NPI L2/L3 用 total_l2/total_l3, PI L1 用 base_total, PI L2/L3 用 total_l2/total_l3
    rate_cols_by_tbl = {
        'npi_fee_l1': ['y1', 'total'],
        'npi_fee_l2': ['y1', 'total_l2'],
        'npi_fee_l3': ['y1', 'total_l3'],
        'pi_fee_l1':  ['base_total'],
        'pi_fee_l2':  ['base_total', 'total_l2'],
        'pi_fee_l3':  ['base_total', 'total_l3'],
    }
    for tbl, cols in rate_cols_by_tbl.items():
        null_checks = ' AND '.join(f'({c} IS NULL OR {c} = 0)' for c in cols)
        for r in conn.execute(f"""
            SELECT company, code, term FROM {tbl}
            WHERE effective_from = ? AND {null_checks}
        """, (effective_from,)):
            issues += 1
            if issues <= 20:
                lines.append(f'| {table_labels[tbl]} | {r["company"]} | {r["code"] or "(空)"} | {r["term"]} |')
    if issues > 20:
        lines.append(f'| ... 还有 {issues - 20} 行 | | | |')
    if issues == 0:
        lines.append('| (无) | | | |')

    Path(report_path).write_text('\n'.join(lines), encoding='utf-8')
    print(f'  报告: {report_path}')


if __name__ == '__main__':
    main()